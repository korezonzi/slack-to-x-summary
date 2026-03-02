// normalize-event.js
// Extract and normalize event data from Slack Event API callback

const body = $input.first().json.body;
const event = body.event;
const eventType = event.type;

let channel = null;
let threadTs = null;
let text = null;

if (eventType === "reaction_added") {
  channel = event.item?.channel;
  threadTs = event.item?.ts;
} else if (eventType === "app_mention") {
  channel = event.channel;
  threadTs = event.thread_ts || event.ts;
  text = event.text;
}

return [
  {
    json: {
      event_type: eventType,
      channel,
      thread_ts: threadTs,
      text,
    },
  },
];
