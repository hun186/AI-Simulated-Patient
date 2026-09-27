# Project Memory

> 類型：Recent durable context。只保留後續任務會用到的近期成果，不取代 current-state 專門文件。

## Current Focus

- 初始化狀態：`INITIALIZED`；2026-09-26 依 commit `f04bc8c` 的實際程式、測試、manifest/lockfile、schema/migrations、README 與 docs 完成 bootstrap。
- 目前產品基線：SQLite-first 的 AI 模擬病人教育原型；production auth/RBAC、native LLM providers、usage pricing/quota、Dify Stateful Chatflow、Teacher/Admin report export 與 case-level student report policy 已存在。
- Current SQLite schema 由 v1 base + ordered migrations 推進至 `user_version=9`；v8 加入 provider session state，v9 加入 Teacher snapshot 與 Coach events。
- Vercel 必須維持 deterministic browser demo 隔離，不可把 production DB/auth/LLM code 或 credentials 納入 bundle；browser-local demo 可使用靜態 report exporter，但 production student-report API 不進 Vercel demo surface。
- 修改 session/LLM 時維持 case/route snapshot、server-side ownership/RBAC、production no-mock-fallback 與 evaluator-before-completion 不變量。
- Canonical 整體驗證是 `npm test`；hosted CI 定義於 `.github/workflows/ci.yml`，目前使用 Node 22、syntax checks 與 `npm test`。

## Recent Outcomes

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
