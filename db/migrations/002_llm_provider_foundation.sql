CREATE TABLE llm_provider_connections (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('system','teacher')),
  owner_user_id TEXT REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider_kind TEXT NOT NULL CHECK (provider_kind IN ('openai','openai_compatible')),
  preset TEXT NOT NULL CHECK (preset IN ('openai','deepseek','ollama','custom')),
  base_url TEXT NOT NULL,
  default_model TEXT NOT NULL,
  encrypted_api_key TEXT,
  api_key_iv TEXT,
  api_key_tag TEXT,
  api_key_last4 TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (scope_type='system' AND owner_user_id IS NULL)
    OR
    (scope_type='teacher' AND owner_user_id IS NOT NULL)
  )
);
CREATE INDEX llm_provider_connections_owner_idx
  ON llm_provider_connections(owner_user_id,updated_at DESC);

CREATE TABLE llm_agent_routes (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('system','case')),
  scope_id TEXT,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('patient','coach','evaluator')),
  connection_id TEXT NOT NULL REFERENCES llm_provider_connections(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (scope_type='system' AND scope_id IS NULL)
    OR
    (scope_type='case' AND scope_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX llm_agent_routes_scope_agent_uidx
  ON llm_agent_routes(scope_type,ifnull(scope_id,''),agent_type);
CREATE INDEX llm_agent_routes_connection_idx ON llm_agent_routes(connection_id);

ALTER TABLE interview_sessions
  ADD COLUMN llm_route_snapshot TEXT NOT NULL DEFAULT '{}';

CREATE TABLE llm_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES interview_sessions(id) ON DELETE SET NULL,
  case_id TEXT REFERENCES cases(id) ON DELETE SET NULL,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('patient','coach','evaluator')),
  connection_id TEXT REFERENCES llm_provider_connections(id) ON DELETE SET NULL,
  provider_kind TEXT NOT NULL,
  preset TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  error_code TEXT,
  provider_request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX llm_usage_events_user_created_idx
  ON llm_usage_events(user_id,created_at DESC);
CREATE INDEX llm_usage_events_session_idx
  ON llm_usage_events(session_id,created_at ASC);
CREATE INDEX llm_usage_events_connection_idx
  ON llm_usage_events(connection_id,created_at DESC);
