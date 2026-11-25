---
name: completion-check
description: Decide whether a ticket's pull request is mergeable by the profile's rules; when it is, move the Jira ticket to the profile's complete transition and tell my owner. Also handles a PR that was merged or closed.
---

# Completion check

The pull request is judged once. When it covers several tickets (`keys`), do the assignment check, the Jira transition and `tko set` for each, and tell my owner in one message which ones moved and which did not. A ticket no longer assigned to my owner follows `assignment-guard` and does not hold back the others.

## Merged or closed (reason pr_merged / pr_closed)

- **merged**: if the ticket is not `completed`, run the Jira complete transition (below) and `tko set <KEY> --status completed --force --detail "PR merged"`. Tell my owner.
- **closed without merge**: `tko set <KEY> --status stopped --reason pr_closed --note "PR closed without merge"`. Tell my owner; do nothing else.
- `tko ack <KEY> <signature>`.

## Mergeable?

First `tko pr-method check <KEY> --json`: if it is not `current`, follow `pr-method` and come back when my owner has decided. The blocking labels may be out of date until then.

`gh pr view <n> -R <repo.github> --json state,isDraft,mergeable,labels,statusCheckRollup,reviews,headRefOid,url`

All must hold:
1. open, and not a draft;
2. every check finished and passed (skipped and neutral are fine);
3. `mergeable` is `MERGEABLE`. `CONFLICTING` blocks. `UNKNOWN` means GitHub has not computed it yet: do not complete and do not message my owner; the pull-request check wakes me again as soon as it changes.
4. none of the labels under "Labels that block completion" in `tko pr-method show <KEY>`;
5. every reviewer in `pr.reviewers` reported on the head commit, with no open findings (from `review-triage`, or skipped by my owner). A reviewer that did not report within the timeout (`reviewersMissing`) does not count as approval: ask on the item, naming the missing reviewer ("complete <KEY>" / "wait"), and complete only on "complete <KEY>".

**All true** →
- still assigned to my owner? (`orca jira issue <KEY> --json`) If not → `assignment-guard`;
- `orca jira status set <KEY> --to "<jira.transitions.complete>"` (if unavailable, tell my owner and stop here);
- `tko set <KEY> --status completed --detail "mergeable: Jira moved to <transition>"`;
- tell my owner: "✅ <KEY> — PR #<n> is mergeable, Jira moved to <transition>." with the link.

**"complete <KEY>" from my owner** → they accept what is missing (for example a reviewer that never ran): run the Jira step above and complete. It never overrides failing checks, conflicts or blocking labels.

**Something missing** → tell my owner once what blocks it, specifically (e.g. the blocking label and what the method says removes it, a conflict to resolve, a check still failing). The status stays `pr_ready`. When the blocker goes away the pull-request check sees a new state and brings me back.

Always finish with `tko ack <KEY> <signature>` when I came from a pull-request event.
