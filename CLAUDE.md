# CLAUDE.md — Slack→X 要約ワークフロー

## n8n-cli Settings

```yaml
default_project: slack-to-x-summary
auto_tags: slack-x-summary
yaml_mode: true
externalize_threshold: 5
```

## プロジェクト概要

Slack チャンネル `#ps-times-fuma` のスレッド内容を AI で要約し、
X（Twitter）向けの高エンゲージメント投稿文を生成して Slack スレッドに返信するワークフロー。
生成されたテキストはユーザーが確認後、手動で X にコピペ投稿する運用。

## アーキテクチャ

```
[Trigger A: 🐦 リアクション] ──→ [n8n Webhook A]
                                         │
[Trigger B: @x要約 メンション] ──→ [n8n Webhook B]
                                         │
                                         ▼
                              [Slack: conversations.replies]
                              スレッド全メッセージ取得
                                         │
                                         ▼
                              [Code Node: format-thread.js]
                              ユーザー名解決 + テキスト整形
                                         │
                                         ▼
                              [Code Node: extract-mention-instruction.js]
                              メンション時: モデル指定 + 追加指示を抽出
                                         │
                                         ▼
                              [Code Node: build-ai-request.js]
                              AI_MODEL_PROVIDER or model_override に応じた
                              リクエスト構築
                                         │
                                         ▼
                              [HTTP Request: AI API]
                              機密フィルタ + X用要約生成
                                         │
                                         ▼
                              [Code Node: parse-ai-response.js]
                              レスポンス正規化
                                         │
                                         ▼
                              [Slack: chat.postMessage]
                              スレッドに要約を返信（使用モデル名を末尾に表示）
```

## トリガー仕様

### A) リアクショントリガー

- 絵文字: 🐦 (bird)
- チャンネル: `#ps-times-fuma`
- Slack Event: `reaction_added`
- スレッド親メッセージの `thread_ts` でスレッド全体を取得
- デフォルトモデル（環境変数 `AI_MODEL_PROVIDER`）を使用

### B) メンショントリガー

- メンション: `@x要約` を含むメッセージ
- Slack Event: `app_mention`
- メンションテキストから **モデル指定** と **追加指示** を抽出

#### メンション例

```
@x要約 Xにして                      → デフォルト (Opus 4.6)
@x要約 sonnetでXにして               → Sonnet に切替
@x要約 haiku 短めに                  → Haiku + 短縮指示
@x要約 gpt4oで英語にして              → GPT-4o + 英語指示
@x要約 スカウトの話だけXにして          → デフォルト + トピック指定
```

#### モデルエイリアス（extract-mention-instruction.js で処理）

| 入力キーワード      | 切替先                     |
| ------------------- | -------------------------- |
| `opus`              | anthropic-opus             |
| `sonnet`            | anthropic-sonnet           |
| `haiku`             | anthropic-haiku            |
| `gpt4o`             | openai-gpt4o               |
| `gpt4omini` / `gpt` | openai-gpt4o-mini          |
| (指定なし)          | 環境変数 AI_MODEL_PROVIDER |

## AI モデル設定

デフォルトは環境変数 `AI_MODEL_PROVIDER` で設定。
メンション時は動的に上書き可能。

| Provider ID                   | モデル                     | エンドポイント                             | 認証ヘッダー                    | 月額概算(30回) |
| ----------------------------- | -------------------------- | ------------------------------------------ | ------------------------------- | -------------- |
| `anthropic-opus` (デフォルト) | claude-opus-4-6-20250515   | https://api.anthropic.com/v1/messages      | `x-api-key: $ANTHROPIC_API_KEY` | ~$0.83 (~¥125) |
| `anthropic-sonnet`            | claude-sonnet-4-5-20250514 | 同上                                       | 同上                            | ~$0.50 (~¥75)  |
| `anthropic-haiku`             | claude-haiku-4-5-20251001  | 同上                                       | 同上                            | ~$0.17 (~¥25)  |
| `openai-gpt4o-mini`           | gpt-4o-mini                | https://api.openai.com/v1/chat/completions | `Bearer $OPENAI_API_KEY`        | ~$0.02 (~¥3)   |
| `openai-gpt4o`                | gpt-4o                     | 同上                                       | 同上                            | ~$0.38 (~¥57)  |

