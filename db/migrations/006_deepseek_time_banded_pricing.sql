ALTER TABLE llm_pricing_rules
  ADD COLUMN time_band TEXT NOT NULL DEFAULT 'always'
  CHECK (time_band IN ('always','peak','off_peak'));

ALTER TABLE llm_pricing_rules
  ADD COLUMN context_band TEXT NOT NULL DEFAULT 'any'
  CHECK (context_band IN ('any','short','long'));

ALTER TABLE llm_pricing_rules
  ADD COLUMN cache_write_microusd_per_million INTEGER
  CHECK (cache_write_microusd_per_million IS NULL OR cache_write_microusd_per_million >= 0);

CREATE INDEX llm_pricing_rules_time_lookup_idx
  ON llm_pricing_rules(preset,model_pattern,time_band,context_band,is_active,effective_at DESC);

CREATE TABLE llm_fx_rates (
  id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate_microunits_per_unit INTEGER NOT NULL CHECK (rate_microunits_per_unit > 0),
  source TEXT NOT NULL DEFAULT '',
  effective_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX llm_fx_rates_lookup_idx
  ON llm_fx_rates(base_currency,quote_currency,is_active,effective_at DESC);

ALTER TABLE llm_usage_events
  ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0);

ALTER TABLE llm_usage_events
  ADD COLUMN service_tier TEXT;

ALTER TABLE llm_usage_events
  ADD COLUMN estimated_cost_microntd INTEGER CHECK (estimated_cost_microntd IS NULL OR estimated_cost_microntd >= 0);

ALTER TABLE llm_usage_events
  ADD COLUMN fx_rate_microunits_per_usd INTEGER CHECK (fx_rate_microunits_per_usd IS NULL OR fx_rate_microunits_per_usd > 0);

ALTER TABLE llm_usage_events
  ADD COLUMN fx_rate_id TEXT REFERENCES llm_fx_rates(id) ON DELETE SET NULL;

-- Latest available CBC interbank closing reference before this migration was authored:
-- 2026-09-24, 1 USD = 31.780 TWD. Historical usage snapshots this rate;
-- Admin may add newer effective-dated USD/TWD rates later.
INSERT INTO llm_fx_rates
  (id,base_currency,quote_currency,rate_microunits_per_unit,source,effective_at,is_active)
VALUES
  ('builtin-cbc-usd-twd-20260924','USD','TWD',31780000,'CBC interbank closing rate 2026-09-24','2026-09-24T00:00:00.000Z',1);

