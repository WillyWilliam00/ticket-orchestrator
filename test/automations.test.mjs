import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { automationSpecs } from '../lib/orca-setup.mjs';
import { loadProfiles } from '../lib/profiles.mjs';

const trigger = (profiles) => {
  const { args } = automationSpecs(profiles, 'tko').find((s) => s.name === 'TKO · new assignments check');
  return args[args.indexOf('--trigger') + 1];
};

test('three automations, all on a schedule with a precheck', () => {
  const specs = automationSpecs([{ id: 'a' }], 'tko');
  assert.equal(specs.length, 3);
  for (const s of specs) assert.ok(s.args.includes('--trigger') && s.args.includes('--precheck'), s.name);
});

test('the assignments check runs at the shortest pollMinutes, 5 by default', () => {
  assert.equal(trigger([{ id: 'a' }]), '*/5 * * * *');
  assert.equal(trigger([{ id: 'a', pollMinutes: 2 }]), '*/2 * * * *');
  assert.equal(trigger([{ id: 'a', pollMinutes: 10 }, { id: 'b', pollMinutes: 3 }]), '*/3 * * * *');
});

test('a pollMinutes that does not divide the hour is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tko-'));
  const profile = { id: 'a', jira: { projectKey: 'A' }, repo: { path: '/x', github: 'o/r', baseBranch: 'main' } };
  for (const bad of [0, 7, '5', 60]) {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...profile, pollMinutes: bad }));
    assert.throws(() => loadProfiles(dir), /pollMinutes/);
  }
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...profile, pollMinutes: 2 }));
  assert.equal(loadProfiles(dir)[0].pollMinutes, 2);
});
