---
name: ticket-kickoff
description: My owner answered a ticket card ("ok KEY", "ok KEY + changes", "no KEY"), or a coding worker reported back. Create the workspace, move the ticket to In progress, start the coding agents, and record the draft PR they open.
---

# Ticket kickoff

## 1. Which ticket, which answer

- Find the key in the reply. No key: allowed only if exactly one ticket is `proposed` (`tko list --status proposed --json`); otherwise ask which one.
- `tko get <KEY> --json` must say `proposed`. Anything else: tell my owner where the ticket stands and stop.

**"no"** → `tko set <KEY> --status rejected --detail "<their words, short>"`. Confirm in one line. Done.

**"ok"** → record what they added: `tko set <KEY> --status approved --detail "<plan and instructions from the reply>"`. Their changes override the plan in `briefs/<KEY>.md`; append them to that file under `## Decisions approved by the owner`: one line per decision, including each open point whose default they accepted, worded exactly as it was put to them.

**Several tickets together** (only when my owner says so): one branch, one workspace, one pull request. Record the answer, the workspace, the dispatches and the pull request on every ticket; start one worker for all of them. Use the first key for file names, and attach every ticket to the workspace with its own `--reference <KEY>`.

## 2. Check before acting

`orca jira issue <KEY> --json`: still assigned to my owner? If not → `assignment-guard`.

## 3. Workspace

A ticket that came back after a reassignment may already have them: if `tko get` shows workspaces, a branch or a PR, reuse them (check the worktree still exists with `orca worktree list --json`) and start the agents there with the new instructions, instead of creating new ones.

Profile: `tko profile <KEY>`.

```
orca worktree create --repo path:<repo.path> --name <KEY> --branch <branch> \
  --base-branch origin/<repo.baseBranch> --reference <KEY> [--reference-site <jira.siteId>] \
  --no-parent --setup skip --comment "<English title>" --json
```

- `--no-parent` puts the workspace under its own project in Orca instead of under my home.
- Keep the worktree id and path from the result.
- Setup: run `tko setup-worktree <path>`. If it fails, report the error and stop (status stays `approved`).
- `tko set <KEY> --status working --workspace <worktree id> --detail "workspace created"`.

**Parallel plan** (only when the plan says so): one extra worktree per part, branched from the ticket branch, branch `<branch>--<part>`, created with `--parent-worktree id:<main worktree id>` and set up the same way; record each with `tko set <KEY> --workspace <id>`. Parts must touch separate files.

## 4. Jira

- `orca jira status set <KEY> --to "<jira.transitions.start>"`. If that transition is not available (`orca jira status list <KEY> --json` shows what is), tell my owner and continue.
- `orca jira comment add <KEY> --body "<jira.startComment with {branch} filled>"` — the only Jira comment I ever write.

## 5. Pull request method

Follow `pr-method` (check). If there is none yet, or it changed, post the proposal now and go on: the agents can code while my owner decides.

## 6. Start the coding agents

For each agent, write its task to `briefs/<KEY>.worker[-<part>].md` from `templates/worker-spec.md` in my home, filled with: the brief, my owner's instructions, the profile's `workerRules`, branch and commit format, base branch, the absolute path of `tko`, and what to report. A part worker does not open the PR; it reports its commits. Do not add duties the template does not have: the worker is done when the draft PR is open, it does not wait for CI or reviews.

```
orca orchestration worker-start --environment local --worktree id:<worktree id> \
  --agent <agent> [--model <model>] [--effort <effort>] \
  --task-title "<KEY> <English title>" --spec-file briefs/<KEY>.worker.md --json
```

Record each dispatch: `tko set <KEY> --dispatch <dispatch id>`. Tell my owner in one line what started where, then end the turn. Orca wakes me when a worker reports.

## When a worker reports

- **Single worker, PR opened** (`worker_done` with the PR number): check it with `gh pr view <n> -R <repo.github> --json number,isDraft,url,baseRefName,headRefName` — it must be a draft, on the ticket branch, against the base branch. Then `tko set <KEY> --status pr_draft --pr <n> --detail "draft PR opened"` (for every ticket the PR covers) and tell my owner: PR link, what changed, tests run, anything left open. From here the pull-request check follows CI. If `orca automations list --json` shows `TKO · pull request check` disabled, say that nothing follows this PR until my owner enables it or writes to me; I do not enable automations myself.
- **Part workers**: when every part has reported, start one integration worker in the main worktree to merge the part branches into the ticket branch, run the checks, push and open the draft PR (same spec template, task "integrate parts"). Then as above.
- **Waiting for the pull request method** (a worker asks because `tko pr-method check` did not pass): follow `pr-method`; answer the worker once my owner has decided.
- **A choice the method leaves to the owner** (e.g. an audit found problems: fix first or open anyway): ask my owner, then pass on the answer.
- **A deviation** (a worker wants to do something different from an approved decision, or two requirements conflict): put it on the item with the options, and pass the answer on. The worker waits before pushing.
- **Failure or question**: a `question` I can answer from the brief or my owner's instructions → answer it with `orca orchestration reply`. Otherwise ask my owner, quoting the worker, and wait. A worker that failed: tell my owner what failed; the ticket stays `working`.
