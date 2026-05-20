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

ensureColumn('events', 'escalation_rate', 'REAL');
ensureColumn('scenarios', 'start_date', 'TEXT');
ensureColumn('buckets', 'enabled', "INTEGER NOT NULL DEFAULT 1");

console.log(`[db] SQLite ready at ${DB_PATH}`);

export default db;
