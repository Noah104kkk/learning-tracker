# セキュリティ方針

このアプリは「データを持たない・送らない」設計です。

## 設計上の保証
| 項目 | 内容 |
|---|---|
| 保存先 | ブラウザの localStorage のみ。サーバー・アカウント・Cookie はありません |
| 外部通信 | なし。Content-Security-Policy（`default-src 'none'`）で、スクリプト・スタイル以外の読み込みと外部接続を禁止 |
| 外部ライブラリ | 実行時は不使用（テスト用の jsdom のみ devDependency）。CDN 読み込みなし |
| XSS対策 | 描画は `textContent` と `createElement(NS)` のみ。`innerHTML`・`eval` を使わない（テストで検査） |
| 入力検証 | 保存データと読み込むJSONは `Store.sanitize` で型・長さ・件数・日付の実在・ID形式を検証 |
| 個人情報 | リポジトリには含まない。サンプルはすべて架空 |

## 公開リポジトリとして守っていること
- 秘密情報（`.env`・鍵・トークン類）と、書き出したデータ（`*.json`）は `.gitignore` で除外
- CI の権限は `contents: read` のみ

## 脆弱性の報告
GitHub の Security タブの「Report a vulnerability」から非公開で連絡してください。
