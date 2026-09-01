const assert = require("node:assert");
const { test } = require("node:test");
const { parseLine, parseMessage } = require("./parser");

test("simple add", () => {
  assert.deepStrictEqual(parseLine("9/3 +David"), {
    date: "9/3",
    note: null,
    max: null,
    adds: ["David"],
    removes: [],
  });
});

test("simple remove", () => {
  assert.deepStrictEqual(parseLine("9/3 -David"), {
    date: "9/3",
    note: null,
    max: null,
    adds: [],
    removes: ["David"],
  });
});

test("note + max + multiple adds", () => {
  assert.deepStrictEqual(parseLine("9/3 長庚5:50 max4 +David +KW +Sophie +Roy"), {
    date: "9/3",
    note: "長庚5:50",
    max: 4,
    adds: ["David", "KW", "Sophie", "Roy"],
    removes: [],
  });
});

test("non sign-up line ignored", () => {
  assert.strictEqual(parseLine("今天天氣不錯"), null);
});

test("invalid date ignored", () => {
  assert.strictEqual(parseLine("13/40 +David"), null);
});

test("multi-line message", () => {
  const entries = parseMessage("9/3 +David\n9/17 +Roy\n哈囉大家好");
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].date, "9/3");
  assert.strictEqual(entries[1].date, "9/17");
});
