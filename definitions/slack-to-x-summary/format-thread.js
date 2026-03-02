// format-thread.js
// Format Slack thread messages from conversations.replies API response

const response = $input.first().json;

// conversations.replies returns { ok, messages: [...] }
const replyMessages = response.messages || [];

function convertSlackMarkup(text) {
  // Convert user mentions: <@U123ABC> -> @U123ABC
  text = text.replace(/<@(U[A-Z0-9]+)>/g, "@$1");
  // Convert channel references: <#C123ABC|channel-name> -> #channel-name
  text = text.replace(/<#C[A-Z0-9]+\|([^>]+)>/g, "#$1");
  // Convert channel references without label: <#C123ABC> -> #channel
  text = text.replace(/<#(C[A-Z0-9]+)>/g, "#$1");
  // Convert URLs: <https://example.com|label> -> label
  text = text.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2");
  // Convert URLs without label: <https://example.com> -> https://example.com
  text = text.replace(/<(https?:\/\/[^>]+)>/g, "$1");
  // Convert mailto: <mailto:a@b.com|a@b.com> -> a@b.com
  text = text.replace(/<mailto:[^|>]+\|([^>]+)>/g, "$1");
  // Convert bold/italic/strike
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/_([^_]+)_/g, "$1");
  text = text.replace(/~([^~]+)~/g, "$1");
  return text.trim();
}

// Format messages
const formattedLines = [];
for (const msg of replyMessages) {
  // Exclude bot messages
  if (msg.subtype === "bot_message") continue;
  if (msg.bot_id) continue;
  if (!msg.text) continue;

  const userId = msg.user || "unknown";
  const text = convertSlackMarkup(msg.text);
  if (text) {
    formattedLines.push(`[${userId}] ${text}`);
  }
}

const formattedThread = formattedLines.join("\n");

return [{ json: { formatted_thread: formattedThread } }];
