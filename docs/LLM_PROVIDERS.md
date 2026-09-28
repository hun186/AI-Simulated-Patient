# LLM Providers

Production database mode supports native Patient, Coach, and Evaluator LLM routing.

## Deployment boundary

The public Vercel PoC defaults to deterministic Mock and keeps production AI Settings read-only. It may optionally run a Groq BYOK Live Demo: the visitor's Groq key is stored only in browser sessionStorage/localStorage and sent transiently through the isolated demo Vercel Function for each live call; it is never stored in the production provider connection database.

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
| Ollama Local | OpenAI-compatible Chat Completions | localhost/private endpoint | Yes, private/local targets only |
| Ollama Cloud | OpenAI-compatible Chat Completions | `https://ollama.com/v1` | Yes |
| Dify | Dify Application API (`chat-messages`, `workflows/run`, `completion-messages`) | Dify Cloud or allowed self-hosted endpoint | Yes |
| Custom | OpenAI-compatible Chat Completions | Admin supplied | No |

Ollama may be keyless. OpenAI, DeepSeek, GroqCloud, Ollama Cloud, and Dify require an API key.

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

Admin configures system routes. Teacher configures owner-scoped case routes for system built-in cases and their own cases, using only their own Teacher-scoped connections. Server-side RBAC is authoritative even if browser state is manipulated.

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

Production usage accounting snapshots estimated cost when a pricing rule is available. DeepSeek pricing includes built-in peak/off-peak rules in USD, selected from the Beijing-time request-start timestamp; cached input, uncached input, and output/reasoning dimensions are priced separately.

OpenAI pricing snapshots distinguish ordinary input, cached input, cache writes, and output/reasoning. GPT-6 and GPT-5.6 seeded rules distinguish short versus long context at the provider's 272K input-token threshold, and the recorded service tier is used for Standard, Flex, or Fast/Priority pricing.

Each priced usage event also snapshots the effective USD/TWD reference rate and an estimated TWD cost. The initial reference is the Taiwan central-bank interbank closing rate for 2026-09-24 (31.780 TWD/USD); Admin may add newer effective-dated reference rates. Historical USD and TWD estimates remain unchanged when pricing or FX rules are updated. Hard cost quotas remain denominated in USD to match provider billing.

## Security notes

- Provider API keys are not returned by GET endpoints.
- Browser UI never stores the API key after submission.
- Teacher cannot configure arbitrary Custom endpoints; Teacher-owned Ollama Local and Dify endpoints remain constrained by endpoint-safety rules.
- Production provider credentials must not be configured on the Vercel PoC; its AI Settings surface is read-only. The separate Groq BYOK demo accepts only visitor-owned keys and does not persist them server-side.
- Teacher-owned Ollama Local and Dify connections are restricted to approved official/private endpoints; arbitrary Custom endpoints remain Admin-only.


## GroqCloud

GroqCloud is exposed as a first-class preset backed by its fixed OpenAI-compatible endpoint `https://api.groq.com/openai/v1`. Staff enter only a connection name, Groq API key, and Groq model ID such as `openai/gpt-oss-120b`; the Base URL is not editable for this preset.

Groq connections reuse the existing OpenAI-compatible Chat Completions adapter, normalized provider errors, token accounting, per-user quota enforcement, route snapshots, and usage analytics. The logical provider remains `groq` in route snapshots and usage rows so Provider/Model/Agent breakdowns can distinguish Groq traffic from arbitrary Custom endpoints.

The current database schema does not add a new persisted preset enum for Groq. To avoid a schema migration solely for this fixed compatible endpoint, Groq connection rows are stored under the existing `custom` persistence value and projected back to logical `groq` only when the stored Base URL is the fixed Groq endpoint. Dify continues to use its separate existing custom-row compatibility marker.

Groq Free Plan limits and paid token pricing are account/plan dependent. The platform records calls and tokens but does not automatically infer Groq billing from the preset, so Groq calls remain explicitly unpriced unless a future plan-aware pricing policy is added. This avoids reporting paid-list pricing as an actual cost for a Free Plan test account.

## Ollama Local and Ollama Cloud

Ollama Local and Ollama Cloud are intentionally separate choices in the Teacher Console:

- **Ollama Local** uses an OpenAI-compatible Ollama endpoint and does not require an API key. The default is `http://127.0.0.1:11434/v1`, but staff may configure another endpoint. Teacher-owned Ollama Local connections are restricted to localhost / loopback / private-network addresses (including common RFC1918 LAN ranges and local IPv6); this supports a separate on-premises Ollama host such as `http://192.168.1.50:11434/v1` without granting arbitrary public-URL access. Local inference is recorded with a zero provider-token cost. If the model name explicitly uses Ollama's `:cloud` proxy suffix, the corresponding Ollama Cloud token price is used instead.
- **Ollama Cloud** uses Ollama's hosted OpenAI-compatible endpoint `https://ollama.com/v1` with an Ollama API key. Teacher-scoped keys are encrypted with the same secret store used for OpenAI and DeepSeek.

