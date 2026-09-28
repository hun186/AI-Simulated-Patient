# Project Memory

> 類型：Recent durable context。只保留後續任務會用到的近期成果，不取代 current-state 專門文件。

## Current Focus

- 初始化狀態：`INITIALIZED`；2026-09-26 依 commit `f04bc8c` 的實際程式、測試、manifest/lockfile、schema/migrations、README 與 docs 完成 bootstrap。
- 目前產品基線：SQLite-first 的 AI 模擬病人教育原型；production auth/RBAC、native LLM providers、usage pricing/quota、Dify Stateful Chatflow、Teacher/Admin report export 與 case-level student report policy 已存在。
- Current SQLite schema 由 v1 base + ordered migrations 推進至 `user_version=12`；v8 加入 provider session state，v9 加入 Teacher snapshot 與 Coach events，v10 加入 evaluation failure diagnostics，v11 加入所有 Evaluator outcome 的 retained audit traces，v12 加入 prompt/KV cache telemetry 與 cache-savings snapshots。
- Vercel 必須維持 deterministic browser demo 隔離，不可把 production DB/auth/LLM code 或 credentials 納入 bundle；browser-local demo 可使用靜態 report exporter，但 production student-report API 不進 Vercel demo surface。
- 修改 session/LLM 時維持 case/route snapshot、server-side ownership/RBAC、production no-mock-fallback 與 evaluator-before-completion 不變量。
- Canonical 整體驗證是 `npm test`；hosted CI 定義於 `.github/workflows/ci.yml`，目前使用 Node 22、syntax checks 與 `npm test`。

## Recent Outcomes

### 2026-09-28 — GroqCloud provider preset

- AI Settings 新增 Teacher/Admin 都可建立的 GroqCloud preset；固定 OpenAI-compatible endpoint 為 `https://api.groq.com/openai/v1`，使用者只需填 Groq API key 與 model ID，不可自行改 Base URL。
- Groq 重用既有 OpenAI-compatible adapter、provider error normalization、route snapshot、token usage、quota 與 usage analytics；route/usage logical preset 保留 `groq`，可在 Provider breakdown 獨立辨識。
- 為避免只為 preset enum 增加 schema migration，Groq DB row 仍用既有 `custom` persistence value + 固定 Groq base URL 做 logical projection；Dify 的 compatibility marker 不受影響。
- Groq 免費／付費方案成本不從 preset 猜測；usage token 照常保存，但成本維持 unpriced，避免把 Developer list price 誤報成 Free Plan 實際費用。

### 2026-09-27 — Security audit pagination and filters

- Security audit 改為 server-side pagination，預設 25 筆／頁，可切 50/100；API 回傳 total/totalPages，不再一次載入大量 audit rows。
- Admin UI 可依今日／本週／本月／近 7/30 日／自訂／全部期間、action、成功/失敗、actor、target 與 identifier/reason/client-host/action 關鍵字篩選。
- API 保留既有 permission boundary：Admin 可查全域，非 Admin 即使直接呼叫 API 仍只可看到 actor/target 涉及自己的事件；篩選條件不可擴張可見範圍。

### 2026-09-27 — Usage analytics filters

- LLM usage analytics 保留完整歷史，不提供 destructive reset；Teacher/Admin 可依本地日曆期間（今日、本週、本月、近 7/30 日、自訂、全部）、可見使用者、Provider、Model、Agent、病例、成功/失敗與 cache telemetry 狀態篩選。
- 前端將本地日期邊界轉成 UTC 查詢，server 以 browser timezone offset 產生本地日期 breakdown；Teacher scope 仍只涵蓋自己與 assigned students，Admin 才能看全域。
- Cache Hit Rate 只以 provider 有回報的 hit/miss input 計算，另顯示 cache telemetry coverage（reported input / total input）與 reported calls，避免舊資料或不回報 cache 的 Provider 造成誤讀。
- Analytics filters 只影響查詢呈現；既有 daily/monthly hard quota enforcement 仍直接依完整 llm_usage_events 計算。

### 2026-09-27 — Prompt/KV cache optimization

- Patient 保持 append-only conversation；Coach 將 transcript 從 system prompt 移到 user task，Evaluator/repair 共用相同 stable system + educator + case/rubric prefix，transcript 後才接 current task，以提高 DeepSeek、vLLM 與相容 OpenAI endpoint 的 prefix/KV cache reuse。
- Provider usage 正規化新增 cache telemetry reporting state、hit/miss tokens；DeepSeek 明確 hit/miss、OpenAI/vLLM-style `cached_tokens` 可被辨識，未提供 cache 欄位的 Ollama/其他 endpoint 保持 `unreported`，不誤報 0% hit。
- v12 usage snapshot 保存 cache hit/miss、reporting state 與依當次 pricing/FX 計算的 cache savings；Teacher/Admin usage dashboard 顯示 hit tokens、hit rate、USD/TWD savings，並在 Provider/Model/Agent breakdown 顯示 cache 摘要。

