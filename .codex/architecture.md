# Architecture

> 類型：Current state。描述目前可由程式、schema、測試與 current docs 驗證的系統模型。

## 系統邊界與高階元件

| 元件 | 責任 | 主要位置 |
| --- | --- | --- |
| Browser UI | training/exam 訪談、mock login 或 production auth、Teacher Console | `index.html`, `app.js`, `formal-app.js` |
| Local/Vercel HTTP edge | static allowlist、body parsing、API routing、安全 headers；Vercel 只 rewrites 到 demo | `scripts/dev-server.mjs`, `api/`, `vercel.json` |
| Auth／authorization | opaque cookie session、CSRF/origin、throttling、RBAC、teacher assignment、audit | `lib/server-auth.js`, `lib/authz.js`, `lib/request-security.js`, `lib/auth-throttle.js` |
| Interview domain | case public projection、session ownership、frozen case/route snapshots、messages、evaluation | `lib/server-cases.js`, `lib/server-sessions.js`, `lib/assessment-utils.js` |
| LLM subsystem | provider connections、encrypted secrets、routing、prompts/adapters、usage/pricing/quota | `lib/llm/` |
| Persistence | driver selection與統一 query facade；SQLite default、PostgreSQL option | `lib/db.js`, `lib/db-sqlite.js`, `lib/db-postgres.js`, `db/` |
| Deterministic demo | browser persistence與 mock patient/coach/evaluator，不接 production auth/LLM | `api/demo.js`, `lib/mock-*.js`, `.vercelignore` |

系統不負責醫療診斷／治療、payment/invoicing，亦不把 Vercel local filesystem 當 durable storage。

## 主要資料流

1. Runtime 依 `DB_DRIVER` → `DATABASE_URL` → Vercel → SQLite 的優先序選出 browser、PostgreSQL 或 SQLite；SQLite open 時套用 base schema 與 ordered migrations。
2. DB mode 使用者經 registration/approval 或 first-admin bootstrap 建立，login 後取得 HttpOnly opaque cookie 與 CSRF token；所有管理與 owner-scoped handler 在 server 重新授權。
3. 學生取得不含 ground truth 的 published case projection，建立 training/exam session；server 凍結 case 定義與 Patient/Coach/Evaluator route snapshot。
4. Chat 先驗證 session owner/status與 quota，再用 snapshot route 呼叫 Patient adapter；成功才保存訊息與 usage。Training 可選 Coach；exam 禁用 Coach/live guidance。
5. Evaluate 讀完整正式 transcript、case snapshot 與 rubric，驗證結構化 evaluation contract 後才完成 session 並保存 evaluation；provider／contract 失敗時 session 保持 active。
6. Teacher/Admin 依角色與 teacher-student assignment 管理 cases、users、records、provider routing、usage/quota；安全相關動作寫 audit events。
7. Browser/Vercel demo 改走 deterministic mock 與 localStorage，沒有 production auth tables、credentials 或 server transcript persistence。

## 依賴方向與不變條件

- `api/` handlers 編排 `lib/` services；database access 經 `lib/db.js` facade，browser mode 不可誤用 DB adapter。
- UI 隱藏不是授權；角色、owner、assignment、CSRF 與 origin 必須由 server 執行。
- 學生 API 不得傳回完整 case ground truth；case 與 agent routes 在 session 建立時凍結，之後設定變更不得改變 active session。
- Patient、Coach、Evaluator prompt/contract 分離；Patient 不接收 scoring/teacher-only feedback，Coach 不洩漏答案，Evaluator 以 transcript evidence 評分。
- Production DB mode 缺 route、quota exceeded 或 provider failure 必須明確失敗，不得 silent fallback 到 mock；失敗的 Patient reply 不落 transcript，無效 evaluation 不完成 session。
- Provider secret 只在 server 加解密；API 只回 masked suffix，secret 不進 browser state、prompt transcript、usage row 或 log。
- Vercel bundle allowlist 排除 production auth、DB、teacher APIs、native SQLite 與 production LLM credentials。

## 核心資料與狀態

| 模型 | 生命週期／權威定義 |
| --- | --- |
| Users, auth sessions, throttle, audit, assignments | `db/sqlite-schema.sql`／`db/schema.sql`; server auth services |
| Cases | draft/published/archived；學生只見 public projection；session 留 snapshot |
| Interview sessions/messages/evaluations | active→completed/abandoned；owner-scoped；正式 transcript/evaluation 在 DB |
| LLM connections/routes | system 或 teacher-owned connection；system/case route；session snapshot 不可變 |
| Usage/pricing/quota | usage 保存 provider facts與定價 snapshot；hard quota 在 provider call 前檢查 |
| Browser demo state | browser localStorage；與 production DB/security domain 隔離 |

## 錯誤、安全與營運邊界

- API 以 HTTP status + JSON `error` 表示失敗；LLM upstream details 正規化／清理，timeout、not configured、quota 有分離語意。
- 沒有通用 request idempotency contract；寫入重試需先檢查 handler/schema 行為，不可自行假定安全。
- SQLite migration 以 `PRAGMA user_version` 依序、transaction 套用；backup 只由 SQLite adapter 支援。
- 密碼以 scrypt、session/CSRF token 只存 hash；production setup/master secrets 必須外部配置。
- 可觀測性目前是 DB audit/usage events、health endpoint 與 server console；production 規模與 SLO 未定義。
- SQLite 適合單一一般主機；多 application hosts／較高 concurrent writes 的升級路徑是 PostgreSQL/Neon。

## 修改導覽

| 能力 | 優先查看 | 主要驗證 |
| --- | --- | --- |
| Auth／帳號／權限 | `api/auth/`, `api/teacher/users.js`, `lib/server-auth.js`, `lib/authz.js` | `registration.integration.test.mjs`, `mock.test.mjs` |
| 訪談／評量 | `api/{sessions,chat,coach,evaluate}.js`, `lib/server-sessions.js` | `mock.test.mjs`, `llm-runtime.integration.test.mjs` |
| LLM provider／route／secret | `lib/llm/`, `api/teacher/ai-settings.js` | `llm-*.test.mjs` |
| Cost／quota | `lib/llm/{usage,pricing,quota,usage-admin}.js` | pricing/quota/usage integration tests |
| Database／migration | `lib/db*.js`, `lib/sqlite-migrations.js`, `db/` | SQLite/schema migration tests |
| Vercel demo | `vercel.json`, `.vercelignore`, `api/demo.js` | Vercel demo/isolation tests |
