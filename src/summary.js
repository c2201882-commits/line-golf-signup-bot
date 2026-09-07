function sortByDateKey(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function displayDate(dateKey) {
  const [, m, d] = dateKey.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function formatSummary(month, mKey, liffUrl) {
  const days = (month && month.days) || {};
  const dateKeys = Object.keys(days)
    .filter((k) => (days[k].sessions || []).some((s) => Object.keys(s.entries || {}).length > 0))
    .sort(sortByDateKey);

  const openLine = liffUrl ? `\n\n👉 打開報名頁：${liffUrl}` : "";

  if (dateKeys.length === 0) {
    return `本月（${mKey}）目前還沒有人報名喔！${openLine || "請聯絡管理員設定報名頁連結。"}`;
  }

  const lines = [`⛳ 本月球局彙整（${mKey}）`, ""];
  for (const dateKey of dateKeys) {
    const sessions = (days[dateKey].sessions || []).filter((s) => Object.keys(s.entries || {}).length > 0);
    for (const session of sessions) {
      const entries = Object.values(session.entries || {});
      const totalCount = entries.reduce((sum, e) => sum + (e.count || 1), 0);
      const names = entries.length
        ? entries.map((e) => (e.count > 1 ? `${e.displayName}x${e.count}` : e.displayName)).join(" ")
        : "（尚無人報名）";

      const parts = [];
      if (session.course) parts.push(session.course);
      if (session.teeTime) parts.push(session.teeTime);
      parts.push(names);

      let countTag = "";
      if (session.max) {
        countTag = totalCount >= session.max ? " 🈵滿" : ` (${totalCount}/${session.max})`;
      } else if (totalCount) {
        countTag = ` — ${totalCount} 人`;
      }
      lines.push(`『${displayDate(dateKey)}』：${parts.join(" ")}${countTag}`);
    }
  }
  if (liffUrl) lines.push(openLine);
  return lines.join("\n");
}

const HELP_TEXT = `⛳ 球局報名機器人使用說明

【報名方式】
點選下方「開啟報名頁」，用你的 LINE 身份登入後，直接在網頁上選日期、填人數即可完成報名。也可以在報名時順便幫朋友多登記人數。
https://liff.line.me/2011364101-TasJ1JCF`;

function buildMenuQuickReply(liffUrl) {
  const items = [];
  if (liffUrl) {
    items.push({
      type: "action",
      action: { type: "uri", label: "開啟報名頁", uri: liffUrl },
    });
  }
  items.push(
    {
      type: "action",
      action: { type: "message", label: "查詢本月彙整", text: "查詢" },
    },
    {
      type: "action",
      action: { type: "message", label: "使用教學", text: "help" },
    }
  );
  return { items };
}

module.exports = { formatSummary, HELP_TEXT, buildMenuQuickReply };
