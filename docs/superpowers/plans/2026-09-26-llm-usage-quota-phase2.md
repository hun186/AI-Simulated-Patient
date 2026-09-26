# LLM Usage, Cost, and Quota Phase 2 Plan

Baseline: `main @ 75e9959666127b85881d52e32da1a76a9992b057`
Branch: `feat/llm-usage-quota-phase2`

## Global rules

- Hosted GitHub state is authoritative.
- SQLite is the acceptance database; PostgreSQL DDL stays structurally aligned.
- TDD per task.
- No production Mock fallback.
- Never expose provider secrets in usage/quota APIs.
- Cost is persisted as integer micro-USD, never binary floating-point currency.
- Quota enforcement is server-side.
- Vercel PoC remains isolated Mock.

### Task 1 — Pricing/quota schema

Create SQLite migration 004 and PostgreSQL-aligned DDL.

Schema additions:
- `llm_pricing_rules`
- `llm_user_quotas`
- usage event cost snapshot columns

Acceptance:
- fresh DB reaches schema version 4
- v3 DB upgrades without losing usage rows
- quota nullable limits preserve unlimited semantics
- pricing/cost fields have nonnegative constraints

### Task 2 — Cost estimator

Create pricing resolver and estimator.

Acceptance:
- exact provider/model rule resolution
- wildcard fallback
- cached-input tokens are not double-counted as normal input
- persisted integer micro-USD cost
- unknown models produce `unpriced`, not fake zero-priced certainty

### Task 3 — Hard quota enforcement

Create quota service and call before Patient/Coach/Evaluator provider invocation.

Acceptance:
- daily/monthly token and cost limits
- HTTP 429 `AI_USAGE_QUOTA_EXCEEDED`
- rejected request does not call provider
- no Mock fallback
- session remains valid after quota rejection

### Task 4 — Usage/quota API + RBAC

Add staff API.

Acceptance:
- Admin all users
- Teacher assigned students + self only
- Teacher cannot edit unassigned users
- pricing management Admin-only
- date-window usage summaries

### Task 5 — Dashboard UI

Add Teacher Console “用量與配額”.

Acceptance:
- totals by date/user/provider/model/agent
- estimated USD display from persisted micro-USD
- unpriced usage visibly separated
- quota edit form
- Vercel demo does not call production endpoint

### Task 6 — Final verification

- full `npm test`
- syntax checks
- hosted exact-SHA GitHub Actions
- Vercel isolation verification
- progress checkpoint
