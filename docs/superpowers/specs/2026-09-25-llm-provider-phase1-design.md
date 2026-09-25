# Phase 1 Design — Native LLM Provider Foundation

Date: 2026-09-25
Repository baseline: `03270515e65ee6c09717544248c9b5ba9bd76fb1`
Branch: `feat/llm-provider-foundation`

## 1. Goal

Add a production-capable LLM provider subsystem without replacing the existing application shell, authentication, SQLite persistence, case management, transcript storage, evaluation records, or Vercel browser-demo boundary.

Phase 1 supports:

- OpenAI through the official Responses API.
- A generic OpenAI-compatible Chat Completions adapter.
- DeepSeek as a preset of the compatible adapter.
- Ollama as a preset of the compatible adapter.
- Custom OpenAI-compatible endpoints under administrator control.
- Encrypted provider credentials.
- Administrator system-wide connections and teacher-owned connections.
- Patient / Coach / Evaluator routing.
- A stable normalized provider response contract.
- Raw usage/token accounting needed by later cost and quota work.
- Production refusal to silently fall back to Mock when no real provider is configured.

Dify remains a future adapter. The provider interface must leave room for it without making Dify part of Phase 1.

## 2. Non-goals

Phase 1 does not implement:

- editable Prompt Studio or prompt version UI;
- price catalogs or cost dashboards;
- per-account quotas or anomaly detection;
- Dify integration;
- course/class ownership;
- streaming UI;
- tool calling.

Those features build on this foundation in later phases.

## 3. Architectural boundary

```text
Browser
  |
  v
Existing /api/chat /api/coach /api/evaluate
  |
  v
LLM Agent Service
  |
  +-- route resolver
  +-- built-in prompt renderer
  +-- provider gateway
        |
        +-- OpenAI Responses adapter
        +-- OpenAI-compatible adapter
              +-- DeepSeek preset
              +-- Ollama preset
              +-- Custom preset
```

The application remains the system of record.

- `interview_sessions` owns the learning session.
- `interview_messages` owns the formal transcript.
- `evaluations` owns the final recorded result.
- Provider-side conversation state is not authoritative.
- Provider secrets never enter browser state or transcript rows.

## 4. Provider interface

Create a provider-neutral contract:

```js
await generateLlm({
  agent: 'patient' | 'coach' | 'evaluator',
  connection,
  model,
  systemPrompt,
  messages,
  responseFormat,
  temperature,
  maxOutputTokens,
  safetyIdentifier
})
```

Normalized return value:

```js
{
  text: '...',
  provider: 'openai' | 'openai_compatible',
  preset: 'openai' | 'deepseek' | 'ollama' | 'custom',
  model: '...',
  usage: {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  },
  latencyMs: 0,
  providerRequestId: null
}
```

The caller must not parse provider-specific response structures.

## 5. API protocols

### OpenAI preset

Use the current OpenAI Responses API:

```text
POST https://api.openai.com/v1/responses
```

Use Node 22 native `fetch()`; do not add an OpenAI SDK dependency in Phase 1.

### DeepSeek preset

Use the OpenAI-compatible Chat Completions endpoint:

```text
POST https://api.deepseek.com/chat/completions
```

DeepSeek is stateless for multi-turn chat, so the application sends the transcript/history needed for each call.

### Ollama preset

Use the OpenAI-compatible endpoint:

```text
POST {baseUrl}/chat/completions
```

Default preset base URL:

```text
http://127.0.0.1:11434/v1
```

The default key may be empty because a normal local Ollama server does not require bearer authentication. If a reverse proxy requires a key, it may be stored.

### Custom compatible preset

Administrators may configure an arbitrary OpenAI-compatible base URL. Teachers cannot create arbitrary custom hosts in Phase 1 because unrestricted server-side URLs create SSRF risk.

Teachers may create:

- OpenAI connections using the fixed official base URL.
- DeepSeek connections using the fixed official base URL.
- connections using an administrator-created compatible endpoint profile.

Administrators may create Ollama/custom compatible endpoints, including approved private-LAN endpoints.

