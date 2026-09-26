# LLM Provider Phase 1 Progress

Authoritative branch: `feat/llm-provider-foundation`
Draft PR: #2
Current hosted head before this checkpoint: `d856e7e8cac9221c1ec06c0ed0e7c3969cd596a9`
Base: `main @ 03270515e65ee6c09717544248c9b5ba9bd76fb1`

## Task status

| Task | Status | Hosted evidence |
|---|---|---|
| 1. SQLite ordered migrations + LLM schema | COMPLETE | `c808fc9a9c081850332f21faa9fbae68f6f3454b`; focused tests and hosted CI PASS |
| 2. AES-256-GCM API Key encryption | COMPLETE | `039cbcb7037697a049e5057699ddccf703558b7e`; focused tests and hosted CI PASS |
| 3. OpenAI / OpenAI-compatible / DeepSeek / Ollama adapters | COMPLETE | `adf8a3bf4c324d4522d37096be479065aaa904c0`; focused tests and hosted CI PASS |
| 4. Admin / Teacher Provider configuration + RBAC | COMPLETE | `c7e049d3064b6938d941890103f2ab7436b10ae4`; focused tests and hosted CI PASS |
| 5. Patient / Coach / Evaluator routing + session snapshot | COMPLETE | `1ce2f671b4c3e7615ad785fec5b7bf49572dc4c9`; focused tests and hosted CI PASS |
| 6. Built-in Patient / Coach / Evaluator prompts + evaluator JSON contract | IMPLEMENTED_CI_PENDING | Task 6 code and focused test are included in this checkpoint; hosted CI must verify GREEN |
| 7. Production chat/coach/evaluate integration + usage accounting | NOT_STARTED | No Task 7 implementation commit yet |
| 8. AI Settings UI + full regression/Vercel verification | NOT_STARTED | No Task 8 implementation commit yet |

## Recovery verification

- PR #2: OPEN, DRAFT, mergeable.
- Recovery head before Task 6: `d856e7e8cac9221c1ec06c0ed0e7c3969cd596a9`.
- Recovery CI: `36219240877` — SUCCESS.
- Recovery Vercel status: success.
- Phase 1 plan: `docs/superpowers/plans/2026-09-26-llm-provider-phase1.md`.

## Completed work

- Tasks 1-5 verified from hosted implementation, tests, commits and CI.
- Task 6 implementation checkpoint adds code-controlled Patient/Coach/Evaluator prompts.
- Evaluator requests a JSON-schema response and validates `covered|partial|missed` plus evidence arrays.
- Agent calls use a SHA-256-derived opaque safety identifier rather than email/display name.
- Task 6 does not modify runtime APIs; production API wiring remains Task 7.

## Relevant test commands

- `node --test llm-agents.test.mjs`
- After focused GREEN: `npm test`

## Current checkpoint

Last verified CI before Task 6:
- Run: `36219240877`
- Status: PASS

Task 6 CI:
- Status: PENDING after push

Next action:
- Read the first Task 6 GitHub Actions result once available.
- If PASS, mark Task 6 COMPLETE and start Task 7 usage/runtime integration.
- If FAIL, inspect the failing job/log and make the smallest corrective change.
