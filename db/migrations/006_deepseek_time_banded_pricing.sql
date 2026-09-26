ALTER TABLE llm_pricing_rules
  ADD COLUMN time_band TEXT NOT NULL DEFAULT 'always'
  CHECK (time_band IN ('always','peak','off_peak'));

CREATE INDEX llm_pricing_rules_time_lookup_idx
  ON llm_pricing_rules(preset,model_pattern,time_band,is_active,effective_at DESC);

-- DeepSeek V4.1 Flash pricing effective 2026-09-10 12:00 Beijing (04:00 UTC).
-- Rates are micro-USD per 1M tokens.
INSERT INTO llm_pricing_rules
  (id,preset,model_pattern,time_band,input_microusd_per_million,cached_input_microusd_per_million,
   output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
VALUES
  ('builtin-deepseek-flash-peak-20260910','deepseek','deepseek-flash','peak',300000,6000,1200000,1200000,'2026-09-10T04:00:00.000Z',1),
  ('builtin-deepseek-flash-offpeak-20260910','deepseek','deepseek-flash','off_peak',150000,3000,600000,600000,'2026-09-10T04:00:00.000Z',1),
  ('builtin-deepseek-v4-flash-alias-peak-20260910','deepseek','deepseek-v4-flash*','peak',300000,6000,1200000,1200000,'2026-09-10T04:00:00.000Z',1),
  ('builtin-deepseek-v4-flash-alias-offpeak-20260910','deepseek','deepseek-v4-flash*','off_peak',150000,3000,600000,600000,'2026-09-10T04:00:00.000Z',1);

-- DeepSeek V4 Pro peak/off-peak pricing effective 2026-08-17 00:00 Beijing (2026-08-16 16:00 UTC).
INSERT INTO llm_pricing_rules
  (id,preset,model_pattern,time_band,input_microusd_per_million,cached_input_microusd_per_million,
   output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
VALUES
  ('builtin-deepseek-v4-pro-peak-20260817','deepseek','deepseek-v4-pro','peak',1320000,44000,3960000,3960000,'2026-08-16T16:00:00.000Z',1),
  ('builtin-deepseek-v4-pro-offpeak-20260817','deepseek','deepseek-v4-pro','off_peak',660000,22000,1980000,1980000,'2026-08-16T16:00:00.000Z',1);
