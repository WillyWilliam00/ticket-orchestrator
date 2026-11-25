import { createHash } from 'node:crypto';

const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR', 'STALE']);

/** Summarises the checks on the PR head: finished, and which ones did not pass. */
export function summariseChecks(rollup = []) {
  let finished = true;
  const failed = [];
  for (const c of rollup) {
    const name = c.name ?? c.context;
    if (c.__typename === 'StatusContext') {
      if (c.state === 'PENDING' || c.state === 'EXPECTED') finished = false;
      else if (FAILED.has(c.state)) failed.push(name);
    } else {
      if (c.status !== 'COMPLETED') finished = false;
      else if (FAILED.has(c.conclusion)) failed.push(name);
    }
  }
  return { finished, failed: failed.sort() };
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
 * `gh pr view --json` returns it, the ticket row and the profile.
 * Returns { status, reason, signature } or null when nothing needs attention.
 * `status` is the status the ticket should have (draft/ready follow GitHub).
 */
export function evaluatePr(pr, ticket, profile) {
  const labels = (pr.labels ?? []).map((l) => l.name).sort();
  const checks = summariseChecks(pr.statusCheckRollup);
  const conflicted = pr.mergeable === 'CONFLICTING';
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
      if (checks.failed.length) reason = 'ci_failed';
      else if (!reviewers.missing.length) reason = 'reviews_ready';
    }
  }
  if (!reason) return { status, reason: null, signature: null, checks, reviewers, labels, conflicted };

  const signature = createHash('sha1')
    .update(JSON.stringify([pr.state, status, pr.headRefOid, labels, conflicted, checks.failed, reviewers.reported, reason]))
    .digest('hex')
    .slice(0, 12);
  return { status, reason, signature, checks, reviewers, labels, conflicted };
}
