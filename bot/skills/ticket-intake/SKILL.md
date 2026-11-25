---
name: ticket-intake
description: A ticket was assigned to my owner (found by the assignments check, or "take KEY"). Verify it, claim it, analyse it against the code, and send my owner the ticket card asking for the go-ahead.
---

# Ticket intake

Goal: one card per new ticket in my chat, with everything my owner needs to say "ok" or "no". I change nothing: no workspace, no code, no Jira.

## 1. Find the tickets

- **source poll**: `tko pending assignments --json` lists them (key, profile, title, url).
- **source manual** ("take KEY"): the key my owner gave.

Handle each ticket on its own. If one fails, report it in one line and go on with the next.

## 2. Verify and claim

1. `tko profile <KEY>`. No profile → tell my owner the project has no profile, stop for this ticket.
2. `orca jira issue <KEY> --json` (add `--site <siteId>` when the profile has one). Check:
   - the assignee is my owner (same accountId as `orca jira connection --json` → `viewer.accountId`);
   - the status category is not done.

   If either fails: stop for this ticket, silently for poll; for manual, say why.
3. `tko claim <KEY> --source <poll|manual> --title "<Jira title>" --url <url>`.
   - exit 1 (already tracked) → stop silently: another run already took it.
   - For manual on a baseline/stopped ticket, `tko set <KEY> --status proposed --force` was already run; skip the claim.

## 3. Analyse

Read, do not write:
- the ticket: description, parent, linked issues, comments (`orca jira comment list <KEY> --json`), attachments' names;
- the code at the profile's `repo.path` (main checkout, read-only: search and read files, `git log` for related history). Never edit, checkout or pull there.

Work out:
- what is asked, and the acceptance criteria (from the ticket, or inferred and marked as inferred);
- the files and modules likely involved, with paths;
- a short technical analysis: where the problem probably is, or how to implement it, and the risks;
- ambiguities and questions for the PM (listed, not sent);
- the change type from the profile's `git.types` (`fix`, `feat`, …);
- an English title and a slug (lowercase, hyphens, ≤ 6 words);
- the branch from `git.branchFormat` (`{type}`, `{key}`, `{slug}`);
- complexity (S, M, L) and an agent plan: how many coding agents, which agent and model (profile `agents` as default), and, when more than one, the split into parts that touch separate files.

Save it: write the full brief to `briefs/<KEY>.md` in my home (create the folder), then
`tko set <KEY> --title-en "<English title>" --branch <branch> --detail "analysed"`.

## 4. The card

Post in my chat, in my owner's language:

```
🎫 <KEY> — <original title>
<English title>
<Jira link> · priority · reporter · status

Summary: …
Acceptance criteria: …
Likely files: …
Analysis: …
Open points: …

Branch: <branch>
Complexity: M · Plan: 1 agent, claude <model> <effort>
(or: 2 agents in parallel — part A …, part B …)

Reply "ok <KEY>" to start with this plan, "ok <KEY> + changes" (e.g. a different plan or instructions), or "no <KEY>".
```

Then end the turn. The answer is handled by `ticket-kickoff`.
