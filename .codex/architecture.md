# Architecture

> 類型：Current state。描述目前可由程式、schema、測試與 current docs 驗證的系統模型。

## 系統邊界與高階元件

| 元件 | 責任 | 主要位置 |
| --- | --- | --- |
| Browser UI | training/exam 訪談、mock login 或 production auth、Teacher Console | `index.html`, `app.js`, `formal-app.js` |
| Local/Vercel HTTP edge | static allowlist、body parsing、API routing、安全 headers；Vercel 只 rewrites 到 demo | `scripts/dev-server.mjs`, `api/`, `vercel.json` |
| Auth／authorization | opaque cookie session、CSRF/origin、throttling、RBAC、teacher assignment、audit | `lib/server-auth.js`, `lib/authz.js`, `lib/request-security.js`, `lib/auth-throttle.js` |
| Interview domain | case public projection、session ownership、frozen case/route snapshots、messages、evaluation、evaluation audit/support snapshots | `lib/server-cases.js`, `lib/server-sessions.js`, `lib/assessment-utils.js`, `lib/evaluation-audit.js`, `lib/evaluation-diagnostics.js` |
| LLM subsystem | provider connections、encrypted secrets、routing、prompts/adapters、provider session state、usage/pricing/quota | `lib/llm/` |
| Report export | Teacher/Admin records、student-owned report projection、DOCX/print rendering | `api/teacher/records.js`, `api/student/report.js`, `report-export.js`, `lib/report-policy.js` |
| Persistence | driver selection與統一 query facade；SQLite default、PostgreSQL option | `lib/db.js`, `lib/db-sqlite.js`, `lib/db-postgres.js`, `db/` |
| Isolated Vercel demo | browser persistence；預設 deterministic mock，可選 visitor-owned Groq BYOK Live calls；不接 production auth/DB/provider secrets | `api/demo.js`, `lib/mock-*.js`, `lib/llm/prompts.js`, `.vercelignore` |

系統不負責醫療診斷／治療、payment/invoicing，亦不把 Vercel local filesystem 當 durable storage。

## 主要資料流

1. Runtime 依 `DB_DRIVER` → `DATABASE_URL` → Vercel → SQLite 的優先序選出 browser、PostgreSQL 或 SQLite；SQLite open 時套用 base schema 與 ordered migrations。
2. DB mode 使用者經 registration/approval 或 first-admin bootstrap 建立，login 後取得 HttpOnly opaque cookie 與 CSRF token；所有管理與 owner-scoped handler 在 server 重新授權。
3. 學生取得不含 ground truth 的 published case projection，建立 training/exam session；server 凍結 case 定義與 Patient/Coach/Evaluator route snapshot。
4. Chat 先驗證 session owner/status與 quota，再用 snapshot route 呼叫 Patient adapter；成功才保存訊息與 usage。Training 可選 Coach；exam 禁用 Coach/live guidance。
5. Dify Stateful Chatflow（若選用）會把 `conversation_id` 依 interview session + Dify connection 保存並重用；新 interview 不沿用舊 state。
6. Evaluate 讀完整正式 transcript、case snapshot 與 rubric；provider JSON 先做有限 deterministic normalization，再經嚴格 contract validation，通過後才完成 session 並保存 canonical evaluation。每次 Evaluator 執行另保存 90-day audit trace，區分 success / normalized / repaired / failed；失敗時 session 保持 active，學生只取得非洩題 metadata，Teacher/Admin 可在權限範圍內查閱 redacted raw/repair/canonical outputs。
7. Teacher/Admin 依角色與 teacher-student assignment 管理 cases、users、records、provider routing、usage/quota；安全相關動作寫 audit events。
8. Completed production sessions 可由 Teacher/Admin records 取得；若 case policy 允許，session owner 亦可透過 student report endpoint 取得已清除內部成本欄位的報告資料。Browser 端以相同 report model 產生真實 DOCX 或 A4 print view。
9. Browser/Vercel demo 沒有 production auth tables、provider credentials 或 server transcript persistence；預設走 deterministic mock。訪客可用 onboarding wizard 啟用自己的 Groq BYOK，Key 預設只在 sessionStorage、選擇記住時才在 localStorage，Live request 只透過 `api/demo.js` 暫時轉送到固定 Groq endpoint。

## 依賴方向與不變條件

