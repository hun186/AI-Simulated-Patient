-- AI Simulated Patient production schema for PostgreSQL / Neon.
-- Apply this schema before enabling DATABASE_URL in the app.

create table if not exists app_users (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  role text not null check (role in ('teacher','student')),
  password_salt text not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_sessions (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_sessions_user_idx on auth_sessions(user_id);
create index if not exists auth_sessions_expiry_idx on auth_sessions(expires_at);

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