## 環境変数

### ローカル（n8n-cli 用）: ~/dev/slack-to-x-summary/.env

```bash
export N8N_API_URL="https://n8n.srv1258652.hstgr.cloud/api/v1"
export N8N_API_KEY="<n8nのAPIキー>"
```

### サーバー（n8n ランタイム用）: Hostinger Docker Manager → .yaml editor

Hostinger 管理画面 → VPS → Docker Manager → n8n コンテナ → Manage → .yaml editor
既存の `environment:` セクションに追記して Deploy（コンテナ再起動）。

```yaml
environment:
  # --- 既存設定はそのまま残す ---
  # --- ここから追加 ---
  - ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
  - OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
  - AI_MODEL_PROVIDER=anthropic-opus
```

ワークフロー内での参照:

```javascript
// Code Node 内
const apiKey = $env.ANTHROPIC_API_KEY;
const provider = $env.AI_MODEL_PROVIDER;
```

```
// Expression 内（他ノードのフィールド）
{{ $env.ANTHROPIC_API_KEY }}
{{ $env.AI_MODEL_PROVIDER }}
```

動作確認（任意の Code Node で実行）:

```javascript
return {
  provider: $env.AI_MODEL_PROVIDER,
  key_exists: !!$env.ANTHROPIC_API_KEY,
};
// 期待結果: { provider: "anthropic-opus", key_exists: true }
```

注意: Deploy するとコンテナが再起動される（数秒間 n8n 停止）。業務時間外推奨。

## Slack App 設定

### 基本情報

- App名: `x要約`
- Bot Display Name: `x要約`
- Default Username: `x-summary-bot`
- 作成: https://api.slack.com/apps

### 設定手順

1. https://api.slack.com/apps → 「x要約」を選択
2. 左メニュー → Features → **App Home**
   - App Display Name の「Edit」→ Display Name: `x要約` / Default Username: `x-summary-bot` → Save
3. 左メニュー → Features → **OAuth & Permissions**
   - Bot Token Scopes に以下6つを追加:

```
reactions:read
channels:history
groups:history
users:read
chat:write
app_mentions:read
```

4. 左メニュー → Settings → **Install App** → 「Install to Workspace」→ 許可
5. 表示される **Bot User OAuth Token**（`xoxb-xxxx`）をコピー
6. n8n の Credentials に「Slack API」として登録（Bot Token に `xoxb-xxxx` を入力）
7. Slack で `#ps-times-fuma` チャンネルにて `/invite @x要約` で Bot を追加
8. 左メニュー → Features → **Event Subscriptions**
   - Enable Events: ON
   - Request URL: n8n Webhook URL（デプロイ後に設定）
   - Subscribe to bot events に追加:

```
reaction_added
app_mention
```

- Save Changes

### ユーザートークンのスコープ

不要。Bot Token Scopes のみで動作する。

## AI プロンプト仕様

### X アルゴリズム 2026 エンゲージメント重み（プロンプト設計の根拠）

出典: X open-sourced algorithm code, Sprout Social 2026/02/06, PostEverywhere 2026/02/02

| アクション                      | 重み  | いいねの何倍？ |
| ------------------------------- | ----- | -------------- |
| 返信→著者が返信                 | +75   | 150倍          |
| 返信                            | +13.5 | 27倍           |
| プロフィールクリック→エンゲージ | +12.0 | 24倍           |
| ブックマーク                    | +10.0 | 20倍           |
| リポスト（RT）                  | +1.0  | 20倍（簡易式） |
| いいね                          | +0.5  | 1倍（最弱）    |

| ペナルティ              | 影響                  |
| ----------------------- | --------------------- |
| 外部リンク              | 30-50% リーチ減       |
| ハッシュタグ3個以上     | 40% ペナルティ        |
| ネガティブ/攻撃的トーン | Grok 感情分析で配信減 |

