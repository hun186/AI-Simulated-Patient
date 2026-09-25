# Authentication and authorization design

This implementation is adapted from `hun186/poc-agent/portable_auth_pack`, but is intentionally not a direct port.

## What was retained from the reference pack

- generic login failures to reduce account enumeration;
- a dummy password hash path for unknown accounts, reducing obvious timing differences;
- login throttling after repeated failures;
- login/account security audit events with client host and user agent;
- password changes and staff resets invalidate every existing session for that account;
- production bootstrap secret requirements;
- server-side authorization checks rather than UI-only hiding;
- security regression tests.

## What was changed for this teaching system

### 1. Roles are domain roles, not a linear database hierarchy

The reference pack uses `superuser → db_operator → data_editor → data_reader`.

This system instead uses explicit permissions:

- **admin** — account administration, global security audit, all teacher capabilities;
- **teacher** — case management, assigned-student account management, assigned-student records;
- **student** — own interview sessions only.

A teacher cannot create another teacher or an admin.

### 2. Teacher access is resource-scoped

`teacher_student_assignments` defines which students a teacher is allowed to manage.

A teacher's account list and completed-interview list are filtered by this relationship. Admins retain global visibility.

A student interview session remains strictly owner-scoped even for a teacher. Teachers inspect completed work through the read-only teacher record endpoint rather than impersonating a student's interactive session.

### 3. No public registration

This is a managed teaching environment. Student accounts are provisioned by staff, so the public pending-registration workflow from the portable pack is intentionally omitted.

If open registration is later required, it should be introduced as a separate enrollment workflow with course/institution policy rather than exposing generic self-registration.

### 4. Opaque DB-backed cookies instead of bearer tokens

Authentication uses a cryptographically random opaque token in an HttpOnly cookie. Only its SHA-256 hash is stored in PostgreSQL.

This means no long-lived signing secret is required for session-token integrity, and logout is a direct deletion of the server-side session.

Default session TTL is 12 hours and is configurable with `AUTH_SESSION_TTL_SECONDS`.

### 5. CSRF protection is added

Because the browser uses cookies, authenticated POST requests require a per-session CSRF token in `X-CSRF-Token`.

The token is returned by login/bootstrap/`/api/auth/me`, kept only in page memory, and its hash is stored server-side.

Unsafe authenticated requests also validate the browser Origin. `AUTH_ALLOWED_ORIGINS` can explicitly configure accepted origins.

### 6. Throttling is database-backed

The portable pack correctly notes that process-local throttling is insufficient for multi-worker / multi-instance production.

This project stores throttle state in PostgreSQL (`auth_throttle`), so Windows multi-process evolution and Vercel/serverless instances share the same login-failure state.

Defaults:

- 5 failed attempts;
- 15-minute observation window;
- 15-minute temporary block.

### 7. Security audit is database-backed

`auth_audit_events` records security-relevant actions including:

- login success/failure/rate limiting;
- logout;
- bootstrap;
- account creation;
- suspension/reactivation;
- staff password reset;
- password change;
- teacher/student assignment changes.

Admins may read the global audit. Non-admin users are restricted to events involving their own account.

### 8. Password recovery is deliberately limited

A public "forgot password" endpoint is not exposed yet because there is no verified email/SMS/help-desk delivery channel.

For the POC, authorized staff may set a new temporary password for an account, which invalidates all previous sessions.

A future self-service recovery flow should use a single-use, short-expiry token delivered out-of-band. It must never return the token from the public forgot-password response.

## Password security

Passwords use Node.js `scrypt` with a unique random salt. The current minimum is 12 characters.

Unknown-account login still performs a dummy scrypt verification before returning the same generic login failure.

## Security headers

Windows and Vercel deployments set defense-in-depth headers including:

- Content Security Policy;
- frame denial;
- nosniff;
- no-referrer;
- restrictive Permissions Policy;
- no-store for API responses.

No permissive CORS policy is enabled by default.

## Deployment migration

After pulling auth changes, re-run the current `db/schema.sql`.

For a new database, the first account is bootstrapped as `admin`.

For a database created by an older POC version that has users but no admin, the first-run screen supports an explicit one-time promotion of an existing active account. It requires:

- the existing account email/password;
- the `ADMIN_SETUP_KEY`.

In production, `ADMIN_SETUP_KEY` must be at least 32 bytes and should be rotated or removed after bootstrap/migration.
