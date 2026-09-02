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
    return `本月（${mKey}）目前還沒有人報名喔！${openLine || "輸入「9/3 +你的名字」就可以報名了。"}`;
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

【網頁報名，推薦】
點選下方「開啟報名頁」，用你的 LINE 身份直接選日期、填人數，也能幫朋友多報名額。

【文字報名，仍可使用】
9/3 +David
一行一個日期，+名字 表示報名，可以一行打多個人：
9/3 +David +Roy +KW

【取消報名】
9/3 -David

【加備註（球場/時間/人數上限，選填）】
9/3 長庚5:50 max4 +David +KW

【查詢本月彙整】
@球局 查詢　或　@球局 本月

【查看說明】
@球局 help　或　@球局 說明

文字報名一天只會對到第一團；如果同一天想開第二場球局（例如早團＋午團），請用網頁報名頁操作。重複輸入同一人不會重複計算。`;

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
