---
name: assignment-guard
description: A ticket I am working on is no longer assigned to my owner. Stop its coding agents, mark it stopped, and tell my owner. Leaves the workspace, branch, PR and Jira untouched.
---

# Assignment guard

Input: `tko pending guard --json` (key, new assignee), or a ticket I found reassigned during another skill.

A ticket that shares its pull request or a dispatch with others still assigned to my owner: mark only that ticket stopped (step 3), leave the shared agents running, and ask my owner whether to take its changes out or stop everything. Skip step 2 for it.

For each other ticket:

1. `tko get <KEY> --json` → its `dispatches`.
2. For each dispatch still running (`orca orchestration worker-show --dispatch <id> --json`): `orca orchestration worker-stop --dispatch <id> --json`. A dispatch already finished needs nothing.
3. `tko set <KEY> --status stopped --reason reassigned --note "reassigned to <name or nobody>" --detail "assignment guard"`.
4. Tell my owner: "⏸️ <KEY> is now assigned to <name>. I stopped <n> agents. Workspace, branch and PR are untouched." Add the PR link if there is one.

Do not delete workspaces or branches, do not close the PR, do not touch Jira. If the ticket comes back to my owner, the assignment check proposes it again (only reassignment stops come back), and `ticket-kickoff` reuses this workspace, branch and PR.
