# LLM Usage, Cost, and Quota Phase 2 Design

Date: 2026-09-26
Baseline: `main @ 75e9959666127b85881d52e32da1a76a9992b057`

## Goal

Add production usage visibility, deterministic cost estimation, and per-account LLM usage limits on top of the Phase 1 provider/runtime foundation.

## Product requirements

- Preserve raw provider usage facts from Phase 1.
- Estimate cost from model pricing without rewriting historical usage when prices change.
- Allow Admin to define system pricing overrides and per-user limits.
- Allow Teacher to view assigned students and manage limits only for assigned students.
- Enforce hard limits before real provider calls. Production must not bypass a configured hard quota by falling back to Mock.
- Expose usage/cost summaries by user, provider, model, agent role, and date window.
- Keep Vercel PoC deterministic Mock-only and isolated from production credentials, pricing, and quota APIs.

## Cost model

Prices are stored in USD micro-dollars (1 USD = 1,000,000 micro-USD) per one million tokens:

- input
- cached input
- output
- reasoning

A pricing rule is keyed by provider preset + model pattern, may be scoped to a pricing time band (`always | peak | off_peak`), and has an effective timestamp. Admin overrides may be added without mutating old usage rows.

DeepSeek has built-in effective-dated pricing rules for `deepseek-flash`, the legacy `deepseek-v4-flash*` aliases, and `deepseek-v4-pro`. Peak/off-peak selection uses Beijing time at provider request start: Monday-Friday 09:00-12:00 and 14:00-18:00 are peak; all other times are off-peak. The catalog uses DeepSeek's published USD rates directly, so no FX conversion is required.

Each `llm_usage_events` row receives:
- `estimated_cost_microusd`
- `pricing_status`: `priced | unpriced | partial`
- `pricing_rule_id`

Cost is calculated from the provider request-start timestamp and persisted, so a long request crossing a pricing boundary keeps the rate in effect when it began, and historical cost remains stable when the catalog changes.

## Quota model

`llm_user_quotas` stores optional hard limits per user:
- daily token limit
- monthly token limit
- daily estimated-cost limit
- monthly estimated-cost limit
- enabled flag

Null means unlimited for that dimension. Zero is a valid hard stop.

Before each real provider request, quota service aggregates successful and failed usage rows that have known token/cost facts for the current UTC day/month and rejects when a configured hard limit is already exhausted.

Phase 2 intentionally does not implement prepaid billing, payment collection, or automatic provider-side spend caps.

## Authorization

- Admin: view all usage, manage pricing rules, manage quotas for any user.
- Teacher: view usage for assigned students and self; manage quotas for assigned students only.
- Student: may view own usage summary only if/when UI exposes it; cannot manage limits.
- Server-side ownership checks remain authoritative.

## Error contract

Quota rejection is explicit and sanitized:
- HTTP 429
- `AI_USAGE_QUOTA_EXCEEDED`
- dimension metadata may identify `daily_tokens`, `monthly_tokens`, `daily_cost`, or `monthly_cost`
- no provider credential or hidden case data is included.

## Phase 2 tasks

1. Pricing/quota schema and ordered SQLite migration v4.
2. Pricing catalog resolver + persisted cost estimation.
3. Quota service + runtime preflight enforcement for Patient/Coach/Evaluator.
4. Usage/quota management API with Admin/Teacher scope.
5. Teacher Console usage/cost dashboard and per-user quota editor.
6. Documentation, full regression, exact hosted CI/Vercel verification.

## Non-goals

- payment processing
- invoice generation
- automatic currency conversion
- organization billing
- anomaly detection / automated account suspension
- streaming/token reservation accounting
- Dify integration
