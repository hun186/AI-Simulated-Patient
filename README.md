# AI Simulated Patient — Product-shaped POC

A speech-language pathology clinical-interview platform prototype with training, exam assessment, optional AI coaching, teacher case management, authentication and server-side persistence.

## Database strategy

### Current production default: SQLite

On a normal Windows or Linux host, no database server is required.

After:

```bash
npm install
npm run dev
```

the application automatically creates:

```text
data/aisp.sqlite
```

and applies the current SQLite schema.

SQLite production settings include:

- WAL journal mode
- foreign keys enabled
- busy timeout
- server-side users / sessions / cases / transcripts / evaluations / audit logs
- automatic schema initialization
- manual consistent backup with `npm run db:backup`

The SQLite file and its WAL/SHM files are ignored by Git.

### Browser-only demo

Set:

```text
DB_DRIVER=browser
```

to use the old localStorage-only demonstration mode.

### Future PostgreSQL path

The application keeps a database-driver boundary.

If future scale requires multiple application hosts or heavier concurrent writes:

```text
DB_DRIVER=postgres
DATABASE_URL=postgresql://...
```

selects the retained PostgreSQL/Neon adapter.

SQLite is therefore the current operational default, not a dead-end architecture.

### Vercel

Vercel is treated as a public PoC surface, not the SQLite production host.

With no `DATABASE_URL`, Vercel runs browser persistence plus a dedicated Mock Login screen with Student / Teacher / Admin roles. Mock identities are stored only in the current browser and never enter the production authentication tables.

A local SQLite file is not treated as durable persistence on Vercel. A future durable Vercel deployment should use PostgreSQL/Neon or another shared persistence service.

The repository pins Vercel to Node 22.x, explicitly uses the "Other" framework preset with no build command, and excludes the native SQLite adapter from Vercel Function bundles. Windows/Linux continue to use SQLite normally.

## Authentication / authorization

Production persistence includes:

- public student self-registration → `pending` → assigned teacher/admin approval
- public teacher self-registration → `pending` → admin-only approval
- `admin / teacher / student` roles
- teacher → assigned-student resource scope
- HttpOnly opaque session cookie
- CSRF protection and Origin validation
- database-backed login throttling
- security audit events
- password change/reset invalidates existing sessions
- server-side hidden case ground truth

See `docs/AUTH_SECURITY.md`.

## Interview modes

**Training**
- AI Coach is off by default
- students can practise independently
- Coach can be enabled mid-session
- final assessment is always available

**Exam**
- no Coach
- no live coverage progress
- no hidden case hints
- final scoring only after the interview ends

## LLM provider status

Patient, Coach and Evaluator remain deterministic mock providers for reproducible POC demonstrations. The persistence/auth contracts are designed so they can later be replaced by structured LLM providers.

## Local start

Node.js 22+:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

On a non-production local run, if no `ADMIN_SETUP_KEY` is configured, the server prints a temporary first-admin setup key in the console.

Tests:

```bash
npm test
```

Backup:

```bash
npm run db:backup
```

This is an educational prototype, not a medical device and not a source of diagnosis or treatment advice.
