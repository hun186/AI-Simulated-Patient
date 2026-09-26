# LLM Provider Phase 1 Progress

Authoritative branch: `feat/llm-provider-foundation`
Draft PR: #2
Current hosted head before this checkpoint: `be487bf2533cc3f1bc5facab026d764510af2949`
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
| 7. Production chat/coach/evaluate integration + usage accounting | COMPLETE | `be487bf2533cc3f1bc5facab026d764510af2949`; GitHub Actions `36221577895` PASS; Vercel PASS |
| 8. AI Settings UI + full regression/Vercel verification | IMPLEMENTED_CI_PENDING | Teacher Console UI, provider docs, UI contract tests, README update included in this checkpoint |

## Task 8 implementation

- Production Teacher Console has an **AI 設定** subtab for Teacher/Admin only.
- Vercel/browser demo keeps that subtab hidden and never calls the production AI Settings API.
- Provider creation supports OpenAI/DeepSeek for Teacher and OpenAI/DeepSeek/Ollama/custom for Admin.
- API keys use a write-only password field; stored credentials are represented only by last-four masking.
- Manageable connections can be tested/deleted.
- Patient, Coach, and Evaluator routes have separate selectors.
- Admin writes system routes; Teacher writes case routes subject to server-side ownership/RBAC.
- `docs/LLM_PROVIDERS.md` documents provider/security/deployment behavior.

## Relevant test commands

- `node --test llm-settings-ui.contract.test.mjs`
- `node --test llm-runtime.integration.test.mjs registration.integration.test.mjs sqlite.integration.test.mjs vercel-demo.test.mjs vercel-isolation.test.mjs`
- `npm test`
- JavaScript syntax checks from CI

## Current checkpoint

Last verified Task 7 CI:
- Run: `36221577895`
- Status: PASS
- Vercel: PASS

Task 8 CI:
- Status: PENDING after push

Next action:
- Read the first Task 8 GitHub Actions result once available.
- If PASS and Vercel succeeds, mark Task 8 COMPLETE and perform final hosted PR diff/check review before any merge decision.
- If FAIL, inspect the failing job/log and make the smallest corrective change.
