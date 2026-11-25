import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listTickets } from './db.mjs';
import { ghJson, orcaJson } from './exec.mjs';
import { automationSpecs, botDir, kitRoot, syncBot } from './orca-setup.mjs';
import { profilesDir } from './paths.mjs';
import { loadProfiles } from './profiles.mjs';

/**
 * Checks every piece the bot needs and says what to do about each missing one.
 * With `fix`, restores the bot's soul and skills when they differ from the kit.
 */
export function doctor(db, { bot, tko, fix = false }) {
  const results = [];
  const ok = (msg) => results.push({ level: 'ok', msg });
  const bad = (msg, hint) => results.push({ level: 'fail', msg, hint });
  const warn = (msg, hint) => results.push({ level: 'warn', msg, hint });
  const attempt = (fn) => {
    try {
      return fn();
    } catch (e) {
      return e;
    }
  };

  // Orca and the bot
  const bots = attempt(() => orcaJson(['bot', 'list']));
  if (bots instanceof Error) bad('Orca is not reachable', `Open Orca, then run tko doctor again (${bots.message})`);
  else ok('Orca is running');

  const dir = botDir(bot);
  if (!existsSync(dir)) {
    bad(`Bot "${bot}" not found (${dir})`, `In Orca, create a bot named exactly "${bot}"`);
  } else {
    ok(`Bot "${bot}" exists`);
    const differs = [];
    const same = (a, b) => existsSync(b) && readFileSync(a, 'utf8') === readFileSync(b, 'utf8');
    if (!same(join(kitRoot, 'bot', 'SOUL.md'), join(dir, 'SOUL.md'))) differs.push('SOUL.md');
    for (const name of readdirSync(join(kitRoot, 'bot', 'skills'))) {
      if (!same(join(kitRoot, 'bot', 'skills', name, 'SKILL.md'), join(dir, 'skills', name, 'SKILL.md'))) differs.push(`skill ${name}`);
    }
    if (!same(join(kitRoot, 'templates', 'worker-spec.md'), join(dir, 'templates', 'worker-spec.md'))) differs.push('worker template');
    if (!differs.length) ok('Bot soul, skills and worker template match the kit');
    else if (fix) {
      syncBot(bot, () => {});
      ok(`Restored from the kit: ${differs.join(', ')}`);
    } else bad(`Bot files differ from the kit: ${differs.join(', ')}`, 'Run: tko doctor --fix');
  }

  // Profiles
  let profiles = [];
  try {
    profiles = loadProfiles();
  } catch (e) {
    bad('A profile is invalid', e.message);
  }
  if (!profiles.length && !results.some((r) => r.msg === 'A profile is invalid')) {
    bad(`No profile in ${profilesDir}`, `Copy ${join(kitRoot, 'profiles', 'example.json')} there and edit it`);
  }
  for (const p of profiles) {
    const label = `Profile "${p.id}"`;
    if (!existsSync(join(p.repo.path, '.git'))) bad(`${label}: repo.path is not a git checkout (${p.repo.path})`, 'Fix repo.path');
    const repo = attempt(() => ghJson(['api', `repos/${p.repo.github}`], p.repo.ghUser));
    if (repo instanceof Error) bad(`${label}: GitHub repo ${p.repo.github} not reachable`, `Check repo.github and repo.ghUser (gh auth status). ${repo.message}`);
    const jira = attempt(() => orcaJson(['jira', 'search', `project = ${p.jira.projectKey}`, '--limit', '1', ...(p.jira.siteId ? ['--site', p.jira.siteId] : [])]));
    if (jira instanceof Error) bad(`${label}: Jira project ${p.jira.projectKey} not reachable`, `Check jira.projectKey / jira.siteId (orca jira connection). ${jira.message}`);
    if (!p.jira.transitions?.start || !p.jira.transitions?.complete) bad(`${label}: jira.transitions.start / .complete missing`, 'See the profile section of the README');
    if (!(repo instanceof Error) && !(jira instanceof Error)) ok(`${label}: Jira ${p.jira.projectKey} and GitHub ${p.repo.github} reachable`);
  }

  // Database
  const tickets = listTickets(db);
  if (profiles.length && !tickets.length) {
    warn('The database is empty', 'Run tko seed, so the tickets already assigned to you are not proposed as new');
  } else ok(`Database: ${tickets.length} tickets`);

  // Automations
  const list = attempt(() => orcaJson(['automations', 'list']));
  if (!(list instanceof Error) && profiles.length) {
    const byName = new Map(list.automations.map((a) => [a.name, a]));
    const missing = [];
    const enabled = [];
    for (const spec of automationSpecs(profiles, tko)) {
      const a = byName.get(spec.name);
      if (!a) missing.push(spec.name);
      else if (a.enabled === true || a.disabled === false || a.status === 'enabled') enabled.push(spec.name);
    }
    if (missing.length) bad(`Missing automations: ${missing.join(', ')}`, 'Run: tko automations');
    else ok('All automations exist');
    if (!missing.length && !enabled.length) warn('Every automation is disabled: the bot only acts when you write to it', 'Try one ticket, then enable them in Orca');
  }

  return results;
}

export function printDoctor(results) {
  const icon = { ok: '✓', warn: '!', fail: '✗' };
  for (const r of results) {
    console.log(`${icon[r.level]} ${r.msg}`);
    if (r.hint) console.log(`    → ${r.hint}`);
  }
  const fails = results.filter((r) => r.level === 'fail').length;
  console.log(fails ? `\n${fails} problem${fails > 1 ? 's' : ''} to fix.` : '\nAll set.');
  return fails ? 1 : 0;
}
