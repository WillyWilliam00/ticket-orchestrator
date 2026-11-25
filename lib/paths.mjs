import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Everything personal lives here, never in the kit repository.
export const home = process.env.TKO_HOME || join(homedir(), '.config', 'ticket-orchestrator');
export const profilesDir = join(home, 'profiles');
export const prMethodsDir = join(home, 'pr-methods');
export const dbPath = join(home, 'state.db');

export function ensureHome() {
  mkdirSync(profilesDir, { recursive: true });
}