- `api/` handlers 編排 `lib/` services；database access 經 `lib/db.js` facade，browser mode 不可誤用 DB adapter。
- UI 隱藏不是授權；角色、owner、assignment、CSRF 與 origin 必須由 server 執行。
- 學生 API 不得傳回完整 case ground truth；case 與 agent routes 在 session 建立時凍結，之後設定變更不得改變 active session。
- Patient、Coach、Evaluator prompt/contract 分離；Patient 不接收 scoring/teacher-only feedback，Coach 不洩漏答案，Evaluator 以 transcript evidence 評分。Prompt 組裝遵守 stable rules → educator/case context → transcript/history → current task 的 prefix-cache 順序；Evaluator repair 與 first-pass 共用相同 system prefix。
- Production DB mode 缺 route、quota exceeded 或 provider failure 必須明確失敗，不得 silent fallback 到 mock；失敗的 Patient reply 不落 transcript，無效 evaluation 不完成 session。
- Provider secret 只在 server 加解密；API 只回 masked suffix，secret 不進 browser state、prompt transcript、usage row 或 log。
- Dify `conversation_id` 不是 credential，但必須限制在同一 interview session + connection；Stateful Evaluator final trigger 缺既有 state 時不得默默開新 conversation。
- Student report 是否可下載由 server 依 session ownership、completed status、case policy 與 mode 重新判定；UI 按鈕不是 security boundary。
- Evaluation audits/support diagnostics 以 server RBAC 為 security boundary：學生不得取得 raw Evaluator/repair/canonical text；Teacher 只可查自己或 assigned students，Admin 可全域查閱；ZIP 只是按需匯出格式，不是 primary persistence。
- Vercel bundle allowlist 排除 production auth、DB、teacher/student APIs、native SQLite 與 production LLM credentials；Groq BYOK 只存在 browser storage 並在 request 期間暫時進入 demo function，不得寫 log/DB 或回傳。

## 核心資料與狀態

| 模型 | 生命週期／權威定義 |
| --- | --- |
| Users, auth sessions, throttle, audit, assignments | `db/sqlite-schema.sql`／`db/schema.sql`; server auth services |
| Cases | draft/published/archived；學生只見 public projection；session 留 snapshot；definition 內含 student report export policy |
| Interview sessions/messages/evaluations | active→completed/abandoned；owner-scoped；正式 transcript/evaluation 在 DB；v9 保存 Teacher snapshot 與 per-turn Coach events，v10 保存失敗評量的 redacted support snapshot，v11 保存所有 Evaluator outcome 的 retained audit trace |
| LLM connections/routes/provider state | system 或 teacher-owned connection；OpenAI/DeepSeek/GroqCloud/Ollama/Dify/Custom routes；session snapshot 不可變；Groq 以固定官方 endpoint 的 logical preset 映射到既有 custom persistence contract；Dify Stateful Chatflow 的 `conversation_id` 依 interview+connection 保存 |
| Usage/pricing/quota | usage 保存 provider facts、cache hit/miss/reporting state、cache-savings、定價/FX snapshot；分析頁可依期間/使用者/Provider/Model/Agent/病例/結果/cache telemetry 篩選並分開顯示 cache hit rate 與 coverage；hard quota 在 provider call 前檢查，分析篩選不改變 quota 計算 |
| Browser demo state | browser localStorage；與 production DB/security domain 隔離 |

## 錯誤、安全與營運邊界

- API 以 HTTP status + JSON `error` 表示失敗；LLM upstream details 正規化／清理，timeout、not configured、quota 有分離語意。
- 沒有通用 request idempotency contract；寫入重試需先檢查 handler/schema 行為，不可自行假定安全。
- SQLite migration 以 `PRAGMA user_version` 依序、transaction 套用；目前 current schema 為 v12；backup 只由 SQLite adapter 支援。
- 密碼以 scrypt、session/CSRF token 只存 hash；production setup/master secrets 必須外部配置。
- 可觀測性目前是 DB audit/usage events、health endpoint 與 server console；security audit UI/API 使用 server-side pagination 與日期/action/result/actor/target/keyword 篩選，避免把長期 audit history 一次載入；production 規模與 SLO 未定義。
- SQLite 適合單一一般主機；多 application hosts／較高 concurrent writes 的升級路徑是 PostgreSQL/Neon。

## 修改導覽

| 能力 | 優先查看 | 主要驗證 |
| --- | --- | --- |
| Auth／帳號／權限 | `api/auth/`, `api/teacher/users.js`, `lib/server-auth.js`, `lib/authz.js` | `registration.integration.test.mjs`, `mock.test.mjs` |
| 訪談／評量 | `api/{sessions,chat,coach,evaluate}.js`, `api/teacher/evaluation-{diagnostics,audits}.js`, `lib/server-sessions.js`, `lib/evaluation-{diagnostics,audit}.js` | `mock.test.mjs`, `llm-runtime.integration.test.mjs`, `evaluation-diagnostics*.test.mjs` |
| LLM provider／route／secret | `lib/llm/`, `api/teacher/ai-settings.js` | `llm-*.test.mjs` |
| Dify stateful integration | `lib/llm/providers/dify.js`, `lib/llm/provider-state.js`, `lib/llm/routes.js`, `lib/llm/agents.js` | `dify-stateful.integration.test.mjs`, Dify provider/route tests |
| Cost／quota | `lib/llm/{usage,pricing,quota,usage-admin}.js` | pricing/quota/usage integration tests |
| Report export／student policy | `report-export.js`, `api/teacher/records.js`, `api/student/report.js`, `lib/report-policy.js` | report/export/student-policy tests |
| Database／migration | `lib/db*.js`, `lib/sqlite-migrations.js`, `db/` | SQLite/schema migration tests |
| Vercel demo | `vercel.json`, `.vercelignore`, `api/demo.js` | Vercel demo/isolation tests |
