ALTER TABLE llm_usage_events
  ADD COLUMN usage_status TEXT NOT NULL DEFAULT 'reported'
  CHECK (usage_status IN ('reported','unreported','estimated'));
