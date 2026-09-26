# Interface Contracts

> 類型：Current state。權威來源是 handlers、services、schema/migrations 與 tests；本文件只提供路由索引與跨模組不變量。

## 契約索引

| ID | 類型／名稱 | Producer／consumer | 權威定義 | 穩定性 |
| --- | --- | --- | --- | --- |
| `HTTP-001` | Runtime／health／cases | server → browser/ops | `api/runtime.js`, `api/health.js`, `api/cases.js` | internal product API |
| `HTTP-002` | Auth lifecycle | server ↔ browser | `api/auth/*.js`, auth integration tests | security-sensitive |
| `HTTP-003` | Interview lifecycle | server ↔ student UI | `api/sessions.js`, `api/chat.js`, `api/coach.js`, `api/evaluate.js` | product-critical |
| `HTTP-004` | Teacher management | server ↔ Teacher Console | `api/teacher/*.js` | RBAC-sensitive |
| `HTTP-005` | Isolated Vercel demo | `api/demo.js` ↔ public demo UI | `vercel.json`, `.vercelignore`, Vercel tests | intentionally reduced |
| `DB-001` | Relational schema/migrations | DB adapters/services | `db/schema.sql`, `db/sqlite-schema.sql`, `db/migrations/*.sql` | versioned |
| `LLM-001` | Provider gateway result/error | adapters ↔ agents/routes/usage | `lib/llm/provider-gateway.js`, provider tests | normalized internal contract |
| `EVAL-001` | Structured evaluation | evaluator/mock ↔ session/UI | `lib/llm/evaluation-contract.js`, `lib/mock-evaluator.js`, tests | validated before persistence |

## HTTP contracts

### `HTTP-001` public/runtime reads

- `GET /api/runtime` reports mode, persistence/driver, demo-auth, initialization and LLM mode; `GET /api/health` returns 200 healthy/demo or 503 DB unavailable.
- `GET /api/cases` returns deterministic public demo case or published production case projections; ground truth must remain server-only.
- Unsupported methods return 405 JSON errors.

### `HTTP-002` authentication

- Routes: `POST /api/auth/bootstrap|register|login|logout|change-password`, `GET /api/auth/me|audit`.
- DB mode uses opaque `aisp_session` HttpOnly/SameSite=Lax cookie; state-changing authenticated calls require `x-csrf-token` and trusted origin checks.
- Registration accepts student/teacher only and returns pending semantics; teacher approval and global audit are Admin-only, student approval is assigned-Teacher/Admin scoped.
- Login failures intentionally do not disclose whether account/password/status caused rejection; throttling may return 429. Password changes/resets invalidate existing sessions.
- Bootstrap is single-admin guarded by `ADMIN_SETUP_KEY`; production requires a sufficiently strong configured key.

### `HTTP-003` interview

- `POST /api/sessions`: default `action=create`; `action=setCoach` only for owned active training sessions and only if frozen Coach route exists in production.
- `POST /api/chat`: non-empty `message`; DB mode additionally requires an owned active `sessionId`. Success returns reply/provider metadata and persists only successful exchanges.
- `POST /api/coach`: production requires active training session with Coach enabled; response is formative and non-spoiler.
- `POST /api/evaluate`: completed session returns 409; successful validated result completes the session, provider/contract failure leaves it active.
- Production LLM failures include 503 route-not-configured, 429 `AI_USAGE_QUOTA_EXCEEDED` with dimension, 504 timeout, or sanitized 502 provider failure; no mock fallback.

### `HTTP-004` Teacher Console

- Cases: `GET/POST /api/teacher/cases`; Teacher/Admin only; definition validated, write status limited to draft/published.
- Users/records: `GET/POST /api/teacher/users`, `GET /api/teacher/records`; Admin global scope, Teacher assigned-student scope. POST actions are defined in handler and require CSRF.
- AI settings: `GET/POST /api/teacher/ai-settings`; actions manage/test connections and system/case routes. Teacher owns only allowed preset connections/cases; custom/private endpoints and system scope are Admin-only; secret responses remain masked/write-only.
- Usage: `GET/POST /api/teacher/llm-usage`; GET summary/users/quota/pricing and POST quota/pricing actions. Admin sees/manages global scope; Teacher sees self+assigned students and edits assigned-student quota only; pricing is Admin-only.

### `HTTP-005` Vercel demo

- `vercel.json` rewrites only runtime, health, cases, chat, coach, evaluate and teacher-cases to `api/demo.js`.
- `.vercelignore` allowlists static assets, deterministic mock dependencies and the single demo function; production auth, DB, sessions, audit and teacher-account/LLM APIs must not enter the bundle.
- Demo identities/state are browser-local and must not be represented as production authentication or durable persistence.

## Data and LLM contracts

### `DB-001` schema and migration

- `db/sqlite-schema.sql` is v1 base schema; lexically ordered `db/migrations/NNN_*.sql` advance SQLite to current `user_version=4` transactionally. Never edit an already-deployed migration without an explicit compatibility decision.
- `db/schema.sql` keeps the PostgreSQL structure aligned. Query callers use PostgreSQL-style `$n` placeholders; SQLite facade translates them.
- Core constraints cover role/status/mode/session state; v2 adds encrypted LLM connections/routes/usage and route snapshots, v3 usage status, v4 pricing snapshot and user quotas.
- Timestamps are stored as UTC-like text generated by DB/application conventions; costs are non-negative integer micro-USD, not floating USD.

### `LLM-001` provider normalization

- Gateway input comprises preset/endpoint/model, rendered messages and server-loaded credential; OpenAI uses Responses API, DeepSeek/Ollama/custom use OpenAI-compatible Chat Completions.
- Normalized success supplies text, provider/preset/model, usage token dimensions, latency/request metadata as available; errors expose normalized codes without upstream bodies, endpoints or secrets.
- Route precedence and supported scopes are defined in `lib/llm/routes.js`; snapshot stored on interview session is authoritative during that session.

### `EVAL-001` evaluation

- Valid status values are `covered`, `partial`, `missed`; result includes per-criterion evidence plus overall comment/recommendations as enforced by `validateEvaluationContract`.
- Evaluator output is parsed/validated before `completeSession`; arbitrary model JSON is not a persistence contract.

## 通用相容性與安全規則

- API fields consumed by `app.js` and contract tests should be additive unless UI/migration is changed together; status/error changes require relevant tests.
- Identifiers are opaque strings/UUIDs; do not infer authorization from them. Authorization is rechecked server-side.
- Never expose password material, cookie/session hashes, CSRF hashes, full case ground truth, provider ciphertext/IV/tag, master keys or raw upstream error bodies.
- There is no published external API version or third-party consumer list; breaking-change policy remains maintainer-confirmation pending.
