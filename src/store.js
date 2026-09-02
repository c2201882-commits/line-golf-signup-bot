// JSON-file storage, keyed by group and month.
// Shape:
// {
//   "<groupId>": {
//     "2026-10": {
//       days: {
//         "2026-10-03": {
//           course: "長庚",
//           teeTime: "5:50",
//           entries: {
//             "line:<lineUserId>": { displayName, count, updatedAt },
//             "name:<slug>": { displayName, count, updatedAt }   // legacy text sign-ups with no LINE identity
//           }
//         }
//       }
//     }
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

function getMonth(groupId, mKey = monthKey()) {
  const data = load();
  return (data[groupId] && data[groupId][mKey]) || { days: {} };
}

function ensureDay(month, date) {
  if (!month.days[date]) month.days[date] = { course: "", teeTime: "", entries: {} };
  return month.days[date];
}

// Legacy text-command entry point: `entries` is the array parser.parseMessage() returns.
// `dateToKey(entry.date)` converts a parsed "9/3" string into the canonical "YYYY-MM-DD" key.
function applyEntries(groupId, entries, mKey, dateToKey) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = { days: {} };
  const month = data[groupId][mKey];

  for (const entry of entries) {
    const dateKey = dateToKey(entry.date);
    const day = ensureDay(month, dateKey);

    if (entry.note) day.course = entry.note;
    if (entry.max !== null && entry.max !== undefined) day.max = entry.max;

    for (const name of entry.adds) {
      const key = nameSlug(name);
      day.entries[key] = { displayName: name, count: 1, updatedAt: Date.now() };
    }
    for (const name of entry.removes) {
      delete day.entries[nameSlug(name)];
    }
  }

  save(data);
  return month;
}

// Web sign-up entry point: set (or clear, when count <= 0) one person's headcount for a date.
// `guestNames` optionally names the extra people this person is signing up alongside themselves.
function setVote(groupId, mKey, dateKey, { lineUserId, displayName, count, guestNames }) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = { days: {} };
  const month = data[groupId][mKey];
  const day = ensureDay(month, dateKey);
  const key = lineKey(lineUserId);

  if (!count || count <= 0) {
    delete day.entries[key];
  } else {
    day.entries[key] = { displayName, count, guestNames: guestNames || [], updatedAt: Date.now() };
  }

  save(data);
  return month;
}

function setSession(groupId, mKey, dateKey, { course, teeTime }) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = { days: {} };
  const month = data[groupId][mKey];
  const day = ensureDay(month, dateKey);

  if (course !== undefined) day.course = course;
  if (teeTime !== undefined) day.teeTime = teeTime;

  save(data);
  return month;
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
  save(data);
  return data[groupId].board;
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
  setVote,
  setSession,
  nameSlug,
  lineKey,
  getBoard,
  addBoardMessage,
  deleteBoardMessage,
  setBoardPin,
};
