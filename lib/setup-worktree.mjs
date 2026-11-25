import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** The main checkout that every worktree of this repository shares. */
export function mainCheckout(worktree) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: worktree, encoding: 'utf8' }).trim();
  return dirname(common);
}

function matches(pattern, name) {
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(name);
}

/**
 * Copies the untracked local files (.env and friends) from the main checkout,
 * without overwriting, then runs the profile's setup commands in the worktree.
 */
export function setupWorktree(profile, worktree = process.cwd(), log = console.log) {
  const target = resolve(worktree);
  const main = mainCheckout(target);
  if (main === target) throw new Error('This is the main checkout: run setup inside a worktree');
  const names = readdirSync(main);
  for (const pattern of profile.setup?.copyFromMain ?? []) {
    const dir = dirname(pattern) === '.' ? '' : dirname(pattern);
    const pool = dir ? readdirSync(join(main, dir)) : names;
    for (const name of pool.filter((n) => matches(basename(pattern), n))) {
      const rel = join(dir, name);
      if (existsSync(join(target, rel))) continue;
      copyFileSync(join(main, rel), join(target, rel));
      log(`copied ${rel}`);
    }
  }
  for (const command of profile.setup?.commands ?? []) {
    log(`$ ${command}`);
    execSync(command, { cwd: target, stdio: 'inherit' });
  }
}
