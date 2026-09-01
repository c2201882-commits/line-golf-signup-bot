const express = require("express");
const line = require("@line/bot-sdk");
const { parseMessage } = require("./parser");
const { applyEntries, getMonth, monthKey } = require("./store");
const { formatSummary, HELP_TEXT, MENU_QUICK_REPLY } = require("./summary");

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const app = express();
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

app.get("/", (_req, res) => res.send("line-golf-signup-bot is running"));

app.post("/webhook", line.middleware(config), async (req, res) => {
  res.status(200).end(); // ack immediately, LINE retries on timeout
  try {
    await Promise.all(req.body.events.map(handleEvent));
  } catch (err) {
    console.error("Error handling events:", err);
  }
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const groupId = event.source.groupId || event.source.roomId || event.source.userId;
  const replyToken = event.replyToken;

  // A bare @mention of the bot with no other text opens the menu.
  const mentionedBot = isBotMentioned(event.message);
  const textWithoutMention = stripMentionText(event.message).trim();

  if (mentionedBot && textWithoutMention === "") {
    return reply(replyToken, "你好！請選擇功能 👇", MENU_QUICK_REPLY);
  }

  const text = textWithoutMention || event.message.text.trim();

  const isHelpCommand = /^(help|說明|教學)$/i.test(text);
  const isQueryCommand = /^(查詢|本月|彙整)$/i.test(text);

  if (isHelpCommand) {
    return reply(replyToken, HELP_TEXT, MENU_QUICK_REPLY);
  }

  if (isQueryCommand) {
    const mKey = monthKey();
    const month = getMonth(groupId, mKey);
    return reply(replyToken, formatSummary(month, mKey), MENU_QUICK_REPLY);
  }

  const entries = parseMessage(text);
  if (entries.length === 0) return; // not a sign-up message, ignore silently

  const mKey = monthKey();
  const month = applyEntries(groupId, entries, mKey);
  return reply(replyToken, formatSummary(month, mKey), MENU_QUICK_REPLY);
}

// LINE tags a mention with a "@" placeholder inside message.text plus a
// message.mention.mentionees array; isSelf is true when the bot itself was tagged.
function isBotMentioned(message) {
  return Boolean(message.mention?.mentionees?.some((m) => m.isSelf));
}

function stripMentionText(message) {
  if (!isBotMentioned(message)) return message.text;
  const mentionees = message.mention.mentionees.filter((m) => m.isSelf);
  let text = message.text;
  // Remove mention spans back-to-front so earlier indices stay valid.
  for (const m of mentionees.sort((a, b) => b.index - a.index)) {
    text = text.slice(0, m.index) + text.slice(m.index + m.length);
  }
  return text;
}

function reply(replyToken, text, quickReply) {
  const message = { type: "text", text };
  if (quickReply) message.quickReply = quickReply;
  return client.replyMessage({
    replyToken,
    messages: [message],
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