| 最適化ポイント            | 根拠                                                           |
| ------------------------- | -------------------------------------------------------------- |
| テキストonly              | 動画より30%高エンゲージ（X唯一のテキスト優位プラットフォーム） |
| 71〜100字                 | 17%高エンゲージ                                                |
| 投稿後1時間以内にリプ対応 | 6時間で半減する時間減衰に対抗                                  |
| 火〜木 AM9:00〜PM3:00     | エンゲージメント最高時間帯                                     |

### システムプロンプト

```text
あなたは X（Twitter）投稿の専門コピーライターです。
Slack スレッドの会話内容を、X でバズる投稿文に変換します。

## 絶対ルール: 機密情報フィルタ
以下を必ず除去または汎化してください:
- 個人のフルネーム → 「あるメンバー」「チームメイト」等
- 年収・給与・オファー金額 → 完全除去
- クライアント企業名・取引先名 → 「あるクライアント」「パートナー企業」等
- 社内評価コメント・人事評価 → 完全除去
- 未公開の事業戦略・数字 → 完全除去
- 社内URL・APIキー・認証情報 → 完全除去

## X エンゲージメント最適化ルール

### 構成（E.H.A. フレームワーク）
1. **Emotional Trigger**: 読み手の感情を動かす要素を入れる
   - 驚き・共感・好奇心・発見のいずれかを冒頭に
2. **Hook**: 最初の1行（〜30字）でスクロールを止める
   - フックパターンを使う（後述）
3. **Action**: リプライ・ブックマーク・リポストを誘発する終わり方

### フックパターン（いずれかを使用）
- 逆張り: 「〇〇って言われるけど、実は△△だった」
- 変化ストーリー: 「前は××だった。今は△△。きっかけは…」
- 具体数字: 「7つの〇〇を見直した結果」
- 好奇心ギャップ: 「ほとんどの人が知らない〇〇」
- タイムリー: 「今週話題の〇〇について整理した」
- 直接呼びかけ: 「〇〇やってる人、これ見て」
- 物語冒頭: 具体的なシーンから始める

### テキスト最適化
- 文字数: 140〜280字（日本語）を目標
  - 短い版（〜140字）と通常版（〜280字）の2パターン生成
- テキストonly前提（画像・リンクなし）
  - X ではテキストonly が動画より30%高エンゲージメント
- 外部リンクは絶対に含めない（30-50%リーチ減ペナルティ）
- ハッシュタグは末尾に1〜2個（3個以上で40%ペナルティ）
  - HR/採用系: #採用 #HR #人事 #スタートアップ #組織づくり から選択
- 改行を効果的に使う（3行以内で読みやすく）

### トーン
- カジュアルだけど専門性がある（Z世代HR担当者の自然な語り口）
- 断定的に言い切る（「〜だと思います」ではなく「〜だ」「〜だった」）
- 自分の体験・学びとして語る（一人称）
- 読み手に問いかけや共感ポイントを入れる

### エンゲージメント誘発テクニック
- ブックマークされる内容にする（参考になるデータ・フレームワーク・知見）
- リプライを誘う問いかけや意見を入れる
  例: 「みんなはどうしてる？」「これ、うちだけ？」
- リポストしたくなる「あるある」「新しい視点」を含める

## 出力形式（JSON）
{
  "x_post_short": "140字以内の短縮版",
  "x_post_standard": "280字以内の標準版",
  "hook_type": "使用したフックパターン名",
  "engagement_strategy": "狙っているエンゲージメント戦略の説明（1文）",
  "hashtags": ["#タグ1", "#タグ2"],
  "removed_items": ["除去した機密情報の概要リスト"],
  "post_tip": "投稿時のアドバイス（例: 返信でリンクを追加、投稿後1時間以内にリプ対応 等）"
}
```

### メンション追加指示の処理

ユーザーが `@x要約 短めに` 等の指示を付けた場合、
システムプロンプトに以下を追記:

```text
ユーザーからの追加指示: {instruction}
この指示に従って出力を調整してください。
```

### メンションでのモデル指定の処理

