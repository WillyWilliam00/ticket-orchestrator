import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tko-'));
process.env.TKO_HOME = dir;
process.env.TKO_GH_BIN = join(dir, 'gh');
const { ackPr, claim, getTicket, openDb, setTicket } = await import('../lib/db.mjs');
const { pendingPrs } = await import('../lib/pending.mjs');

// A stand-in for gh that answers with one PR and logs each call.
function fakeGh(pr) {
  writeFileSync(join(dir, 'pr.json'), JSON.stringify(pr));
  writeFileSync(join(dir, 'calls'), '');
  writeFileSync(process.env.TKO_GH_BIN, `#!/bin/sh\necho "$@" >> '${dir}/calls'\ncat '${dir}/pr.json'\n`);
  chmodSync(process.env.TKO_GH_BIN, 0o755);
}
const calls = () => readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').length;
const profiles = [{ id: 'p', repo: { github: 'o/r' } }];
const pr = (over = {}) => ({
  number: 7,
  state: 'OPEN',
  isDraft: true,
  headRefOid: 'a'.repeat(40),
  mergeable: 'MERGEABLE',
  labels: [],
  reviews: [],
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'Build', status: 'COMPLETED', conclusion: 'FAILURE' }],
  url: 'u',
  ...over,
});
function db(...keys) {
  const d = openDb(join(mkdtempSync(join(tmpdir(), 'tko-')), 'state.db'));
  for (const key of keys) {
    claim(d, { key, profile: 'p', source: 'manual' });
    setTicket(d, key, { status: 'pr_draft', pr: 7 }, { force: true });
  }
  return d;
}

test('tickets sharing a PR give one entry, one gh call and one ack', () => {
  fakeGh(pr());
  const d = db('A-1', 'A-2');
  const out = pendingPrs(d, profiles);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].keys, ['A-1', 'A-2']);
  assert.equal(out[0].reason, 'ci_failed');
  assert.equal(calls(), 1);
  assert.deepEqual(ackPr(d, 'A-2', out[0].signature), ['A-1', 'A-2']);
  assert.equal(pendingPrs(d, profiles).length, 0);
});

test('draft to ready reaches every ticket of the PR', () => {
  fakeGh(pr({ isDraft: false }));
  const d = db('A-1', 'A-2');
  pendingPrs(d, profiles);
  assert.equal(getTicket(d, 'A-1').status, 'pr_ready');
  assert.equal(getTicket(d, 'A-2').status, 'pr_ready');
});

test('a stopped ticket no longer counts, the other one goes on', () => {
  fakeGh(pr());
  const d = db('A-1', 'A-2');
  setTicket(d, 'A-1', { status: 'stopped', stopReason: 'reassigned' });
  assert.deepEqual(pendingPrs(d, profiles)[0].keys, ['A-2']);
});

test('the same PR number in two projects stays separate', () => {
  fakeGh(pr());
  const d = db('A-1');
  claim(d, { key: 'B-1', profile: 'q', source: 'manual' });
  setTicket(d, 'B-1', { status: 'pr_draft', pr: 7 }, { force: true });
  const out = pendingPrs(d, [...profiles, { id: 'q', repo: { github: 'o/q' } }]);
  assert.deepEqual(out.map((o) => o.keys).sort(), [['A-1'], ['B-1']]);
  assert.deepEqual(ackPr(d, 'A-1', 'x'), ['A-1']);
});
