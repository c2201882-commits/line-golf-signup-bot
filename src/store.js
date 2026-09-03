// JSON-file storage, keyed by group and month.
// Shape:
// {
//   "<groupId>": {
//     "2026-10": {
//       days: {
//         "2026-10-03": {
//           sessions: [
//             {
//               id: "s1",
//               course: "長庚",
//               teeTime: "5:50",
//               entries: {
//                 "line:<lineUserId>": { displayName, count, guestNames, updatedAt },
//                 "name:<slug>": { displayName, count, updatedAt }   // legacy text sign-ups with no LINE identity
//               }
//             }
//             // a day can hold more than one session — e.g. a morning and an
//             // afternoon outing on the same date
//           ]
//         }
//       }
//     },
//     board: [ ... ]
//   }
// }

const fs = require("fs");
const path = require("path");

// DATA_DIR points at a mounted persistent disk in production (e.g. Render's
// /var/data) so sign-ups survive restarts; falls back to a local folder for
// development, where the filesystem is already persistent.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "signups.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// mKey: "YYYY-M" (from monthKey()); mdDate: "M/D" (from parser.js). -> "YYYY-MM-DD"
function canonicalDate(mKey, mdDate) {
  const [year] = mKey.split("-");
  const [m, d] = mdDate.split("/");
  return `${year}-${pad(m)}-${pad(d)}`;
}

function nameSlug(name) {
  return "name:" + name.trim().toLowerCase().replace(/\s+/g, "_");
}

function lineKey(lineUserId) {
  return "line:" + lineUserId;
}

function shortDate(dateKey) {
  const [, m, d] = dateKey.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// Appends to data[groupId].activity in place (caller still does load/save).
// Capped so the file doesn't grow forever; the API only ever serves the
// most recent 20 anyway.
function pushActivity(data, groupId, entry) {
  if (!data[groupId]) data[groupId] = {};
  if (!Array.isArray(data[groupId].activity)) data[groupId].activity = [];
  data[groupId].activity.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...entry,
  });
  if (data[groupId].activity.length > 200) {
    data[groupId].activity = data[groupId].activity.slice(-200);
  }
}

function newSessionId() {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// A day used to be a single { course, teeTime, entries } object — one outing
// per date. Upgrade any day still in that shape to { sessions: [...] } in
// place so old data keeps working without a separate migration step.
function migrateDayShape(day) {
  if (day && !Array.isArray(day.sessions)) {
    const legacy = {
      id: "s1",
      course: day.course || "",
      teeTime: day.teeTime || "",
      entries: day.entries || {},
    };
    if (day.max !== undefined) legacy.max = day.max;
    day.sessions = Object.keys(legacy.entries).length || legacy.course || legacy.teeTime ? [legacy] : [];
    delete day.course;
    delete day.teeTime;
    delete day.entries;
    delete day.max;
  }
  return day;
}

function migrateMonthDays(month) {
  Object.keys(month.days || {}).forEach((k) => migrateDayShape(month.days[k]));
  return month;
}

function getMonth(groupId, mKey = monthKey()) {
  const data = load();
  const month = (data[groupId] && data[groupId][mKey]) || { days: {} };
  return migrateMonthDays(month);
}

function ensureDay(month, date) {
  if (!month.days[date]) month.days[date] = { sessions: [] };
  return migrateDayShape(month.days[date]);
}

function ensureSession(day, sessionId) {
  let session = day.sessions.find((s) => s.id === sessionId);
  if (!session) {
    session = { id: sessionId || newSessionId(), course: "", teeTime: "", entries: {} };
    day.sessions.push(session);
  }
  return session;
}

// Legacy text-command entry point: `entries` is the array parser.parseMessage() returns.
// `dateToKey(entry.date)` converts a parsed "9/3" string into the canonical "YYYY-MM-DD" key.
// Text commands always target the day's first (or only) session — they predate multi-session days.
function applyEntries(groupId, entries, mKey, dateToKey) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = { days: {} };
  const month = data[groupId][mKey];

  for (const entry of entries) {
    const dateKey = dateToKey(entry.date);
    const day = ensureDay(month, dateKey);
    const session = day.sessions[0] || ensureSession(day, "s1");

    if (entry.note) session.course = entry.note;
    if (entry.max !== null && entry.max !== undefined) session.max = entry.max;

    for (const name of entry.adds) {
      const key = nameSlug(name);
      session.entries[key] = { displayName: name, count: 1, updatedAt: Date.now() };
    }
    for (const name of entry.removes) {
      delete session.entries[nameSlug(name)];
    }
  }

  save(data);
  return migrateMonthDays(month);
}

