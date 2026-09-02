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
function setVote(groupId, mKey, dateKey, sessionId, { lineUserId, displayName, count, guestNames }) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = { days: {} };
  const month = data[groupId][mKey];
  const day = ensureDay(month, dateKey);
  const session = ensureSession(day, sessionId);
  const key = lineKey(lineUserId);

  if (!count || count <= 0) {
    delete session.entries[key];
  } else {
    session.entries[key] = { displayName, count, guestNames: guestNames || [], updatedAt: Date.now() };
    pushActivity(data, groupId, { type: "join", displayName, detail: shortDate(dateKey) });
  }

  if (Object.keys(session.entries).length === 0) {
    day.sessions = day.sessions.filter((s) => s.id !== session.id);
  }

  save(data);
  return migrateMonthDays(month);
}

function setSession(groupId, mKey, dateKey, sessionId, { course, teeTime }) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = { days: {} };
  const month = data[groupId][mKey];
  const day = ensureDay(month, dateKey);
  const session = ensureSession(day, sessionId);

  if (course !== undefined) session.course = course;
  if (teeTime !== undefined) session.teeTime = teeTime;

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
// author — enforced here, not just hidden client-side.
function deleteBoardMessage(groupId, messageId, lineUserId) {
  const data = load();
  const board = (data[groupId] && data[groupId].board) || [];
  const message = board.find((m) => m.id === messageId);
  if (!message) return { ok: true, board };
  if (message.lineUserId !== lineUserId) return { ok: false, board };

  data[groupId].board = board.filter((m) => m.id !== messageId);
  save(data);
  return { ok: true, board: data[groupId].board };
}

function setBoardPin(groupId, messageId, lineUserId, pinned) {
  const data = load();
  const board = (data[groupId] && data[groupId].board) || [];
  const message = board.find((m) => m.id === messageId);
  if (!message) return { ok: true, board };
  if (message.lineUserId !== lineUserId) return { ok: false, board };

  message.pinned = !!pinned;
  save(data);
  return { ok: true, board };
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
};
