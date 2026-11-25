# Ticket Orchestrator

An [Orca](https://github.com/stablyai/orca) bot kit that takes the tickets assigned to you from "assigned" to a mergeable **draft** pull request, asking for your approval at every step that matters.

Works with Jira, GitHub and Orca. Not affiliated with Atlassian, GitHub or Orca.

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Setup, step by step](#setup-step-by-step)
- [Using it](#using-it)
- [Optional extras](#optional-extras)
- [Pause, update, uninstall](#pause-update-uninstall)
- [Troubleshooting](#troubleshooting)
- [Profile reference](#profile-reference)

## What it does

1. **Notices new tickets** assigned to you, with a Jira check every few minutes (5 by default, configurable). It also catches tickets you assign to yourself.
2. **Analyses** each ticket against your code and posts a card in the bot's Orca chat: summary, acceptance criteria, likely files, technical analysis, open points, English title, proposed branch, and a plan (how many coding agents, which model).
3. **Waits for your "ok"**. Then it creates the workspace (branch linked to the ticket), copies your local env files into it, moves the ticket to *In progress* with one comment, and starts the coding agents.
4. The agents follow your repository's rules, commit as `{type}/{KEY} | summary`, push, and open a **draft** PR.
5. **Follows CI** and fixes failures. When you mark the PR ready for review, it reads the reviewers you configured, explains their findings and **proposes** fixes, which it applies only after your ok.
6. When the PR is **mergeable** by your project's rules (checks green, no conflicts, no blocking labels, reviewers satisfied), it moves the ticket to *complete* and tells you.
7. If a ticket is **reassigned** to someone else, it stops its agents and tells you.

It never merges, approves, marks a PR ready, force-pushes, or posts anywhere except its own chat.

## How it works

| Piece | Where it lives | What it is |
| --- | --- | --- |
| The bot | Orca, folder `~/.orca/bots/ticket-orchestrator/` | An Orca bot. This kit gives it its character (`SOUL.md`) and one skill per moment of the flow. |
| `tko` | `~/.local/bin/tko` → this repository | A small command (Node.js, no dependencies): ticket state, the checks, workspace setup, a local report. |
| Profiles | `~/.config/ticket-orchestrator/profiles/*.json` | One per project: Jira project, repository, rules. Personal; never committed. |
| State | `~/.config/ticket-orchestrator/state.db` | SQLite. Every ticket the bot handles, its status and its history. |
| Automations | Orca | What wakes the bot without you writing to it. See below. |

### The three automations

On its own, an Orca bot only acts when you write to it. An automation is an Orca timer that starts it for you. It is not a skill: the **automation** decides *when* the bot starts, the **skill** tells it *how* to do the job.

| Automation | When it runs | What the bot then does |
| --- | --- | --- |
| `TKO · new assignments check` | Every `pollMinutes` (default 5), **only if** a ticket assigned to you is not tracked yet | Analyses the ticket and posts the card |
| `TKO · pull request check` | Every 5 min, **only if** a tracked PR changed (CI finished, marked ready, reviewers reported, labels, merged) | Fixes CI, triages reviews, completes the ticket |
| `TKO · assignment guard` | Every 30 min, **only if** a ticket in progress is no longer assigned to you | Stops its agents and tells you |

"Only if" is an Orca *precheck*: before starting the bot, Orca runs a `tko precheck …` command, which takes about a second. When there is nothing to do, the bot is not started and the run costs nothing.

`tko automations` creates all three with the exact settings (schedule, absolute paths, prechecks). They are created **disabled**: you try one ticket first, then turn them on.

### How pull requests are opened

The kit has no built-in way to open pull requests. At a project's **first ticket** the bot reads the repository's own rules (AGENTS.md, CLAUDE.md, CONTRIBUTING.md, pull request templates, workflows, skills, Cursor rules), summarises them in its chat with the files they come from, and asks you:

- **"method ok &lt;project&gt;"**: saved as is.
- **Tell it what to change**: saved with your change, and it lists where that departs from the repository's rules.
- No rules found: it proposes a plain draft pull request.

The method also holds the **labels that block completion**. From then on every agent follows it without asking.

**When the rules change,** a script notices that one of those files changed or appeared on the base branch. It runs at every kickoff, before every push, before opening the PR and before completing a ticket. Only then does the bot read the difference. If it concerns pull requests it tells you and asks; meanwhile the coding goes on, and only pushing, opening and completing wait.

- A draft is always a draft: a method cannot make the bot merge, approve, mark ready or force-push.
- Rules are read from the base branch on the remote, so a ticket's own branch cannot change them.
- It cannot see rules that exist only in GitHub's settings (branch protection, apps) or in other files, and whether a change concerns pull requests is the bot's judgement.

It is saved in `~/.config/ticket-orchestrator/pr-methods/<project>.md`. You can edit it; delete it to be asked again.

## Requirements

- macOS (Linux should work, not tested)
- [Orca](https://github.com/stablyai/orca), with Jira connected (`orca jira connection` lists the site)
- Node.js 22.13 or newer (the built-in `node:sqlite` is used)
- GitHub CLI (`gh`) signed in to an account that can open PRs on your project
- Claude (or another coding agent) set up in Orca

## Setup, step by step

Run `tko doctor` at any point: it checks every step below and tells you what is missing.

### 1. Install the kit

```sh
git clone https://github.com/WillyWilliam00/ticket-orchestrator.git
cd ticket-orchestrator
./install.sh
```

- **What it does:** finds a Node.js with SQLite, `orca` and `gh`, and creates `~/.local/bin/tko` with their absolute paths (Orca automations run without your shell's PATH). It also creates `~/.config/ticket-orchestrator/`.
- **Check:** `tko help` prints the commands. If `tko` is not found, add `~/.local/bin` to your PATH.

### 2. Create the bot in Orca

In Orca, create a new bot named exactly **`ticket-orchestrator`**, and choose the model it thinks with (a strong one: it analyses tickets and reviews). Then:

```sh
tko doctor --fix
```

- **Why the exact name:** the kit writes the bot's character and skills into `~/.orca/bots/ticket-orchestrator/`. A different name means a different folder, and the bot would not get them. To use another name, pass `--bot <name>` to `tko doctor` and `tko automations`.
- **Why `--fix`:** it copies the character and skills into the bot. Orca writes its own `SOUL.md` when a bot is created or first used, so run `tko doctor` again after your first chat with the bot; it tells you if they need restoring.
- **Check:** `tko doctor` shows `✓ Bot soul, skills and worker template match the kit`.

### 3. Write your project profile

```sh
cp profiles/example.json ~/.config/ticket-orchestrator/profiles/<project>.json
```

Edit it ([field reference](#profile-reference)). The values you most likely need to look up:

| Field | How to find it |
| --- | --- |
| `jira.siteId` | `orca jira connection --json` → `sites[].id` |
| `jira.transitions` | `orca jira status list <A-TICKET-KEY> --json` → the names that move a ticket to "in progress" and to "done/completed" |
| `pr.reviewers` | On a recent PR: `gh pr view <n> --json reviews,statusCheckRollup` → the review authors' logins and the check names of your review bots |

- **Check:** `tko doctor` shows `✓ Profile "<id>": Jira … and GitHub … reachable`.

### 4. Record the tickets you already have

```sh
tko seed
```

- **Why:** without it, the first check would find every open ticket assigned to you and propose them all. `seed` records them as `baseline`, so the bot only acts on new ones. To hand one of them to the bot later, write to it: "take ACME-123".
- **Check:** `tko list` shows them as `baseline`.

### 5. Create the automations

```sh
tko automations
```

- **Why:** see [The three automations](#the-three-automations). They are created disabled.
- **Check:** `tko doctor` shows `✓ All automations exist`. In Orca they appear in the bot's automations.

### 6. Try one ticket, then switch on

1. In the bot's chat: **"take ACME-123"** (a real, small ticket assigned to you).
2. You get the card. Press (or write) **"ok ACME-123"**.
3. Follow it: workspace created, ticket *In progress*, agent working, draft PR, CI.
4. Mark the PR ready for review yourself. To test the PR check before turning automations on, use **Run now** on `TKO · pull request check` in Orca.
5. When it all looks right, **enable the three automations** in Orca.

## Using it

**Answering the bot:** every question is an Orca item with buttons; you can also write the same words in its chat.

| You write | When | Effect |
| --- | --- | --- |
| `ok KEY` / `ok KEY + changes` | On a ticket card | Starts it, with your changes to the plan |
| `no KEY` | On a ticket card | Rejected; nothing is touched |
| `fix KEY` / `fix KEY 1,3` / `skip KEY` | On a review proposal | Applies all / some fixes, or leaves them |
| `method ok PROJECT` / `method keep PROJECT` / a change in your own words | On a pull request method proposal | Saves the new method / keeps the current one / saves your variation |
| `complete KEY` | A reviewer never reported | Completes anyway (never overrides failing checks, conflicts or blocking labels) |
| `take KEY` | Any time | Hands it a ticket it did not pick up (e.g. a `baseline` one) |

A bare "ok" works only when exactly one ticket is waiting; otherwise the bot asks which.

**The report:** `tko serve`, then open http://127.0.0.1:4747: every ticket, its status, branch, PR and history, with buttons to clear closed tickets. It only answers on this computer.

**The command line:**

```text
tko list [--status s1,s2]     tko get KEY               tko doctor [--fix]
tko pending assignments|prs|guard    what the automations would act on right now
tko remove KEY [--force]      tko clear --closed | --all --yes
tko help                      everything else
```

Ticket statuses: `baseline` (yours before install), `proposed`, `approved`, `rejected`, `working`, `pr_draft`, `pr_ready`, `completed`, `stopped`.

## Optional extras

### Set up the workspaces you create by hand

A new Orca workspace is a clean checkout: no `.env` or other ignored files, no `node_modules`. The bot already prepares its own workspaces (it runs `tko setup-worktree` after creating one). For the workspaces **you** create in Orca, set the project's setup script in Orca's repository settings to:

```
~/.local/bin/tko setup-worktree
```

It copies the files listed in the profile's `setup.copyFromMain` from the main checkout (never overwriting) and runs `setup.commands` (e.g. `pnpm install`).

### Several tickets in one pull request

When two tickets are really one change, tell the bot ("ok ACME-1 and ACME-2 together"). They share one branch, one workspace and one pull request; CI and reviews are handled once, and each ticket moves in Jira on its own.

### Several projects

Add one profile per project. The bot picks the profile from the ticket key's project (`ACME-123` → the profile with `jira.projectKey: "ACME"`). The automations are shared: the assignments check runs at the shortest `pollMinutes` among your profiles.

## Pause, update, uninstall

- **Pause:** disable the automations in Orca. The bot then only acts when you write to it.
- **Update:** `git pull && ./install.sh && tko doctor --fix`. Profiles and the database are never touched. If you changed `pollMinutes`, `tko automations --replace` recreates the automations (disabled: enable them again in Orca).
- **Uninstall:**
  1. In Orca, delete the three `TKO ·` automations and the bot.
  2. `rm ~/.local/bin/tko`
  3. `rm -r ~/.config/ticket-orchestrator` (your profiles and the ticket history)
  4. Delete the cloned folder.

  Workspaces, branches and PRs the bot created stay where they are.

## Troubleshooting

- **Start with `tko doctor`.**
- **A check never wakes the bot:** in Orca, the automation's run history shows `skipped_precheck` when there was nothing to do. Run the same check yourself, e.g. `tko pending prs`, to see what it sees.
- **Errors from Jira or GitHub** during the checks are written to `~/.config/ticket-orchestrator/errors.log`. One failing ticket or PR does not stop the others.
- **An agent finished but did not push:** it is probably waiting for the pull request method. `tko pr-method check KEY` says why; look for the bot's question in its chat.
- **A reviewer never reports:** after `pr.reviewerTimeoutMinutes` (default 30) from the end of CI, the bot tells you which reviewer is missing; answer `complete KEY` to go on.

## Profile reference

See [`profiles/example.json`](profiles/example.json).

| Field | Meaning |
| --- | --- |
| `id` | Profile name |
| `pollMinutes` | Optional, default 5: how often to look for new tickets (1, 2, 3, 4, 5, 6, 10, 12, 15, 20 or 30) |
| `jira.projectKey`, `jira.siteId` | Project and Orca Jira site |
| `jira.assignedJql` | Optional; default: open tickets assigned to you in the project |
| `jira.transitions.start` / `.complete` | Transition names for "in progress" and "work completed" |
| `jira.startComment` | The one comment posted on start (`{branch}` is filled in) |
| `repo.path`, `repo.github`, `repo.baseBranch` | Main checkout, GitHub repository, PR base branch |
| `repo.ghUser` | Optional: the `gh` account to use for this project (the active account is never switched) |
| `git.branchFormat`, `git.commitFormat`, `git.types` | Naming rules (`{type}`, `{key}`, `{slug}`, `{summary}`) |
| `setup.copyFromMain`, `setup.commands` | Files copied into new workspaces, commands run there |
| `pr.reviewers` | Reviewers that count: `login` (review author) and/or `checkName` (check run) |
| `pr.reviewerTimeoutMinutes` | How long after CI to wait for a reviewer that may never run (default 30) |
| `agents.default`, `.model`, `.effort` | Default coding agent and model |
| `workerRules` | Extra rules for the coding agents (checks to run, docs to follow) |

## Development

```sh
npm test    # node --test, no dependencies
```

## License

[MIT](LICENSE)
