# 阿綸涅亞 NIEIA 官方網站

阿綸涅亞 NIEIA 療癒工作室的官方網站：個案療癒預約、工作坊報名、宇宙訊息抽卡與後台管理。

## 技術架構

- 主機：Cloudflare（製作期間使用免費網址，正式上線前接上 nieia.com）
- 資料庫：MongoDB Atlas（新加坡區）
- 通知：Email

## 開發階段

1. 第一階段：首頁、關於、服務、預約須知、個案預約、工作坊報名、宇宙訊息抽卡、後台預約與報名管理
2. 第二階段：療癒紀錄、回饋邀請、個案見證
3. 第三階段：會員區、線上收款、站內商店、簡體中文切換

## 專案結構

- `public/`：網站頁面、樣式與前端程式（首頁、療癒服務、宇宙訊息、工作坊、聖照選物、關於阿綸、後台、404）
- `tools/build_pages.py`：產生 `public/` 下的前台頁面
- `src/index.js`：Cloudflare Worker，負責 `/api/` 開頭的請求與 MongoDB 連線
- `wrangler.jsonc`：Cloudflare 設定

## 常用指令

- `npm install`：安裝套件
- `npm run dev`：在自己電腦上預覽網站（http://localhost:8787）
- `npm run check`：檢查能否成功打包

## 連線測試

部署後打開 `/api/health`：
- `"database": "connected"`：資料庫連線成功
- `"database": "not_configured"`：尚未在 Cloudflare 設定 `MONGODB_URI`
- `"database": "unreachable"`：連線字串、密碼或 MongoDB Network Access 有誤

## 後台

- 網址：`/admin`
- 需要在 Cloudflare 新增 Secret `ADMIN_PASSWORD`（後台密碼）
- 分頁「時段」：新增、暫停、刪除可預約時段（時間一律為 UTC+8）
- 分頁「療癒項目」：新增、編輯、上下架、排序，前台「療癒服務」頁直接讀取
- 分頁「商品」：新增、編輯、上下架、排序、標示售完，前台「聖照選物」頁直接讀取
- 第一次打開時，會自動匯入網站原本的 6 個療癒項目與 5 張聖照卡
- 密碼 15 分鐘內錯 5 次會暫時鎖定；更換 `ADMIN_PASSWORD` 後，所有已登入的裝置都需重新登入

## 注意

資料庫帳號密碼等機密資訊一律設定在 Cloudflare 的環境變數中，不放進這個 repository。
