import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { claim, clearTickets, getEvents, getTicket, listTickets, openDb, reclaim, setTicket } from '../lib/db.mjs';

const fresh = () => openDb(join(mkdtempSync(join(tmpdir(), 'tko-')), 'state.db'));

test('claim takes a ticket once', () => {
  const db = fresh();
  assert.equal(claim(db, { key: 'ABC-1', profile: 'p', source: 'poll' }), true);
  assert.equal(claim(db, { key: 'ABC-1', profile: 'p', source: 'manual' }), false);
  assert.equal(getTicket(db, 'ABC-1').source, 'poll');
});

test('two connections racing on the same ticket: only one wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tko-'));
  const a = openDb(join(dir, 'state.db'));
  const b = openDb(join(dir, 'state.db'));
  const results = [claim(a, { key: 'ABC-2', profile: 'p', source: 'poll' }), claim(b, { key: 'ABC-2', profile: 'p', source: 'manual' })];
  assert.deepEqual(results.sort(), [false, true]);
});

test('status changes follow the allowed transitions', () => {
  const db = fresh();
  claim(db, { key: 'ABC-3', profile: 'p', source: 'poll' });
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

test('only a ticket stopped by a reassignment is proposed again', () => {
  const db = fresh();
  claim(db, { key: 'ABC-4', profile: 'p', source: 'poll' });
  assert.equal(reclaim(db, 'ABC-4', 'poll'), false);
  setTicket(db, 'ABC-4', { status: 'stopped', stopReason: 'reassigned' });
  assert.equal(getTicket(db, 'ABC-4').stop_reason, 'reassigned');
  assert.equal(reclaim(db, 'ABC-4', 'poll'), true);
  const t = getTicket(db, 'ABC-4');
  assert.equal(t.status, 'proposed');
  assert.equal(t.stop_reason, null);

  claim(db, { key: 'ABC-7', profile: 'p', source: 'poll' });
  setTicket(db, 'ABC-7', { status: 'stopped', stopReason: 'pr_closed' });
  assert.equal(reclaim(db, 'ABC-7', 'poll'), false);
  assert.throws(() => setTicket(db, 'ABC-5x', { status: 'stopped' }), /not tracked/);
});

test('a database from before stop_reason and dispatches is migrated', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(mkdtempSync(join(tmpdir(), 'tko-')), 'state.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE tickets (key TEXT PRIMARY KEY, profile TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', title_en TEXT, url TEXT,
    status TEXT NOT NULL, source TEXT NOT NULL, branch TEXT, workspaces TEXT NOT NULL DEFAULT '[]', pr_number INTEGER, head_sha TEXT,
    pr_ack TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  old.close();
  const db = openDb(path);
  claim(db, { key: 'ABC-8', profile: 'p', source: 'poll' });
  assert.deepEqual(getTicket(db, 'ABC-8').dispatches, []);
});

test('clear closed keeps active tickets', () => {
  const db = fresh();
  claim(db, { key: 'ABC-5', profile: 'p', source: 'poll' });
  claim(db, { key: 'ABC-6', profile: 'p', source: 'poll' });
  setTicket(db, 'ABC-6', { status: 'rejected' });
  assert.equal(clearTickets(db, 'closed'), 1);
  assert.deepEqual(listTickets(db).map((t) => t.key), ['ABC-5']);
  assert.equal(getEvents(db, 'ABC-6').length, 0);
});