Ollama Cloud usage is priced from the effective-dated catalog snapshot. DeepSeek cloud models use Ollama's UTC weekday peak window (12:00-18:00 UTC Monday-Friday) and off-peak rates at other times. Other seeded cloud models use their published per-million-token input, cached-input, and output rates. Cost is snapshotted in USD and converted to TWD using the effective FX reference already used by the usage dashboard.


## Custom prompt templates

Admin and Teacher routes may include safe educator-authored prompt templates. Templates are stored inside the existing route `config_json` and are snapshotted into each interview session together with the Provider/Model route, so later edits do not change historical sessions.

Editable areas:

- **Patient**: tone, response length, interaction style, and role-play emphasis.
- **Coach**: coaching strategy, Socratic-questioning style, feedback tone, and teaching focus.
- **Evaluator**: scoring explanation/evidence emphasis while preserving the rubric and machine-readable contract.
- **Final Feedback**: guidance for `overall.comment`, strengths, improvements, recommendations, and next-practice focus only.

Templates are supplemental. Locked system rules remain authoritative: the Patient cannot invent case facts or reveal hidden rubric material, the Coach cannot reveal hidden answers/model answers, and the Evaluator must grade only transcript evidence and preserve the fixed JSON/status contract.

Supported placeholders are intentionally limited to:
`{{case_title}}`, `{{patient_name}}`, `{{patient_age}}`, `{{learning_goals}}`, and `{{mode}}`.
Hidden facts, rubric answers, API secrets, and raw system internals are not exposed as template variables. Each template is limited to 8,000 characters.


## Returning an Agent route to unconfigured

Patient, Coach, and Evaluator route selectors support an explicit **Unconfigured (Rule-based / system default)** state. Saving that empty selection deletes the current route rather than requiring another Provider. In local/development mode, the existing deterministic rule-based fallback can then be used. Production keeps its strict policy: a production interview still requires the configured LLM routes needed by that workflow and does not silently fall back to mock/rule-based behavior.


## Dify Application API

Dify is available in the same **AI Provider connections** area as the native LLM providers. A Dify connection is one published Dify App API key plus its API base URL.

Supported Dify app modes:

- **Chat / Chatflow** → `POST /chat-messages`
- **Workflow** → `POST /workflows/run`
- **Completion** → `POST /completion-messages`

The default base URL is `https://api.dify.ai/v1`. Self-hosted Dify can use another HTTP/HTTPS base URL; Teacher-owned connections are limited to the official Dify Cloud host or private/local network targets, while Admin retains broader endpoint control.

A connection test uses `GET /parameters`, so testing credentials does not generate a real Patient/Coach/Evaluator response.

The platform remains the source of truth for interview history and persisted assessment results. Dify supports two execution modes:

- **Platform-managed (stateless)** — the platform sends the current locked system prompt and relevant transcript/request context on every call. Dify conversation continuity is not required.
- **Stateful Chatflow** — available only for Dify Chat/Chatflow apps. The platform sends the current user query, stores the returned `conversation_id` as provider-specific session state, and reuses it for later turns in the same interview. This mode is intended for Dify Conversation Variables such as `H01_done ... H14_done`. The Dify App itself owns the Patient/assessment workflow prompt logic in this mode; the platform still owns the canonical transcript and final persisted result.

Provider state is stored per interview session and Dify connection in `llm_provider_session_state`. If Patient and Evaluator must share the same Dify Conversation Variables, they must select the same Dify connection. A new interview session does not reuse the previous session's Dify `conversation_id`.

A Stateful Evaluator route can enable a configurable final trigger, defaulting to `問診結束`. The platform sends that trigger to the same Dify conversation when the learner ends the interview. If no conversation state exists for that connection, evaluation fails with `DIFY_CONVERSATION_STATE_MISSING` instead of silently starting a new conversation.

For Workflow routes, the route config supports:

- `difyInputKey` — Workflow input variable receiving the combined agent prompt; default `prompt`.
- `difyOutputKey` — Workflow output variable used as the agent response; default `text`.
- `difyInputs` — optional fixed JSON inputs, for example `{"language":"zh-TW"}`.

Dify token usage is recorded when the Dify response reports it. Because the actual underlying model and billing policy are managed inside Dify, the platform does not invent a native model price for Dify calls; unmatched Dify usage remains explicitly unpriced until a dedicated pricing policy is configured.

For the compatibility contract with existing Dify Chatflows that depend on `conversation_id` and Conversation Variables, see [`DIFY_INTEGRATION_CONTRACT.md`](./DIFY_INTEGRATION_CONTRACT.md). Stateful Chatflow support was merged via PR #22 and is covered by adapter, route-validation, schema-migration, and interview-lifecycle integration tests.
