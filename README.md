# Ticket Orchestrator

An [Orca](https://github.com/stablyai/orca) bot kit that takes the tickets assigned to you from "assigned" to a mergeable **draft** pull request — with your approval at every step that matters.

Works with Jira, GitHub and Orca. Not affiliated with Atlassian, GitHub or Orca.

## What it does

1. **Notices new tickets** assigned to you: from the Jira assignment email (about a minute) and from a 5-minute Jira check that also catches tickets you assign to yourself.
2. **Analyses** each ticket against your code and posts a card in the bot's Orca chat: summary, acceptance criteria, likely files, technical analysis, open points, English title, proposed branch, and an agent plan.
3. **Waits for your "ok"**. Then it creates the workspace (branch linked to the ticket), copies your local env files, moves the ticket to *In progress* with one comment, and starts one or more coding agents.
4. The agents follow your repository's rules, commit as `{type}/{KEY} | summary`, push, and open a **draft** PR.
5. **Follows CI** and fixes failures. When you mark the PR ready, it reads the reviewers you configured, explains their findings and **proposes** fixes — applied only after your ok.
6. When the PR is **mergeable** by your project's rules (checks green, no conflicts, no blocking labels, reviewers satisfied), it moves the ticket to *complete* and tells you.
7. If a ticket is **reassigned**, it stops its agents and tells you.

It never merges, approves, marks PRs ready, force-pushes, or posts outside its own chat.

## How it fits together

| Piece | Where | Role |
| --- | --- | --- |
| `tko` command | `bin/`, `lib/` | Ticket state (SQLite), the checks the automations run, worktree setup, local report |
| Bot soul and skills | `bot/` | How the bot behaves; one skill per moment of the flow |
| Worker template | `templates/` | The task every coding agent receives |
| Profiles | `~/.config/ticket-orchestrator/profiles/*.json` | One per project; personal, never committed |
| State | `~/.config/ticket-orchestrator/state.db` | Every ticket the bot tracks, with its history |

The checks run as Orca automation *prechecks*: plain scripts that start the bot only when there is something to do, so idle checks cost nothing.

## Requirements

- macOS or Linux, [Orca](https://github.com/stablyai/orca) with a Jira connection and Google connected (for the assignment emails)
- Node.js 22.13+ (uses the built-in `node:sqlite`; no npm dependencies)
- GitHub CLI (`gh`) signed in to the account that owns the project's PRs

## Install

```sh
git clone https://github.com/WillyWilliam00/ticket-orchestrator.git
cd ticket-orchestrator
./install.sh
```

Then follow the steps it prints:

1. Create a bot named `ticket-orchestrator` in Orca, then run `./install.sh` again (it copies the soul and skills into the bot).
2. Connect Google in the bot's chat.
3. Write a profile: copy [`profiles/example.json`](profiles/example.json) to `~/.config/ticket-orchestrator/profiles/<id>.json`.
4. `tko seed` — records the tickets already assigned to you, so the bot does not propose your whole backlog.
5. `tko automations` — creates the automations, **disabled**.
6. Set each project's setup script in Orca's repository settings to `~/.local/bin/tko setup-worktree`.
7. Try one ticket end to end, then enable the automations.

Update: `git pull && ./install.sh`. Your profiles and database are never touched.

## Profile

See [`profiles/example.json`](profiles/example.json). Fields:

| Field | Meaning |
| --- | --- |
| `id` | Profile name |
| `jira.projectKey`, `jira.siteId` | Project and Orca Jira site (`orca jira connection`) |
| `jira.assignedJql` | Optional; default: open tickets assigned to you in the project |
| `jira.transitions.start` / `.complete` | Transition names for "in progress" and "work completed" |
| `jira.startComment` | The one comment posted on start (`{branch}` is filled in) |
| `mail.from`, `mail.subjectContains` | Gmail filter for assignment emails |
| `repo.path`, `repo.github`, `repo.baseBranch`, `repo.ghUser` | Main checkout, GitHub repo, PR base, `gh` account to use |
| `git.branchFormat`, `git.commitFormat`, `git.types` | Naming rules |
| `setup.copyFromMain`, `setup.commands` | Files copied into new worktrees, commands run there |
| `pr.reviewers` | Reviewers that count: `login` (review author) and/or `checkName` (check run) |
| `pr.reviewerTimeoutMinutes` | How long after CI finishes to wait for a reviewer that may never run (default 30) |
| `pr.blockingLabels`, `pr.blockingLabelHint` | Labels that make a PR not mergeable, and what to tell you |
| `agents` | Default coding agent, model and effort |
| `workerRules` | Extra rules for the coding agents |

## The `tko` command

```text
tko list [--status s1,s2] [--json]      tko get <KEY>
tko serve                               local report on http://127.0.0.1:4747
tko pending assignments|prs|guard       what the automations would act on
tko remove <KEY> [--force]              tko clear --closed | --all --yes
tko help                                everything else
```

Statuses: `baseline` (already assigned at install), `proposed`, `approved`, `rejected`, `working`, `pr_draft`, `pr_ready`, `completed`, `stopped`.

## Development

```sh
npm test    # node --test, no dependencies
```

## License

[MIT](LICENSE)
