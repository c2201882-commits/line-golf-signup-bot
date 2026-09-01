// Simple JSON-file storage, keyed by group and month.
// Shape:
// {
//   "<groupId>": {
//     "2026-9": {
//       "9/3": { note: "長庚5:50", max: 4, names: ["David", "KW"] }
//     }
//   }
// }

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "signups.json");

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

function getMonth(groupId, mKey = monthKey()) {
  const data = load();
  return (data[groupId] && data[groupId][mKey]) || {};
}

function applyEntries(groupId, entries, mKey = monthKey()) {
  const data = load();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][mKey]) data[groupId][mKey] = {};
  const month = data[groupId][mKey];

  for (const entry of entries) {
    const { date, note, max, adds, removes } = entry;
    if (!month[date]) month[date] = { note: null, max: null, names: [] };
    const day = month[date];

    if (note) day.note = note;
    if (max !== null && max !== undefined) day.max = max;

    for (const name of adds) {
      if (!day.names.includes(name)) day.names.push(name);
    }
    for (const name of removes) {
      day.names = day.names.filter((n) => n !== name);
    }
  }

  save(data);
  return month;
}

module.exports = { load, save, monthKey, getMonth, applyEntries };
