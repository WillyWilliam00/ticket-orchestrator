#!/usr/bin/env node
import { claim, clearTickets, getEvents, getTicket, listTickets, openDb, reclaim, removeTicket, setTicket, ACTIVE } from '../lib/db.mjs';
import { home, profilesDir } from '../lib/paths.mjs';
import { pendingAssignments, pendingGuard, pendingPrs, seed } from '../lib/pending.mjs';
import { loadProfiles, profileById, profileForKey } from '../lib/profiles.mjs';
import { resolve } from 'node:path';
import { mainCheckout, setupWorktree } from '../lib/setup-worktree.mjs';
import { defaultBot, syncAutomations, syncBot } from '../lib/orca-setup.mjs';
import { doctor, printDoctor } from '../lib/doctor.mjs';
import { checkMethod, markSeen, methodDiff, readMethod, saveMethod } from '../lib/pr-method.mjs';
import { readFileSync } from 'node:fs';

const HELP = `tko — Ticket Orchestrator state and checks

Tickets
  tko list [--status s1,s2] [--profile id] [--json]
  tko get <KEY> [--json]
  tko claim <KEY> --source poll|manual [--title t] [--url u]   exit 0 = taken, 1 = already tracked
  tko set <KEY> [--status s] [--title-en t] [--branch b] [--pr n] [--workspace w] [--dispatch id] [--reason reassigned|pr_closed|owner] [--note n] [--detail d] [--force]
  tko ack <KEY> <signature>        mark a pull request event as handled
  tko remove <KEY> [--force]       --force is needed for an active ticket
  tko clear --closed | --all --yes

Checks (used by the automations)
  tko pending assignments|prs|guard [--json]
  tko precheck assignments|prs|guard    exit 0 when there is work, 1 when there is none
  tko seed                         record already-assigned tickets as baseline

Pull request method (how PRs are opened in a project)
  tko pr-method check <KEY|profile> [--json]     exit 0 = approved and current, 1 = none or rules changed
  tko pr-method show <KEY|profile>               print the approved method
  tko pr-method diff <KEY|profile> --commit sha  what changed in the repository's rules
  tko pr-method save <KEY|profile> --commit sha --file f    save what the owner approved
  tko pr-method seen <KEY|profile> --commit sha  the change does not concern pull requests

Setup
  tko doctor [--fix]               check everything the bot needs; --fix restores its soul and skills
  tko profiles                     list profiles (${profilesDir})
  tko profile <id|KEY>             print one profile
  tko setup-worktree [--profile id] [path]
  tko bot-sync [--bot name]
  tko automations [--bot name] [--dry-run] [--replace]
  tko serve [--port 4747]          local HTML report

Statuses: baseline proposed approved rejected working pr_draft pr_ready completed stopped\nA stopped ticket comes back as proposed only when it was stopped by a reassignment.`;

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) pos.push(a);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) flags[a.slice(2)] = true;
    else flags[a.slice(2)] = argv[++i];
  }
  return { pos, flags };
}

const profileFor = (ps, id) => (/-\d+$/.test(id ?? '') ? profileForKey(ps, id) : profileById(ps, id));

function table(rows, cols) {
  if (!rows.length) return console.log('(none)');
  const widths = cols.map((c) => Math.min(60, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))));
  const line = (vals) => vals.map((v, i) => String(v ?? '').slice(0, widths[i]).padEnd(widths[i])).join('  ');
  console.log(line(cols));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}