## 6. Credential security

### Master key

Production requires:

```text
LLM_SECRET_MASTER_KEY
```

Format: base64-encoded 32 random bytes.

Provider API keys are encrypted server-side with AES-256-GCM before database storage.

Persist:

- ciphertext;
- IV/nonce;
- authentication tag;
- last four display characters only.

Never persist plaintext API keys.

Never return ciphertext, IV, tag, or plaintext key to browser APIs.

After save, UI displays only:

```text
••••••••••••abcd
```

### Local development

For non-production SQLite mode only, if `LLM_SECRET_MASTER_KEY` is absent, the server may create a persistent random local key at:

```text
data/llm-secret.key
```

The file is gitignored. The server logs that this local key is required to decrypt saved provider credentials after restart or backup restoration.

Production must not auto-generate the master key.

## 7. Database additions

SQLite and PostgreSQL schemas stay aligned.

### `llm_provider_connections`

```text
id
scope_type              system | teacher
owner_user_id           NULL for system, teacher id for teacher
name
provider_kind           openai | openai_compatible
preset                  openai | deepseek | ollama | custom
base_url
default_model
encrypted_api_key
api_key_iv
api_key_tag
api_key_last4
is_active
created_by
created_at
updated_at
```

Rules:

- only Admin creates/updates/deletes `system` connections;
- Teacher may CRUD only connections where `scope_type=teacher` and `owner_user_id=self`;
- Teacher may not read another teacher's connections;
- no API returns secret material.

### `llm_agent_routes`

```text
id
scope_type              system | case
scope_id                NULL for system; case id for case
agent_type              patient | coach | evaluator
connection_id
model
config_json
created_by
created_at
updated_at
```

Resolution precedence:

```text
case-specific route
        >
system route
        >
no route
```

A teacher may create a case route only for a case they created and only with a connection they own.

Admin may bind any case to a system connection.

Built-in cases use system routes unless explicitly overridden by Admin.

### `interview_sessions`

Add:

```text
llm_route_snapshot
```

At session creation, resolve and snapshot the three agent routes. The snapshot contains connection IDs, provider kind/preset, model, and non-secret generation configuration. It never contains API keys.

A session therefore does not unexpectedly switch models when an administrator changes a default route mid-interview.

### `llm_usage_events`

Phase 1 records raw provider usage even though dashboards and price calculation arrive later:

```text
id
created_at
user_id
session_id
case_id
agent_type
connection_id
provider_kind
preset
model
input_tokens
cached_input_tokens
output_tokens
reasoning_tokens
total_tokens
latency_ms
success
error_code
provider_request_id
```

No cost is calculated in Phase 1.

## 8. Runtime behavior

### Browser/Vercel demo

The current Vercel demo remains deterministic Mock and does not receive real provider credentials.

### Development DB mode

If no route is configured, Mock may remain available for local development/testing with an explicit runtime indicator.

### Production DB mode

No implicit Mock fallback.

If a required Patient route is absent when starting a production interview:

```text
503 AI_PROVIDER_NOT_CONFIGURED
```

If Coach is enabled but no Coach route exists, enabling Coach fails clearly.

If evaluation is requested but no Evaluator route exists, evaluation fails clearly without completing the session.

This prevents a real deployment from silently pretending to use AI while actually using deterministic Mock behavior.

## 9. Prompt handling in Phase 1

Phase 1 introduces built-in server-side templates only:

- Patient template
- Coach template
- Evaluator template

They are code/version controlled, not editable from the UI yet.

The templates render from the existing case snapshot and transcript.

Patient rules:

- stay in patient role;
- answer only from case ground truth;
- do not reveal unrelated hidden facts;
- do not reveal rubric or evaluation logic;
- do not invent facts.

Coach rules:

- use transcript and rubric;
- do not reveal hidden answers;
- give non-spoiler next-step guidance.

Evaluator rules:

- evaluate transcript against rubric;
- output the existing evaluation contract;
- distinguish covered / partial / missed;
- include transcript evidence;
- do not give credit merely because the patient volunteered a fact.

