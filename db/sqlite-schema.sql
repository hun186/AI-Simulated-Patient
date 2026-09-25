PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher','student')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','pending','suspended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  csrf_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_throttle (
  key_hash TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS auth_throttle_updated_idx ON auth_throttle(updated_at);

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  reason TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  identifier TEXT NOT NULL DEFAULT '',
  client_host TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS auth_audit_events_created_idx ON auth_audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_events_actor_idx ON auth_audit_events(actor_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_events_target_idx ON auth_audit_events(target_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS teacher_student_assignments (
  teacher_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  student_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (teacher_user_id,student_user_id),
  CHECK (teacher_user_id <> student_user_id)
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  internal_title TEXT NOT NULL,
  student_label TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT '自訂',
  student_brief TEXT NOT NULL DEFAULT '',
  definition_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  case_version INTEGER NOT NULL,
  case_snapshot TEXT NOT NULL,
  student_user_id TEXT NOT NULL REFERENCES app_users(id),
  mode TEXT NOT NULL CHECK (mode IN ('training','exam')),
  coach_enabled INTEGER NOT NULL DEFAULT 0 CHECK (coach_enabled IN (0,1)),
  coach_used INTEGER NOT NULL DEFAULT 0 CHECK (coach_used IN (0,1)),
  revealed_fact_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS interview_sessions_student_idx ON interview_sessions(student_user_id,started_at DESC);
CREATE INDEX IF NOT EXISTS interview_sessions_case_idx ON interview_sessions(case_id,started_at DESC);

CREATE TABLE IF NOT EXISTS interview_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('student','patient','system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS interview_messages_session_idx ON interview_messages(session_id,id);

CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE REFERENCES interview_sessions(id) ON DELETE CASCADE,
  rubric_version INTEGER NOT NULL DEFAULT 1,
  total_score REAL NOT NULL,
  max_score REAL NOT NULL,
  percentage REAL NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

PRAGMA user_version = 1;
