---
name: ci-fix
description: CI failed on a ticket's pull request (reason ci_failed from tko pending prs). Find what failed and have a coding agent fix it on the ticket branch.
---

# CI fix

One pull request, one fix, however many tickets it covers (`keys`).

Input: an entry from `tko pending prs --json` with `reason: ci_failed`, its `failedChecks` and `signature`.

1. Still assigned to my owner? (`orca jira issue <KEY> --json`) If not → `assignment-guard`.
2. Count earlier attempts: `tko get <KEY> --json` → events whose detail starts with `ci-fix`. After 3 attempts on the same checks, do not start another: tell my owner what keeps failing, `tko ack <KEY> <signature>`, stop.
3. Read the failure:
   - `gh pr checks <pr> -R <repo.github>`;
   - for GitHub Actions: `gh run view <run id> -R <repo.github> --log-failed` (keep only the relevant lines);
   - for other checks, the check's details URL and output.
4. If it is not caused by the PR (infrastructure, flaky test that passes on the base branch, external service): tell my owner, suggest a re-run (`gh run rerun <id> --failed` only if they agree), ack, stop.
5. Otherwise write `briefs/<KEY>.ci-fix.md` from `templates/worker-spec.md`: the failing checks, the log lines, the likely cause, "fix it, run the same checks locally, commit with the ticket's format, push; do not open another PR". Start a worker in the ticket's worktree (`--worktree id:<first workspace>`), record it with `tko set <KEY> --dispatch <id> --detail "ci-fix: <checks>"`.
6. `tko ack <KEY> <signature>`. Tell my owner in one line: which check failed, why, and that a fix is running.

When the worker reports: tell my owner what it changed. CI runs again by itself; the pull-request check picks it up.
