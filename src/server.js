const path = require("path");
const express = require("express");
const line = require("@line/bot-sdk");
const { parseMessage } = require("./parser");
const {
  applyEntries, getMonth, monthKey, canonicalDate, addSession, setVote, setSession, load, save,
  getBoard, addBoardMessage, deleteBoardMessage, setBoardPin,
} = require("./store");
const { formatSummary, HELP_TEXT, buildMenuQuickReply } = require("./summary");
const { verifyIdToken } = require("./lineAuth");

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const LIFF_ID = process.env.LIFF_ID;
const liffBaseUrl = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null;

function liffUrlForGroup(groupId) {
  if (!liffBaseUrl) return null;
  return `${liffBaseUrl}?groupId=${encodeURIComponent(groupId)}`;
}

const app = express();
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

app.get("/", (_req, res) => res.send("line-golf-signup-bot is running"));

app.use(express.static(path.join(__dirname, "..", "public")));

// ---- LINE Messaging webhook ------------------------------------------------
// Registered BEFORE express.json(): line.middleware() verifies the request
// signature against the raw body, which a prior JSON body-parser would consume.

app.post("/webhook", line.middleware(config), async (req, res) => {
  res.status(200).end(); // ack immediately, LINE retries on timeout
  try {
    await Promise.all(req.body.events.map(handleEvent));
  } catch (err) {
    console.error("Error handling events:", err);
  }
});

// ---- LIFF web app API -----------------------------------------------------
// Every write carries the caller's LIFF id_token; we verify it server-side so
// nobody can submit a sign-up under someone else's name.

app.use(express.json());

app.get("/api/config", (_req, res) => {
  res.json({ liffId: LIFF_ID || null });
});

app.get("/api/state", async (req, res) => {
  const { groupId, month } = req.query;
  if (!groupId || !month) return res.status(400).json({ error: "groupId and month are required" });
  const monthData = getMonth(groupId, month);
  res.json({ days: monthData.days || {} });
});

app.post("/api/session/create", async (req, res) => {
  const { idToken, groupId, month, date, course, teeTime } = req.body || {};
  if (!groupId || !month || !date) return res.status(400).json({ error: "groupId, month, date are required" });

  try {
    await verifyIdToken(idToken); // anyone may open a new session, but must be a real LINE user
  } catch (err) {
    console.error("verifyIdToken failed:", err.message || err);
    return res.status(401).json({ error: "invalid LINE identity", detail: String(err.message || err) });
  }

  const { month: monthData, sessionId } = addSession(groupId, month, date, {
    course: course || "",
    teeTime: teeTime || "",
  });
  res.json({ days: monthData.days, sessionId });
});

app.post("/api/vote", async (req, res) => {
  const { idToken, groupId, month, date, sessionId, count, guestNames } = req.body || {};
  if (!groupId || !month || !date || !sessionId) {
    return res.status(400).json({ error: "groupId, month, date, sessionId are required" });
  }

  let identity;
  try {
    identity = await verifyIdToken(idToken);
  } catch (err) {
    console.error("verifyIdToken failed:", err.message || err);
    return res.status(401).json({ error: "invalid LINE identity", detail: String(err.message || err) });
  }

  const parsedCount = Math.max(0, Math.min(20, parseInt(count, 10) || 0));
  const parsedGuestNames = Array.isArray(guestNames)
    ? guestNames.slice(0, 19).map((n) => String(n || "").trim().slice(0, 30))
    : [];
  const monthData = setVote(groupId, month, date, sessionId, {
    lineUserId: identity.lineUserId,
    displayName: identity.displayName,
    count: parsedCount,
    guestNames: parsedGuestNames,
  });
  res.json({ days: monthData.days });
});

app.post("/api/session", async (req, res) => {
  const { idToken, groupId, month, date, sessionId, course, teeTime } = req.body || {};
  if (!groupId || !month || !date || !sessionId) {
    return res.status(400).json({ error: "groupId, month, date, sessionId are required" });
  }

  try {
    await verifyIdToken(idToken); // anyone in the group may edit course/tee-time, but must be a real LINE user
  } catch (err) {
    console.error("verifyIdToken failed:", err.message || err);
    return res.status(401).json({ error: "invalid LINE identity", detail: String(err.message || err) });
  }

  const monthData = setSession(groupId, month, date, sessionId, { course, teeTime });
  res.json({ days: monthData.days });
});

// ---- Message board ----------------------------------------------------------

app.get("/api/board", (req, res) => {
  const { groupId } = req.query;
  if (!groupId) return res.status(400).json({ error: "groupId is required" });
  res.json({ messages: getBoard(groupId) });
});

