import { createHash } from 'node:crypto';

const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR', 'STALE']);
export const DEFAULT_REVIEWER_TIMEOUT_MINUTES = 30;

/** Summarises the checks on the PR head: finished, which ones did not pass, and when the last one ended. */
export function summariseChecks(rollup = []) {
  let finished = true;
  let lastCompletedAt = null;
  const failed = [];
  for (const c of rollup) {
    const name = c.name ?? c.context;
    if (c.__typename === 'StatusContext') {
      if (c.state === 'PENDING' || c.state === 'EXPECTED') finished = false;
      else if (FAILED.has(c.state)) failed.push(name);
    } else {
      if (c.status !== 'COMPLETED') finished = false;
      else if (FAILED.has(c.conclusion)) failed.push(name);
      if (c.completedAt && (!lastCompletedAt || c.completedAt > lastCompletedAt)) lastCompletedAt = c.completedAt;
    }
  }
  return { finished, failed: failed.sort(), lastCompletedAt };
}

/** Which configured reviewers have reported on the head commit. */
export function reviewersReported(pr, reviewers = []) {
  const reported = [];
  const missing = [];
  for (const r of reviewers) {
    const byReview = r.login && (pr.reviews ?? []).some((v) => v.author?.login === r.login && v.commit?.oid === pr.headRefOid);
    const byCheck =
      r.checkName &&
      (pr.statusCheckRollup ?? []).some((c) => (c.name ?? c.context) === r.checkName && (c.status === 'COMPLETED' || (c.state && c.state !== 'PENDING')));
    (byReview || byCheck ? reported : missing).push(r.name);
  }
  return { reported, missing };
}

/**
 * Decides whether a tracked PR needs the bot, and why. Pure: takes the PR as
 * `gh pr view --json` returns it, the ticket row, the profile and the current time.
 * Returns { status, reason, signature, ... }; reason is null when nothing needs attention.
 * `status` is the status the ticket should have (draft/ready follow GitHub).
 *
 * A reviewer that never reports does not block forever: once CI on the head commit
 * finished more than `pr.reviewerTimeoutMinutes` ago, reviews_ready fires with
 * the missing reviewers listed.
 */
export function evaluatePr(pr, ticket, profile, now = Date.now()) {
  const labels = (pr.labels ?? []).map((l) => l.name).sort();
  const checks = summariseChecks(pr.statusCheckRollup);
  let status = ticket.status;
  if (status === 'pr_draft' && !pr.isDraft) status = 'pr_ready';
  if (status === 'pr_ready' && pr.isDraft) status = 'pr_draft';

  let reason = null;
  let reviewers = { reported: [], missing: [] };
  if (pr.state !== 'OPEN') {
    reason = pr.state === 'MERGED' ? 'pr_merged' : 'pr_closed';
  } else if (checks.finished) {
    if (status === 'pr_draft') {
      reason = checks.failed.length ? 'ci_failed' : 'ci_passed';
    } else if (status === 'pr_ready') {
      reviewers = reviewersReported(pr, profile.pr?.reviewers);
      const timeout = (profile.pr?.reviewerTimeoutMinutes ?? DEFAULT_REVIEWER_TIMEOUT_MINUTES) * 60_000;
      const waitedEnough = !checks.lastCompletedAt || now - Date.parse(checks.lastCompletedAt) >= timeout;
      if (checks.failed.length) reason = 'ci_failed';
      else if (!reviewers.missing.length || waitedEnough) reason = 'reviews_ready';
    }
  }
  const base = { status, reason, signature: null, checks, reviewers, labels, mergeable: pr.mergeable };
  if (!reason) return base;

  // The raw mergeable value is part of the state: UNKNOWN → MERGEABLE must wake the bot again.
  const signature = createHash('sha1')
    .update(JSON.stringify([pr.state, status, pr.headRefOid, labels, pr.mergeable, checks.failed, reviewers.reported, reason]))
    .digest('hex')
    .slice(0, 12);
  return { ...base, signature };
}
