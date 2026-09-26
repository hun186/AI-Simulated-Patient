# Native LLM Provider Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-ready OpenAI, OpenAI-compatible, DeepSeek, and Ollama provider support with encrypted credentials, route snapshots, usage capture, and a staff management surface while preserving the existing SQLite/Auth/Vercel boundaries.

**Architecture:** Existing `/api/chat`, `/api/coach`, and `/api/evaluate` remain the public application boundary. A new provider subsystem resolves a session-pinned agent route, decrypts the chosen credential server-side, renders built-in agent prompts, calls either OpenAI Responses or an OpenAI-compatible Chat Completions endpoint, normalizes usage/errors, and records raw usage. SQLite becomes migration-driven before provider schema is introduced.

**Tech Stack:** Node.js 22 ESM, native `fetch()`, `node:crypto` AES-256-GCM, better-sqlite3, existing PostgreSQL adapter compatibility, browser JS UI, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-25-llm-provider-phase1-design.md`

## Global Constraints

- No new OpenAI SDK dependency in Phase 1.
- OpenAI uses the official Responses API; DeepSeek/Ollama/custom use OpenAI-compatible Chat Completions.
- Vercel PoC remains deterministic Mock and must not receive production LLM credentials.
- Production DB mode must never silently fall back to Mock.
- Provider API keys are encrypted at rest; plaintext/ciphertext/IV/tag never return to the browser.
- Teacher-created arbitrary provider URLs are forbidden; arbitrary private/custom endpoints are Admin-only.
- Session route selection is snapshotted when a session starts.
- Prompt Studio, cost calculation/dashboard, quotas/anomaly detection, Dify, streaming, and tool calling are out of Phase 1.
- SQLite is the Phase 1 acceptance database; PostgreSQL schema stays structurally aligned.

## Review Focus

1. Production server starts with provider tables present but no configured routes: interview creation must fail clearly with `AI_PROVIDER_NOT_CONFIGURED`, not Mock.
2. A Teacher submits a custom/private URL despite UI restrictions: server must reject it.
3. A saved API key is updated or cleared: DB must never contain plaintext and browser responses must reveal only `apiKeyLast4`.
4. A provider times out or returns malformed JSON/structured evaluation: normalized error must be returned and an active interview must remain active.
5. System routes change during an active interview: the existing session must keep its original snapshotted connection/model.

---

### Task 1: Introduce ordered SQLite migrations and provider schema

**Files:**
- Create: `db/migrations/002_llm_provider_foundation.sql`
- Create: `lib/sqlite-migrations.js`
- Modify: `lib/db-sqlite.js`
- Modify: `db/sqlite-schema.sql`
- Modify: `db/schema.sql`
- Test: `sqlite-migrations.integration.test.mjs`

**Interfaces:**
- Consumes: existing SQLite `open()` lifecycle.
- Produces: `applySqliteMigrations(db, { projectRoot })`; schema version `2`; tables `llm_provider_connections`, `llm_agent_routes`, `llm_usage_events`; column `interview_sessions.llm_route_snapshot`.

- [ ] **Step 1: Write the failing migration test**

Create `sqlite-migrations.integration.test.mjs` asserting that a fresh temp DB and a synthetic version-1 DB both end at `schemaVersion===2`, contain the three provider tables, and expose `llm_route_snapshot` on `interview_sessions`.

- [ ] **Step 2: Run the migration test and verify RED**

Run: `node --test sqlite-migrations.integration.test.mjs`

Expected: FAIL because migration runner/version 2 objects do not exist.

- [ ] **Step 3: Implement the migration runner**

Create `applySqliteMigrations(db,{projectRoot})` in `lib/sqlite-migrations.js`. It reads current `PRAGMA user_version`, applies numbered SQL files exactly once inside transactions, and advances `user_version` only after each migration succeeds.

- [ ] **Step 4: Move schema authority to migrations**

Keep `db/sqlite-schema.sql` as version-1 bootstrap schema but stop it from being the final schema authority. In `lib/db-sqlite.js`, execute bootstrap schema then call `applySqliteMigrations()`. Add equivalent PostgreSQL DDL to `db/schema.sql`.

- [ ] **Step 5: Verify GREEN and regression**

Run:
`node --test sqlite-migrations.integration.test.mjs sqlite.integration.test.mjs`

Expected: PASS; SQLite reports schema version 2.

- [ ] **Step 6: Commit**

Commit message: `feat: add ordered SQLite migrations for LLM providers`

---

### Task 2: Add encrypted provider-secret storage primitives

**Files:**
- Create: `lib/llm/secret-store.js`
- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `scripts/dev-server.mjs`
- Test: `llm-secret-store.test.mjs`

**Interfaces:**
- Consumes: `LLM_SECRET_MASTER_KEY`, `APP_ENV`.
- Produces:
  - `loadLlmMasterKey() -> Buffer`
  - `encryptSecret(plaintext) -> { ciphertext, iv, tag, last4 }`
  - `decryptSecret(record) -> string`

- [ ] **Step 1: Write failing secret-store tests**

Assert:
- AES-256-GCM round trip succeeds.
- Ciphertext does not contain the plaintext key.
- Wrong master key/auth tag fails closed.
- production without `LLM_SECRET_MASTER_KEY` throws `LLM_MASTER_KEY_REQUIRED`.
- development SQLite without env key persists and reuses `data/llm-secret.key`.

- [ ] **Step 2: Run RED**

Run: `node --test llm-secret-store.test.mjs`

Expected: FAIL because `lib/llm/secret-store.js` is absent.

- [ ] **Step 3: Implement secret-store primitives**

Use 32-byte AES-256-GCM keys, a fresh 12-byte IV per encryption, and base64 storage fields. Accept only a base64 value decoding to exactly 32 bytes for production env configuration.

- [ ] **Step 4: Add startup/config integration**

Ignore `data/llm-secret.key`. Add documented `LLM_SECRET_MASTER_KEY=` to `.env.example`. Log only whether a local dev key file is being used; never log its bytes.

- [ ] **Step 5: Verify GREEN**

Run: `node --test llm-secret-store.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: encrypt LLM provider credentials`

---

### Task 3: Implement provider adapters and normalized error/usage contracts

**Files:**
- Create: `lib/llm/errors.js`
- Create: `lib/llm/providers/openai.js`
- Create: `lib/llm/providers/openai-compatible.js`
- Create: `lib/llm/provider-gateway.js`
- Test: `llm-provider-adapters.test.mjs`

**Interfaces:**
- Consumes: connection records plus decrypted API key.
- Produces:
  - `generateLlm(request, { fetchImpl=fetch }) -> NormalizedLlmResult`
  - `testLlmConnection(connection, { fetchImpl=fetch }) -> SanitizedConnectionTestResult`
  - normalized error codes: `authentication_failed`, `endpoint_unreachable`, `model_not_found`, `rate_limited`, `invalid_response`, `timeout`.

- [ ] **Step 1: Write failing adapter tests**

Use a local fake `fetchImpl` to assert:
- OpenAI preset posts to `/v1/responses` and normalizes `input_tokens/output_tokens/total_tokens/cached_tokens`.
- DeepSeek preset posts Chat Completions to the fixed DeepSeek base URL.
- Ollama preset posts Chat Completions to `http://127.0.0.1:11434/v1/chat/completions` and works without Authorization when key is empty.
- Custom compatible base URL is normalized without duplicate slashes.
- timeout, 401, 404/model error, 429, and malformed success payloads map to the specified internal codes.
- upstream response bodies are not copied into public error messages.