app.post("/api/board/post", async (req, res) => {
  const { idToken, groupId, text } = req.body || {};
  if (!groupId || !text || !String(text).trim()) {
    return res.status(400).json({ error: "groupId and text are required" });
  }

  let identity;
  try {
    identity = await verifyIdToken(idToken);
  } catch (err) {
    console.error("verifyIdToken failed:", err.message || err);
    return res.status(401).json({ error: "invalid LINE identity", detail: String(err.message || err) });
  }

  const messages = addBoardMessage(groupId, {
    lineUserId: identity.lineUserId,
    displayName: identity.displayName,
    pictureUrl: identity.pictureUrl,
    text: String(text).trim().slice(0, 500),
  });
  res.json({ messages });
});

app.post("/api/board/delete", async (req, res) => {
  const { idToken, groupId, messageId } = req.body || {};
  if (!groupId || !messageId) return res.status(400).json({ error: "groupId and messageId are required" });

  let identity;
  try {
    identity = await verifyIdToken(idToken);
  } catch (err) {
    console.error("verifyIdToken failed:", err.message || err);
    return res.status(401).json({ error: "invalid LINE identity", detail: String(err.message || err) });
  }

  const result = deleteBoardMessage(groupId, messageId, identity.lineUserId);
  if (!result.ok) return res.status(403).json({ error: "only the author can delete this message" });
  res.json({ messages: result.board });
});

app.post("/api/board/pin", async (req, res) => {
  const { idToken, groupId, messageId, pinned } = req.body || {};
  if (!groupId || !messageId) return res.status(400).json({ error: "groupId and messageId are required" });

  let identity;
  try {
    identity = await verifyIdToken(idToken);
  } catch (err) {
    console.error("verifyIdToken failed:", err.message || err);
    return res.status(401).json({ error: "invalid LINE identity", detail: String(err.message || err) });
  }

  const result = setBoardPin(groupId, messageId, identity.lineUserId, !!pinned);
  if (!result.ok) return res.status(403).json({ error: "only the author can pin this message" });
  res.json({ messages: result.board });
});

// ---- Admin backup/restore --------------------------------------------------
// Render's free plan wipes the filesystem on every deploy. These let us dump
// the whole store before pushing a change and write it back after the new
// deploy is live, so sign-ups survive a code update.

const ADMIN_SECRET = process.env.ADMIN_SECRET;

function checkAdminSecret(req, res) {
  if (!ADMIN_SECRET) {
    res.status(503).json({ error: "ADMIN_SECRET not configured" });
    return false;
  }
  if (req.query.secret !== ADMIN_SECRET && (req.body || {}).secret !== ADMIN_SECRET) {
    res.status(401).json({ error: "invalid secret" });
    return false;
  }
  return true;
}

app.get("/api/admin/backup", (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  res.json(load());
});

app.post("/api/admin/restore", (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  const { data } = req.body || {};
  if (!data || typeof data !== "object") return res.status(400).json({ error: "data object is required" });
  save(data);
  res.json({ ok: true });
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const groupId = event.source.groupId || event.source.roomId || event.source.userId;
  const replyToken = event.replyToken;
  const quickReply = buildMenuQuickReply(liffUrlForGroup(groupId));

  // A bare @mention of the bot with no other text opens the menu.
  const mentionedBot = isBotMentioned(event.message);
  const textWithoutMention = stripMentionText(event.message).trim();

  if (mentionedBot && textWithoutMention === "") {
    return reply(replyToken, "你好！請選擇功能 👇", quickReply);
  }

  const text = textWithoutMention || event.message.text.trim();

  const isHelpCommand = /^(help|說明|教學)$/i.test(text);
  const isQueryCommand = /^(查詢|本月|彙整)$/i.test(text);
  const isSignupCommand = /^(報名|投票)$/i.test(text);

  if (isHelpCommand) {
    return reply(replyToken, HELP_TEXT, quickReply);
  }

  if (isSignupCommand) {
    const url = liffUrlForGroup(groupId);
    return reply(
      replyToken,
      url ? `👉 點這裡開啟報名頁：\n${url}` : "報名頁尚未設定，請聯絡管理員設定 LIFF_ID。",
      quickReply
    );
  }

  if (isQueryCommand) {
    const mKey = monthKey();
    const month = getMonth(groupId, mKey);
    return reply(replyToken, formatSummary(month, mKey, liffUrlForGroup(groupId)), quickReply);
  }

  const entries = parseMessage(text);
  if (entries.length === 0) return; // not a sign-up message, ignore silently

  const mKey = monthKey();
  const month = applyEntries(groupId, entries, mKey, (mdDate) => canonicalDate(mKey, mdDate));
  return reply(replyToken, formatSummary(month, mKey, liffUrlForGroup(groupId)), quickReply);
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
