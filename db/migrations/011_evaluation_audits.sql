CREATE TABLE evaluation_audits (
  evaluation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  student_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success','success_normalized','success_repaired','failed')),
  audit_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX evaluation_audits_session_idx
  ON evaluation_audits(session_id,created_at DESC);

CREATE INDEX evaluation_audits_student_idx
  ON evaluation_audits(student_user_id,created_at DESC);

CREATE INDEX evaluation_audits_expiry_idx
  ON evaluation_audits(expires_at);
