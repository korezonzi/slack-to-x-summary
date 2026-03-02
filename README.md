# Slack → X 要約ワークフロー

Slack チャンネルのスレッドを AI で要約し、X（Twitter）向けの高エンゲージメント投稿文を生成する n8n ワークフロー。

## ディレクトリ構成

```
slack-to-x-summary/
├── definitions/
│   ├── slack-to-x-summary.yaml          # n8n ワークフロー定義（デプロイ対象）
│   └── slack-to-x-summary/              # ワークフロー内 Code Node のスクリプト群
│       ├── normalize-event.js            # イベント正規化（reaction_added / app_mention）
│       ├── format-thread.js              # スレッドメッセージ整形
│       ├── extract-mention-instruction.js # モデル指定・追加指示の抽出
│       ├── build-ai-request.js           # AI リクエスト構築（Anthropic / OpenAI）
│       └── parse-ai-response.js          # AI レスポンス正規化
└── CLAUDE.md                             # 詳細仕様・プロンプト設計・運用ガイド
```

> `definitions/slack-to-x-summary/` は `definitions/slack-to-x-summary.yaml` に対応する外部化コードノードです。
> n8n-cli の `externalize_threshold` 設定により、Code Node が YAML から分離されています。

## トリガー

| トリガー        | 操作                                    | 動作                               |
| --------------- | --------------------------------------- | ---------------------------------- |
| 🐦 リアクション | スレッド親メッセージに 🐦 を付ける      | デフォルトモデル（Opus 4.6）で要約 |
| @bot メンション | `@bot Xにして` とスレッド内でメンション | モデル指定・追加指示に対応         |

**メンション例:**

```
@bot Xにして              → デフォルト (Claude Opus 4.6)
@bot sonnetでXにして       → Claude Sonnet に切替
@bot haiku 短めに          → Claude Haiku + 短縮指示
@bot gpt4oで英語にして     → GPT-4o + 英語指示
```

## デプロイ

```bash
# 環境変数を読み込む
source .env

# 差分確認
./n8n-cli apply --dry-run --yaml -d ./definitions

# デプロイ
./n8n-cli apply --yaml -d ./definitions
```

詳細な仕様・プロンプト設計・Slack App 設定・運用 Tips は [CLAUDE.md](./CLAUDE.md) を参照してください。