// Create a new, empty session ("球局") on a date — used when a day already
// has one outing and someone wants to open a second one (e.g. morning +
// afternoon tee times).
function addSession(groupId, mKey, dateKey, { course, teeTime } = {}) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = { days: {} };
  const month = data[groupId][mKey];
  const day = ensureDay(month, dateKey);

  const session = { id: newSessionId(), course: course || "", teeTime: teeTime || "", entries: {} };
  day.sessions.push(session);

  save(data);
  return { month: migrateMonthDays(month), sessionId: session.id };
}

// Web sign-up entry point: set (or clear, when count <= 0) one person's headcount
// on a specific session. `guestNames` optionally names the extra people this
// person is signing up alongside themselves. Nobody can delete a session
// directly — once everyone has left it (no entries remain), it's removed
// automatically here.
function setVote(groupId, mKey, dateKey, sessionId, { lineUserId, displayName, pictureUrl, count, guestNames }) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = { days: {} };
  const month = data[groupId][mKey];
  const day = ensureDay(month, dateKey);
  const session = ensureSession(day, sessionId);
  const key = lineKey(lineUserId);

  if (!count || count <= 0) {
    const hadEntry = !!session.entries[key];
    delete session.entries[key];
    if (hadEntry) pushActivity(data, groupId, { type: "leave", displayName, detail: shortDate(dateKey) });
  } else {
    session.entries[key] = { displayName, pictureUrl: pictureUrl || null, count, guestNames: guestNames || [], updatedAt: Date.now() };
    pushActivity(data, groupId, { type: "join", displayName, detail: shortDate(dateKey) });
  }

  if (Object.keys(session.entries).length === 0) {
    day.sessions = day.sessions.filter((s) => s.id !== session.id);
  }

  save(data);
  return migrateMonthDays(month);
}

function setSession(groupId, mKey, dateKey, sessionId, { course, teeTime, displayName }) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = { days: {} };
  const month = data[groupId][mKey];
  const day = ensureDay(month, dateKey);
  const session = ensureSession(day, sessionId);

  if (course !== undefined) session.course = course;
  if (teeTime !== undefined) session.teeTime = teeTime;
  pushActivity(data, groupId, { type: "info", displayName, detail: shortDate(dateKey) });

  save(data);
  return migrateMonthDays(month);
}

// ---- message board ---------------------------------------------------------
// Stored per group as data[groupId].board = [{ id, lineUserId, displayName,
// pictureUrl, text, pinned, createdAt }], independent of month.

function getBoard(groupId) {
  const data = load();
  return (data[groupId] && data[groupId].board) || [];
}

function addBoardMessage(groupId, { lineUserId, displayName, pictureUrl, text }) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!Array.isArray(data[groupId].board)) data[groupId].board = [];

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lineUserId,
    displayName,
    pictureUrl: pictureUrl || null,
    text,
    pinned: false,
    createdAt: Date.now(),
  };
  data[groupId].board.push(message);
  pushActivity(data, groupId, { type: "board", displayName });
  save(data);
  return data[groupId].board;
}

// ---- activity feed ----------------------------------------------------------
// The most recent 20 "who did what" events across sign-ups and the board,
// newest first — a lightweight combined feed, not a full audit log.

function getActivity(groupId) {
  const data = load();
  const activity = (data[groupId] && data[groupId].activity) || [];
  return activity.slice(-20).reverse();
}

// Both mutations require the caller's lineUserId to match the message's
// author — enforced here, not just hidden client-side. `asAdmin` (only ever
// set by the password-gated admin routes) bypasses the author check.
function deleteBoardMessage(groupId, messageId, lineUserId, displayName, asAdmin) {
  const data = load();
  const board = (data[groupId] && data[groupId].board) || [];
  const message = board.find((m) => m.id === messageId);
  if (!message) return { ok: true, board };
  if (!asAdmin && message.lineUserId !== lineUserId) return { ok: false, board };

  data[groupId].board = board.filter((m) => m.id !== messageId);
  pushActivity(data, groupId, { type: "board_delete", displayName: displayName || "管理員" });
  save(data);
  return { ok: true, board: data[groupId].board };
}

function setBoardPin(groupId, messageId, lineUserId, pinned, asAdmin) {
  const data = load();
  const board = (data[groupId] && data[groupId].board) || [];
  const message = board.find((m) => m.id === messageId);
  if (!message) return { ok: true, board };
  if (!asAdmin && message.lineUserId !== lineUserId) return { ok: false, board };

  message.pinned = !!pinned;
  save(data);
  return { ok: true, board };
}