Prompt Studio will later turn these built-ins into versioned editable templates without changing provider interfaces.

## 10. Existing API integration

`/api/chat`:

- continues ownership/CSRF checks;
- loads session route snapshot;
- renders Patient prompt;
- calls provider;
- stores student and patient messages;
- records usage.

`/api/coach`:

- keeps mode/coach-enabled authorization;
- renders Coach prompt;
- calls provider;
- records usage.

`/api/evaluate`:

- renders Evaluator prompt;
- requests structured JSON;
- validates/normalizes the result into the existing evaluation contract;
- only then calls `completeSession()`;
- records usage.

Mock implementations remain behind the same service contract for tests and demo mode.

## 11. Management API and UI

Add a staff subtab:

```text
AI 設定
```

### Connection cards

Fields:

- display name;
- preset;
- base URL;
- API key;
- default model;
- active/inactive status;
- masked key suffix;
- Test Connection action.

For OpenAI and DeepSeek, the official base URL is fixed in normal teacher UI.

For Ollama/custom, arbitrary host configuration is Admin-only.

### Routing

Admin:

- set system Patient / Coach / Evaluator defaults;
- bind system connections to cases.

Teacher:

- create own OpenAI/DeepSeek credentials;
- view/test own connections;
- bind an owned connection to a case the teacher created.

No teacher may alter system defaults.

## 12. Test Connection semantics

The server performs the test; the browser never calls a provider directly.

The request uses a minimal bounded prompt and small output limit.

Return only:

```json
{
  "ok": true,
  "provider": "openai_compatible",
  "preset": "ollama",
  "model": "...",
  "latencyMs": 123
}
```

On failure, return a sanitized category such as:

- authentication_failed;
- endpoint_unreachable;
- model_not_found;
- rate_limited;
- invalid_response;
- timeout.

Do not echo upstream response bodies containing secrets.

## 13. Error handling

Provider calls have a configurable timeout with a conservative default.

Normalize upstream failures into internal error codes.

The patient message is persisted only after a successful provider response.

An evaluator failure must not mark a session completed.

Provider connection tests and changes are written to the existing security audit log.

## 14. Migration strategy

The repository currently uses SQLite schema initialization rather than a full migration framework.

Phase 1 must introduce ordered SQLite migrations before adding these tables/columns, so future provider/cost/quota schema changes are safe.

The first migration framework version becomes the authority for schema version changes instead of repeatedly setting `PRAGMA user_version=1`.

PostgreSQL remains a future-compatible schema target and receives equivalent DDL, but Phase 1 acceptance is based on SQLite because SQLite is the current production default.

## 15. Acceptance criteria

Phase 1 is complete only when automated tests prove:

1. Provider API keys are encrypted at rest and plaintext is not present in DB rows or API responses.
2. Admin and Teacher connection scopes are enforced server-side.
3. Teachers cannot configure arbitrary custom hosts.
4. OpenAI Responses responses normalize to the common result contract.
5. OpenAI-compatible Chat Completions responses normalize to the same contract.
6. DeepSeek preset uses the compatible path.
7. Ollama preset supports a keyless local endpoint.
8. Test Connection sanitizes upstream errors.
9. Route precedence is case > system.
10. Session creation snapshots routes.
11. Mid-session default-route changes do not alter that session snapshot.
12. Production mode never silently falls back to Mock.
13. Patient/Coach/Evaluator calls record raw usage.
14. Evaluator JSON is validated before session completion.
15. Existing auth, registration, SQLite, Vercel demo, and deterministic mock tests remain green.

## 16. Current API references

The protocol choices above are based on current official documentation:

- OpenAI API quickstart / Responses API: https://developers.openai.com/api/docs
- DeepSeek OpenAI-compatible API: https://api-docs.deepseek.com/zh-cn/
- DeepSeek Chat Completions: https://api-docs.deepseek.com/api/create-chat-completion/
- Ollama OpenAI compatibility: https://ollama.com/blog/openai-compatibility
