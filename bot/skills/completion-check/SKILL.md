---
name: completion-check
description: Decide whether a ticket's pull request is mergeable by the profile's rules; when it is, move the Jira ticket to the profile's complete transition and tell my owner. Also handles a PR that was merged or closed.
---

# Completion check

## Merged or closed (reason pr_merged / pr_closed)

- **merged**: if the ticket is not `completed`, run the Jira complete transition (below) and `tko set <KEY> --status completed --force --detail "PR merged"`. Tell my owner.
- **closed without merge**: `tko set <KEY> --status stopped --note "PR closed without merge"`. Tell my owner; do nothing else.
- `tko ack <KEY> <signature>`.

## Mergeable?

`gh pr view <n> -R <repo.github> --json state,isDraft,mergeable,labels,statusCheckRollup,reviews,headRefOid,url`

All must hold:
1. open, and not a draft;
2. every check finished and passed (skipped and neutral are fine);
3. `mergeable` is not `CONFLICTING` (if `UNKNOWN`, treat as not yet known: say so, do not complete);
4. none of the profile's `pr.blockingLabels`;
5. every reviewer in `pr.reviewers` reported on the head commit, with no open findings (from `review-triage`, or skipped by my owner).

**All true** →
- still assigned to my owner? (`orca jira issue <KEY> --json`) If not → `assignment-guard`;
- `orca jira status set <KEY> --to "<jira.transitions.complete>"` (if unavailable, tell my owner and stop here);
- `tko set <KEY> --status completed --detail "mergeable: Jira moved to <transition>"`;
- tell my owner: "✅ <KEY> — PR #<n> is mergeable, Jira moved to <transition>." with the link.

**Something missing** → tell my owner once what blocks it, specifically (e.g. the blocking label and the profile's `blockingLabelHint`, a conflict to resolve, a check still failing). The status stays `pr_ready`. When the blocker goes away the pull-request check sees a new state and brings me back.

Always finish with `tko ack <KEY> <signature>` when I came from a pull-request event.