ユーザーが `@x要約 sonnetでXにして` 等のモデル指定をした場合、
extract-mention-instruction.js がモデルエイリアスを検出し、
build-ai-request.js に `model_override` として渡す。
環境変数 `AI_MODEL_PROVIDER` より優先される。

## ファイル構成

```
~/dev/slack-to-x-summary/
├── .env                          # n8n-cli 用環境変数（API URL, API KEY のみ）
├── CLAUDE.md                     # このファイル
├── n8n-cli -> ~/dev/n8n-cli/n8n-cli  # シンボリックリンク
└── definitions/
    ├── slack-to-x-summary.yaml   # n8n ワークフロー定義
    └── slack-to-x-summary/       # 外部化された Code Node
        ├── format-thread.js      # スレッド整形
        ├── build-ai-request.js   # AIリクエスト構築
        ├── parse-ai-response.js  # AIレスポンス解析
        └── extract-mention-instruction.js  # メンション指示・モデル指定抽出
```

## 各 Code Node の仕様

### format-thread.js

- 入力: Slack conversations.replies のレスポンス配列
- 処理:
  1. 各メッセージの `user` ID を Slack `users.info` で表示名に解決
  2. `[表示名] メッセージ本文` 形式に整形
  3. Bot メッセージ（subtype: bot_message）を除外
  4. Slack のマークアップ（`<@U123>`、`<#C123|name>` 等）をプレーンテキストに変換
- 出力: 改行区切りの整形済みテキスト

### extract-mention-instruction.js

- 入力: Slack app_mention イベントのテキスト
- 処理:
  1. `<@BOT_ID>` 部分を除去
  2. テキスト内のモデルエイリアス（opus/sonnet/haiku/gpt4o/gpt4omini/gpt）を検出
  3. 検出した場合は `model_override` に対応する Provider ID を設定し、テキストからエイリアスを除去
  4. 残りのテキストを追加指示として抽出
  5. 空の場合は `null` を返却
- 出力: `{ model_override: "anthropic-sonnet" | null, instruction: "短めにXにして" | null }`

### build-ai-request.js

- 入力: 整形済みテキスト + model_override（or null）+ 環境変数
- 処理:
  1. モデル決定の優先順位: `model_override` > `$env.AI_MODEL_PROVIDER` > `"anthropic-opus"`（フォールバック）
  2. Provider ID に応じて API URL・ヘッダー・ボディ形式を構築
  3. Anthropic の場合: Messages API 形式、ヘッダーに `x-api-key: $env.ANTHROPIC_API_KEY`
  4. OpenAI の場合: Chat Completions 形式、ヘッダーに `Authorization: Bearer $env.OPENAI_API_KEY`
  5. システムプロンプト（本ファイルの「システムプロンプト」セクション）とユーザーメッセージを設定
  6. メンション追加指示がある場合はプロンプトに追記
- 出力: `{ ai_url, ai_headers, ai_body, ai_provider_type, ai_model_name }` オブジェクト

### parse-ai-response.js

- 入力: AI API のレスポンス
- 処理:
  1. Anthropic / OpenAI のレスポンス形式の違いを吸収
  2. テキスト部分を抽出
  3. JSON をパース
  4. パース失敗時はテキストそのものを `x_post_standard` として返却
- 出力: 正規化された JSON オブジェクト + `ai_model_name`（Slack 返信表示用）

## Slack 返信フォーマット

```
📝 *X用要約（短縮版）*
{x_post_short}

📝 *X用要約（標準版）*
{x_post_standard}

📋 *フック*: {hook_type}
🎯 *戦略*: {engagement_strategy}
💡 *投稿Tips*: {post_tip}

⚠️ *除去した機密情報*: {removed_items をカンマ区切り}
───
🤖 {ai_model_name} | 🐦で再生成 | @x要約 sonnet 等でモデル変更可
```

## ワークフロー YAML 生成ルール

- YAML フォーマット準拠
- ノード名は日本語（例: 「設定値」「スレッド取得」「AI要約」「Slack返信」）
- Slack 操作は n8n 組み込み Slack ノードを使用
- AI API 呼び出しは HTTP Request ノードを使用
  - URL: `{{ $json.ai_url }}`
  - Headers: `{{ $json.ai_headers }}`（Code Node で構築済み）
  - Body: `{{ $json.ai_body }}`
