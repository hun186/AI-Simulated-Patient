# LLM Usage / Cost / Quota Phase 2 Progress

Authoritative baseline: `main @ 75e9959666127b85881d52e32da1a76a9992b057`
Branch: `feat/llm-usage-quota-phase2`

## Task status

| Task | Status |
|---|---|
| 1. Pricing/quota schema + SQLite migration v4 | COMPLETE |
| 2. Cost estimator | IMPLEMENTED_CI_PENDING |
| 3. Hard quota enforcement | NOT_STARTED |
| 4. Usage/quota API + RBAC | NOT_STARTED |
| 5. Usage/cost dashboard UI | NOT_STARTED |
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
