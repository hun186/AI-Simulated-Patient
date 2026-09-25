# Windows production-like deployment

## 1. Prerequisites

Install Node.js 22+ and verify:

```powershell
node -v
npm -v
```

Clone the repository and install dependencies:

```powershell
git clone https://github.com/hun186/AI-Simulated-Patient.git
cd AI-Simulated-Patient
npm install
```

## 2. Create PostgreSQL / Neon

Create a Neon project (or another PostgreSQL database), then run the complete `db/schema.sql` in the SQL editor.

The schema is intentionally re-runnable and contains the current additive migration steps (for example `coach_used` and frozen `case_snapshot`). Re-run the current schema after pulling a newer application version.

## 3. Configure the Windows process

In PowerShell:

```powershell
$env:DATABASE_URL="postgresql://..."
$env:ADMIN_SETUP_KEY="replace-with-a-long-random-secret"
$env:LLM_PROVIDER="mock"
npm run dev
```

Open:

```text
http://localhost:3000
```

If `DATABASE_URL` is present, the application automatically enters server-persistence mode.

## 4. first administrator setup

On the first page load, when the database contains no users, the browser shows **建立第一位系統管理員**.

Enter:

- teacher display name
- teacher email
- a password with at least 12 characters
- the same `ADMIN_SETUP_KEY` configured in PowerShell

The setup endpoint succeeds only while the user table is empty. After creating the first administrator, rotate or remove `ADMIN_SETUP_KEY`.

## 5. Create student accounts

Log in as a teacher:

```text
教師管理 → 帳號管理
```

Create student or additional teacher accounts. In production mode the student name shown on a session comes from the authenticated account and cannot be edited by the student.

## 6. Runtime checks

Health endpoint:

```text
http://localhost:3000/api/health
```

Expected database mode response includes:

```json
{"ok":true,"mode":"production","database":"connected"}
```

The same API handler modules are used by the Windows Node server and Vercel Functions.


## Authentication security environment variables

Recommended production values:

```powershell
$env:APP_ENV="production"
$env:AUTH_SESSION_TTL_SECONDS="43200"
$env:AUTH_THROTTLE_FAILURE_LIMIT="5"
$env:AUTH_THROTTLE_WINDOW_SECONDS="900"
$env:AUTH_THROTTLE_BLOCK_SECONDS="900"
# Optional explicit origin allowlist:
# $env:AUTH_ALLOWED_ORIGINS="https://your-app.example"
```

When `APP_ENV=production`, the first-admin bootstrap refuses an `ADMIN_SETUP_KEY` shorter than 32 bytes.
