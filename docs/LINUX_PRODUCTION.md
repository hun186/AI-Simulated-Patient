# Linux deployment — SQLite production default

## Install and run

Node.js 22+ is required.

```bash
git clone https://github.com/hun186/AI-Simulated-Patient.git
cd AI-Simulated-Patient
npm install

export APP_ENV=production
export DB_DRIVER=sqlite
export SQLITE_PATH=/var/lib/aisp/aisp.sqlite
export ADMIN_SETUP_KEY='<at-least-32-random-bytes>'
export LLM_PROVIDER=mock

npm run dev
```

The service account must have write access to `/var/lib/aisp`.

## systemd example

```ini
[Unit]
Description=AI Simulated Patient
After=network.target

[Service]
Type=simple
User=aisp
Group=aisp
WorkingDirectory=/opt/ai-simulated-patient
Environment=APP_ENV=production
Environment=DB_DRIVER=sqlite
Environment=SQLITE_PATH=/var/lib/aisp/aisp.sqlite
Environment=ADMIN_SETUP_KEY=replace-with-a-long-random-secret
Environment=LLM_PROVIDER=mock
ExecStart=/usr/bin/node scripts/dev-server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

For a LAN deployment, Nginx or another reverse proxy can terminate HTTPS in front of Node.js.

## Backup

```bash
npm run db:backup
```

For production, keep backup copies on separate storage.

## Scaling boundary

SQLite is intended for the current single-host deployment. If the application later moves to multiple app servers or requires HA/shared concurrent writers, switch the database driver to PostgreSQL.
