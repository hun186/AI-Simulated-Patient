CREATE TABLE llm_pricing_rules (
  id TEXT PRIMARY KEY,
  preset TEXT NOT NULL CHECK (preset IN ('openai','deepseek','ollama','custom')),
  model_pattern TEXT NOT NULL,
  input_microusd_per_million INTEGER CHECK (input_microusd_per_million IS NULL OR input_microusd_per_million >= 0),
  cached_input_microusd_per_million INTEGER CHECK (cached_input_microusd_per_million IS NULL OR cached_input_microusd_per_million >= 0),
  output_microusd_per_million INTEGER CHECK (output_microusd_per_million IS NULL OR output_microusd_per_million >= 0),
  reasoning_microusd_per_million INTEGER CHECK (reasoning_microusd_per_million IS NULL OR reasoning_microusd_per_million >= 0),
  effective_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX llm_pricing_rules_lookup_idx
  ON llm_pricing_rules(preset,model_pattern,is_active,effective_at DESC);

CREATE TABLE llm_user_quotas (
  user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  daily_token_limit INTEGER CHECK (daily_token_limit IS NULL OR daily_token_limit >= 0),
  monthly_token_limit INTEGER CHECK (monthly_token_limit IS NULL OR monthly_token_limit >= 0),
  daily_cost_limit_microusd INTEGER CHECK (daily_cost_limit_microusd IS NULL OR daily_cost_limit_microusd >= 0),
  monthly_cost_limit_microusd INTEGER CHECK (monthly_cost_limit_microusd IS NULL OR monthly_cost_limit_microusd >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  updated_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE llm_usage_events
  ADD COLUMN estimated_cost_microusd INTEGER
  CHECK (estimated_cost_microusd IS NULL OR estimated_cost_microusd >= 0);

ALTER TABLE llm_usage_events
  ADD COLUMN pricing_status TEXT NOT NULL DEFAULT 'unpriced'
  CHECK (pricing_status IN ('priced','unpriced','partial'));

ALTER TABLE llm_usage_events
  ADD COLUMN pricing_rule_id TEXT REFERENCES llm_pricing_rules(id) ON DELETE SET NULL;
