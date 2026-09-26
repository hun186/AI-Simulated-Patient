# LLM Providers

Phase 1 adds native Patient, Coach, and Evaluator LLM routing to production database mode.

## Deployment boundary

The public Vercel PoC remains deterministic Mock-only. It does not expose the production AI Settings API and should not receive production provider credentials.

Windows/Linux production deployments use the server-side database and the AI Settings screen in Teacher Console.

## Required secret

Production provider credentials are encrypted with AES-256-GCM. Configure:

```text
LLM_SECRET_MASTER_KEY=<32-byte key encoded as base64>
```

Do not commit this value. Losing or changing the key makes previously stored provider credentials undecryptable.

## Supported providers

| Preset | Transport | Default endpoint | Teacher can create |
|---|---|---|---|
| OpenAI | Responses API | fixed OpenAI endpoint | Yes |
| DeepSeek | OpenAI-compatible Chat Completions | fixed DeepSeek endpoint | Yes |
| Ollama | OpenAI-compatible Chat Completions | localhost default, Admin configurable | No |
| Custom | OpenAI-compatible Chat Completions | Admin supplied | No |

Ollama may be keyless. OpenAI and DeepSeek require an API key.

## AI Settings

Teacher Console → **AI 設定** is available only in production database mode to Teacher/Admin users.

Connection controls:
- create a provider connection;
- store API keys through a write-only password field;
- show only the stored key's last four characters;
- test a manageable connection;
- delete a manageable connection.

Admin connections are system-scoped. Teacher connections are owned by the Teacher account.

## Routing

Patient, Coach, and Evaluator routes are independent.

Admin configures system routes. Teacher configures case-specific routes only for cases they own and only with their own Teacher-scoped connections. Server-side RBAC is authoritative even if browser state is manipulated.

When an interview session starts, the selected route ID, connection ID, provider kind, preset, model, and route config are snapshotted into the session. Provider secrets are not copied into the session snapshot.

## Runtime behavior

Production database mode never silently falls back to Mock.

- Missing required Patient route: session creation fails clearly.
- Coach enabled without an available Coach route: session creation or Coach execution fails clearly.
- Provider failure: sanitized 502/504 responses; upstream secret/error bodies are not exposed.
- Patient provider failure: no fake Patient reply is persisted.
- Evaluator provider/contract failure: the interview remains active.
- Valid evaluation: the interview is completed and evaluation persisted.

Development/demo Mock remains explicit and deterministic.

## Usage accounting

Every real provider call writes an `llm_usage_events` event with:
- agent role;
- user/session/case;
- provider/connection/model;
- token counts when reported;
- latency;
- success/failure and normalized error code;
- provider request ID when available.

`usage_status` distinguishes `reported`, `unreported`, and `estimated` token data so a missing provider usage object is not presented as an exact zero-token measurement.

Phase 1 intentionally does not calculate monetary cost or implement quotas.

## Security notes

- Provider API keys are not returned by GET endpoints.
- Browser UI never stores the API key after submission.
- Teacher cannot configure arbitrary custom/private endpoints.
- Production provider credentials must not be configured on the Vercel PoC.
- Treat local Ollama/custom endpoints as privileged Admin configuration.
