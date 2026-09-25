# Windows production-like deployment

1. Install Node.js 22+ and verify `node -v` and `npm -v`.
2. Clone the repository, enter it, and run `npm install`.
3. Create a Neon database and apply `db/schema.sql` in the Neon SQL Editor.
4. Set environment variables in PowerShell:

    $env:DATABASE_URL="postgresql://..."
    $env:ADMIN_SETUP_KEY="replace-with-a-long-random-secret"
    $env:LLM_PROVIDER="mock"
    npm run dev

5. Create the first teacher account once with POST `/api/auth/bootstrap`. JSON fields are `setupKey`, `email`, `password`, and `displayName`. Password must be at least 10 characters.
6. After bootstrap, rotate or remove `ADMIN_SETUP_KEY`.
7. Open `http://localhost:3000`.

When `DATABASE_URL` is present, the app enters production persistence mode. The same API handler modules are used on Windows and Vercel.
