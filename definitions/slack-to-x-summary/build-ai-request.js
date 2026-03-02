// build-ai-request.js
// Build AI API request based on provider (Anthropic / OpenAI)
// Auth headers are handled by n8n credentials, not this code node.

const PROVIDER_CONFIG = {
  "anthropic-opus": {
    type: "anthropic",
    model: "claude-opus-4-6",
    displayName: "claude-opus-4.6",
    url: "https://api.anthropic.com/v1/messages",
  },
  "anthropic-sonnet": {
    type: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    displayName: "claude-sonnet-4.5",
    url: "https://api.anthropic.com/v1/messages",
  },
  "anthropic-haiku": {
    type: "anthropic",
    model: "claude-haiku-4-5-20251001",
    displayName: "claude-haiku-4.5",
    url: "https://api.anthropic.com/v1/messages",
  },
  "openai-gpt4o-mini": {
    type: "openai",
    model: "gpt-4o-mini",
    displayName: "gpt-4o-mini",
    url: "https://api.openai.com/v1/chat/completions",
  },
  "openai-gpt4o": {
    type: "openai",
    model: "gpt-4o",
    displayName: "gpt-4o",
    url: "https://api.openai.com/v1/chat/completions",
  },
};

const FALLBACK_PROVIDER = "anthropic-opus";

const SYSTEM_PROMPT = `あなたは X（Twitter）投稿の専門コピーライターです。
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
}`;

// Inputs
const formattedThread = $("スレッド整形").first().json.formatted_thread;
const mentionData = $("メンション指示抽出").first().json;
const modelOverride = mentionData.model_override || null;
const instruction = mentionData.instruction || null;

// Determine provider: model_override > fallback ($env is blocked on this instance)
const providerId = modelOverride || FALLBACK_PROVIDER;

const config =
  PROVIDER_CONFIG[providerId] || PROVIDER_CONFIG[FALLBACK_PROVIDER];

// Build system prompt with optional user instruction
let systemPrompt = SYSTEM_PROMPT;
if (instruction) {
  systemPrompt += `\n\nユーザーからの追加指示: ${instruction}\nこの指示に従って出力を調整してください。`;
}

const userMessage = `以下の Slack スレッドの会話内容を、X 用の投稿文に変換してください。JSON形式で出力してください。\n\n${formattedThread}`;

let aiBody = {};

if (config.type === "anthropic") {
  aiBody = {
    model: config.model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
} else if (config.type === "openai") {
  aiBody = {
    model: config.model,
    max_tokens: 2048,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };
}

return [
  {
    json: {
      ai_url: config.url,
      ai_body: aiBody,
      ai_provider_type: config.type,
      ai_model_name: config.displayName,
    },
  },
];
