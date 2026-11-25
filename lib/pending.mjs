import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVE, claim, getTicket, listTickets, setTicket } from './db.mjs';
import { ghJson, orcaJson } from './exec.mjs';
import { home } from './paths.mjs';
import { evaluatePr } from './pr-state.mjs';
import { assignedJql, profileById } from './profiles.mjs';

/**
 * One failing ticket, PR or profile must not disable a whole check: the error is
 * logged to errors.log and printed on stderr, and the rest goes on.
 */
export function logError(where, e) {
  const line = `${new Date().toISOString()} ${where}: ${e.message.split('\n')[0]}`;
  console.error(`tko: ${line}`);
  try {
    appendFileSync(join(home, 'errors.log'), `${line}\n`);
  } catch {
    // the data folder may not exist in tests
  }
}

function jiraSearch(profile, jql) {
  const args = ['jira', 'search', jql, '--limit', '200'];
  if (profile.jira.siteId) args.push('--site', profile.jira.siteId);
  return orcaJson(args);
}

/** Open tickets assigned to the owner that are not tracked yet, or were stopped by a reassignment and came back. */
export function pendingAssignments(db, profiles) {
  const out = [];
  for (const p of profiles) {
    let issues;
    try {
      issues = jiraSearch(p, assignedJql(p));
    } catch (e) {
      logError(`assignments ${p.id}`, e);
      continue;
    }
    for (const issue of issues) {
      const row = getTicket(db, issue.key);
      if (!row || (row.status === 'stopped' && row.stop_reason === 'reassigned')) {
        out.push({ key: issue.key, profile: p.id, title: issue.title, url: issue.url, status: issue.status?.name, again: Boolean(row) });
      }
    }
  }
  return out;
}

/** Records every open assigned ticket as `baseline`, so installing never floods the chat with the backlog. */
export function seed(db, profiles) {
  let n = 0;
  for (const t of pendingAssignments(db, profiles)) {
    if (!t.again && claim(db, { key: t.key, profile: t.profile, title: t.title, url: t.url, source: 'seed', status: 'baseline' })) n++;
  }
  return n;
}

/** Active tickets no longer assigned to the owner. */
export function pendingGuard(db, profiles) {
  const out = [];
  for (const p of profiles) {
    const rows = listTickets(db, { status: ACTIVE.join(','), profile: p.id });
    if (!rows.length) continue;
    const jql = `key in (${rows.map((r) => r.key).join(',')}) AND (assignee is EMPTY OR assignee != currentUser())`;
    try {
      for (const issue of jiraSearch(p, jql)) {
        out.push({ key: issue.key, profile: p.id, assignee: issue.assignee?.displayName ?? null, status: getTicket(db, issue.key).status });
      }
    } catch (e) {
      logError(`guard ${p.id}`, e);
    }
  }
  return out;
}

const PR_FIELDS = 'number,state,isDraft,headRefOid,mergeable,labels,reviews,statusCheckRollup,url';

/** Tracked tickets grouped by the pull request they share. */
function ticketsByPr(db) {
  const groups = new Map();
  for (const row of listTickets(db, { status: 'pr_draft,pr_ready' })) {
    if (!row.pr_number) continue;
    const id = `${row.profile}#${row.pr_number}`;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return [...groups.values()];
}

/**
 * Tracked PRs that need the bot, one entry each, with every ticket the PR covers in
 * `keys`. Keeps draft/ready in sync with GitHub on the way. A reason is reported once
 * per PR state: the bot acknowledges it with `tko ack`.
 */
export function pendingPrs(db, profiles, now = Date.now()) {
  const out = [];
  for (const rows of ticketsByPr(db)) {
    const [{ profile, pr_number: number }] = rows;
    const keys = rows.map((r) => r.key).sort();
    try {
      const p = profileById(profiles, profile);
      const pr = ghJson(['pr', 'view', String(number), '-R', p.repo.github, '--json', PR_FIELDS], p.repo.ghUser);
      const e = evaluatePr(pr, rows[0], p, now);
      for (const row of rows) {
        if (e.status !== row.status || pr.headRefOid !== row.head_sha) {
          setTicket(db, row.key, { status: e.status, headSha: pr.headRefOid }, { detail: 'synced with GitHub' });
        }
      }
      if (e.reason && rows.some((row) => row.pr_ack !== e.signature)) {
        out.push({
          key: keys[0],
          keys,
          profile: p.id,
          pr: pr.number,
          url: pr.url,
          status: e.status,
          reason: e.reason,
          signature: e.signature,
          failedChecks: e.checks.failed,
          reviewersReported: e.reviewers.reported,
          reviewersMissing: e.reviewers.missing,
          labels: e.labels,
          mergeable: e.mergeable,
        });
      }
    } catch (e) {
      logError(`pr ${keys.join('+')} #${number}`, e);
    }
  }
  return out;
}
