const path = require("path");
const express = require("express");
const line = require("@line/bot-sdk");
const cron = require("node-cron");
const { parseMessage } = require("./parser");
const {
  applyEntries, getMonth, monthKey, canonicalDate, addSession, setVote, setSession, load, save,
  getBoard, addBoardMessage, deleteBoardMessage, setBoardPin, getActivity,
  getStats, getProfiles, getCatalogFor, addCustomTitle, deleteCustomTitle, purchaseItem, equipItem,
  adminDeleteSession, adminAddProxyEntries, adminRemoveProxyEntry,
  buildRosterText, setBroadcastGroupId, getBroadcastGroupId,
  getBroadcastTime, setBroadcastTime, getLastBroadcastDate, setLastBroadcastDate,
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
    pictureUrl: identity.pictureUrl,
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

  let identity;
  try {
    identity = await verifyIdToken(idToken); // anyone in the group may edit course/tee-time, but must be a real LINE user
  } catch (err) {
    console.error("verifyIdToken failed:", err.message || err);
    return res.status(401).json({ error: "invalid LINE identity", detail: String(err.message || err) });
  }

  const monthData = setSession(groupId, month, date, sessionId, { course, teeTime, displayName: identity.displayName });
  res.json({ days: monthData.days });
});

// ---- Message board ----------------------------------------------------------

app.get("/api/activity", (req, res) => {
  const { groupId } = req.query;
  if (!groupId) return res.status(400).json({ error: "groupId is required" });
  res.json({ activity: getActivity(groupId) });
});

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

  const result = deleteBoardMessage(groupId, messageId, identity.lineUserId, identity.displayName);
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

// ---- Stats: honor board + friendship pairs --------------------------------

app.get("/api/stats", (req, res) => {
  const { groupId } = req.query;
  if (!groupId) return res.status(400).json({ error: "groupId is required" });
  res.json(getStats(groupId));
});

// ---- Shop: cosmetic frames/titles bought with points earned from sign-ups --

app.get("/api/profiles", (req, res) => {
  const { groupId } = req.query;
  if (!groupId) return res.status(400).json({ error: "groupId is required" });
  res.json({ profiles: getProfiles(groupId), catalog: getCatalogFor(groupId) });
});

app.post("/api/shop/purchase", async (req, res) => {
  const { idToken, groupId, itemType, itemId } = req.body || {};
  if (!groupId || !itemType || !itemId) return res.status(400).json({ error: "groupId, itemType, itemId are required" });

  let identity;
  try {
    identity = await verifyIdToken(idToken);
  } catch (err) {
    console.error("verifyIdToken failed:", err.message || err);
    return res.status(401).json({ error: "invalid LINE identity", detail: String(err.message || err) });
  }

  const result = purchaseItem(groupId, identity.lineUserId, identity.displayName, itemType, itemId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ profile: result.profile });
});

app.post("/api/shop/equip", async (req, res) => {
  const { idToken, groupId, itemType, itemId } = req.body || {};
  if (!groupId || !itemType || !itemId) return res.status(400).json({ error: "groupId, itemType, itemId are required" });

  let identity;
  try {
    identity = await verifyIdToken(idToken);
  } catch (err) {
    console.error("verifyIdToken failed:", err.message || err);
    return res.status(401).json({ error: "invalid LINE identity", detail: String(err.message || err) });
  }

  const result = equipItem(groupId, identity.lineUserId, identity.displayName, itemType, itemId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ profile: result.profile });
});

// ---- Admin: password-gated, can override the normal per-user rules --------
// A shared password (not tied to any one LINE identity) — fine for a small
// trusted group; every admin route re-checks it independently rather than
// relying on a login session.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

function checkAdminPassword(req, res) {
  if ((req.body || {}).password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "wrong password" });
    return false;
  }
  return true;
}

app.post("/api/admin/login", (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  res.json({ ok: true });
});

app.post("/api/admin/session/delete", (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  const { groupId, month, date, sessionId } = req.body || {};
  if (!groupId || !month || !date || !sessionId) {
    return res.status(400).json({ error: "groupId, month, date, sessionId are required" });
  }
  const monthData = adminDeleteSession(groupId, month, date, sessionId);
  res.json({ days: monthData.days });
});

app.post("/api/admin/session/proxy-add", (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  const { groupId, month, date, sessionId, names } = req.body || {};
  if (!groupId || !month || !date || !Array.isArray(names)) {
    return res.status(400).json({ error: "groupId, month, date, names[] are required" });
  }
  const monthData = adminAddProxyEntries(groupId, month, date, sessionId || null, names.slice(0, 20));
  res.json({ days: monthData.days });
});

