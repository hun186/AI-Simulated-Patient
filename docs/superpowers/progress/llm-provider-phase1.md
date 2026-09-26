# LLM Provider Phase 1 Progress

Authoritative branch: `feat/llm-provider-foundation`
Draft PR: #2
Current hosted head: `1ce2f671b4c3e7615ad785fec5b7bf49572dc4c9`
Base: `main @ 03270515e65ee6c09717544248c9b5ba9bd76fb1`

## Task status

| Task | Status | Hosted evidence |
|---|---|---|
| 1. SQLite ordered migrations + LLM schema | COMPLETE | `c808fc9a9c081850332f21faa9fbae68f6f3454b`; migration tests present; current CI PASS |
| 2. AES-256-GCM API Key encryption | COMPLETE | `039cbcb7037697a049e5057699ddccf703558b7e`; secret-store tests present; current CI PASS |
| 3. OpenAI / OpenAI-compatible / DeepSeek / Ollama adapters | COMPLETE | `adf8a3bf4c324d4522d37096be479065aaa904c0`; adapter tests present; current CI PASS |
| 4. Admin / Teacher Provider configuration + RBAC | COMPLETE | `c7e049d3064b6938d941890103f2ab7436b10ae4`; connection-management integration test present; current CI PASS |
| 5. Patient / Coach / Evaluator routing + session snapshot | COMPLETE | `1ce2f671b4c3e7615ad785fec5b7bf49572dc4c9`; route/session snapshot integration test present; current CI PASS |
| 6. Built-in Patient / Coach / Evaluator prompts + evaluator JSON contract | IN_PROGRESS | No Task 6 implementation commit yet |
| 7. Production chat/coach/evaluate integration + usage accounting | NOT_STARTED | No Task 7 implementation commit yet |
| 8. AI Settings UI + full regression/Vercel verification | NOT_STARTED | No Task 8 implementation commit yet |

## Recovery verification

- PR #2 state: OPEN, DRAFT, mergeable.
- PR #2 hosted head: `1ce2f671b4c3e7615ad785fec5b7bf49572dc4c9`.
- Current GitHub Actions run: `36206006736` — SUCCESS.
- Current suite at hosted head: **32 tests / 32 pass / 0 fail**.
- Current Vercel commit status: **success**.
- Phase 1 plan: `docs/superpowers/plans/2026-09-26-llm-provider-phase1.md`.
- Phase 1 spec: `docs/superpowers/specs/2026-09-25-llm-provider-phase1-design.md`.

## Completed work

- SQLite ordered migration runner and schema version 2.
- LLM provider connection, route and usage tables; session route snapshot column.
- AES-256-GCM encrypted provider credential storage.
- OpenAI Responses adapter.
- OpenAI-compatible adapter with DeepSeek/Ollama/custom presets.
- Sanitized provider error normalization and Test Connection contract.
- Admin/Teacher provider-connection scope enforcement.
- System/case agent routes and immutable interview-session route snapshots.
- Production session creation refuses missing Patient provider.
- Development keeps explicit deterministic Mock routes.

## Remaining work

1. Task 6 agent prompts, safety identifier, evaluator JSON validation.
2. Task 7 production runtime API integration and `llm_usage_events` writes.
3. Task 8 Teacher/Admin AI Settings UI, docs, full regression and Vercel verification.

## Last verified tests

Hosted run `36206006736`:
- adapter, connection, route, secret, migration tests: PASS.
- full repository suite: **32/32 PASS**.
- Vercel: success.

## Exact next action

Implement Task 6 by adding focused tests plus:
- `lib/llm/prompts.js`
- `lib/llm/evaluation-contract.js`
- `lib/llm/agents.js`

Use the existing provider gateway and session route snapshot contracts. Do not modify runtime APIs until Task 7.
