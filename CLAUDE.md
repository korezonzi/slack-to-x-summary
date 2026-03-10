# CLAUDE.md — Slack→X 要約ワークフロー

## n8n-cli Settings

```yaml
default_project: slack-to-x-summary
auto_tags: slack-x-summary
yaml_mode: true
externalize_threshold: 5
```

## プロジェクト概要

Slack チャンネルのスレッド内容を AI で要約し、
X（Twitter）向けの高エンゲージメント投稿文を生成して Slack スレッドに返信するワークフロー。
生成されたテキストはユーザーが確認後、手動で X にコピペ投稿する運用。

## アーキテクチャ

```
[Trigger A: 🐦 リアクション] ──→ [n8n Webhook]
                                         │
[Trigger B: @bot メンション] ──→ [n8n Webhook]
                                         │
                                         ▼
                              [HTTP Request: conversations.replies]
                              スレッド全メッセージ取得
                                         │
                                         ▼
                              [Code Node: format-thread.js]
                              テキスト整形（user ID + メッセージ）
                                         │
                                         ▼
                              [Code Node: extract-mention-instruction.js]
                              メンション時: モデル指定 + 追加指示を抽出
                                         │
                                         ▼
                              [Code Node: build-ai-request.js]
                              model_override に応じたリクエスト構築
                                         │
                                         ▼
                              [IF: プロバイダ判定]
                              ├─ Anthropic → [HTTP Request: Anthropic API]
                              └─ OpenAI   → [HTTP Request: OpenAI API]
                                         │
                                         ▼
                              [Code Node: parse-ai-response.js]
                              レスポンス正規化
                                         │
                                         ▼
                              [HTTP Request: chat.postMessage]
                              スレッドに要約を返信（使用モデル名を末尾に表示）
```

## トリガー仕様

### A) リアクショントリガー

- 絵文字: 🐦 (bird)
- チャンネル: 対象の Slack チャンネル
- Slack Event: `reaction_added`
- スレッド親メッセージの `thread_ts` でスレッド全体を取得
- デフォルトモデル（フォールバック: `anthropic-opus`）を使用

### B) メンショントリガー

- メンション: Bot をメンションするメッセージ
- Slack Event: `app_mention`
- メンションテキストから **モデル指定** と **追加指示** を抽出

#### メンション例

```
@bot Xにして                      → デフォルト (Opus 4.6)
@bot sonnetでXにして               → Sonnet に切替
@bot haiku 短めに                  → Haiku + 短縮指示
@bot gpt4oで英語にして              → GPT-4o + 英語指示
@bot スカウトの話だけXにして          → デフォルト + トピック指定
```

#### モデルエイリアス（extract-mention-instruction.js で処理）

| 入力キーワード      | 切替先                          |
| ------------------- | ------------------------------- |
| `opus`              | anthropic-opus                  |
| `sonnet`            | anthropic-sonnet                |
| `haiku`             | anthropic-haiku                 |
| `gpt4o`             | openai-gpt4o                    |
| `gpt4omini` / `gpt` | openai-gpt4o-mini               |
| (指定なし)          | フォールバック (anthropic-opus) |

## AI モデル設定

デフォルトは `anthropic-opus`（フォールバック）。
メンション時は動的に上書き可能。

| Provider ID                   | モデル                     | エンドポイント                             |
| ----------------------------- | -------------------------- | ------------------------------------------ |
| `anthropic-opus` (デフォルト) | claude-opus-4-6            | https://api.anthropic.com/v1/messages      |
| `anthropic-sonnet`            | claude-sonnet-4-5-20250929 | 同上                                       |
| `anthropic-haiku`             | claude-haiku-4-5-20251001  | 同上                                       |
| `openai-gpt4o-mini`           | gpt-4o-mini                | https://api.openai.com/v1/chat/completions |
| `openai-gpt4o`                | gpt-4o                     | 同上                                       |

認証は n8n の predefinedCredentialType（`anthropicApi`, `openAiApi`, `slackApi`）で管理。

## 環境変数

### ローカル（n8n-cli 用）: .env

```bash
export N8N_API_URL="https://your-n8n-instance.example.com/api/v1"
export N8N_API_KEY="<your-n8n-api-key>"
```

### サーバー（n8n ランタイム用）

n8n サーバーの環境変数に以下を設定:

```yaml
environment:
  - ANTHROPIC_API_KEY=<your-anthropic-api-key>
  - OPENAI_API_KEY=<your-openai-api-key>
  - AI_MODEL_PROVIDER=anthropic-opus
```

> **注意**: 現在のデプロイでは `$env` がブロックされているため、環境変数ではなく n8n Credentials と build-ai-request.js のフォールバック定数でモデルを管理しています。

## Slack App 設定

### 基本情報

- App名: 任意（例: `x要約`）
- Bot Display Name: 任意
- 作成: https://api.slack.com/apps

### 必要な Bot Token Scopes

```
reactions:read
channels:history
groups:history
users:read
chat:write
app_mentions:read
```

### Event Subscriptions

Subscribe to bot events:

```
reaction_added
app_mention
```

