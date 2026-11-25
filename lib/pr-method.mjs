import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prMethodsDir } from './paths.mjs';

// Where a repository usually writes how its pull requests are opened and labelled.
const WATCHED = [
  /(^|\/)(AGENTS|CLAUDE|CONTRIBUTING|GEMINI)(\.\w+)?\.md$/i,
  /(^|\/)pull_request_template(\.md$|\/)/i,
  /^\.github\/(workflows\/|copilot-instructions\.md$|instructions\/|labeler\.ya?ml$)/,
  /^\.(agents|claude|cursor|codex)\/(skills|commands|rules|agents)\//,
  /^\.cursorrules$/,
];

// The user's own PATH: git hooks and credential helpers may need it.
const git = (profile, args) =>
  execFileSync('git', args, {
    cwd: profile.repo.path,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(process.env.TKO_USER_PATH && { PATH: process.env.TKO_USER_PATH }) },
  });

const baseRef = (p) => `origin/${p.repo.baseBranch}`;
export const methodPath = (p) => join(prMethodsDir, `${p.id}.md`);

/**
 * The watched files at a commit, as { path: blob }. Always read from the base branch
 * on the remote, so a ticket's own branch can never change the rules it is judged by.
 */
export function snapshot(profile, commit) {
  const files = {};
  for (const entry of git(profile, ['ls-tree', '-r', '-z', commit]).split('\0')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(entry);
    if (m && WATCHED.some((re) => re.test(m[2]))) files[m[2]] = m[1];
  }
  return files;
}

export function compare(before, after) {
  const changes = [];
  for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (before[path] === after[path]) continue;
    changes.push({ path, change: !before[path] ? 'added' : !after[path] ? 'removed' : 'modified' });
  }
  return changes;
}

const row = (db, p) => db.prepare('SELECT * FROM pr_methods WHERE profile = ?').get(p.id);

/**
 * none: no approved method yet. current: approved, rules unchanged since.
 * changed: approved, but watched files changed on the base branch.
 * `commit` is what was looked at: pass it back to saveMethod or markSeen, so rules
 * that change while the owner is deciding are still noticed.
 */
export function checkMethod(db, profile) {
  git(profile, ['fetch', '--quiet', 'origin', profile.repo.baseBranch]);
  const commit = git(profile, ['rev-parse', baseRef(profile)]).trim();
  const files = snapshot(profile, commit);
  const saved = row(db, profile);
  const base = { profile: profile.id, commit, method: methodPath(profile) };
  if (!saved || !existsSync(methodPath(profile))) return { ...base, status: 'none', files: Object.keys(files) };
  const changes = compare(JSON.parse(saved.files), files);
  return { ...base, status: changes.length ? 'changed' : 'current', approvedAt: saved.approved_at, since: saved.commit_sha, changes };
}

function store(db, profile, commit, approvedAt) {
  const sha = git(profile, ['rev-parse', '--verify', `${commit}^{commit}`]).trim();
  git(profile, ['merge-base', '--is-ancestor', sha, baseRef(profile)]);
  db.prepare(
    `INSERT INTO pr_methods (profile, commit_sha, files, approved_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(profile) DO UPDATE SET commit_sha = excluded.commit_sha, files = excluded.files, approved_at = excluded.approved_at`,
  ).run(profile.id, sha, JSON.stringify(snapshot(profile, sha)), approvedAt);
}

/** Saves the method the owner approved. */
export function saveMethod(db, profile, commit, text) {
  if (!text.trim()) throw new Error('The method is empty');
  store(db, profile, commit, new Date().toISOString());
  mkdirSync(prMethodsDir, { recursive: true });
  writeFileSync(methodPath(profile), text);
}

/** The watched files changed, but not how pull requests are opened: move the reference forward. */
export function markSeen(db, profile, commit) {
  const saved = row(db, profile);
  if (!saved || !existsSync(methodPath(profile))) throw new Error(`No approved method for ${profile.id}`);
  store(db, profile, commit, saved.approved_at);
}

export function readMethod(db, profile) {
  if (!row(db, profile) || !existsSync(methodPath(profile))) throw new Error(`No approved method for ${profile.id}`);
  return readFileSync(methodPath(profile), 'utf8');
}

/** What changed in the watched files between the approved reference and `commit`. */
export function methodDiff(db, profile, commit) {
  const saved = row(db, profile);
  if (!saved) throw new Error(`No approved method for ${profile.id}`);
  const paths = compare(JSON.parse(saved.files), snapshot(profile, commit)).map((c) => c.path);
  return paths.length ? git(profile, ['diff', '--no-ext-diff', '--no-color', saved.commit_sha, commit, '--', ...paths.map((p) => `:(literal)${p}`)]) : '';
}
