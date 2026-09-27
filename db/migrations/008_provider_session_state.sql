CREATE TABLE llm_provider_session_state (
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES llm_provider_connections(id) ON DELETE CASCADE,
  provider_kind TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (session_id,connection_id)
);

CREATE INDEX llm_provider_session_state_connection_idx
  ON llm_provider_session_state(connection_id,updated_at DESC);