- [ ] **Step 2: Run RED**

Run: `node --test llm-provider-adapters.test.mjs`

Expected: FAIL because provider adapters do not exist.

- [ ] **Step 3: Implement OpenAI Responses adapter**

Implement `generateOpenAI({...}, {fetchImpl})` with official fixed base URL, bearer auth, bounded timeout, text extraction, request-id capture, and usage normalization.

- [ ] **Step 4: Implement OpenAI-compatible adapter**

Implement `generateOpenAICompatible({...}, {fetchImpl})` for DeepSeek/Ollama/custom Chat Completions, including compatible usage fields and optional bearer auth.

- [ ] **Step 5: Implement gateway/presets and connection test**

`provider-gateway.js` selects the adapter from `providerKind/preset`, applies fixed provider URLs for OpenAI/DeepSeek, Ollama default URL, and returns only sanitized test results.

- [ ] **Step 6: Verify GREEN**

Run: `node --test llm-provider-adapters.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: add OpenAI-compatible LLM provider gateway`

---

### Task 4: Add provider-connection RBAC service and management API

**Files:**
- Create: `lib/llm/connections.js`
- Create: `api/teacher/ai-settings.js`
- Modify: `lib/authz.js`
- Modify: `scripts/dev-server.mjs`
- Modify: `lib/auth-audit.js` only if a reusable generic audit helper is required
- Test: `llm-connections.integration.test.mjs`

