# Production architecture

## Current default

```text
Windows / Linux host
        │
        ▼
      Node.js
        │
        ├─ Authentication / RBAC / CSRF
        ├─ Case management
        ├─ Interview sessions
        ├─ Patient / Coach / Evaluator
        └─ Security audit
               │
               ▼
         SQLite adapter
               │
               ▼
       data/aisp.sqlite
```

No separate SQL server is required.

## Database boundary

```text
Application services / APIs
            │
            ▼
          lib/db.js
        driver facade
        ┌─────┴──────┐
        ▼            ▼
 SQLite adapter   PostgreSQL adapter
   current          future scale
```

The application-level auth, cases, sessions and evaluation code uses the shared query facade. SQLite compatibility stays inside the adapter plus the portable SQL used by service modules.

## SQLite runtime

Startup automatically:

1. creates the configured data directory;
2. opens `data/aisp.sqlite` (or `SQLITE_PATH`);
3. enables `foreign_keys`;
4. enables WAL;
5. configures a 5-second busy timeout;
6. uses NORMAL synchronous mode;
7. applies `db/sqlite-schema.sql`;
8. records schema version through SQLite `user_version`.

The main SQLite database, WAL and SHM files must stay on the same local filesystem while the server is running.

## Database selection

Priority:

1. explicit `DB_DRIVER`
2. `DATABASE_URL` implies PostgreSQL
3. Vercel without a database URL → browser demo
4. normal Windows/Linux host → SQLite

Supported values:

```text
DB_DRIVER=sqlite
DB_DRIVER=browser
DB_DRIVER=postgres
```

## Future PostgreSQL upgrade

The PostgreSQL/Neon adapter remains in the repository. `db/schema.sql` is the PostgreSQL schema reference.

A future migration should copy data through a controlled migration utility rather than making application modules depend on PostgreSQL-specific types.

PostgreSQL becomes useful when requirements change to multiple application instances, HA, shared cloud storage, or substantially heavier concurrent writes.

## Security and data boundaries

- student-facing APIs never return complete case ground truth;
- interview sessions use a frozen case snapshot;
- interactive sessions are owner-scoped;
- teachers inspect assigned students through read-only management APIs;
- administrators manage global account scope and security audit;
- production browser sessions do not persist hidden fact state or transcripts in localStorage.

See `docs/AUTH_SECURITY.md`.