const out = (json, value, human) => (json ? console.log(JSON.stringify(value, null, 2)) : human());

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);
  if (!cmd || cmd === 'help' || flags.help) return console.log(HELP);

  const db = openDb();
  const profiles = () => loadProfiles();

  switch (cmd) {
    case 'list': {
      const rows = listTickets(db, { status: flags.status, profile: flags.profile });
      return out(flags.json, rows, () => table(rows.map((r) => ({ ...r, title: r.title_en || r.title, pr: r.pr_number })), ['key', 'status', 'title', 'branch', 'pr', 'updated_at']));
    }
    case 'get': {
      const t = getTicket(db, pos[0]);
      if (!t) throw new Error(`${pos[0]} is not tracked`);
      const events = getEvents(db, t.key);
      return out(flags.json, { ...t, events }, () => {
        for (const [k, v] of Object.entries(t)) console.log(`${k.padEnd(11)} ${Array.isArray(v) ? v.join(', ') : v ?? ''}`);
        console.log('\nhistory');
        for (const e of events) console.log(`  ${e.at}  ${e.to_status ? `${e.from_status ?? 'new'} → ${e.to_status}` : 'note'}  ${e.detail ?? ''}`);
      });
    }
    case 'claim': {
      const key = pos[0];
      if (!key || !flags.source) throw new Error('usage: tko claim <KEY> --source poll|manual');
      const p = profileForKey(profiles(), key);
      const took = claim(db, { key, profile: p.id, title: flags.title || '', url: flags.url || null, source: flags.source }) || reclaim(db, key, flags.source);
      console.log(took ? `taken ${key}` : `already tracked ${key} (${getTicket(db, key).status})`);
      process.exitCode = took ? 0 : 1;
      return;
    }
    case 'set': {
      const t = setTicket(
        db,
        pos[0],
        {
          status: flags.status,
          titleEn: flags['title-en'],
          title: flags.title,
          branch: flags.branch,
          pr: flags.pr === undefined ? undefined : Number(flags.pr),
          workspace: flags.workspace,
          dispatch: flags.dispatch,
          stopReason: flags.reason,
          note: flags.note,
          url: flags.url,
        },
        { force: Boolean(flags.force), detail: flags.detail },
      );
      return console.log(`${t.key}: ${t.status}`);
    }
    case 'ack': {
      if (!pos[1]) throw new Error('usage: tko ack <KEY> <signature>');
      setTicket(db, pos[0], { prAck: pos[1] }, { detail: `handled PR event ${pos[1]}` });
      return console.log(`acknowledged ${pos[0]}`);
    }
    case 'remove': {
      const t = getTicket(db, pos[0]);
      if (!t) throw new Error(`${pos[0]} is not tracked`);
      if (ACTIVE.includes(t.status) && !flags.force) throw new Error(`${t.key} is ${t.status}: pass --force (it will be picked up again if still assigned to you)`);
      removeTicket(db, t.key);
      return console.log(`removed ${t.key}`);
    }
    case 'clear': {
      if (flags.closed) return console.log(`removed ${clearTickets(db, 'closed')} closed tickets`);
      if (flags.all && flags.yes) return console.log(`removed ${clearTickets(db, 'all')} tickets`);
      throw new Error('usage: tko clear --closed | --all --yes');
    }
    case 'pending':
    case 'precheck': {
      const kinds = { assignments: pendingAssignments, prs: pendingPrs, guard: pendingGuard };
      const fn = kinds[pos[0]];
      if (!fn) throw new Error('usage: tko pending|precheck assignments|prs|guard');
      const items = fn(db, profiles());
      if (cmd === 'precheck') {
        console.log(items.length ? `${items.length} to handle: ${items.map((i) => i.key).join(', ')}` : 'nothing to do');
        process.exitCode = items.length ? 0 : 1;
        return;
      }
      return out(flags.json, items, () => table(items, Object.keys(items[0] ?? { key: '' })));
    }
    case 'seed':
      return console.log(`recorded ${seed(db, profiles())} already-assigned tickets as baseline`);
    case 'profiles':
      return table(profiles().map((p) => ({ id: p.id, project: p.jira.projectKey, repo: p.repo.github, path: p.repo.path })), ['id', 'project', 'repo', 'path']);
    case 'profile': {
      return console.log(JSON.stringify(profileFor(profiles(), pos[0]), null, 2));
    }
    case 'pr-method': {
      const p = profileFor(profiles(), pos[1]);
      if (['diff', 'save', 'seen'].includes(pos[0]) && typeof flags.commit !== 'string') throw new Error(`usage: tko pr-method ${pos[0]} <KEY|profile> --commit <sha from check>`);
      switch (pos[0]) {
        case 'check': {
          const r = checkMethod(db, p);
          process.exitCode = r.status === 'current' ? 0 : 1;
          return out(flags.json, r, () => console.log(`${r.profile}: ${r.status}${r.changes?.length ? ` (${r.changes.map((c) => `${c.change} ${c.path}`).join(', ')})` : ''}`));
        }
        case 'show':
          return console.log(readMethod(db, p));
        case 'diff':
          return console.log(methodDiff(db, p, flags.commit));
        case 'save':
          if (typeof flags.file !== 'string') throw new Error('usage: tko pr-method save <KEY|profile> --commit <sha> --file <path>');
          saveMethod(db, p, flags.commit, readFileSync(flags.file, 'utf8'));
          return console.log(`saved the pull request method of ${p.id}`);
        case 'seen':
          markSeen(db, p, flags.commit);
          return console.log(`${p.id}: reference moved forward`);
        default:
          throw new Error('usage: tko pr-method check|show|diff|save|seen <KEY|profile>');
      }
    }
    case 'setup-worktree': {
      const ps = profiles();
      const target = resolve(pos[0] ?? process.cwd());
      const main = mainCheckout(target);
      const p = flags.profile ? profileById(ps, flags.profile) : ps.find((x) => resolve(x.repo.path) === main);
      if (!p) throw new Error(`No profile has repo.path ${main}`);
      return setupWorktree(p, target);
    }
    case 'doctor':
      process.exitCode = printDoctor(doctor(db, { bot: flags.bot || defaultBot, tko: process.env.TKO_SELF || 'tko', fix: Boolean(flags.fix) }));
      return;
    case 'bot-sync':
      return syncBot(flags.bot || defaultBot);
    case 'automations':
      return syncAutomations(profiles(), { bot: flags.bot || defaultBot, tko: process.env.TKO_SELF || 'tko', dryRun: Boolean(flags['dry-run']), replace: Boolean(flags.replace) });
    case 'serve': {
      return import('../lib/server.mjs').then(({ serve }) => serve(db, profiles(), Number(flags.port || 4747)));
    }
    case 'where':
      return console.log(home);
    default:
      throw new Error(`Unknown command ${cmd}. Run tko help.`);
  }
}

try {
  await main();
} catch (e) {
  console.error(`tko: ${e.message}`);
  process.exitCode = 2;
}