### 2026-09-27 — Retained evaluation audit traces

- 每次已開始的 Evaluator 執行都建立 `EVL-...` audit trace，區分 `success`、`success_normalized`、`success_repaired`、`failed`；raw/repaired output、normalization actions、canonical evaluation 與 provider metadata 保存在 server-side audit record。
- audit 預設保留 90 天（可由 `EVALUATION_AUDIT_RETENTION_DAYS` 調整），過期資料不再由查詢 API 回傳，並在新 audit 寫入時 opportunistic pruning；ZIP 只在教師／Admin 需要時即時產生。
- Teacher/Admin 依既有 assignment RBAC 查閱 raw/canonical audit；學生只看到安全 Evaluation ID/狀態摘要。Teacher record 保留同一 session 的完整 audit history，可選任一執行下載技術診斷包。
- v11 新增 `evaluation_audits`；Vercel deterministic demo 不暴露 production audit API。

### 2026-09-27 — Evaluator evidence compatibility fix

- DeepSeek may return transcript evidence as strings such as `[2] student: ...` even when the canonical Evaluator contract requires `{turn,quote}`; provider parsing now normalizes only this deterministic form before strict validation.
- Provider aggregate scores are recomputed from numeric item scores before validation, while the canonical contract now rejects inconsistent aggregate totals.
- Evaluator/repair prompts explicitly require evidence objects and aggregate arithmetic; ambiguous evidence still fails and keeps the existing repair/diagnostic path.

### 2026-09-27 — Evaluation failure support diagnostics

- Evaluator JSON 首次驗證與自動修復都失敗時，session 維持 active，系統產生 `EVL-...` 錯誤編號並保存 redacted failure snapshot。
- 學生只取得可交給教師／Admin 的安全 metadata，不直接取得 raw Evaluator text；Teacher/Admin 依 assignment/RBAC 可用錯誤編號查閱完整 redacted first/repair outputs。
- UI 提供重試、查看技術資訊、複製錯誤編號與下載 ZIP 支援包；Vercel demo 隔離邊界不變。

### 2026-09-27 — Dify stateful + report/export baseline

- Dify Application API 已支援 Platform-managed 與 Stateful Chatflow；Stateful 僅適用 Chat/Chatflow，`conversation_id` 依 interview session + connection 保存，新 interview 不沿用舊 state。
- 完成的 interview 可由 Teacher/Admin 匯出 DOCX / browser print-PDF；case 可用 `disabled`、`training_only`、`all_completed` 控制學生自行下載。
- Student report endpoint 以 server-side ownership/completed/policy/mode 判定權限，保留 Provider/Model 與 token usage provenance，但移除內部 Provider cost 欄位。
- Vercel 仍是隔離的 deterministic browser demo；production auth/DB/LLM/student-report APIs 不進 demo bundle。

### 2026-09-26 — Codex project bootstrap

- 結果：將根 `AGENTS.md` Quickstart 與 `.codex/*.md` 從 template placeholders 初始化為 repository current state；沒有修改產品程式碼、測試、schema、dependency、config 或 README。
- README gate：`ADEQUATE`；其用途、SQLite/browser/PostgreSQL/Vercel 邊界、auth、訪談模式、LLM、啟動／測試／backup 命令均能由 current code/config/tests 證實，因此保留原文。
- 主要資料流：browser UI → local/Vercel HTTP handlers → auth/session/domain/LLM services → SQLite(default) 或 PostgreSQL；Vercel demo 另走 `api/demo.js` + deterministic mocks + browser localStorage。
- 驗證：`npm test` 通過 53/53；另以 `git diff --check`、scope 與敏感資訊檢查確認文件變更。不要把舊 phase progress 的 hosted SHA 當作目前 head。

## Open Handoffs

- 人工確認：repository maintainer／support policy 仍未由 repository 明確定義；hosted CI 已由 `.github/workflows/ci.yml` 證實。
- 沒有已開始未完成的產品實作；Phase 1/2 plan checklist 需以 progress、程式與 tests 判讀，不應重新當 backlog 執行。

## Archive Index

- 詳細索引見 `.codex/archive/README.md`；一般任務不讀 archive，除非 current 文件或使用者要求追溯。

## 維護準則

- 最多保留 10 筆有持久參考價值的 outcomes；專案身份、架構、契約、決策、issue、backlog 分流至對應文件。
- 不記錄完整命令輸出、聊天逐字稿、秘密／個資、一次性失敗或可直接由 diff 得知的瑣碎清單。
