import { DatabaseSync } from 'node:sqlite';
import { dbPath, ensureHome } from './paths.mjs';

export const STATUSES = [
  'baseline', // already assigned when the kit was installed: never picked up on its own
  'proposed', // card sent, waiting for the owner's ok
  'approved',
  'rejected',
  'working',
  'pr_draft',
  'pr_ready',
  'completed',
  'stopped', // reassigned to someone else, or stopped by the owner
];

export const ACTIVE = ['proposed', 'approved', 'working', 'pr_draft', 'pr_ready'];
export const CLOSED = ['rejected', 'completed', 'stopped'];

const TRANSITIONS = {
  baseline: ['proposed'],
  proposed: ['approved', 'rejected', 'stopped'],
  approved: ['working', 'rejected', 'stopped'],
  rejected: ['proposed'],
  working: ['pr_draft', 'stopped'],
  pr_draft: ['pr_ready', 'working', 'stopped'],
  pr_ready: ['pr_draft', 'working', 'completed', 'stopped'],
  completed: ['pr_ready'],
  stopped: ['proposed'],
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  key        TEXT PRIMARY KEY,
  profile    TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  title_en   TEXT,
  url        TEXT,
  status     TEXT NOT NULL,
  source     TEXT NOT NULL,
  branch     TEXT,
  workspaces TEXT NOT NULL DEFAULT '[]',
  dispatches TEXT NOT NULL DEFAULT '[]',
  pr_number  INTEGER,
  head_sha   TEXT,
  pr_ack     TEXT,
  stop_reason TEXT,
  note       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_events (
  id          INTEGER PRIMARY KEY,
  key         TEXT NOT NULL REFERENCES tickets(key) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS ticket_events_key ON ticket_events(key);
`;

export function openDb(path = dbPath) {
  if (path === dbPath) ensureHome();
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after the first release, for databases created before them. */
function migrate(db) {
  const have = new Set(db.prepare('PRAGMA table_info(tickets)').all().map((c) => c.name));
  if (!have.has('dispatches')) db.exec(`ALTER TABLE tickets ADD COLUMN dispatches TEXT NOT NULL DEFAULT '[]'`);
  if (!have.has('stop_reason')) db.exec('ALTER TABLE tickets ADD COLUMN stop_reason TEXT');
}

/** Why a ticket was stopped. Only a reassignment is proposed again when the ticket comes back. */
export const STOP_REASONS = ['reassigned', 'pr_closed', 'owner'];

const now = () => new Date().toISOString();

function logEvent(db, key, from, to, detail) {
  db.prepare('INSERT INTO ticket_events (key, at, from_status, to_status, detail) VALUES (?, ?, ?, ?, ?)').run(
    key,
    now(),
    from ?? null,
    to ?? null,
    detail ?? null,
  );
}

/** Inserts the ticket only if it is new. Returns true when this call took it. */
export function claim(db, { key, profile, title = '', url = null, source, status = 'proposed' }) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
  const t = now();
  const r = db
    .prepare(
      `INSERT INTO tickets (key, profile, title, url, status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`,
    )
    .run(key, profile, title, url, status, source, t, t);
  if (r.changes !== 1) return false;
  logEvent(db, key, null, status, `claimed from ${source}`);
  return true;
}

/** A ticket stopped by a reassignment and assigned back to the owner is proposed again, once. */
export function reclaim(db, key, source) {
  const r = db
    .prepare(
      `UPDATE tickets SET status = 'proposed', stop_reason = NULL, source = ?, updated_at = ?
       WHERE key = ? AND status = 'stopped' AND stop_reason = 'reassigned'`,
    )
    .run(source, now(), key);
  if (r.changes !== 1) return false;
  logEvent(db, key, 'stopped', 'proposed', `assigned again (${source})`);
  return true;
}

export function getTicket(db, key) {
  const row = db.prepare('SELECT * FROM tickets WHERE key = ?').get(key);
  return row ? decode(row) : null;
}

export function getEvents(db, key) {
  return db.prepare('SELECT at, from_status, to_status, detail FROM ticket_events WHERE key = ? ORDER BY id').all(key);
}

export function listTickets(db, { status, profile } = {}) {
  const where = [];
  const args = [];
  if (status) {
    const list = status.split(',');
    where.push(`status IN (${list.map(() => '?').join(',')})`);
    args.push(...list);
  }
  if (profile) {
    where.push('profile = ?');
    args.push(profile);
  }
  const sql = `SELECT * FROM tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`;
  return db.prepare(sql).all(...args).map(decode);
}

function decode(row) {
  return { ...row, workspaces: JSON.parse(row.workspaces), dispatches: JSON.parse(row.dispatches) };
}

const FIELDS = { titleEn: 'title_en', branch: 'branch', pr: 'pr_number', headSha: 'head_sha', prAck: 'pr_ack', note: 'note', url: 'url', title: 'title' };

/**
 * Updates a ticket. A status change must follow TRANSITIONS unless force is set.
 * `workspace` and `dispatch` append to their lists.
 */
export function setTicket(db, key, changes, { force = false, detail } = {}) {
  const current = getTicket(db, key);
  if (!current) throw new Error(`${key} is not tracked`);
  const sets = [];
  const args = [];
  if (changes.status && changes.status !== current.status) {
    if (!STATUSES.includes(changes.status)) throw new Error(`Unknown status: ${changes.status}`);
    if (!force && !TRANSITIONS[current.status].includes(changes.status)) {
      throw new Error(
        `${key}: ${current.status} → ${changes.status} is not allowed (allowed: ${TRANSITIONS[current.status].join(', ') || 'none'})`,
      );
    }
    sets.push('status = ?', 'stop_reason = ?');
    args.push(changes.status, changes.status === 'stopped' ? (changes.stopReason ?? 'owner') : null);
    if (changes.stopReason && !STOP_REASONS.includes(changes.stopReason)) throw new Error(`Unknown stop reason: ${changes.stopReason}`);
  }
  for (const [name, column] of Object.entries(FIELDS)) {
    if (changes[name] !== undefined) {
      sets.push(`${column} = ?`);
      args.push(changes[name] === '' ? null : changes[name]);
    }
  }
  for (const [name, column] of [['workspace', 'workspaces'], ['dispatch', 'dispatches']]) {
    const value = changes[name];
    if (!value || current[column].includes(value)) continue;
    sets.push(`${column} = ?`);
    args.push(JSON.stringify([...current[column], value]));
  }
  if (!sets.length) return current;
  sets.push('updated_at = ?');
  args.push(now());
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE key = ?`).run(...args, key);
    if (changes.status && changes.status !== current.status) logEvent(db, key, current.status, changes.status, detail);
    else if (detail) logEvent(db, key, null, null, detail);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getTicket(db, key);
}

export function removeTicket(db, key) {
  return db.prepare('DELETE FROM tickets WHERE key = ?').run(key).changes === 1;
}

export function clearTickets(db, mode) {
  if (mode === 'all') return Number(db.prepare('DELETE FROM tickets').run().changes);
  const list = CLOSED.map(() => '?').join(',');
  return Number(db.prepare(`DELETE FROM tickets WHERE status IN (${list})`).run(...CLOSED).changes);
}
