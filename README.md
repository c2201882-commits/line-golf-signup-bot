# 高爾夫開團 LINE Bot + 報名網頁

在 LINE 群組裡管理每月球局報名：機器人負責提醒與彙整，實際報名在一個公開網頁（LIFF）完成，
每個人用自己的 LINE 身份登入、選日期、填人數（可以幫朋友一起報）。

## 架構

- `src/server.js` — Express server：LINE webhook + `/api/*` 報名資料 API + 靜態網頁
- `public/liff.html` — 報名網頁本體（LIFF app）
- `src/store.js` — JSON 檔案儲存（`data/signups.json`），依 group + 月份 + 日期分層
- `src/parser.js` / `src/summary.js` — 舊版文字指令報名（`9/3 +David`）與月彙整文字，仍可並用

## 部署（推薦 Render，免費方案）

1. 把這個 repo push 到 GitHub。
2. 到 [Render](https://render.com) → New → Web Service → 選這個 repo。
3. 設定：
   - Build Command: `npm install`
   - Start Command: `npm start`
4. 到 Environment 分頁加入環境變數（見下方「環境變數」）。
5. 部署完成後會得到一個公開網址，例如 `https://your-app.onrender.com`，之後設定 LINE webhook / LIFF 都要用這個網址。

> Render 免費方案閒置一段時間會休眠，收到請求時要幾秒鐘喚醒；如果在意延遲可以之後升級付費方案，或改用 Railway。

## 申請 LINE 設定

### 1. Messaging API channel（如果還沒有）

1. 到 [LINE Developers Console](https://developers.line.biz/console/)，建立一個 Provider。
2. 在該 Provider 下建立一個 **Messaging API** channel。
3. 到 channel 的「Messaging API」分頁：
   - 取得 **Channel access token**（long-lived），填入 `LINE_CHANNEL_ACCESS_TOKEN`
   - 「Basic settings」分頁的 **Channel secret**，填入 `LINE_CHANNEL_SECRET`
   - Webhook URL 填 `https://your-app.onrender.com/webhook`，並開啟「Use webhook」
   - 建議關閉「自動回應訊息」「加入好友歡迎訊息」，避免跟 bot 邏輯衝突

### 2. 建立 LIFF app（報名網頁用）

1. 同一個 channel（或同 Provider 下任一個 channel）的「LIFF」分頁 → Add
2. 設定：
   - Size: `Full`（比較好操作日曆和輸入框）
   - Endpoint URL: `https://your-app.onrender.com/liff.html`
   - Scope: 勾選 `profile` 和 `openid`（一定要有 `openid` 才能拿到 id_token 驗證身份）
3. 建立後會得到一組 **LIFF ID**（格式像 `1234567890-AbCdEfGh`），填入 `LIFF_ID`
4. 同一頁面也會顯示這個 channel 的 **Channel ID**（在「Basic settings」分頁可看到），填入 `LINE_LIFF_CHANNEL_ID`
   （伺服器驗證 id_token 時要核對這個 channel ID，確保不是別的 app 發的 token）

### 3. 把 bot 加進球隊群組

把 Messaging API channel 對應的官方帳號加入球隊 LINE 群組。之後在群組輸入「報名」或
「@球局」就會出現「開啟報名頁」的按鈕，點下去會用該群組的 groupId 打開報名頁。

## 環境變數

| 變數 | 說明 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API 的長期 access token |
| `LINE_CHANNEL_SECRET` | Messaging API 的 channel secret，驗證 webhook 簽章用 |
| `LIFF_ID` | 報名網頁的 LIFF ID |
| `LINE_LIFF_CHANNEL_ID` | LIFF app 所屬 channel 的 Channel ID，驗證 id_token 用 |
| `ADMIN_SECRET` | 保護 `/api/admin/backup`、`/api/admin/restore` 的密鑰 |
| `DATA_DIR` | 存放 `signups.json` 的資料夾，正式環境請指到掛載的持久化磁碟（例如 Render 的 `/var/data`），本機開發留空即可 |
| `PORT` | 伺服器監聽的 port（Render 會自動注入，本機開發預設 3000） |

## 本機開發

```bash
npm install
cp .env.example .env   # 填入上面幾個變數
npm run dev
```

用 [ngrok](https://ngrok.com) 之類的工具把本機 port 開成公開網址，才能設定 webhook 和 LIFF endpoint 做測試。
