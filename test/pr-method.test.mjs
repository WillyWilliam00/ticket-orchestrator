import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

process.env.TKO_HOME = mkdtempSync(join(tmpdir(), 'tko-home-'));
const { openDb } = await import('../lib/db.mjs');
const { checkMethod, markSeen, methodDiff, methodPath, readMethod, saveMethod } = await import('../lib/pr-method.mjs');

function setup(id) {
  const root = mkdtempSync(join(tmpdir(), 'tko-repo-'));
  const remote = join(root, 'remote');
  const local = join(root, 'local');
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
  mkdirSync(remote);
  git(remote, 'init', '-q', '-b', 'main');
  const commit = (files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(remote, path)), { recursive: true });
      writeFileSync(join(remote, path), text);
    }
    git(remote, 'add', '-A');
    git(remote, 'commit', '-qm', 'x');
  };
  commit({ 'AGENTS.md': 'rules', 'src/a.js': '1' });
  git(root, 'clone', '-q', remote, local);
  return { db: openDb(join(root, 'state.db')), profile: { id, repo: { path: local, baseBranch: 'main' } }, commit, git, local };
}

test('no method, then approved, then current', () => {
  const { db, profile } = setup('one');
  const first = checkMethod(db, profile);
  assert.equal(first.status, 'none');
  assert.deepEqual(first.files, ['AGENTS.md']);
  assert.throws(() => readMethod(db, profile), /No approved method/);
  saveMethod(db, profile, first.commit, '# How\n');
  assert.equal(checkMethod(db, profile).status, 'current');
  assert.equal(readMethod(db, profile), '# How\n');
});

test('code changes are ignored; changed and new rule files are noticed', () => {
  const { db, profile, commit } = setup('two');
  saveMethod(db, profile, checkMethod(db, profile).commit, 'm');
  commit({ 'src/a.js': '2' });
  assert.equal(checkMethod(db, profile).status, 'current');
  commit({ 'AGENTS.md': 'new rules', '.agents/skills/pr/SKILL.md': 'open PRs like this', '.github/workflows/label.yml': 'on: pull_request' });
  const c = checkMethod(db, profile);
  assert.equal(c.status, 'changed');
  assert.deepEqual(c.changes, [
    { path: '.agents/skills/pr/SKILL.md', change: 'added' },
    { path: '.github/workflows/label.yml', change: 'added' },
    { path: 'AGENTS.md', change: 'modified' },
  ]);
  const diff = methodDiff(db, profile, c.commit);
  assert.match(diff, /\+new rules/);
  assert.match(diff, /\+open PRs like this/);
  markSeen(db, profile, c.commit);
  assert.equal(checkMethod(db, profile).status, 'current');
});

test('rules that change while the owner decides are still noticed', () => {
  const { db, profile, commit } = setup('three');
  const looked = checkMethod(db, profile).commit;
  commit({ 'AGENTS.md': 'changed meanwhile' });
  checkMethod(db, profile);
  saveMethod(db, profile, looked, 'm');
  assert.equal(checkMethod(db, profile).status, 'changed');
});

test("a ticket branch cannot change or approve its own rules", () => {
  const { db, profile, git, local } = setup('four');
  saveMethod(db, profile, checkMethod(db, profile).commit, 'm');
  git(local, 'checkout', '-qb', 'fix/ticket');
  writeFileSync(join(local, 'AGENTS.md'), 'my own rules');
  git(local, 'commit', '-qam', 'x');
  assert.equal(checkMethod(db, profile).status, 'current');
  assert.throws(() => saveMethod(db, profile, git(local, 'rev-parse', 'HEAD').trim(), 'mine'));
  assert.equal(readMethod(db, profile), 'm');
});

test('deleting the method file asks for it again', () => {
  const { db, profile } = setup('five');
  saveMethod(db, profile, checkMethod(db, profile).commit, 'm');
  rmSync(methodPath(profile));
  assert.equal(checkMethod(db, profile).status, 'none');
});
