# Vercel PoC deployment

Vercel is a public demonstration target. It is intentionally separate from the Windows/Linux SQLite production mode.

## Build/runtime contract

- Node.js is pinned to `22.x`.
- Framework preset is explicitly `Other` via `"framework": null`.
- No framework build command is required; the root static UI is deployed directly.
- Dependency installation is skipped because the Vercel PoC uses no external runtime packages.
- `.vercelignore` allowlists only the static UI, demo libraries/prompt definitions, and one `api/demo.js` function.
- Production Auth, SQLite, sessions, audit, registration, and teacher-account APIs are not uploaded to the Vercel PoC deployment.
- Without `DATABASE_URL`, `/api/runtime` reports `persistence: "browser"` and `demoAuth: true`.
- The default AI mode is deterministic Mock. Optional Groq BYOK Live Demo uses only the isolated demo function and does not import production DB/provider-secret services.

## Mock Login

When Vercel has no durable database configured, visitors see one-click roles:

- Student
- Teacher
- Administrator

This is UI/demo identity only. It does not call the production login endpoint and it does not create authentication records. The selected role is stored in the browser so a refresh keeps the demo session.

The Student role hides the Teacher console. Teacher/Admin demo roles expose the teaching workflow that can operate with browser-local case and record data.

Logging out clears the mock identity and returns to the role selector.

## Groq BYOK onboarding

After a demo identity is selected, first-time visitors see an onboarding wizard with two explicit choices:

1. **Mock Demo** — no external LLM call and no API key.
2. **GroqCloud Live Demo** — use the visitor's own Groq API key for Patient, Coach, and Evaluator calls.

The wizard explains how to create a Groq API key, lets the visitor choose a supported demo model, tests the key/model before activation, and clearly shows whether the current session is Mock or Live.

Supported demo model choices are currently:

- `openai/gpt-oss-120b`
- `openai/gpt-oss-20b`
- `qwen/qwen3.8-27b`

The endpoint is fixed server-side to `https://api.groq.com/openai/v1`; the browser cannot supply an arbitrary upstream URL.

### API key storage and transit

- Default: key is stored only in browser `sessionStorage`.
- Optional **Remember this device**: key is stored in that browser's `localStorage`.
- The key is not stored in the application's production database and is not persisted by the demo Vercel function.
- Every Live request necessarily sends the key from the browser to the site's Vercel Function, which forwards it to Groq over HTTPS.
- The demo function does not echo the key or raw Groq error body in its JSON response.
- Clearing the key immediately returns the local interview to deterministic Mock mode.

Because a remembered localStorage key can be read by JavaScript running in that browser origin, do not use the remember option on shared/public devices. A dedicated testing key with limited exposure is preferable.

## Live Demo request path

```text
Browser sessionStorage/localStorage
        │ visitor-owned Groq key
        ▼
Vercel api/demo.js
        │ transient forwarding only
        ▼
GroqCloud fixed endpoint
```

Patient, Coach, and Evaluator continue to use the platform's case/prompt contracts. The browser-local transcript/records remain demo state; the Vercel function has no durable interview/session database.

The regular Teacher Console **AI Settings** page remains read-only in Vercel. BYOK is deliberately configured through the separate onboarding wizard so the demo cannot be mistaken for production Provider administration.

## Production boundary

Do not use Vercel browser persistence for real student records.

Do not treat BYOK browser storage as production secret management. Production deployments keep provider keys encrypted server-side and use authenticated Provider configuration.

For real deployments use Windows/Linux + SQLite. If Vercel later needs durable multi-user authentication, configure the retained PostgreSQL path instead of attempting to persist a local SQLite file in serverless storage.
