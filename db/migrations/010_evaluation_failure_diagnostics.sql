CREATE TABLE evaluation_failure_diagnostics (
  error_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  student_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  diagnostic_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX evaluation_failure_diagnostics_session_idx
  ON evaluation_failure_diagnostics(session_id,created_at DESC);

CREATE INDEX evaluation_failure_diagnostics_student_idx
  ON evaluation_failure_diagnostics(student_user_id,created_at DESC);