**Interfaces:**
- Consumes: Task 1 schema, Task 2 secret store, Task 3 connection tester, existing `requireUser/requireCsrf`.
- Produces:
  - `listVisibleConnections(actor)`
  - `createConnection(actor,input)`
  - `updateConnection(actor,id,input)`
  - `deleteConnection(actor,id)`
  - `getConnectionForUse(actorOrSystem,id)`
  - `POST/GET /api/teacher/ai-settings`.

- [ ] **Step 1: Write failing RBAC/API integration tests**

Assert:
- Admin can create system OpenAI/DeepSeek/Ollama/custom connections.
- Teacher can create only teacher-scoped OpenAI or DeepSeek credentials.
- Teacher cannot submit an arbitrary base URL or Ollama/custom preset.
- Teacher sees only own teacher-scoped connections plus safe metadata for system connections allowed for routing.
- API responses expose only `apiKeyLast4`, never encrypted columns or plaintext.
- updating key re-encrypts it; omitting key keeps existing secret.
- create/update/test actions require CSRF and generate audit events.

- [ ] **Step 2: Run RED**

Run: `node --test llm-connections.integration.test.mjs`

Expected: FAIL because service/API route does not exist.

- [ ] **Step 3: Add authorization permission**

Add `LLM_SETTINGS_MANAGE` to Admin and Teacher permissions, while enforcing connection scope rules inside `connections.js`.

- [ ] **Step 4: Implement connection service**

Implement DB CRUD with encrypted secret fields. Never return encrypted secret material from service DTOs.

- [ ] **Step 5: Implement `/api/teacher/ai-settings`**

Support GET list and POST actions `createConnection`, `updateConnection`, `deleteConnection`, `testConnection`. Register the route in `scripts/dev-server.mjs`.

- [ ] **Step 6: Verify GREEN**

Run: `node --test llm-connections.integration.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: add scoped LLM connection management`

---

### Task 5: Add route resolution and immutable session snapshots

**Files:**
- Create: `lib/llm/routes.js`
- Modify: `lib/server-sessions.js`
- Extend: `api/teacher/ai-settings.js`
- Test: `llm-routes.integration.test.mjs`

**Interfaces:**
- Consumes: visible/usable connections from Task 4.
- Produces:
  - `resolveAgentRoutes({caseId,actor}) -> {patient,coach,evaluator}`
  - `snapshotAgentRoutes(routes) -> JSON-safe route snapshot without secrets`
  - management actions `setSystemRoute`, `setCaseRoute`, `deleteRoute`.

- [ ] **Step 1: Write failing route tests**

Assert:
- case route overrides system route.
- no route returns null for that agent.
- Teacher can bind only an owned connection to a case where `created_by=self`.
- Teacher cannot bind system routes or built-in/other-teacher cases.
- Admin can set system routes and case routes using system connections.
- created session stores connection id/preset/model/config but no key material.
- changing the system route after session creation does not change the saved session snapshot.

