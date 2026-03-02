// parse-ai-response.js
// Normalize AI API response from Anthropic or OpenAI

const response = $input.first().json;
const aiProviderType = $("AIリクエスト構築").first().json.ai_provider_type;
const aiModelName = $("AIリクエスト構築").first().json.ai_model_name;

let rawText = "";

if (aiProviderType === "anthropic") {
  // Anthropic Messages API: { content: [{ type: "text", text: "..." }] }
  const content = response.content || [];
  const textBlock = content.find((block) => block.type === "text");
  rawText = textBlock?.text || "";
} else if (aiProviderType === "openai") {
  // OpenAI Chat Completions: { choices: [{ message: { content: "..." } }] }
  rawText = response.choices?.[0]?.message?.content || "";
}

// Try to extract JSON from the response
let parsed = null;
try {
  // Handle case where JSON is wrapped in markdown code block
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
  parsed = JSON.parse(jsonStr);
} catch {
  // Fallback: use raw text as x_post_standard
  parsed = {
    x_post_short: "",
    x_post_standard: rawText.trim(),
    hook_type: "N/A",
    engagement_strategy: "N/A",
    hashtags: [],
    removed_items: [],
    post_tip: "",
  };
}

parsed.ai_model_name = aiModelName;

return [{ json: parsed }];