Request URL には n8n Webhook URL を設定。

### セットアップ手順

1. Slack App を作成し、上記の Bot Token Scopes を追加
2. Workspace にインストールして Bot User OAuth Token を取得
3. n8n の Credentials に Slack API として登録
4. 対象チャンネルに Bot を招待（`/invite @botname`）
5. Event Subscriptions で Webhook URL を設定

## AI プロンプト仕様

### X アルゴリズム エンゲージメント重み（プロンプト設計の根拠）

出典: X open-sourced algorithm code, Sprout Social, PostEverywhere

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

ユーザーが `@bot 短めに` 等の指示を付けた場合、
システムプロンプトに以下を追記:

```text
ユーザーからの追加指示: {instruction}
この指示に従って出力を調整してください。
```

### メンションでのモデル指定の処理

ユーザーがモデル名を含めてメンションした場合、
extract-mention-instruction.js がモデルエイリアスを検出し、
build-ai-request.js に `model_override` として渡す。
フォールバックの `anthropic-opus` より優先される。

## ファイル構成

```
.
├── .env                          # n8n-cli 用環境変数（API URL, API KEY）
├── CLAUDE.md                     # このファイル
├── n8n-cli                       # n8n-cli へのシンボリックリンク
└── definitions/
    ├── slack-to-x-summary.yaml   # n8n ワークフロー定義
    └── slack-to-x-summary/       # 外部化された Code Node
        ├── normalize-event.js    # イベント正規化
        ├── format-thread.js      # スレッド整形
        ├── extract-mention-instruction.js  # メンション指示・モデル指定抽出
        ├── build-ai-request.js   # AIリクエスト構築
        └── parse-ai-response.js  # AIレスポンス解析
```

## 各 Code Node の仕様

### normalize-event.js

- 入力: Slack Webhook イベント（`reaction_added` / `app_mention` / その他）
- 処理: イベントタイプに応じて `channel`, `thread_ts`, `event_type` を正規化
- 出力: `{ channel, thread_ts, event_type }` or null（対象外イベント）

### format-thread.js

- 入力: Slack `conversations.replies` API のレスポンス
- 処理:
  1. `response.messages` 配列からメッセージを取得
  2. Bot メッセージ（`subtype: bot_message` / `bot_id` 存在）を除外
  3. Slack マークアップ（`<@U123>`、`<#C123|name>` 等）をプレーンテキストに変換
  4. `[userId] メッセージ本文` 形式に整形
- 出力: `{ formatted_thread: "改行区切りの整形済みテキスト" }`

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

- 入力: 整形済みテキスト + model_override（or null）
- 処理:
  1. モデル決定の優先順位: `model_override` > フォールバック (`anthropic-opus`)
  2. Provider ID に応じて API URL・ボディ形式を構築
  3. Anthropic の場合: Messages API 形式
  4. OpenAI の場合: Chat Completions 形式
  5. システムプロンプトとユーザーメッセージを設定
  6. メンション追加指示がある場合はプロンプトに追記
- 出力: `{ ai_url, ai_body, ai_provider_type, ai_model_name }`
- 認証: n8n の predefinedCredentialType で管理（コード内では不要）

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
🤖 {ai_model_name} | 🐦で再生成 | @bot sonnet 等でモデル変更可
```

## ワークフロー YAML 生成ルール

- YAML フォーマット準拠
- ノード名は日本語（例: 「スレッド取得」「AIレスポンス解析」「Slack返信」）
- Slack API 呼び出しは HTTP Request ノードを使用（n8n Slack ノードの制約回避のため）
  - `conversations.replies`: スレッド取得
  - `chat.postMessage`: スレッド返信（`thread_ts` を JSON body に含める）
- AI API 呼び出しは HTTP Request ノードを使用
  - Anthropic / OpenAI を IF ノードで分岐
- モデル名をハードコードしない（Code Node で動的に構築）
- 認証は n8n の `predefinedCredentialType` で管理（`anthropicApi`, `openAiApi`, `slackApi`）

## 本番ワークフロー情報

| 項目           | 値                 |
| -------------- | ------------------ |
| ワークフローID | `g2do0vq62tGgIown` |
| 名前           | Slack→X要約Bot     |
| 状態           | Active             |
| Webhook パス   | `slack-events`     |

> **注意**: `definitions/slack-to-x-summary.yaml` の `id: "1LBtEbOeefaECCXo"` は別の非アクティブなワークフロー。
> `n8n-cli apply` でデプロイすると新規ワークフローが増殖するため、Code Node の更新は必ず REST API 直接呼び出しで行う。

## デプロイ手順

### Code Node を更新する場合（通常の手順）

`n8n-cli apply` は HTTP 400 エラー ("request/body must NOT have additional properties") で動作しないため、n8n REST API を直接呼び出す。

```bash
source .env

python3 << 'EOF'
import json, ssl, urllib.request, os

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

api_url = os.environ['N8N_API_URL']
api_key = os.environ['N8N_API_KEY']
workflow_id = 'g2do0vq62tGgIown'  # 本番ワークフローID

