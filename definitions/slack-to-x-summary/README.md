# Code Nodes — slack-to-x-summary

このフォルダは `../slack-to-x-summary.yaml` ワークフロー内の **Code Node スクリプト群**です。
n8n-cli の `externalize_threshold` 設定により、YAML から分離されています。

| ファイル                         | 役割                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| `normalize-event.js`             | Slack Webhook イベントを正規化（`reaction_added` / `app_mention`） |
| `format-thread.js`               | スレッドメッセージを整形（Bot メッセージ除外・マークアップ変換）   |
| `extract-mention-instruction.js` | モデル指定（opus/sonnet/haiku/gpt4o 等）と追加指示を抽出           |
| `build-ai-request.js`            | Anthropic / OpenAI 向けリクエストを構築                            |
| `parse-ai-response.js`           | AI レスポンスを正規化（プロバイダ差異を吸収）                      |
