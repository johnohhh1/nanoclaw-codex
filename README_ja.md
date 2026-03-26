# NanoClaw

このブランチは Claude 向け実装から Codex ネイティブ実装へ移行した版です。

最新で正確な説明は [README.md](README.md) を参照してください。英語版を正本とし、この日本語版は要点のみを残しています。

## 現在の内容

- Codex CLI ベースのコンテナ内エージェント実行
- `AGENTS.md` ベースの指示・メモリ
- グループごとのセッション分離
- スケジューラ、SQLite、IPC、コンテナ分離

## 削除されたもの

- Claude Agent SDK 依存
- `.claude` ベースの状態管理
- Claude Remote Control
- 旧ホスト側スキル導入フロー

セットアップ、開発、構成の詳細は英語版 README を見てください。