- [ ] **Step 2: Run RED**

Run: `node --test llm-routes.integration.test.mjs`

Expected: FAIL because route service and session snapshot do not exist.

- [ ] **Step 3: Implement route CRUD and precedence**

Implement exact precedence `case > system > null`, plus actor/resource validation.

- [ ] **Step 4: Snapshot routes in `createInterviewSession()`**

Resolve all three agent routes before insert and persist `llm_route_snapshot`. In production, reject session creation with `AI_PROVIDER_NOT_CONFIGURED` if Patient route is missing. Development may explicitly use Mock only when non-production/mock mode is selected.

- [ ] **Step 5: Verify GREEN**

Run: `node --test llm-routes.integration.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: snapshot LLM agent routes per interview`

---

### Task 6: Add built-in Patient, Coach, and Evaluator agent services

**Files:**
- Create: `lib/llm/prompts.js`
- Create: `lib/llm/evaluation-contract.js`
- Create: `lib/llm/agents.js`
- Test: `llm-agents.test.mjs`

**Interfaces:**
- Consumes: case snapshot, transcript, route snapshot, Task 3 gateway.
- Produces:
  - `runPatientAgent({session,message,transcript,route,fetchImpl})`
  - `runCoachAgent({session,transcript,route,fetchImpl})`
  - `runEvaluatorAgent({session,transcript,route,fetchImpl})`
  - `validateEvaluationContract(value)`.

- [ ] **Step 1: Write failing prompt/agent tests**

Assert:
- Patient system prompt includes persona/ground truth but excludes rubric scoring instructions.
- Coach prompt contains rubric/context but explicitly forbids revealing hidden answers.
- Evaluator prompt requests the existing `totalScore/maxScore/percentage/items/overall` JSON contract.
- malformed evaluator JSON or invalid item status is rejected.
- evaluator normalization accepts only `covered|partial|missed` and preserves evidence arrays.
- safety identifier uses an opaque/hash-derived user id, never email/display name.

- [ ] **Step 2: Run RED**

Run: `node --test llm-agents.test.mjs`

Expected: FAIL because agent service is absent.

- [ ] **Step 3: Implement built-in prompt renderers**

Keep templates code-controlled in Phase 1 and separate Patient/Coach/Evaluator prompt construction functions.

- [ ] **Step 4: Implement agent service and evaluation validator**

Call Task 3 gateway; for evaluator request structured JSON-compatible output and validate before returning.

- [ ] **Step 5: Verify GREEN**

Run: `node --test llm-agents.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add native LLM patient coach and evaluator agents`

---

### Task 7: Wire native LLM agents into runtime APIs and usage recording

**Files:**
- Create: `lib/llm/usage.js`
- Modify: `api/chat.js`
- Modify: `api/coach.js`
- Modify: `api/evaluate.js`
- Modify: `api/sessions.js` if explicit provider errors need mapping
- Modify: `api/runtime.js`
- Test: `llm-runtime.integration.test.mjs`

**Interfaces:**
- Consumes: Task 5 route snapshot, Task 6 agents.
- Produces:
  - `recordLlmUsage({...})`
  - production API behavior using native agents instead of direct mock helpers.

- [ ] **Step 1: Write failing end-to-end SQLite tests**

Using fake provider `fetchImpl` injection/test hook, assert:
- production session without Patient route returns 503 and is not created.
- successful Patient call persists student and patient messages only after provider success.
- failed Patient call does not persist a fake patient message.
- Coach without configured Coach route fails clearly when enabled.
- evaluator provider failure or invalid JSON leaves session `active`.
- valid evaluator result completes session and writes `evaluations`.
- each real provider call writes one `llm_usage_events` row with agent/user/session/case/model/token/latency/success fields.
- Mock remains deterministic in browser/Vercel demo and explicit development mock mode.

- [ ] **Step 2: Run RED**

Run: `node --test llm-runtime.integration.test.mjs`

