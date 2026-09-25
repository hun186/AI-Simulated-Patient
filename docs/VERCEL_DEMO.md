# Vercel PoC deployment

Vercel is a public demonstration target. It is intentionally separate from the Windows/Linux SQLite production mode.

## Build/runtime contract

- Node.js is pinned to `22.x`.
- Framework preset is explicitly `Other` via `"framework": null`.
- No framework build command is required; root static files and `/api/**/*.js` Vercel Functions are deployed directly.
- SQLite-only files are excluded from Vercel Function bundles.
- Without `DATABASE_URL`, `/api/runtime` reports `persistence: "browser"` and `demoAuth: true`.

## Mock Login

When Vercel has no durable database configured, visitors see one-click roles:

- Student
- Teacher
- Administrator

This is UI/demo identity only. It does not call the production login endpoint and it does not create authentication records. The selected role is stored in the browser so a refresh keeps the demo session.

The Student role hides the Teacher console. Teacher/Admin demo roles expose the teaching workflow that can operate with browser-local case and record data.

Logging out clears the mock identity and returns to the role selector.

## Production boundary

Do not use Vercel browser persistence for real student records.

For real deployments use Windows/Linux + SQLite. If Vercel later needs durable multi-user authentication, configure the retained PostgreSQL path instead of attempting to persist a local SQLite file in serverless storage.
