import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '..', '..', 'data', 'app.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schemaSql);

// ---- Lightweight migration runner ----
// SQLite doesn't support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so we
// inspect the table and add missing columns conditionally. Fresh installs
// already have them from schema.sql; this handles upgrades from older DBs.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db] migrated: added column ${table}.${column}`);
  }
}

// ---- Named one-shot migrations ----
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

function runMigration(name, fn) {
  const already = db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name);
  if (already) return;
  console.log(`[db] running migration: ${name}`);
  try {
    db.transaction(() => {
      fn();
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
    })();
    console.log(`[db] migration "${name}" done`);
  } catch (err) {
    console.error(`[db] migration "${name}" failed:`, err.message);
    throw err;
  }
}

ensureColumn('events', 'escalation_rate', 'REAL');
ensureColumn('scenarios', 'start_date', 'TEXT');
ensureColumn('buckets', 'enabled', "INTEGER NOT NULL DEFAULT 1");

// Drop the old CHECK constraint on events.cadence so we can support
// semi_annual and biennial without a schema rebuild on every release.
// SQLite enforces CHECK only on INSERT/UPDATE so old data is unaffected;
// we re-create the table without the CHECK and copy rows over.
runMigration('expand_event_cadences', () => {
  const cols = db.prepare("PRAGMA table_info(events)").all();
  if (!cols.length) return; // table doesn't exist yet (fresh install handled by schema.sql)

  db.exec(`
    DROP TRIGGER IF EXISTS trg_events_updated;
    CREATE TABLE events_new (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id     INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      bucket_id       INTEGER REFERENCES buckets(id) ON DELETE CASCADE,
      type            TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','rate_change','contribution_change')),
      date            TEXT NOT NULL,
      amount          REAL,
      new_rate        REAL,
      recurring       INTEGER NOT NULL DEFAULT 0,
      cadence         TEXT,
      end_date        TEXT,
      escalation_rate REAL,
      enabled         INTEGER NOT NULL DEFAULT 1,
      notes           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO events_new (id, scenario_id, bucket_id, type, date, amount, new_rate, recurring, cadence, end_date, escalation_rate, enabled, notes, created_at, updated_at)
      SELECT id, scenario_id, bucket_id, type, date, amount, new_rate, recurring, cadence, end_date, escalation_rate, enabled, notes, created_at, updated_at FROM events;
    DROP TABLE events;
    ALTER TABLE events_new RENAME TO events;
    CREATE INDEX IF NOT EXISTS idx_events_scenario ON events(scenario_id);
    CREATE INDEX IF NOT EXISTS idx_events_bucket ON events(bucket_id);
    CREATE TRIGGER IF NOT EXISTS trg_events_updated
    AFTER UPDATE ON events
    BEGIN
      UPDATE events SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
  `);
});

// Band-aid rip: contribution_schedules collapse into recurring deposit events.
// After this runs, the contribution_schedules table is empty and unused.
runMigration('contributions_to_events', () => {
  const schedules = db.prepare('SELECT * FROM contribution_schedules').all();
  if (schedules.length === 0) return;

  const insertEvent = db.prepare(
    `INSERT INTO events (scenario_id, bucket_id, type, date, amount, recurring, cadence, end_date, enabled, notes, escalation_rate)
     VALUES (?, ?, 'deposit', ?, ?, 1, ?, ?, 1, ?, NULL)`,
  );
  const getBucket = db.prepare('SELECT scenario_id FROM buckets WHERE id = ?');

  let migrated = 0;
  for (const s of schedules) {
    const bucket = getBucket.get(s.bucket_id);
    if (!bucket) continue; // orphaned schedule, skip
    insertEvent.run(
      bucket.scenario_id,
      s.bucket_id,
      s.start_date,
      s.amount,
      s.cadence,
      s.end_date,
      'Migrated from contribution schedule',
    );
    migrated++;
  }
  db.exec('DELETE FROM contribution_schedules');
  console.log(`[db] migrated ${migrated} contribution schedule(s) -> recurring deposit events`);
});

console.log(`[db] SQLite ready at ${DB_PATH}`);

export default db;
