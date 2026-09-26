# Development Workflows

> 類型：Current state。命令以 `package.json`、lockfile、README、程式與測試交叉查證；最後查證 2026-09-26。

## 環境前提

| 項目 | 要求／現況 | 查證來源 |
| --- | --- | --- |
| Runtime | Node.js 22.x | `package.json` engines、`package-lock.json` |
| Package manager | npm；lockfile v3 | `package-lock.json` |
| 本機服務 | 預設 SQLite 不需資料庫服務；PostgreSQL 與真實 LLM 僅在選用時需要 | `lib/db.js`, README |
| 平台 | Windows、Linux 有部署文件；Vercel 僅隔離 demo | `docs/*PRODUCTION.md`, `docs/VERCEL_DEMO.md` |

## 環境變數（只列名稱）

- Runtime／DB：`PORT`、`APP_ENV`、`NODE_ENV`、`DB_DRIVER`、`SQLITE_PATH`、`DATABASE_URL`、`VERCEL`、`VERCEL_ENV`。
- Auth：`ADMIN_SETUP_KEY`、`AUTH_ALLOWED_ORIGINS`、`AUTH_SESSION_TTL_SECONDS`、`AUTH_THROTTLE_FAILURE_LIMIT`、`AUTH_THROTTLE_WINDOW_SECONDS`、`AUTH_THROTTLE_BLOCK_SECONDS`、`AUTH_REGISTER_EMAIL_LIMIT`、`AUTH_REGISTER_IP_LIMIT`。
- LLM：`LLM_SECRET_MASTER_KEY`、`LLM_SECRET_KEY_PATH`、`LLM_PROVIDER`。Production DB mode 的 master key 與 first-admin bootstrap key 需由部署者安全配置；不得寫入 Git。

## Canonical Commands

所有命令從 repository root 執行。

| 用途 | 命令 | 狀態／副作用 |
| --- | --- | --- |
| 可重現安裝 | `npm ci` | lockfile 定義；會寫 `node_modules/`，bootstrap 未重跑 |
| 開發啟動 | `npm run dev` | 建立／開啟 SQLite 與本機 LLM key，為長時間程序；bootstrap 未啟動 |
| 完整測試／最小整體驗證 | `npm test` | `node --test`；使用 temp SQLite 與 injected provider fakes |
| 指定測試 | `node --test <file>.test.mjs` | 最靠近變更範圍的驗證 |
| 語法檢查 | `node --check <file.js-or-mjs>` | 適用修改過的 JS/MJS |
| SQLite backup | `npm run db:backup` | 會在 `data/backups/` 寫檔；只適用 SQLite，非一般驗證 |
| Build／lint／format／typecheck | 目前沒有 canonical command | `package.json` 未定義，不得猜測 |

## 驗證矩陣

| 變更類型 | 最小必要檢查 | 擴大條件 |
| --- | --- | --- |
| 純文件／Codex memory | `git diff --check`、連結／路徑／命令與來源交叉核對、敏感字串檢查 | 記載 executable contract 時跑相應 test；bootstrap 跑全套 |
| Domain／mock | 對應 `mock.test.mjs` 或 LLM unit test | 共用評量、prompt 或 gateway 改變時跑 `npm test` |
| API／auth／RBAC | 相應 integration test | 共用 auth、session、DB facade 改變時跑全套 |
| Schema／migration | `sqlite-migrations.integration.test.mjs`、相關 phase schema test | PostgreSQL DDL 或既有資料升級改變時跑全套並人工 review DDL |
| UI | 對應 `*-ui.contract.test.mjs`／`llm-settings-ui.contract.test.mjs` | 可感知 layout 改變時另做 browser screenshot |
| Vercel | `vercel-demo.test.mjs`、`vercel-isolation.test.mjs` | allowlist、rewrite 或 handler 改變時跑全套 |

## 測試與資料安全

- 測試 runner 是 Node built-in test runner；測試檔位於 root，無另外的 test config。
- SQLite integration tests 使用 `mkdtemp` 的獨立 DB 並清理；不要將測試指向 production `SQLITE_PATH`。
- Provider adapter tests 使用 injected `fetchImpl`；完整 `npm test` 不應需要網路或真實 API key。
- `npm run dev` 與 backup 會修改 `data/`，不是無副作用驗證；Vercel deployment、正式 migration 與真實 provider test 也不可當一般本機測試。
- CI 現況：checkout 沒有 `.github/workflows/`；不可把歷史 progress 的 hosted pass 當作目前 commit 自動驗證。