app.post("/api/admin/session/proxy-remove", (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  const { groupId, month, date, sessionId, entryKey } = req.body || {};
  if (!groupId || !month || !date || !sessionId || !entryKey) {
    return res.status(400).json({ error: "groupId, month, date, sessionId, entryKey are required" });
  }
  const monthData = adminRemoveProxyEntry(groupId, month, date, sessionId, entryKey);
  res.json({ days: monthData.days });
});

app.post("/api/admin/board/delete", (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  const { groupId, messageId } = req.body || {};
  if (!groupId || !messageId) return res.status(400).json({ error: "groupId and messageId are required" });
  const result = deleteBoardMessage(groupId, messageId, null, "管理員", true);
  res.json({ messages: result.board });
});

app.post("/api/admin/board/pin", (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  const { groupId, messageId, pinned } = req.body || {};
  if (!groupId || !messageId) return res.status(400).json({ error: "groupId and messageId are required" });
  const result = setBoardPin(groupId, messageId, null, !!pinned, true);
  res.json({ messages: result.board });
});

app.post("/api/admin/titles/add", (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  const { groupId, label, price, tier } = req.body || {};
  if (!groupId || !label) return res.status(400).json({ error: "groupId and label are required" });
  const result = addCustomTitle(groupId, { label: String(label).trim().slice(0, 20), price, tier });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ catalog: result.catalog });
});

app.post("/api/admin/titles/delete", (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  const { groupId, id } = req.body || {};
  if (!groupId || !id) return res.status(400).json({ error: "groupId and id are required" });
  const result = deleteCustomTitle(groupId, id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ catalog: result.catalog });
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

// ---- Nightly roster broadcast -----------------------------------------------
// Every day at an admin-configurable time (Asia/Taipei, default 23:59), push
// the same text the "複製名單" button builds to the LINE group. The push
// destination is learned automatically: the webhook records the real LINE
// group id the first time it sees any message there (see handleEvent), since
// the LIFF app itself only ever works with the fixed "default" data
// namespace, not a real LINE group id.
const BROADCAST_APP_GROUP_ID = process.env.BROADCAST_APP_GROUP_ID || "default";

async function sendNightlyRoster() {
  const targetGroupId = getBroadcastGroupId();
  if (!targetGroupId) {
    console.warn("Nightly roster broadcast skipped: no LINE group id captured yet (bot needs to see a message in the group first).");
    return { ok: false, error: "no broadcast group id captured yet" };
  }
  const text = buildRosterText(BROADCAST_APP_GROUP_ID, monthKey(), LIFF_ID);
  await client.pushMessage({ to: targetGroupId, messages: [{ type: "text", text }] });
  return { ok: true, targetGroupId, text };
}

// The broadcast time is stored in the data file (admin-editable from the web
// app), not a fixed cron expression, so checking every minute against it is
// simpler than re-registering a cron job whenever the setting changes.
// lastBroadcastDate guards against firing twice in the same minute-window
// (e.g. a restart right at the target time).
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now).reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const nowHHmm = `${parts.hour}:${parts.minute}`;

    if (nowHHmm === getBroadcastTime() && getLastBroadcastDate() !== today) {
      setLastBroadcastDate(today);
      await sendNightlyRoster();
    }
  } catch (err) {
    console.error("Nightly roster broadcast failed:", err);
  }
});

// Identify which LINE Official Account this deployment's channel access token
// belongs to (displayName/basicId/pictureUrl) — useful when you're not sure
// which bot in your LINE contact list is the one this app is talking to.
app.get("/api/admin/bot-info", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const lineRes = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${config.channelAccessToken}` },
    });
    const data = await lineRes.json();
    if (!lineRes.ok) return res.status(lineRes.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/admin/broadcast-time", (req, res) => {
  res.json({ time: getBroadcastTime() });
});

app.post("/api/admin/broadcast-time", (req, res) => {
  if (!checkAdminPassword(req, res)) return;
  const result = setBroadcastTime((req.body || {}).time);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ time: result.time });
});

// Manual trigger for testing, gated by the same ADMIN_SECRET as backup/restore.
app.post("/api/admin/broadcast-now", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const result = await sendNightlyRoster();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

async function handleEvent(event) {
  // Any event from an actual LINE group tells us its real group id — needed
  // for the nightly roster push, since the LIFF app itself only knows the
  // fixed app-level "default" data namespace, not the real group id.
  if (event.source && event.source.groupId) {
    setBroadcastGroupId(event.source.groupId);
  }

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
    // Read from the LIFF app's actual data namespace, not this chat's own
    // groupId — all real sign-ups live under BROADCAST_APP_GROUP_ID ("default").
    return reply(replyToken, buildRosterText(BROADCAST_APP_GROUP_ID, monthKey(), LIFF_ID), quickReply);
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
