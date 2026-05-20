-- Future Sight — initial schema (better-sqlite3, WAL mode)
-- Run on every startup; idempotent via IF NOT EXISTS.

PRAGMA foreign_keys = ON;

-- ============================================================
-- Users & auth
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- connect-sqlite3 manages its own `sessions` table; we don't create it here.

-- ============================================================
-- Plans (households) and membership
-- ============================================================
CREATE TABLE IF NOT EXISTS plans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  base_currency   TEXT NOT NULL DEFAULT 'USD',
  created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  version         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plan_members (
  plan_id         INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plan_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_members_user ON plan_members(user_id);

-- ============================================================
-- Scenarios
-- ============================================================
CREATE TABLE IF NOT EXISTS scenarios (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id                  INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  description              TEXT,
  is_base                  INTEGER NOT NULL DEFAULT 0,
  cloned_from_scenario_id  INTEGER REFERENCES scenarios(id) ON DELETE SET NULL,
  horizon_years            INTEGER NOT NULL DEFAULT 30,
  start_date               TEXT,                    -- ISO YYYY-MM-DD; NULL = use today at projection time
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scenarios_plan ON scenarios(plan_id);

-- ============================================================
-- Buckets (investment / savings "pots")
-- ============================================================
CREATE TABLE IF NOT EXISTS buckets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id       INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  category          TEXT,
  currency          TEXT NOT NULL DEFAULT 'USD',
  starting_balance  REAL NOT NULL DEFAULT 0,
  expected_return   REAL NOT NULL DEFAULT 0.05,  -- decimal, e.g. 0.07 for 7%
  compounding       TEXT NOT NULL DEFAULT 'monthly' CHECK (compounding IN ('monthly','annual')),
  target_amount     REAL,
  target_date       TEXT,                        -- ISO YYYY-MM-DD
  icon              TEXT DEFAULT 'wallet',       -- lucide icon name
  color             TEXT DEFAULT 'primary',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  enabled           INTEGER NOT NULL DEFAULT 1,  -- toggle bucket in/out of projections
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_buckets_scenario ON buckets(scenario_id);

-- ============================================================
-- Contribution schedules — variable contributions over time
-- ============================================================
CREATE TABLE IF NOT EXISTS contribution_schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_id   INTEGER NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
  amount      REAL NOT NULL,
  cadence     TEXT NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('monthly','quarterly','annual')),
  start_date  TEXT NOT NULL,        -- ISO YYYY-MM-DD
  end_date    TEXT,                 -- ISO YYYY-MM-DD, NULL = open-ended
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contributions_bucket ON contribution_schedules(bucket_id);

-- ============================================================
-- Events — point-in-time changes on the scenario timeline
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id     INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  bucket_id       INTEGER REFERENCES buckets(id) ON DELETE CASCADE,  -- NULL for plan-wide events
  type            TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','rate_change','contribution_change')),
  date            TEXT NOT NULL,        -- ISO YYYY-MM-DD
  amount          REAL,                 -- for deposit/withdrawal/contribution_change
  new_rate        REAL,                 -- for rate_change (decimal, e.g. 0.04)
  recurring       INTEGER NOT NULL DEFAULT 0,
  cadence         TEXT CHECK (cadence IN ('monthly','quarterly','annual')),
  end_date        TEXT,
  escalation_rate REAL,                 -- optional annual escalation, e.g. 0.03 for +3%/yr
  enabled         INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_scenario ON events(scenario_id);
CREATE INDEX IF NOT EXISTS idx_events_bucket ON events(bucket_id);

-- ============================================================
-- Actuals — recorded historical balances per bucket
-- ============================================================
CREATE TABLE IF NOT EXISTS actuals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_id   INTEGER NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,        -- ISO YYYY-MM-DD
  balance     REAL NOT NULL,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bucket_id, date)
);
CREATE INDEX IF NOT EXISTS idx_actuals_bucket ON actuals(bucket_id);

-- ============================================================
-- FX rates cache (frankfurter.app backed)
-- ============================================================
CREATE TABLE IF NOT EXISTS fx_cache (
  base        TEXT NOT NULL,
  quote       TEXT NOT NULL,
  date        TEXT NOT NULL DEFAULT 'latest',
  rate        REAL NOT NULL,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (base, quote, date)
);

-- ============================================================
-- Audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id     INTEGER REFERENCES plans(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  details     TEXT,                  -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_plan ON audit_log(plan_id, created_at DESC);

-- ============================================================
-- Triggers — keep `updated_at` fresh and bump plan version
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_users_updated
AFTER UPDATE ON users
BEGIN
  UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_plans_updated
AFTER UPDATE ON plans
BEGIN
  UPDATE plans SET updated_at = datetime('now'), version = OLD.version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_scenarios_updated
AFTER UPDATE ON scenarios
BEGIN
  UPDATE scenarios SET updated_at = datetime('now') WHERE id = NEW.id;
  UPDATE plans SET version = version + 1, updated_at = datetime('now') WHERE id = NEW.plan_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_buckets_updated
AFTER UPDATE ON buckets
BEGIN
  UPDATE buckets SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_events_updated
AFTER UPDATE ON events
BEGIN
  UPDATE events SET updated_at = datetime('now') WHERE id = NEW.id;
END;