// Admin-only: remove any session regardless of who's in it (normal users can
// only ever reach 0 participants, which auto-removes a session — see
// setVote above; this is the one direct "delete" path, gated by password in
// server.js, not exposed on the regular /api/session* routes).
function adminDeleteSession(groupId, mKey, dateKey, sessionId) {
  const data = load();
  const month = data[groupId] && data[groupId][mKey];
  const day = month && month.days[dateKey];
  if (day) {
    migrateDayShape(day);
    day.sessions = day.sessions.filter((s) => s.id !== sessionId);
    save(data);
  }
  return month ? migrateMonthDays(month) : { days: {} };
}

// ---- stats: honor board + friendship pairs ---------------------------------
// Derived read-only from every session across every month for this group —
// nothing extra is stored. "count" here means "times signed up", not
// verified attendance (we have no separate check-in step).

function isMonthKey(key) {
  return /^\d{4}-\d{1,2}$/.test(key);
}

function collectAllSessions(groupId) {
  const data = load();
  const groupData = data[groupId] || {};
  const sessions = [];
  Object.keys(groupData).forEach((key) => {
    if (!isMonthKey(key)) return;
    const month = groupData[key];
    Object.keys(month.days || {}).forEach((dateKey) => {
      const day = month.days[dateKey];
      migrateDayShape(day);
      (day.sessions || []).forEach((session) => sessions.push(session));
    });
  });
  return sessions;
}

function getStats(groupId) {
  const sessions = collectAllSessions(groupId);
  const counts = {}; // lineUserId -> { displayName, count }
  const pairCounts = {}; // "idA|idB" (idA < idB) -> { aId, bId, aName, bName, count }

  sessions.forEach((session) => {
    const participants = Object.entries(session.entries || {})
      .filter(([key]) => key.startsWith("line:"))
      .map(([key, e]) => ({ id: key.slice(5), displayName: e.displayName, pictureUrl: e.pictureUrl || null }));

    participants.forEach((p) => {
      if (!counts[p.id]) counts[p.id] = { displayName: p.displayName, pictureUrl: p.pictureUrl, count: 0 };
      counts[p.id].count += 1;
      counts[p.id].displayName = p.displayName;
      if (p.pictureUrl) counts[p.id].pictureUrl = p.pictureUrl;
    });

    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const [a, b] = [participants[i], participants[j]].sort((x, y) => (x.id < y.id ? -1 : 1));
        const key = `${a.id}|${b.id}`;
        if (!pairCounts[key]) {
          pairCounts[key] = {
            aId: a.id, bId: b.id, aName: a.displayName, bName: b.displayName,
            aPictureUrl: a.pictureUrl, bPictureUrl: b.pictureUrl, count: 0,
          };
        }
        pairCounts[key].count += 1;
        pairCounts[key].aName = a.displayName;
        pairCounts[key].bName = b.displayName;
        if (a.pictureUrl) pairCounts[key].aPictureUrl = a.pictureUrl;
        if (b.pictureUrl) pairCounts[key].bPictureUrl = b.pictureUrl;
      }
    }
  });

  const leaderboard = Object.entries(counts)
    .map(([lineUserId, v]) => ({ lineUserId, displayName: v.displayName, pictureUrl: v.pictureUrl || null, count: v.count }))
    .sort((a, b) => b.count - a.count);

  const pairs = Object.values(pairCounts).sort((a, b) => b.count - a.count);

  return { leaderboard, pairs };
}

// ---- shop: cosmetic frames/titles bought with points earned from sign-ups --
// Points are never stored directly — always recomputed as
// (join count so far) * POINTS_PER_JOIN - spentPoints, so there's nothing to
// desync if a session later gets removed.

const POINTS_PER_JOIN = 10;

// `tier` (1-5, grey/green/blue/purple/gold) drives that item's color
// everywhere in the UI — every catalog entry, built-in or admin-added,
// carries one so nothing needs a separate hardcoded id->color map.
const SHOP_CATALOG = {
  frames: [
    { id: "grey", label: "灰框", price: 0, tier: 1 },
    { id: "green", label: "綠框", price: 50, tier: 2 },
    { id: "blue", label: "藍框", price: 100, tier: 3 },
    { id: "purple", label: "紫框", price: 150, tier: 4 },
    { id: "gold", label: "金框", price: 250, tier: 5 },
  ],
  titles: [
    { id: "newbie", label: "新手上路", price: 0, tier: 1 },
    { id: "earlybird", label: "早鳥常客", price: 60, tier: 1 },
    { id: "rising_star", label: "球場新星", price: 100, tier: 2 },
    { id: "swingking", label: "揮桿好手", price: 140, tier: 2 },
    { id: "champion", label: "常勝軍", price: 180, tier: 3 },
    { id: "overlord", label: "球場霸主", price: 220, tier: 3 },
    { id: "hole_in_one", label: "一桿進洞王", price: 260, tier: 4 },
    { id: "swing_god", label: "揮桿之神", price: 320, tier: 4 },
    { id: "legend", label: "球場傳說", price: 380, tier: 5 },
    { id: "golf_emperor", label: "高爾夫皇者", price: 450, tier: 5 },
    { id: "immortal", label: "不朽傳奇", price: 550, tier: 5 },
  ],
};