Expected: FAIL because APIs still call mock implementations directly.

- [ ] **Step 3: Implement usage recorder**

Insert raw normalized usage/error facts only; do not calculate monetary cost.

- [ ] **Step 4: Replace production direct Mock calls**

In DB production mode, use session snapshot + Task 6 agents. Keep current ownership/CSRF checks. Keep existing browser/demo mock paths.

- [ ] **Step 5: Add clear public error mapping**

Return `503 AI_PROVIDER_NOT_CONFIGURED` for missing required routes and sanitized 502/504-style provider failures without upstream secrets.

- [ ] **Step 6: Verify GREEN**

Run: `node --test llm-runtime.integration.test.mjs registration.integration.test.mjs sqlite.integration.test.mjs vercel-demo.test.mjs vercel-isolation.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: run production interviews through configured LLM providers`

---

### Task 8: Add AI Settings UI, routing controls, and final regression verification

**Files:**
- Modify: `index.html`
- Modify: `formal-app.js`
- Modify: `formal.css`
- Modify: `README.md`
- Create: `docs/LLM_PROVIDERS.md`
- Test: `llm-settings-ui.contract.test.mjs`

**Interfaces:**
- Consumes: `/api/teacher/ai-settings`.
- Produces: Teacher Console subtab `AI 設定` with connection cards, masked-key handling, connection test action, and permitted route selectors.

- [ ] **Step 1: Write failing UI contract test**

Assert static DOM/JS contracts:
- Teacher Console contains `AI 設定`.
- Provider presets include OpenAI, DeepSeek, Ollama and Custom, but Teacher-facing logic disables Admin-only presets.
- saved connections render masked suffix only.
- API key input is write-only and never prefilled from server data.
- route selectors expose Patient/Coach/Evaluator separately.
- Vercel demo does not render or call production AI-settings APIs.

- [ ] **Step 2: Run RED**

Run: `node --test llm-settings-ui.contract.test.mjs`

Expected: FAIL because AI Settings UI is absent.

- [ ] **Step 3: Implement staff AI Settings view**

Add connection create/edit/test/disable controls and agent-route selectors. Admin sees system/Ollama/custom controls; Teacher sees own allowed connection controls and eligible case routes only.

- [ ] **Step 4: Update runtime/docs**

Document master-key generation, OpenAI/DeepSeek/Ollama examples, production no-Mock rule, and the fact that usage rows are raw Phase 1 accounting only.

- [ ] **Step 5: Run full verification**

Run:
`npm test`

Then:
`node --check formal-app.js && node --check scripts/dev-server.mjs && for f in api/*.js api/auth/*.js api/teacher/*.js lib/*.js lib/llm/*.js lib/llm/providers/*.js; do node --check "$f"; done`

Expected: all tests PASS; syntax checks exit 0.

- [ ] **Step 6: Push branch and verify hosted checks**

Verify GitHub Actions on the exact branch HEAD. Verify Vercel preview remains successful and still uses demo-only Mock isolation.

- [ ] **Step 7: Commit**

Commit message: `feat: add staff AI provider settings`

---

## Final acceptance checklist

- [ ] SQLite schema migration path upgrades existing databases to version 2.
- [ ] OpenAI Responses adapter verified.
- [ ] Generic OpenAI-compatible adapter verified.
- [ ] DeepSeek preset verified.
- [ ] Ollama keyless preset verified.
- [ ] API keys encrypted at rest and masked in API/UI.
- [ ] Teacher/Admin connection scopes enforced server-side.
- [ ] Arbitrary custom URLs restricted to Admin.
- [ ] Patient/Coach/Evaluator routes selectable independently.
- [ ] Session route snapshots immutable for active sessions.
- [ ] Production cannot silently use Mock.
- [ ] Provider usage rows recorded.
- [ ] Evaluator result validated before session completion.
- [ ] Existing authentication, pending registration, SQLite, and Vercel demo tests remain green.
- [ ] Exact hosted branch HEAD and CI/Vercel statuses verified before merge.
