# Technical Decisions

> 類型：Durable rationale。以下只收錄已由實作、測試與現有設計文件共同證實、仍約束目前系統的決策。

## Active Decision Index

| ID | 決策 | 狀態 | 日期 | 影響範圍 |
| --- | --- | --- | --- | --- |
| `ADR-0001` | 一般單機 production 以 SQLite 為預設，保留 PostgreSQL driver boundary | Accepted | 已存在；bootstrap 於 2026-09-26 收錄 | DB、部署、backup |
| `ADR-0002` | Vercel 為隔離 deterministic browser demo，不承載 production auth/SQLite/LLM secrets | Accepted | 已存在；bootstrap 於 2026-09-26 收錄 | Vercel bundle、API、安全 |
| `ADR-0003` | LLM 採 server-side adapters、加密 credentials 與 session route snapshots，production fail closed | Accepted | 2026-09-25 設計、現已實作 | LLM、session、安全 |
| `ADR-0004` | 使用 usage-time pricing snapshot 與 provider-call 前 hard quota | Accepted | 2026-09-26 | usage/cost/quota |

## Decision Records

### ADR-0001 — SQLite default with PostgreSQL upgrade boundary

- 背景：Windows/Linux 教學原型需免外部 DB server 即可部署，同時不能封死多 host／較高 concurrency 的未來路徑。
- 決策：driver selection 在一般 host 預設 SQLite；`DATABASE_URL` 或 explicit driver 可切 PostgreSQL/Neon；application services 經 `lib/db.js` query facade。
- 取捨：SQLite 簡化營運並支援一致 backup，但不宣稱適合多 application hosts/heavy concurrent writes；兩份 schema 必須持續對齊。
- 證據：`lib/db.js`、`docs/PRODUCTION_ARCHITECTURE.md`、SQLite integration/migration tests。

### ADR-0002 — Isolated Vercel demo surface

- 背景：Vercel local filesystem 不是 durable SQLite host，公開 PoC 也不應取得 production credentials 或 auth data。
- 決策：無 `DATABASE_URL` 的 Vercel 使用 browser persistence/mock identities；deployment allowlist 只含 static UI、deterministic mocks 與 `api/demo.js`，production APIs 不上傳。
- 取捨：公開 demo 可重現且降低 secret/data risk，但其登入與持久化不是 production capability demonstration。
- 證據：`.vercelignore`、`vercel.json`、`docs/VERCEL_DEMO.md`、Vercel isolation tests。

### ADR-0003 — Native LLM adapter and immutable session routing

- 背景：Patient/Coach/Evaluator 需要不同語意與 provider 選擇，且 active interview 不可因管理設定改動而漂移。
- 決策：server-side gateway 正規化 OpenAI/compatible providers；credentials 以 AES-256-GCM 保存；route 在 session start snapshot；production 缺 route／provider failure 不 fallback mock。
- 取捨：需維護 provider adapters、secret master key 與 schema，但換得清楚信任邊界、可稽核 usage 與重現性。
- 證據：`docs/superpowers/specs/2026-09-25-llm-provider-phase1-design.md`、`lib/llm/`、route/runtime/secret tests。

### ADR-0004 — Persisted cost snapshots and preflight quotas

- 背景：價格會隨時間變更，歷史 cost 不應被新規則重算；hard limit 不可在 provider call 後才發現。
- 決策：usage event 保存所用 pricing rule/status 與 integer micro-USD estimate；每日／每月 token/cost quota 在 Patient/Coach/Evaluator provider call 前執行，拒絕不寫 provider failure。
- 取捨：unknown/partial prices明確保留 unpriced/partial，不假造精確金額；沒有 token reservation/streaming accounting。
- 證據：Phase 2 design/progress、migration 004、pricing/quota/runtime tests。
