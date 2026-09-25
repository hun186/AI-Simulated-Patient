-- Production-oriented schema sketch for PostgreSQL / Neon.
-- Not required for the zero-config Mock POC.

create table if not exists cases (
  id text primary key,
  version integer not null default 1,
  title text not null,
  definition_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists interview_sessions (
  id uuid primary key,
  case_id text not null references cases(id),
  case_version integer not null,
  student_external_id text,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists interview_messages (
  id bigserial primary key,
  session_id uuid not null references interview_sessions(id) on delete cascade,
  role text not null check (role in ('student','patient','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists evaluations (
  id bigserial primary key,
  session_id uuid not null references interview_sessions(id) on delete cascade,
  rubric_version integer not null,
  total_score numeric,
  result_json jsonb not null,
  created_at timestamptz not null default now()
);
