# Known Issues

> 類型：Verified open problems。只保存已重現、未解決且可能再次影響工作的問題。

## Open Issues

目前沒有由本次 bootstrap 或 repository current-state 證實的產品／驗證問題。

下列是限制或待確認事項，不是已重現 defect：

- SQLite 的單 host／concurrent-write 邊界是已接受架構限制；需要多 host 時使用 PostgreSQL/Neon，見 `ADR-0001`。
- Vercel browser demo 不提供 production persistence/auth/LLM 是刻意隔離，見 `ADR-0002`。
- Checkout 目前沒有 `.github/workflows/`；是否另有 hosted CI 設定待 maintainer 確認，不能據此宣稱 CI 故障。
- Project 未定義 build、lint、format 或 typecheck script；這是 workflow 現況，不自行建立 issue。

## Recently Resolved

目前沒有需要從 bootstrap 搬入的近期項目；過往 phase 修正由 Git 與 `docs/superpowers/progress/` 追溯。

## 收錄規則

- 新增項目需包含穩定 ID（`KI-001` 起）、日期／環境、最小重現、預期與實際、影響、workaround、修復條件及狀態。
- 不收錄未重現風險、一次性環境失敗、願望清單、已接受設計限制或已立即修好的瑣碎問題。
- 解決後移至 Recently Resolved 並保留實際驗證；累積過多再移至 `.codex/archive/`。