- モデル名をハードコードしない（Code Node で動的に構築）
- API キーは `$env.ANTHROPIC_API_KEY` / `$env.OPENAI_API_KEY` で参照
  - n8n の Credentials は使わない（Hostinger Docker 環境変数で管理）
- credentials は Slack のみ名前参照（「Slack API」）

## デプロイ手順

```bash
# 1. 環境変数読み込み
cd ~/dev/slack-to-x-summary
source .env

# 2. Lint
./n8n-cli lint -d ./definitions

# 3. Dry-run（差分確認）
./n8n-cli apply --dry-run --yaml -d ./definitions

# 4. デプロイ
./n8n-cli apply --yaml -d ./definitions

# 5. ワークフロー確認
./n8n-cli workflow list --tags slack-x-summary

# 6. 有効化
./n8n-cli workflow activate <workflow-id>

# 7. Webhook URL を取得し、Slack App の Event Subscriptions Request URL に設定
```

## テスト方法

### リアクションテスト

1. `#ps-times-fuma` で複数人のやり取りがあるスレッドを選ぶ
2. スレッド親メッセージに 🐦 リアクションを付ける
3. 数秒後、スレッド内に要約が返信されることを確認
4. 機密情報が除去されていることを確認
5. 標準版 or 短縮版を X にコピペして投稿

### メンションテスト

1. 同スレッド内で `@x要約 Xにして` と投稿
2. 要約が返信されることを確認
3. `@x要約 sonnetで短めにXにして` → Sonnet で短縮版が返ること
4. `@x要約 haiku 英語で` → Haiku で英語の要約が返ること

### モデル切替テスト

1. `@x要約 Xにして` → 末尾に `claude-opus-4.6` と表示
2. `@x要約 sonnetでXにして` → 末尾に `claude-sonnet-4.5` と表示
3. `@x要約 haikuでXにして` → 末尾に `claude-haiku-4.5` と表示

## 投稿後のエンゲージメント最大化ガイド（運用Tips）

出典: X open-sourced algorithm, PostEverywhere 2026/02/02, Sprout Social 2026/02/06

1. **投稿後1時間以内にリプライ対応** — 著者返信 = いいねの150倍の重み（+75）
2. **リプに来たらさらに返す** — 会話の深さがアルゴリズム最強シグナル
3. **火〜木の AM9:00〜PM3:00 に投稿** — 日本のHR層が最もアクティブ
4. **外部リンクは返信に貼る** — 本文に入れると30-50%リーチ減
5. **投稿間隔は30〜60分空ける** — 連投ペナルティ回避
6. **ブックマークされる内容を目指す** — いいねの20倍の重み

## トラブルシューティング

### よくある問題

| 症状                           | 原因と対処                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Webhook が反応しない           | Slack App の Event Subscriptions URL が正しいか確認                                |
| スレッドが取得できない         | Bot（x要約）が `#ps-times-fuma` に参加しているか確認                               |
| AI レスポンスが空              | Hostinger .yaml の ANTHROPIC_API_KEY と AI_MODEL_PROVIDER を確認                   |
| `$env` が空 / access denied    | Hostinger Docker Manager で Deploy 済みか確認。YAML のインデント（スペース）を確認 |
| 要約が機密情報を含む           | システムプロンプトの機密フィルタ部分を強化                                         |
| JSON パースエラー              | parse-ai-response.js のフォールバック処理を確認                                    |
| 「ボットユーザーがありません」 | Slack App → App Home で Display Name を設定                                        |
| Bot Token が表示されない       | Slack App → Settings → Install App からインストール                                |

### ログ確認

```bash
./n8n-cli execution list --limit 10
./n8n-cli execution get <execution-id>
```

### 環境変数の確認（Hostinger SSH）

```bash
docker exec -it n8n printenv | grep ANTHROPIC
docker exec -it n8n printenv | grep AI_MODEL
```
