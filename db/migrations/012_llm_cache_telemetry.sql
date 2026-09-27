ALTER TABLE llm_usage_events
  ADD COLUMN cache_miss_tokens INTEGER NOT NULL DEFAULT 0
  CHECK (cache_miss_tokens >= 0);

ALTER TABLE llm_usage_events
  ADD COLUMN cache_read_status TEXT NOT NULL DEFAULT 'unreported'
  CHECK (cache_read_status IN ('reported','unreported'));

ALTER TABLE llm_usage_events
  ADD COLUMN cache_savings_microusd INTEGER
  CHECK (cache_savings_microusd IS NULL OR cache_savings_microusd >= 0);

ALTER TABLE llm_usage_events
  ADD COLUMN cache_savings_microntd INTEGER
  CHECK (cache_savings_microntd IS NULL OR cache_savings_microntd >= 0);
