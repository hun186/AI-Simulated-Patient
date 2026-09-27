# Project Memory

> 類型：Recent durable context。只保留後續任務會用到的近期成果，不取代 current-state 專門文件。

## Current Focus

- 初始化狀態：`INITIALIZED`；2026-09-26 依 commit `f04bc8c` 的實際程式、測試、manifest/lockfile、schema/migrations、README 與 docs 完成 bootstrap。
- 目前產品基線：SQLite-first 的 AI 模擬病人教育原型；production auth/RBAC、native LLM providers、usage pricing/quota、Dify Stateful Chatflow、Teacher/Admin report export 與 case-level student report policy 已存在。
- Current SQLite schema 由 v1 base + ordered migrations 推進至 `user_version=11`；v8 加入 provider session state，v9 加入 Teacher snapshot 與 Coach events，v10 加入 evaluation failure diagnostics，v11 加入所有 Evaluator outcome 的 retained audit traces。
- Vercel 必須維持 deterministic browser demo 隔離，不可把 production DB/auth/LLM code 或 credentials 納入 bundle；browser-local demo 可使用靜態 report exporter，但 production student-report API 不進 Vercel demo surface。
- 修改 session/LLM 時維持 case/route snapshot、server-side ownership/RBAC、production no-mock-fallback 與 evaluator-before-completion 不變量。
- Canonical 整體驗證是 `npm test`；hosted CI 定義於 `.github/workflows/ci.yml`，目前使用 Node 22、syntax checks 與 `npm test`。

## Recent Outcomes

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
