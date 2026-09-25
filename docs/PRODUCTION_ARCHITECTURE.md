# Production architecture

```text
Windows Node server / Vercel Functions
                 │
                 ├─ HttpOnly cookie authentication
                 │      ├─ teacher
                 │      └─ student
                 │
                 ├─ Student-safe case API
                 ├─ Teacher case / user / record APIs
                 ├─ Interview session API
                 ├─ Patient provider
                 ├─ Optional Learning Coach
                 └─ Final Evaluator
                         │
                         ▼
                  PostgreSQL / Neon
                         │
                         ├─ app_users
                         ├─ auth_sessions
                         ├─ cases
                         ├─ interview_sessions
                         ├─ interview_messages
                         └─ evaluations
```

## Runtime modes

### Demo mode

When `DATABASE_URL` is absent, the browser-local POC stays available for zero-setup demonstrations. Cases and records can use browser storage. This mode is not suitable for real examinations.

### Production persistence mode

When `DATABASE_URL` is present:

- teacher/student login is required;
- authentication uses an HttpOnly SameSite=Lax session cookie;
- student APIs return only neutral student-facing case metadata;
- internal diagnosis, facts, triggers and rubrics remain server-side;
- each interview gets a server-generated UUID;
- transcript and revealed-fact state are written to PostgreSQL;
- interactive session APIs are strictly owner-scoped;
- teachers review centralized records through teacher-only APIs;
- the final evaluator reads the transcript from PostgreSQL instead of trusting browser-submitted transcript data;
- the browser does not persist the production transcript or hidden fact state in localStorage.

## Frozen case ground truth

At interview creation, the server writes both:

- `case_version`
- `case_snapshot`

into `interview_sessions`.

Patient, Coach and Evaluator all use that frozen snapshot for the entire session. Later edits to a case therefore cannot silently change the meaning or score of an already-started interview.

## Coach audit

`coach_enabled` stores the current switch state.

`coach_used` is a permanent audit flag that becomes true once Coach has ever been enabled during that session. Turning Coach off later does not erase that fact from the teacher record.

## Information boundary

The student browser must never receive the complete production `definition_json`.

Teacher/internal title, etiology, hidden case facts, rubric, learning goals and scoring ground truth remain on the server. The student receives only the neutral case label, neutral brief, basic demographics and opening line.

## Initial teacher bootstrap

After applying the schema and configuring `DATABASE_URL` plus `ADMIN_SETUP_KEY`, the application detects an empty user table and shows a one-time first-teacher setup form.

After bootstrap, rotate or remove `ADMIN_SETUP_KEY`.

## Windows and Vercel

The Windows Node server and Vercel Functions import the same API handler modules. Only the hosting adapter differs.

For Vercel configure at least:

- `DATABASE_URL`
- `ADMIN_SETUP_KEY` during first setup
- `LLM_PROVIDER=mock` for the current POC

A future OpenAI provider can add `OPENAI_API_KEY` without changing the persistence/auth architecture.


## Account authorization

Production authentication follows three domain roles: `admin`, `teacher`, and `student`.

Teachers are not globally privileged. Their student/account/result access is filtered through `teacher_student_assignments`. Admins have global account/audit visibility. Interactive student sessions remain owner-scoped.

See `docs/AUTH_SECURITY.md` for the security model adapted from the portable auth reference pack.
