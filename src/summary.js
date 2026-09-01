function sortByDate(a, b) {
  const [am, ad] = a.split("/").map(Number);
  const [bm, bd] = b.split("/").map(Number);
  return am - bm || ad - bd;
}

function formatSummary(month, mKey) {
  const dates = Object.keys(month).sort(sortByDate);
  if (dates.length === 0) {
    return `本月（${mKey}）目前還沒有人報名喔，輸入「9/3 +你的名字」就可以報名了！`;
  }

  const lines = [`⛳ 本月球局彙整（${mKey}）`, ""];
  for (const date of dates) {
    const day = month[date];
    const parts = [];
    if (day.note) parts.push(day.note);
    const names = day.names.length ? day.names.join(" ") : "（尚無人報名）";
    parts.push(names);
    let countTag = "";
    if (day.max) {
      countTag = day.names.length >= day.max ? " 🈵滿" : ` (${day.names.length}/${day.max})`;
    } else if (day.names.length) {
      countTag = ` — ${day.names.length}`;
    }
    lines.push(`『${date}』：${parts.join(" ")}${countTag}`);
  }
  return lines.join("\n");
}

const HELP_TEXT = `⛳ 球局報名機器人使用說明

【報名】
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

一天只會開一團，重複輸入同一人不會重複計算。`;

const MENU_QUICK_REPLY = {
  items: [
    {
      type: "action",
      action: { type: "message", label: "查詢本月彙整", text: "查詢" },
    },
    {
      type: "action",
      action: { type: "message", label: "使用教學", text: "help" },
    },
  ],
};

module.exports = { formatSummary, HELP_TEXT, MENU_QUICK_REPLY };
