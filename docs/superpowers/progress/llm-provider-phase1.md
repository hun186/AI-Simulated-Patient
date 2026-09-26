# LLM Provider Phase 1 Progress

Authoritative branch: `feat/llm-provider-foundation`
Draft PR: #2
Current hosted head before this checkpoint: `d3e29a48e66055b0efa6d361450bff1135fc8420`
Base: `main @ 03270515e65ee6c09717544248c9b5ba9bd76fb1`

## Task status

| Task | Status | Hosted evidence |
|---|---|---|
| 1. SQLite ordered migrations + LLM schema | COMPLETE | `c808fc9a9c081850332f21faa9fbae68f6f3454b`; focused tests and hosted CI PASS |
| 2. AES-256-GCM API Key encryption | COMPLETE | `039cbcb7037697a049e5057699ddccf703558b7e`; focused tests and hosted CI PASS |
| 3. OpenAI / OpenAI-compatible / DeepSeek / Ollama adapters | COMPLETE | `adf8a3bf4c324d4522d37096be479065aaa904c0`; focused tests and hosted CI PASS |
| 4. Admin / Teacher Provider configuration + RBAC | COMPLETE | `c7e049d3064b6938d941890103f2ab7436b10ae4`; focused tests and hosted CI PASS |
| 5. Patient / Coach / Evaluator routing + session snapshot | COMPLETE | `1ce2f671b4c3e7615ad785fec5b7bf49572dc4c9`; focused tests and hosted CI PASS |
| 6. Built-in Patient / Coach / Evaluator prompts + evaluator JSON contract | COMPLETE | `d3e29a48e66055b0efa6d361450bff1135fc8420`; GitHub Actions `36220196344` PASS; Vercel PASS |
| 7. Production chat/coach/evaluate integration + usage accounting | IMPLEMENTED_CI_PENDING | Native runtime integration, usage recorder, explicit usage reporting state and focused integration test are included in this checkpoint |
| 8. AI Settings UI + full regression/Vercel verification | NOT_STARTED | No Task 8 implementation commit yet |

## Completed work

- Tasks 1-6 verified from hosted implementation, focused tests and CI.
- Production DB chat/coach/evaluate paths use native Patient/Coach/Evaluator agents from the immutable session route snapshot.
- Provider failure does not persist fake Patient output; evaluator failure leaves the session active.
- Usage events record user/session/case/role/provider/model/token/latency/success/failure fields.
- Usage accounting distinguishes `reported`, `unreported`, and `estimated` states rather than presenting missing token usage as exact.
- Browser/Vercel demo and explicit non-production Mock routes remain deterministic Mock.

## Relevant test commands

- `node --test llm-runtime.integration.test.mjs`
- `node --test llm-runtime.integration.test.mjs registration.integration.test.mjs sqlite.integration.test.mjs vercel-demo.test.mjs vercel-isolation.test.mjs`
- `npm test`

## Current checkpoint

Last verified CI:
- Task 6 run: `36220196344`
- Status: PASS
- Vercel: PASS

Task 7 CI:
- Status: PENDING after push

Next action:
- Read the first Task 7 GitHub Actions result once available.
- If PASS, mark Task 7 COMPLETE and start Task 8 AI Settings UI/docs/final verification.
- If FAIL, inspect the failing job/log and make the smallest corrective change.
