import { execFileSync } from 'node:child_process';

const orcaBin = () => process.env.TKO_ORCA_BIN || 'orca';
const ghBin = () => process.env.TKO_GH_BIN || 'gh';

function run(bin, args, env) {
  return execFileSync(bin, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function orcaJson(args) {
  const out = JSON.parse(run(orcaBin(), [...args, '--json']));
  if (!out.ok) throw new Error(`orca ${args.slice(0, 3).join(' ')}: ${out.error?.message ?? 'failed'}`);
  return out.result;
}

const tokens = new Map();

/** Runs gh as the profile's GitHub account, without changing the active gh account. */
export function ghJson(args, ghUser) {
  let env;
  if (ghUser) {
    if (!tokens.has(ghUser)) tokens.set(ghUser, run(ghBin(), ['auth', 'token', '--user', ghUser]).trim());
    env = { GH_TOKEN: tokens.get(ghUser) };
  }
  return JSON.parse(run(ghBin(), args, env));
}
