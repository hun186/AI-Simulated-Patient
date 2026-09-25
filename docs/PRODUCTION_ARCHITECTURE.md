# Production architecture

```text
Windows local server / Vercel Functions
              │
              ├─ Authentication + role checks
              │      ├─ teacher
              │      └─ student
              │
              ├─ Student-safe case API
              ├─ Teacher case management API
              ├─ Interview session API
              ├─ Patient / Coach / Evaluator providers
              │
              ▼
        PostgreSQL / Neon
              │
              ├─ app_users
              ├─ auth_sessions
              ├─ cases (ground truth is server-side)
              ├─ interview_sessions
              ├─ interview_messages
              └─ evaluations
```

## Runtime modes

### Demo mode

If `DATABASE_URL` is absent, the existing browser-local POC remains available. This is useful for a zero-setup demonstration, but is not suitable for real assessment.

### Production persistence mode

If `DATABASE_URL` is present:

- users authenticate with an HttpOnly session cookie;
- student case APIs return only neutral student-facing metadata;
- case ground truth and rubrics stay on the server;
- an interview gets a server-generated UUID;
- student and patient turns are appended to PostgreSQL;
- revealed-fact state is stored server-side;
- the final evaluator reads the transcript from PostgreSQL rather than trusting a browser-submitted transcript;
- teachers can retrieve centralized student results.

## Initial teacher bootstrap

1. Apply `db/schema.sql` to Neon/PostgreSQL.
2. Set `DATABASE_URL` and a long random `ADMIN_SETUP_KEY`.
3. POST once to `/api/auth/bootstrap` with `setupKey`, `email`, `password`, and `displayName`.
4. The first teacher is created and receives an HttpOnly session cookie.
5. Rotate or remove `ADMIN_SETUP_KEY` after setup.

## Security boundary

The browser must never receive the complete `definition_json` for a built-in production case. Patient and evaluator providers load it server-side. Teacher endpoints require the teacher role. Student sessions are owner-scoped; a student cannot read or mutate another student's session.

## Windows

The same Node.js application can run on Windows. Set environment variables in PowerShell, run `npm install`, apply the schema to the chosen PostgreSQL/Neon database, then run `npm run dev`.

## Vercel

Set `DATABASE_URL` and `ADMIN_SETUP_KEY` in Vercel project environment variables. Neon provides a serverless JavaScript driver designed for serverless/edge environments. Redeploy after changing Vercel environment variables.
