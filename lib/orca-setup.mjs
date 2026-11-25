import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { orcaJson } from './exec.mjs';

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

/** The automations the kit needs: one mail trigger per profile, three shared checks. */
export function automationSpecs(profiles, bot, tko) {
  const specs = [];
  for (const p of profiles) {
    if (!p.mail?.from || !p.mail?.subjectContains) continue;
    specs.push({
      name: `TKO · ${p.id} · assignment mail`,
      args: [
        '--on',
        `gmail.new_email from=${p.mail.from} subject="${p.mail.subjectContains}"`,
        '--prompt',
        `A Jira assignment email arrived for profile "${p.id}". Use your ticket-intake skill with source "mail". Take the ticket key from the subject in the event below.`,
      ],
    });
  }
  specs.push(
    {
      name: 'TKO · new assignments check',
      args: [
        '--trigger', '*/5 * * * *',
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
  );
  return specs;
}

/**
 * Creates the missing automations, disabled. Existing ones (same name) are left alone,
 * unless `replace` is set: then they are removed and created again, disabled, so a
 * changed profile (mail sender, subject) takes effect.
 */
export function syncAutomations(profiles, { bot = defaultBot, tko, dryRun = false, replace = false, log = console.log }) {
  const existing = new Map(orcaJson(['automations', 'list']).automations.map((a) => [a.name, a.id]));
  for (const spec of automationSpecs(profiles, bot, tko)) {
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
