// extract-mention-instruction.js
// Extract model alias and additional instruction from app_mention text

const MODEL_ALIASES = {
  opus: "anthropic-opus",
  sonnet: "anthropic-sonnet",
  haiku: "anthropic-haiku",
  gpt4o: "openai-gpt4o",
  gpt4omini: "openai-gpt4o-mini",
  gpt: "openai-gpt4o-mini",
};

// Ordered by longest first to avoid partial matches (gpt4omini before gpt4o before gpt)
const ALIAS_PATTERN = /\b(gpt4omini|gpt4o|opus|sonnet|haiku|gpt)\b/i;

const mentionText = $("イベント正規化").first().json.text || "";

// Remove bot mention: <@U12345ABC>
let cleaned = mentionText.replace(/<@U[A-Z0-9]+>/g, "").trim();

// Detect model alias
let modelOverride = null;
const aliasMatch = cleaned.match(ALIAS_PATTERN);
if (aliasMatch) {
  const alias = aliasMatch[1].toLowerCase();
  modelOverride = MODEL_ALIASES[alias] || null;
  // Remove the alias keyword and surrounding particles (で, を, etc.)
  cleaned = cleaned
    .replace(new RegExp(aliasMatch[1] + "[でをは]?", "i"), "")
    .trim();
}

// Remaining text is the additional instruction
const instruction = cleaned.length > 0 ? cleaned : null;

return [
  {
    json: {
      model_override: modelOverride,
      instruction: instruction,
    },
  },
];
