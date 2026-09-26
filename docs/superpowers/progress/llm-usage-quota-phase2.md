# LLM Usage / Cost / Quota Phase 2 Progress

Authoritative baseline: `main @ 75e9959666127b85881d52e32da1a76a9992b057`
Branch: `feat/llm-usage-quota-phase2`

## Task status

| Task | Status |
|---|---|
| 1. Pricing/quota schema + SQLite migration v4 | COMPLETE |
| 2. Cost estimator | COMPLETE |
| 3. Hard quota enforcement | COMPLETE |
| 4. Usage/quota API + RBAC | COMPLETE |
| 5. Usage/cost dashboard UI | IMPLEMENTED_CI_PENDING |
| 6. Final regression / hosted verification | NOT_STARTED |

## Task 1

Hosted evidence: `a7817cf18656dd2bd1a69141bb1f4a9325034c5c`, GitHub Actions `36224009223` PASS.


Added:
- `db/migrations/004_llm_usage_cost_quota.sql`
- `phase2-schema.integration.test.mjs`
- PostgreSQL-aligned pricing/quota DDL
- schema-version expectations updated to v4

Schema:
- `llm_pricing_rules`
- `llm_user_quotas`
- `llm_usage_events.estimated_cost_microusd`
- `llm_usage_events.pricing_status`
- `llm_usage_events.pricing_rule_id`

Next:
- Read first hosted CI for Task 1.
- PASS => mark Task 1 COMPLETE and start Task 2.
- FAIL => inspect actual log and make smallest correction.

## Task 2

Implemented:
- `lib/llm/pricing.js` pricing rule resolver and deterministic integer micro-USD estimator.
- Exact model rule wins over wildcard; wildcard specificity and effective time break ties.
- Cached input is removed from normal input before pricing.
- Reasoning tokens are removed from normal output before reasoning pricing.
- Unknown or unreported usage remains explicitly `unpriced`.
- Missing price dimensions yield `partial`, not fake certainty.
- `recordLlmUsage()` persists cost/pricing snapshot fields.
- `llm-pricing.integration.test.mjs` covers resolver, double-count avoidance, partial/unpriced status, and persisted snapshots.

Task 2 CI: PENDING after push.

## Task 3

Implemented:
- `lib/llm/quota.js` with UTC daily/monthly usage aggregation.
- Hard dimensions: daily/monthly tokens and daily/monthly estimated cost.
- Quota rejection code: `AI_USAGE_QUOTA_EXCEEDED` with dimension metadata.
- Production Patient/Coach/Evaluator APIs enforce quota before provider calls.
- Quota rejection returns HTTP 429 and is not recorded as a provider usage failure.
- Runtime test verifies provider is not called, messages/usage rows do not change, and session remains active.

Task 2 hosted evidence: `7a5eb1a0b115dbb23fa4b2fe491195cd4de329fe`, Actions `36224188446` PASS.
Task 3 CI: PENDING after push.

## Task 4

Implemented:
- `lib/llm/usage-admin.js` for authorized user lists, usage summaries, quota CRUD, and pricing-rule management.
- `GET/POST /api/teacher/llm-usage`.
- Admin can view all users, manage any user quota, and manage pricing rules.
- Teacher can view self + assigned students, manage assigned-student quotas only, and cannot manage pricing.
- Usage summaries support optional user/date-window filters and aggregates by user/provider/model/agent.
- Management actions generate auth audit events.
- Dev server route registered.
- `llm-usage-admin.integration.test.mjs` verifies scope boundaries and summary results.

Task 3 hosted evidence: `aee3cdf70f67b5acbb2f37a34676103efff34413`, Actions `36224395870` PASS.
Task 4 CI: PENDING after push.

## Task 5

Implemented:
- Teacher Console subtab `用量與配額` for production Teacher/Admin only.
- Aggregate calls/tokens/persisted estimated cost/unpriced-call count.
- Breakdown by provider, model, and agent role.
- Optional per-user selection within server-authorized visible users.
- Quota viewer/editor for daily/monthly tokens and cost limits.
- Admin may edit all visible users; Teacher quota editor is enabled only for assigned students, not self.
- Cost display converts persisted micro-USD to USD; unpriced calls remain visibly separate.
- Browser/Vercel demo cannot enter the production usage API path.
- Added `llm-usage-ui.contract.test.mjs`.

Task 4 hosted evidence: `13c21e32146e435aefc88a82b64dceae67026658`, Actions `36224789787` PASS, Vercel PASS.
Task 5 CI: PENDING after push.
