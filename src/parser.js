// Parses golf sign-up lines like:
//   9/3 +David
//   9/3 -David
//   9/3 長庚5:50 max4 +David +KW +Sophie +Roy
//
// Returns an array of { date: "9/3", note: "長庚5:50" | null, max: number | null,
//                        adds: ["David", ...], removes: ["David", ...] }
// for every line in the message that starts with a recognizable date.

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\b/;
const TOKEN_RE = /([+-])([^\s+-][^\s]*)/g;
const MAX_RE = /\bmax(\d+)\b/i;

function parseLine(rawLine) {
  const line = rawLine.trim();
  if (!line) return null;

  const dateMatch = line.match(DATE_RE);
  if (!dateMatch) return null;

  const month = parseInt(dateMatch[1], 10);
  const day = parseInt(dateMatch[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${month}/${day}`;

  let rest = line.slice(dateMatch[0].length).trim();

  const maxMatch = rest.match(MAX_RE);
  const max = maxMatch ? parseInt(maxMatch[1], 10) : null;
  if (maxMatch) rest = rest.replace(MAX_RE, "").trim();

  const adds = [];
  const removes = [];
  let firstTokenIndex = rest.length;

  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(rest)) !== null) {
    if (m.index < firstTokenIndex) firstTokenIndex = m.index;
    const sign = m[1];
    const name = m[2].trim();
    if (!name) continue;
    if (sign === "+") adds.push(name);
    else removes.push(name);
  }

  const note = rest.slice(0, firstTokenIndex).trim() || null;

  if (adds.length === 0 && removes.length === 0 && !note) return null;

  return { date, note, max, adds, removes };
}

// A message can contain multiple sign-up lines, one per line.
function parseMessage(text) {
  return text
    .split("\n")
    .map(parseLine)
    .filter(Boolean);
}

module.exports = { parseLine, parseMessage };
