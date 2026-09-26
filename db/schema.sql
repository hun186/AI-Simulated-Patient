-- Future PostgreSQL / Neon schema. SQLite production uses db/sqlite-schema.sql automatically.
-- AI Simulated Patient production schema for PostgreSQL / Neon.
-- Re-runnable schema + additive migrations for the current application.

create table if not exists app_users (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  role text not null,
  password_salt text not null,
  password_hash text not null,
  is_active boolean not null default true,
  account_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_users add column if not exists account_status text not null default 'active';
update app_users set account_status='suspended' where is_active=false;
update app_users set account_status='active' where is_active=true and account_status is null;
alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check check (role in ('admin','teacher','student'));
alter table app_users drop constraint if exists app_users_account_status_check;
alter table app_users add constraint app_users_account_status_check check (account_status in ('active','pending','suspended'));

create table if not exists auth_sessions (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  csrf_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table auth_sessions add column if not exists csrf_hash text;
create index if not exists auth_sessions_user_idx on auth_sessions(user_id);
create index if not exists auth_sessions_expiry_idx on auth_sessions(expires_at);

create table if not exists auth_throttle (
  key_hash text primary key,
  scope text not null,
  failures integer not null default 0,
  window_started_at timestamptz not null,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists auth_throttle_updated_idx on auth_throttle(updated_at);

create table if not exists auth_audit_events (
  id bigserial primary key,
  action text not null,
  success boolean not null,
  reason text not null default '',
  actor_user_id uuid references app_users(id) on delete set null,
  target_user_id uuid references app_users(id) on delete set null,
  identifier text not null default '',
  client_host text not null default '',
  user_agent text not null default '',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists auth_audit_events_created_idx on auth_audit_events(created_at desc);
create index if not exists auth_audit_events_actor_idx on auth_audit_events(actor_user_id,created_at desc);
create index if not exists auth_audit_events_target_idx on auth_audit_events(target_user_id,created_at desc);

create table if not exists teacher_student_assignments (
  teacher_user_id uuid not null references app_users(id) on delete cascade,
  student_user_id uuid not null references app_users(id) on delete cascade,
  assigned_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (teacher_user_id,student_user_id),
  check (teacher_user_id <> student_user_id)
);

create table if not exists cases (
  id text primary key,
  version integer not null default 1,
  internal_title text not null,
  student_label text not null,
  difficulty text not null default '自訂',
  student_brief text not null default '',
  definition_json jsonb not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists interview_sessions (
  id uuid primary key,
  case_id text not null references cases(id),
  case_version integer not null,
  case_snapshot jsonb not null,
  student_user_id uuid not null references app_users(id),
  mode text not null check (mode in ('training','exam')),
  coach_enabled boolean not null default false,
  coach_used boolean not null default false,
  revealed_fact_ids jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','completed','abandoned')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table interview_sessions add column if not exists coach_used boolean not null default false;
alter table interview_sessions add column if not exists case_snapshot jsonb;
update interview_sessions s set case_snapshot=c.definition_json from cases c where s.case_id=c.id and s.case_snapshot is null;
alter table interview_sessions alter column case_snapshot set not null;
create index if not exists interview_sessions_student_idx on interview_sessions(student_user_id,started_at desc);
create index if not exists interview_sessions_case_idx on interview_sessions(case_id,started_at desc);

create table if not exists interview_messages (
  id bigserial primary key,
  session_id uuid not null references interview_sessions(id) on delete cascade,
  role text not null check (role in ('student','patient','system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists interview_messages_session_idx on interview_messages(session_id,id);

create table if not exists evaluations (
  id bigserial primary key,
  session_id uuid not null unique references interview_sessions(id) on delete cascade,
  rubric_version integer not null default 1,
  total_score numeric not null,
  max_score numeric not null,
  percentage numeric not null,
  result_json jsonb not null,
  created_at timestamptz not null default now()
);


-- LLM provider foundation (SQLite migration version 2 equivalent).
create table if not exists llm_provider_connections (
  id uuid primary key,
  scope_type text not null check (scope_type in ('system','teacher')),
  owner_user_id uuid references app_users(id) on delete cascade,
  name text not null,
  provider_kind text not null check (provider_kind in ('openai','openai_compatible')),
  preset text not null check (preset in ('openai','deepseek','ollama','custom')),
  base_url text not null,
  default_model text not null,
  encrypted_api_key text,
  api_key_iv text,
  api_key_tag text,
  api_key_last4 text not null default '',
  is_active boolean not null default true,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type='system' and owner_user_id is null)
    or
    (scope_type='teacher' and owner_user_id is not null)
  )
);
create index if not exists llm_provider_connections_owner_idx
  on llm_provider_connections(owner_user_id,updated_at desc);

create table if not exists llm_agent_routes (
  id uuid primary key,
  scope_type text not null check (scope_type in ('system','case')),
  scope_id text,
  owner_user_id uuid references app_users(id) on delete cascade,
  agent_type text not null check (agent_type in ('patient','coach','evaluator')),
  connection_id uuid not null references llm_provider_connections(id) on delete cascade,
  model text not null,
  config_json jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type='system' and scope_id is null)
    or
    (scope_type='case' and scope_id is not null)
  )
);
alter table llm_agent_routes add column if not exists owner_user_id uuid references app_users(id) on delete cascade;

update llm_agent_routes r
set owner_user_id=r.created_by
from llm_provider_connections c
where r.scope_type='case'
  and r.created_by is not null
  and c.id=r.connection_id
  and c.scope_type='teacher'
  and c.owner_user_id=r.created_by
  and r.owner_user_id is null;

drop index if exists llm_agent_routes_scope_agent_uidx;
create unique index if not exists llm_agent_routes_global_scope_agent_uidx
  on llm_agent_routes(scope_type,coalesce(scope_id,''),agent_type)
  where owner_user_id is null;
create unique index if not exists llm_agent_routes_owner_scope_agent_uidx
  on llm_agent_routes(scope_type,scope_id,owner_user_id,agent_type)
  where owner_user_id is not null;
create index if not exists llm_agent_routes_connection_idx on llm_agent_routes(connection_id);
create index if not exists llm_agent_routes_owner_idx on llm_agent_routes(owner_user_id,updated_at desc);

alter table interview_sessions add column if not exists llm_route_snapshot jsonb not null default '{}'::jsonb;

create table if not exists llm_usage_events (
  id bigserial primary key,
  user_id uuid references app_users(id) on delete set null,
  session_id uuid references interview_sessions(id) on delete set null,
  case_id text references cases(id) on delete set null,
  agent_type text not null check (agent_type in ('patient','coach','evaluator')),
  connection_id uuid references llm_provider_connections(id) on delete set null,
  provider_kind text not null,
  preset text not null,
  model text not null,
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  reasoning_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  latency_ms integer not null default 0,
  success boolean not null,
  error_code text,
  provider_request_id text,
  created_at timestamptz not null default now()
);
create index if not exists llm_usage_events_user_created_idx
  on llm_usage_events(user_id,created_at desc);
create index if not exists llm_usage_events_session_idx
  on llm_usage_events(session_id,created_at asc);
create index if not exists llm_usage_events_connection_idx
  on llm_usage_events(connection_id,created_at desc);


-- LLM usage reporting state (SQLite migration version 3 equivalent).
alter table llm_usage_events add column if not exists usage_status text not null default 'reported';


-- LLM usage pricing and per-user quotas (SQLite migration version 4 equivalent).
create table if not exists llm_pricing_rules (
  id uuid primary key,
  preset text not null check (preset in ('openai','deepseek','ollama','custom')),
  model_pattern text not null,
  time_band text not null default 'always' check (time_band in ('always','peak','off_peak')),
  input_microusd_per_million bigint check (input_microusd_per_million is null or input_microusd_per_million >= 0),
  cached_input_microusd_per_million bigint check (cached_input_microusd_per_million is null or cached_input_microusd_per_million >= 0),
  output_microusd_per_million bigint check (output_microusd_per_million is null or output_microusd_per_million >= 0),
  reasoning_microusd_per_million bigint check (reasoning_microusd_per_million is null or reasoning_microusd_per_million >= 0),
  effective_at timestamptz not null,
  is_active boolean not null default true,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table llm_pricing_rules add column if not exists time_band text not null default 'always';

do $
begin
  if not exists (
    select 1 from pg_constraint where conname='llm_pricing_rules_time_band_check'
  ) then
    alter table llm_pricing_rules
      add constraint llm_pricing_rules_time_band_check
      check (time_band in ('always','peak','off_peak'));
  end if;
end $;

create index if not exists llm_pricing_rules_lookup_idx
  on llm_pricing_rules(preset,model_pattern,is_active,effective_at desc);
create index if not exists llm_pricing_rules_time_lookup_idx
  on llm_pricing_rules(preset,model_pattern,time_band,is_active,effective_at desc);

insert into llm_pricing_rules
  (id,preset,model_pattern,time_band,input_microusd_per_million,cached_input_microusd_per_million,
   output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
values
  ('00000000-0000-4000-8000-000000000601','deepseek','deepseek-flash','peak',300000,6000,1200000,1200000,'2026-09-10T04:00:00Z',true),
  ('00000000-0000-4000-8000-000000000602','deepseek','deepseek-flash','off_peak',150000,3000,600000,600000,'2026-09-10T04:00:00Z',true),
  ('00000000-0000-4000-8000-000000000603','deepseek','deepseek-v4-flash*','peak',300000,6000,1200000,1200000,'2026-09-10T04:00:00Z',true),
  ('00000000-0000-4000-8000-000000000604','deepseek','deepseek-v4-flash*','off_peak',150000,3000,600000,600000,'2026-09-10T04:00:00Z',true),
  ('00000000-0000-4000-8000-000000000605','deepseek','deepseek-v4-pro','peak',1320000,44000,3960000,3960000,'2026-08-16T16:00:00Z',true),
  ('00000000-0000-4000-8000-000000000606','deepseek','deepseek-v4-pro','off_peak',660000,22000,1980000,1980000,'2026-08-16T16:00:00Z',true)
on conflict (id) do nothing;

create table if not exists llm_user_quotas (
  user_id uuid primary key references app_users(id) on delete cascade,
  daily_token_limit bigint check (daily_token_limit is null or daily_token_limit >= 0),
  monthly_token_limit bigint check (monthly_token_limit is null or monthly_token_limit >= 0),
  daily_cost_limit_microusd bigint check (daily_cost_limit_microusd is null or daily_cost_limit_microusd >= 0),
  monthly_cost_limit_microusd bigint check (monthly_cost_limit_microusd is null or monthly_cost_limit_microusd >= 0),
  is_active boolean not null default true,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table llm_usage_events add column if not exists estimated_cost_microusd bigint;
alter table llm_usage_events add column if not exists pricing_status text not null default 'unpriced';
alter table llm_usage_events add column if not exists pricing_rule_id uuid references llm_pricing_rules(id) on delete set null;

do $
begin
  if not exists (
    select 1 from pg_constraint where conname='llm_usage_events_estimated_cost_nonnegative'
  ) then
    alter table llm_usage_events
      add constraint llm_usage_events_estimated_cost_nonnegative
      check (estimated_cost_microusd is null or estimated_cost_microusd >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='llm_usage_events_pricing_status_check'
  ) then
    alter table llm_usage_events
      add constraint llm_usage_events_pricing_status_check
      check (pricing_status in ('priced','unpriced','partial'));
  end if;
end $;


-- Provider-aware pricing dimensions and TWD FX snapshots (SQLite migration version 6 equivalent).
alter table llm_pricing_rules add column if not exists context_band text not null default 'any';
alter table llm_pricing_rules add column if not exists cache_write_microusd_per_million bigint;
alter table llm_usage_events add column if not exists cache_write_tokens bigint not null default 0;
alter table llm_usage_events add column if not exists service_tier text;
alter table llm_usage_events add column if not exists estimated_cost_microntd bigint;
alter table llm_usage_events add column if not exists fx_rate_microunits_per_usd bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='llm_pricing_rules_context_band_check') then
    alter table llm_pricing_rules add constraint llm_pricing_rules_context_band_check
      check (context_band in ('any','short','long'));
  end if;
  if not exists (select 1 from pg_constraint where conname='llm_pricing_rules_cache_write_nonnegative') then
    alter table llm_pricing_rules add constraint llm_pricing_rules_cache_write_nonnegative
      check (cache_write_microusd_per_million is null or cache_write_microusd_per_million >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='llm_usage_events_cache_write_nonnegative') then
    alter table llm_usage_events add constraint llm_usage_events_cache_write_nonnegative
      check (cache_write_tokens >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='llm_usage_events_twd_cost_nonnegative') then
    alter table llm_usage_events add constraint llm_usage_events_twd_cost_nonnegative
      check (estimated_cost_microntd is null or estimated_cost_microntd >= 0);
  end if;
end $$;

create table if not exists llm_fx_rates (
  id uuid primary key,
  base_currency text not null,
  quote_currency text not null,
  rate_microunits_per_unit bigint not null check (rate_microunits_per_unit > 0),
  source text not null default '',
  effective_at timestamptz not null,
  is_active boolean not null default true,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists llm_fx_rates_lookup_idx
  on llm_fx_rates(base_currency,quote_currency,is_active,effective_at desc);
alter table llm_usage_events add column if not exists fx_rate_id uuid references llm_fx_rates(id) on delete set null;

insert into llm_fx_rates
  (id,base_currency,quote_currency,rate_microunits_per_unit,source,effective_at,is_active)
values
  ('00000000-0000-4000-8000-000000000690','USD','TWD',31780000,'CBC interbank closing rate 2026-09-24','2026-09-24T00:00:00Z',true)
on conflict (id) do nothing;

create index if not exists llm_pricing_rules_context_lookup_idx
  on llm_pricing_rules(preset,model_pattern,time_band,context_band,is_active,effective_at desc);

-- OpenAI Standard text pricing. Runtime applies Flex/Batch 0.5x and Fast/Priority 2x
-- from the actual service_tier and selects long context above 272K input tokens.
insert into llm_pricing_rules
  (id,preset,model_pattern,time_band,context_band,input_microusd_per_million,cached_input_microusd_per_million,
   cache_write_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active)
values
  ('00000000-0000-4000-8000-000000000610','openai','gpt-6-astra*','always','short',10000000,1000000,12500000,50000000,50000000,'2026-09-03T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000611','openai','gpt-6-astra*','always','long',20000000,2000000,25000000,75000000,75000000,'2026-09-03T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000612','openai','gpt-6-sol*','always','short',2000000,200000,2500000,10000000,10000000,'2026-09-22T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000613','openai','gpt-6-sol*','always','long',4000000,400000,5000000,15000000,15000000,'2026-09-22T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000614','openai','gpt-6-luna*','always','short',100000,10000,125000,500000,500000,'2026-09-22T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000615','openai','gpt-6-luna*','always','long',200000,20000,250000,750000,750000,'2026-09-22T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000616','openai','gpt-5.6-sol*','always','short',4000000,400000,5000000,20000000,20000000,'2026-08-21T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000617','openai','gpt-5.6-sol*','always','long',8000000,800000,10000000,30000000,30000000,'2026-08-21T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000618','openai','gpt-5.6','always','short',4000000,400000,5000000,20000000,20000000,'2026-08-21T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000619','openai','gpt-5.6','always','long',8000000,800000,10000000,30000000,30000000,'2026-08-21T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000620','openai','gpt-5.6-terra*','always','short',2000000,200000,2500000,12000000,12000000,'2026-07-30T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000621','openai','gpt-5.6-terra*','always','long',4000000,400000,5000000,18000000,18000000,'2026-07-30T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000622','openai','gpt-5.6-luna*','always','short',200000,20000,250000,1200000,1200000,'2026-07-30T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000623','openai','gpt-5.6-luna*','always','long',400000,40000,500000,1800000,1800000,'2026-07-30T00:00:00Z',true),
  ('00000000-0000-4000-8000-000000000624','openai','chat-latest','always','any',5000000,500000,null,30000000,30000000,'2026-09-27T00:00:00Z',true)
on conflict (id) do nothing;
