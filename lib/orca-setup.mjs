import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { orcaJson } from './exec.mjs';
import { DEFAULT_POLL_MINUTES } from './profiles.mjs';

export const kitRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const defaultBot = 'ticket-orchestrator';
export const botDir = (bot) => join(homedir(), '.orca', 'bots', bot);

/** Copies SOUL.md and the kit's skills into the bot's home. Never touches its memory. */
export function syncBot(bot = defaultBot, log = console.log) {
  const dir = botDir(bot);
  if (!existsSync(dir)) throw new Error(`Bot folder ${dir} not found: create the bot in Orca first`);
  cpSync(join(kitRoot, 'bot', 'SOUL.md'), join(dir, 'SOUL.md'));
  mkdirSync(join(dir, 'skills'), { recursive: true });
  for (const name of readdirSync(join(kitRoot, 'bot', 'skills'))) {
    cpSync(join(kitRoot, 'bot', 'skills', name), join(dir, 'skills', name), { recursive: true });
    log(`skill ${name}`);
  }
  cpSync(join(kitRoot, 'templates'), join(dir, 'templates'), { recursive: true });
  log(`synced into ${dir}`);
}

/**
 * The three automations the kit needs. The assignments check is shared by every
 * profile, so it runs at the shortest pollMinutes among them.
 */
export function automationSpecs(profiles, tko) {
  const pollMinutes = Math.min(...profiles.map((p) => p.pollMinutes ?? DEFAULT_POLL_MINUTES));
  return [
    {
      name: 'TKO · new assignments check',
      args: [
        '--trigger', `*/${pollMinutes} * * * *`,
        '--precheck', `${tko} precheck assignments`,
        '--prompt', `Use your ticket-intake skill with source "poll": run \`${tko} pending assignments --json\` and take in every ticket it lists.`,
      ],
    },
    {
      name: 'TKO · pull request check',
      args: [
        '--trigger', '*/5 * * * *',
        '--precheck', `${tko} precheck prs`,
        '--prompt', `Run \`${tko} pending prs --json\`. For each entry follow your skill for its reason: ci_failed → ci-fix; ci_passed → tell me the draft PR is green; reviews_ready → review-triage then completion-check (reviewersMissing lists reviewers that did not report in time); pr_merged / pr_closed → completion-check. Acknowledge each entry with \`${tko} ack <KEY> <signature>\` once handled.`,
      ],
    },
    {
      name: 'TKO · assignment guard',
      args: [
        '--trigger', '*/30 * * * *',
        '--precheck', `${tko} precheck guard`,
        '--prompt', `Use your assignment-guard skill: run \`${tko} pending guard --json\` and stop the work on every ticket it lists.`,
      ],
    },
  ];
}

/**
 * Creates the missing automations, disabled. Existing ones (same name) are left alone,
 * unless `replace` is set: then they are removed and created again, disabled, so a
 * changed pollMinutes takes effect.
 */
export function syncAutomations(profiles, { bot = defaultBot, tko, dryRun = false, replace = false, log = console.log }) {
  if (!profiles.length) throw new Error('No profile found: write one first (see README)');
  const existing = new Map(orcaJson(['automations', 'list']).automations.map((a) => [a.name, a.id]));
  for (const spec of automationSpecs(profiles, tko)) {
    if (existing.has(spec.name)) {
      if (!replace) {
        log(`exists  ${spec.name} (tko automations --replace recreates it from the profile)`);
        continue;
      }
      if (dryRun) log(`would remove ${spec.name}`);
      else {
        orcaJson(['automations', 'remove', existing.get(spec.name)]);
        log(`removed ${spec.name}`);
      }
    }
    const args = ['automations', 'create', '--bot', bot, '--name', spec.name, '--runs-in', 'chat', '--disabled', ...spec.args];
    if (dryRun) log(`would create ${spec.name}: orca ${args.join(' ')}`);
    else {
      orcaJson(args);
      log(`created ${spec.name} (disabled)`);
    }
  }
}
