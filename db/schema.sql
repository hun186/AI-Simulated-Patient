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
update app_users set account_status=case when is_active then 'active' else 'suspended' end where account_status is null;
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
