# Project Profile

> 類型：Current state。最後查證：2026-09-26；基準 branch `codex/bootstrap-project-context`、commit `f04bc8c`。

## 專案身份與範圍

- 初始化狀態：`INITIALIZED`
- 一句話目的：提供語言治療臨床訪談的訓練／考核原型，讓學生訪談模擬病人、取得受控教練提示與結構化評量，並讓教師管理案例、帳號與紀錄。
- 主要使用者：學生、教師、管理員；角色與資源範圍由伺服器端 RBAC 執行。
- 主要輸入：案例定義、學生訪談訊息、模式與教練設定、帳號／教師管理動作、LLM provider／route／定價／配額設定。
- 主要輸出：病人回覆、非洩題教練提示、逐項評量、正式 transcript/evaluation、稽核與 LLM usage/cost 摘要。
- 明確非目標：本專案是教育原型，不是醫療器材，亦不提供診斷或治療建議；Vercel 公開面不是 production persistence host。

## 技術與執行環境

| 面向 | 目前狀態 | 證據位置 |
| --- | --- | --- |
| 語言／UI | JavaScript ESM；無 framework 的靜態 HTML/CSS/JS | `package.json`, `index.html`, `app.js`, `formal-app.js` |
| Runtime／server | Node.js 22.x；本機原生 `node:http`，部署另有 Vercel Functions | `package.json`, `scripts/dev-server.mjs`, `vercel.json` |
| 套件 | npm lockfile v3；`@neondatabase/serverless`、`better-sqlite3` | `package.json`, `package-lock.json` |
| 儲存 | 一般主機預設 SQLite；`DATABASE_URL` 可選 PostgreSQL/Neon；Vercel 無 DB 時為 browser/localStorage demo | `lib/db.js`, `lib/db-*.js`, `docs/PRODUCTION_ARCHITECTURE.md` |
| LLM | OpenAI Responses 與 OpenAI-compatible adapter；OpenAI、DeepSeek、Ollama、custom presets | `lib/llm/`, `docs/LLM_PROVIDERS.md` |
| 支援平台 | 文件化 Windows/Linux SQLite 部署與隔離式 Vercel demo | `docs/WINDOWS_PRODUCTION.md`, `docs/LINUX_PRODUCTION.md`, `docs/VERCEL_DEMO.md` |

## Repository 地圖

| 路徑 | 責任 | 優先查看時機 |
| --- | --- | --- |
| `index.html`, `app.js`, `styles.css` | 主要單頁 UI | 學生／教師互動與畫面契約 |
| `formal-app.js`, `formal.css` | 另一套正式視覺 UI 資產 | Vercel allowlist 或正式外觀 |
| `scripts/` | 本機 HTTP server、SQLite backup | 執行、路由、營運工具 |
| `api/` | HTTP handler；auth、訪談、teacher management | API 行為、權限、錯誤狀態 |
| `lib/` | domain/service、DB facade、auth、安全與 LLM adapters | 核心行為與跨 handler 共用邏輯 |
| `db/` | PostgreSQL schema、SQLite v1 schema、ordered migrations | schema／migration 相容性 |
| `*.test.mjs` | Node 單元、integration、UI/config contract tests | 行為與回歸事實來源 |
| `docs/` | production、安全、LLM 與已完成階段設計／進度 | 設計理由與部署邊界 |

## 主要入口與事實來源

| 入口 | 用途 | 狀態 |
| --- | --- | --- |
| `npm run dev` → `scripts/dev-server.mjs` | 本機 UI/API server，預設 `http://localhost:3000` | README、manifest 與程式一致 |
| `index.html` → `app.js` | Browser application | 已存在 |
| `api/demo.js` + `vercel.json` rewrites | Vercel deterministic mock surface | isolation tests 覆蓋 |
| `npm test` → `node --test` | 完整測試套件 | manifest 定義；bootstrap 時實跑 |
| `npm run db:backup` | 一致性 SQLite backup | 僅 SQLite 模式 |

事實來源優先序：可執行程式與 `*.test.mjs` → `package*.json`／`vercel.json` → `db/schema.sql`、`db/sqlite-schema.sql`、`db/migrations/` → current production/security docs → phase plans/progress。

## 資料、秘密與產物邊界

- 應提交：程式、測試、schemas/migrations、靜態 UI、文件與 `data/.gitkeep`。
- 不應提交：`.env*`（已追蹤範例若未來建立須無秘密）、`node_modules/`、`.vercel/`、`data/*` 中的 SQLite/WAL/backup 與本機 `llm-secret.key`。
- 正式敏感資料：密碼雜湊、opaque sessions、transcripts、evaluations、audit events 與 LLM credential ciphertext；不得放入 `.codex/`。
- 測試 fixture：多數 integration tests 在 OS temp 目錄建立獨立 SQLite DB 並清理；provider tests 注入 fake `fetch`，不要求外部 LLM。

## 外部系統、限制與待確認

- PostgreSQL/Neon：由 `DATABASE_URL` 與 `@neondatabase/serverless` adapter 使用；SQLite 才是一般主機目前預設。
- LLM endpoints：只由 server adapters 呼叫；credential 不進 browser、transcript 或 API response。
- Vercel：只上傳 allowlist 的 demo handler／mock code 與靜態資產，不能視為 SQLite durable production。
- CI：目前 checkout 未含 `.github/workflows/`；歷史 progress 文件記載先前 hosted checks 通過，但目前 main 的持續 CI 定義待確認。
- 維護責任與正式 release／support policy：repository 未明確定義，待 maintainer 確認。