function ensureProfile(data, groupId, lineUserId, displayName) {
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId].profiles) data[groupId].profiles = {};
  if (!data[groupId].profiles[lineUserId]) {
    data[groupId].profiles[lineUserId] = {
      displayName,
      spentPoints: 0,
      unlocked: { frames: ["grey"], titles: ["newbie"] },
      equipped: { frame: "grey", title: "newbie" },
    };
  }
  data[groupId].profiles[lineUserId].displayName = displayName;
  return data[groupId].profiles[lineUserId];
}

function earnedPoints(groupId, lineUserId) {
  const { leaderboard } = getStats(groupId);
  const mine = leaderboard.find((l) => l.lineUserId === lineUserId);
  return (mine ? mine.count : 0) * POINTS_PER_JOIN;
}

// Groups can grow their own title catalog via the admin panel (frames stay
// fixed) — data[groupId].customTitles, merged on top of the built-in list.
function getCatalogFor(groupId) {
  const data = load();
  const customTitles = (data[groupId] && data[groupId].customTitles) || [];
  return { frames: SHOP_CATALOG.frames, titles: SHOP_CATALOG.titles.concat(customTitles) };
}

// The id is an internal key only (never shown to the admin) — generated here
// so the admin form only has to ask for the things that actually matter:
// name, price, color tier.
function addCustomTitle(groupId, { label, price, tier }) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!Array.isArray(data[groupId].customTitles)) data[groupId].customTitles = [];

  const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  data[groupId].customTitles.push({
    id,
    label,
    price: Math.max(0, Number(price) || 0),
    tier: Math.min(5, Math.max(1, Number(tier) || 1)),
  });
  save(data);
  return { ok: true, catalog: getCatalogFor(groupId) };
}

// Only removes admin-added titles — the built-in catalog is fixed in code.
// Anyone with it equipped just falls back to no title (titleLabelFor finds
// no matching catalog entry and renders nothing) rather than erroring.
function deleteCustomTitle(groupId, id) {
  const data = load();
  const customTitles = (data[groupId] && data[groupId].customTitles) || [];
  if (!customTitles.some((t) => t.id === id)) return { ok: false, error: "not found" };

  data[groupId].customTitles = customTitles.filter((t) => t.id !== id);
  save(data);
  return { ok: true, catalog: getCatalogFor(groupId) };
}

// Public: every member's equipped look + available points, keyed by lineUserId.
function getProfiles(groupId) {
  const data = load();
  const profiles = (data[groupId] && data[groupId].profiles) || {};
  const { leaderboard } = getStats(groupId);
  const result = {};
  Object.keys(profiles).forEach((id) => {
    const earned = (leaderboard.find((l) => l.lineUserId === id)?.count || 0) * POINTS_PER_JOIN;
    result[id] = { ...profiles[id], points: earned - profiles[id].spentPoints };
  });
  return result;
}

function purchaseItem(groupId, lineUserId, displayName, itemType, itemId) {
  const catalog = getCatalogFor(groupId)[itemType];
  const item = catalog && catalog.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: "unknown item" };

  const data = load();
  const profile = ensureProfile(data, groupId, lineUserId, displayName);
  if (profile.unlocked[itemType].includes(itemId)) return { ok: true, profile };

  const available = earnedPoints(groupId, lineUserId) - profile.spentPoints;
  if (available < item.price) return { ok: false, error: "not enough points" };

  profile.spentPoints += item.price;
  profile.unlocked[itemType].push(itemId);
  save(data);
  return { ok: true, profile };
}

function equipItem(groupId, lineUserId, displayName, itemType, itemId) {
  const data = load();
  const profile = ensureProfile(data, groupId, lineUserId, displayName);
  if (!profile.unlocked[itemType] || !profile.unlocked[itemType].includes(itemId)) {
    return { ok: false, error: "not unlocked" };
  }
  profile.equipped[itemType] = itemId;
  save(data);
  return { ok: true, profile };
}

module.exports = {
  load,
  save,
  monthKey,
  canonicalDate,
  getMonth,
  applyEntries,
  addSession,
  setVote,
  setSession,
  nameSlug,
  lineKey,
  getBoard,
  addBoardMessage,
  deleteBoardMessage,
  setBoardPin,
  getActivity,
  getStats,
  getProfiles,
  getCatalogFor,
  addCustomTitle,
  deleteCustomTitle,
  purchaseItem,
  equipItem,
  adminDeleteSession,
  SHOP_CATALOG,
};
