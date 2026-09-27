ALTER TABLE interview_sessions
  ADD COLUMN teacher_snapshot TEXT NOT NULL DEFAULT '[]';

CREATE TABLE interview_coach_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX interview_coach_events_session_idx
  ON interview_coach_events(session_id,id);
