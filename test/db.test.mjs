import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { claim, clearTickets, getEvents, getTicket, listTickets, openDb, reclaim, setTicket } from '../lib/db.mjs';

const fresh = () => openDb(join(mkdtempSync(join(tmpdir(), 'tko-')), 'state.db'));

test('claim takes a ticket once', () => {
  const db = fresh();
  assert.equal(claim(db, { key: 'ABC-1', profile: 'p', source: 'mail' }), true);
  assert.equal(claim(db, { key: 'ABC-1', profile: 'p', source: 'poll' }), false);
  assert.equal(getTicket(db, 'ABC-1').source, 'mail');
});

test('two connections racing on the same ticket: only one wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tko-'));
  const a = openDb(join(dir, 'state.db'));
  const b = openDb(join(dir, 'state.db'));
  const results = [claim(a, { key: 'ABC-2', profile: 'p', source: 'mail' }), claim(b, { key: 'ABC-2', profile: 'p', source: 'poll' })];
  assert.deepEqual(results.sort(), [false, true]);
});

test('status changes follow the allowed transitions', () => {
  const db = fresh();
  claim(db, { key: 'ABC-3', profile: 'p', source: 'mail' });
  assert.throws(() => setTicket(db, 'ABC-3', { status: 'completed' }), /not allowed/);
  setTicket(db, 'ABC-3', { status: 'approved' });
  setTicket(db, 'ABC-3', { status: 'working', branch: 'fix/ABC-3-x', workspace: 'w1' });
  setTicket(db, 'ABC-3', { workspace: 'w2' });
  setTicket(db, 'ABC-3', { workspace: 'w1' });
  const t = getTicket(db, 'ABC-3');
  assert.equal(t.status, 'working');
  assert.deepEqual(t.workspaces, ['w1', 'w2']);
  assert.equal(setTicket(db, 'ABC-3', { status: 'completed' }, { force: true }).status, 'completed');
  assert.deepEqual(getEvents(db, 'ABC-3').map((e) => e.to_status), ['proposed', 'approved', 'working', 'completed']);
});

test('a stopped ticket assigned again is proposed again', () => {
  const db = fresh();
  claim(db, { key: 'ABC-4', profile: 'p', source: 'mail' });
  assert.equal(reclaim(db, 'ABC-4', 'poll'), false);
  setTicket(db, 'ABC-4', { status: 'stopped' });
  assert.equal(reclaim(db, 'ABC-4', 'poll'), true);
  assert.equal(getTicket(db, 'ABC-4').status, 'proposed');
});

test('clear closed keeps active tickets', () => {
  const db = fresh();
  claim(db, { key: 'ABC-5', profile: 'p', source: 'mail' });
  claim(db, { key: 'ABC-6', profile: 'p', source: 'mail' });
  setTicket(db, 'ABC-6', { status: 'rejected' });
  assert.equal(clearTickets(db, 'closed'), 1);
  assert.deepEqual(listTickets(db).map((t) => t.key), ['ABC-5']);
  assert.equal(getEvents(db, 'ABC-6').length, 0);
});