# ワークフロー取得
req = urllib.request.Request(
    f"{api_url}/workflows/{workflow_id}",
    headers={"X-N8N-API-KEY": api_key}
)
with urllib.request.urlopen(req, context=ctx) as resp:
    workflow = json.loads(resp.read())

# 更新したい Code Node の jsCode を書き換える
# 例: normalize-event の更新
with open('definitions/slack-to-x-summary/normalize-event.js', 'r') as f:
    js_code = f.read()
for node in workflow['nodes']:
    if node['id'] == 'normalize-event':
        node['parameters']['jsCode'] = js_code
        break

# PUT（許可フィールドのみ: name/nodes/connections/settings）
payload = {
    'name': workflow['name'],
    'nodes': workflow['nodes'],
    'connections': workflow['connections'],
    'settings': workflow.get('settings', {}),
}
body = json.dumps(payload).encode('utf-8')
req = urllib.request.Request(
    f"{api_url}/workflows/{workflow_id}",
    data=body,
    headers={"X-N8N-API-KEY": api_key, "Content-Type": "application/json"},
    method="PUT"
)
with urllib.request.urlopen(req, context=ctx) as resp:
    result = json.loads(resp.read())
    print(f"Updated: {result['name']} (updatedAt: {result['updatedAt']})")
EOF
```

> **n8n REST API の PUT 制約**: `name`, `nodes`, `connections`, `settings` の 4 フィールドのみ受け付ける。
> `id`, `active`, `createdAt`, `updatedAt` 等を含めると 400 エラーになる。

### Lint と差分確認（参考用）

```bash
source .env
./n8n-cli lint -d ./definitions
./n8n-cli apply --dry-run --yaml -d ./definitions  # 差分確認のみ（applyは動作しない）
```

### ワークフローの有効化確認

```bash
source .env
./n8n-cli workflow list 2>&1 | grep "Slack→X要約Bot"
```

## テスト方法

### リアクションテスト

1. 対象チャンネルで複数人のやり取りがあるスレッドを選ぶ
2. スレッド親メッセージに 🐦 リアクションを付ける
3. 数秒後、スレッド内に要約が返信されることを確認
4. 機密情報が除去されていることを確認
5. 標準版 or 短縮版を X にコピペして投稿

### メンションテスト

1. 同スレッド内で `@bot Xにして` と投稿
2. 要約が返信されることを確認
3. `@bot sonnetで短めにXにして` → Sonnet で短縮版が返ること
4. `@bot haiku 英語で` → Haiku で英語の要約が返ること

### モデル切替テスト

1. `@bot Xにして` → 末尾に `claude-opus-4.6` と表示
2. `@bot sonnetでXにして` → 末尾に `claude-sonnet-4.5` と表示
3. `@bot haikuでXにして` → 末尾に `claude-haiku-4.5` と表示

## 投稿後のエンゲージメント最大化ガイド（運用Tips）

出典: X open-sourced algorithm, PostEverywhere, Sprout Social

1. **投稿後1時間以内にリプライ対応** — 著者返信 = いいねの150倍の重み（+75）
2. **リプに来たらさらに返す** — 会話の深さがアルゴリズム最強シグナル
3. **火〜木の AM9:00〜PM3:00 に投稿** — 日本のHR層が最もアクティブ
4. **外部リンクは返信に貼る** — 本文に入れると30-50%リーチ減
5. **投稿間隔は30〜60分空ける** — 連投ペナルティ回避
6. **ブックマークされる内容を目指す** — いいねの20倍の重み

## トラブルシューティング

### よくある問題

| 症状                                                                 | 原因と対処                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Webhook が反応しない                                                 | Slack App の Event Subscriptions URL が正しいか確認                                |
| スレッドが取得できない                                               | Bot が対象チャンネルに参加しているか確認                                           |
| AI レスポンスが空                                                    | n8n サーバーの環境変数（API キー）を確認                                           |
| `$env` が空 / access denied                                          | n8n サーバーで環境変数がデプロイ済みか確認                                         |
| 要約が機密情報を含む                                                 | システムプロンプトの機密フィルタ部分を強化                                         |
| JSON パースエラー                                                    | parse-ai-response.js のフォールバック処理を確認                                    |
| 「ボットユーザーがありません」                                       | Slack App → App Home で Display Name を設定                                        |
| Bot Token が表示されない                                             | Slack App → Settings → Install App からインストール                                |
| `n8n-cli apply` が HTTP 400 で失敗する                               | `n8n-cli apply` は動作しない。デプロイ手順の REST API 直接呼び出しを使うこと       |
| `n8n-cli apply` で "request/body must have required property 'name'" | n8n API の PUT 制約。許可フィールド（name/nodes/connections/settings）のみ送信する |
| どのスタンプでもボットが起動する                                     | normalize-event.js の bird フィルタが本番に未反映。REST API で直接デプロイすること |
| `workflow list --tags slack-x-summary` が空を返す                    | 本番ワークフロー `g2do0vq62tGgIown` にタグが付いていない。`workflow list` で確認   |

### ログ確認

```bash
./n8n-cli execution list --limit 10
./n8n-cli execution get <execution-id>
```
