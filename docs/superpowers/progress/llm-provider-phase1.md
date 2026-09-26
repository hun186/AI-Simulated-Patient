# LLM Provider Phase 1 Progress

Authoritative branch: `feat/llm-provider-foundation`
Draft PR: #2
Current hosted head before this review-fix checkpoint: `a919b14e241d06b7eaf14eca4b10f81a3ca89f3f`
Base: `main @ 03270515e65ee6c09717544248c9b5ba9bd76fb1`

## Task status

| Task | Status | Hosted evidence |
|---|---|---|
| 1. SQLite ordered migrations + LLM schema | COMPLETE | focused tests + hosted CI PASS |
| 2. AES-256-GCM API Key encryption | COMPLETE | focused tests + hosted CI PASS |
| 3. OpenAI / OpenAI-compatible / DeepSeek / Ollama adapters | COMPLETE | focused tests + hosted CI PASS |
| 4. Admin / Teacher Provider configuration + RBAC | COMPLETE | focused tests + hosted CI PASS |
| 5. Patient / Coach / Evaluator routing + session snapshot | COMPLETE | focused tests + hosted CI PASS |
| 6. Built-in Patient / Coach / Evaluator prompts + evaluator JSON contract | COMPLETE | `d3e29a48e66055b0efa6d361450bff1135fc8420`; Actions `36220196344` PASS; Vercel PASS |
| 7. Production chat/coach/evaluate integration + usage accounting | COMPLETE | `be487bf2533cc3f1bc5facab026d764510af2949`; Actions `36221577895` PASS; Vercel PASS |
| 8. AI Settings UI + full regression/Vercel verification | COMPLETE | final corrective head `9798f40b9c462feab4d24c12ee6512e0c7cf9c1a`; Actions `36222679914` PASS; Vercel PASS |

## Final hosted-review corrections

- Enabling Coach mid-session now fails before mutating session state when the immutable session snapshot has no Coach route.
- Teacher AI route picker exposes only cases created by the signed-in Teacher; server-side ownership enforcement remains authoritative.
- AI Provider UI now includes edit and enable/disable controls in addition to create/test/delete.
- Runtime integration test verifies rejected mid-session Coach enable leaves `coach_enabled=false`.
- UI contract test verifies edit/disable controls and owned-case filtering.

## Current checkpoint

Phase 1 Task 1-8 are COMPLETE.

Final hosted verification:
- Exact head: `9798f40b9c462feab4d24c12ee6512e0c7cf9c1a`
- GitHub Actions run: `36222679914` — PASS
- Vercel preview — PASS
- PR #2 — OPEN, DRAFT, mergeable

Next action:
- Perform no merge unless explicitly requested.
- If merge is requested, re-read hosted PR/head/checks immediately before merging.
