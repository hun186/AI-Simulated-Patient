# Windows deployment — SQLite production default

## 1. Prerequisites

Install Node.js 22+.

```powershell
node -v
npm -v
```

Clone/update the repository:

```powershell
git clone https://github.com/hun186/AI-Simulated-Patient.git
cd AI-Simulated-Patient
npm.cmd install
```

## 2. Start

For local POC/testing:

```powershell
npm.cmd run dev
```

No PostgreSQL, Neon, Docker, or SQL Server installation is needed.

The console should show something similar to:

```text
[setup] Local first-admin setup key: ...
[db] SQLite: D:\...\AI-Simulated-Patient\data\aisp.sqlite (WAL=true, schema=1)
AI simulated patient: http://localhost:3000
```

Open `http://localhost:3000`.

On first run, paste the temporary setup key shown in the console into the first-administrator form.

## 3. Real production settings

For a persistent LAN/server deployment, set a fixed secret before starting:

```powershell
$env:APP_ENV="production"
$env:DB_DRIVER="sqlite"
$env:SQLITE_PATH="D:\AIData\AI-Simulated-Patient\aisp.sqlite"
$env:ADMIN_SETUP_KEY="<at-least-32-random-bytes>"
$env:LLM_PROVIDER="mock"
npm.cmd run dev
```

After the first admin is created, rotate or remove `ADMIN_SETUP_KEY`.

The Windows service account must have read/write/create permission on the SQLite directory.

## 4. Backup

```powershell
npm.cmd run db:backup
```

By default backups are written under:

```text
data\backups\
```

For production, also copy backups to storage outside the application machine.

## 5. Health

```text
http://localhost:3000/api/health
```

SQLite mode reports `driver: "sqlite"`, schema version and WAL state.

## Browser demo fallback

To deliberately disable server persistence:

```powershell
$env:DB_DRIVER="browser"
npm.cmd run dev
```