-- DeepSeek V4.1 Flash pricing effective 2026-09-10 12:00 Beijing (04:00 UTC).
-- Rates are micro-USD per 1M tokens.
INSERT INTO llm_pricing_rules
  (id,preset,model_pattern,time_band,context_band,input_microusd_per_million,cached_input_microusd_per_million,
   cache_write_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
VALUES
  ('builtin-deepseek-flash-peak-20260910','deepseek','deepseek-flash','peak','any',300000,6000,NULL,1200000,1200000,'2026-09-10T04:00:00.000Z',1),
  ('builtin-deepseek-flash-offpeak-20260910','deepseek','deepseek-flash','off_peak','any',150000,3000,NULL,600000,600000,'2026-09-10T04:00:00.000Z',1),
  ('builtin-deepseek-v4-flash-alias-peak-20260910','deepseek','deepseek-v4-flash*','peak','any',300000,6000,NULL,1200000,1200000,'2026-09-10T04:00:00.000Z',1),
  ('builtin-deepseek-v4-flash-alias-offpeak-20260910','deepseek','deepseek-v4-flash*','off_peak','any',150000,3000,NULL,600000,600000,'2026-09-10T04:00:00.000Z',1);

-- DeepSeek V4 Pro peak/off-peak pricing effective 2026-08-17 00:00 Beijing.
INSERT INTO llm_pricing_rules
  (id,preset,model_pattern,time_band,context_band,input_microusd_per_million,cached_input_microusd_per_million,
   cache_write_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
VALUES
  ('builtin-deepseek-v4-pro-peak-20260817','deepseek','deepseek-v4-pro','peak','any',1320000,44000,NULL,3960000,3960000,'2026-08-16T16:00:00.000Z',1),
  ('builtin-deepseek-v4-pro-offpeak-20260817','deepseek','deepseek-v4-pro','off_peak','any',660000,22000,NULL,1980000,1980000,'2026-08-16T16:00:00.000Z',1);

-- OpenAI standard-processing text pricing. The runtime records service_tier and applies
-- exact Flex (0.5x) / Fast-Priority (2x) multipliers when those tiers are explicitly used.
-- GPT-6 Astra.
INSERT INTO llm_pricing_rules
  (id,preset,model_pattern,time_band,context_band,input_microusd_per_million,cached_input_microusd_per_million,
   cache_write_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
VALUES
  ('builtin-openai-gpt6-astra-short-20260903','openai','gpt-6-astra*','always','short',10000000,1000000,12500000,50000000,50000000,'2026-09-03T00:00:00.000Z',1),
  ('builtin-openai-gpt6-astra-long-20260903','openai','gpt-6-astra*','always','long',20000000,2000000,25000000,75000000,75000000,'2026-09-03T00:00:00.000Z',1);

-- GPT-6 Sol and Luna.
INSERT INTO llm_pricing_rules
  (id,preset,model_pattern,time_band,context_band,input_microusd_per_million,cached_input_microusd_per_million,
   cache_write_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
VALUES
  ('builtin-openai-gpt6-sol-short-20260922','openai','gpt-6-sol*','always','short',2000000,200000,2500000,10000000,10000000,'2026-09-22T00:00:00.000Z',1),
  ('builtin-openai-gpt6-sol-long-20260922','openai','gpt-6-sol*','always','long',4000000,400000,5000000,15000000,15000000,'2026-09-22T00:00:00.000Z',1),
  ('builtin-openai-gpt6-luna-short-20260922','openai','gpt-6-luna*','always','short',100000,10000,125000,500000,500000,'2026-09-22T00:00:00.000Z',1),
  ('builtin-openai-gpt6-luna-long-20260922','openai','gpt-6-luna*','always','long',200000,20000,250000,750000,750000,'2026-09-22T00:00:00.000Z',1);

-- GPT-5.6 family current standard prices. Sol promotional rate effective 2026-08-21;
-- Terra/Luna current rates effective 2026-07-30.
INSERT INTO llm_pricing_rules
  (id,preset,model_pattern,time_band,context_band,input_microusd_per_million,cached_input_microusd_per_million,
   cache_write_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
VALUES
  ('builtin-openai-gpt56-sol-short-20260821','openai','gpt-5.6-sol*','always','short',4000000,400000,5000000,20000000,20000000,'2026-08-21T00:00:00.000Z',1),
  ('builtin-openai-gpt56-sol-long-20260821','openai','gpt-5.6-sol*','always','long',8000000,800000,10000000,30000000,30000000,'2026-08-21T00:00:00.000Z',1),
  ('builtin-openai-gpt56-alias-short-20260821','openai','gpt-5.6','always','short',4000000,400000,5000000,20000000,20000000,'2026-08-21T00:00:00.000Z',1),
  ('builtin-openai-gpt56-alias-long-20260821','openai','gpt-5.6','always','long',8000000,800000,10000000,30000000,30000000,'2026-08-21T00:00:00.000Z',1),
  ('builtin-openai-gpt56-terra-short-20260730','openai','gpt-5.6-terra*','always','short',2000000,200000,2500000,12000000,12000000,'2026-07-30T00:00:00.000Z',1),
  ('builtin-openai-gpt56-terra-long-20260730','openai','gpt-5.6-terra*','always','long',4000000,400000,5000000,18000000,18000000,'2026-07-30T00:00:00.000Z',1),
  ('builtin-openai-gpt56-luna-short-20260730','openai','gpt-5.6-luna*','always','short',200000,20000,250000,1200000,1200000,'2026-07-30T00:00:00.000Z',1),
  ('builtin-openai-gpt56-luna-long-20260730','openai','gpt-5.6-luna*','always','long',400000,40000,500000,1800000,1800000,'2026-07-30T00:00:00.000Z',1);

-- Specialized chat-latest rate. Cache-write pricing is not published in its specialized table.
INSERT INTO llm_pricing_rules
  (id,preset,model_pattern,time_band,context_band,input_microusd_per_million,cached_input_microusd_per_million,
   cache_write_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
VALUES
  ('builtin-openai-chat-latest-20260927','openai','chat-latest','always','any',5000000,500000,NULL,30000000,30000000,'2026-09-27T00:00:00.000Z',1);
