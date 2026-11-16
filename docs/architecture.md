# 架構

> 狀態：技術棧已決定（D-001、D-023）；部署（D-003）2026-11-12 決定自己架 Kubernetes，設定在 `deploy/`，說明見 [deploy/README.md](../deploy/README.md)。

## 技術棧
| 層 | 建議 | 理由 |
|---|---|---|
| 前端 | Vite + React + TypeScript（D-023） | 書桌互動多（Canvas 手寫、IME 輸入、塗改），元件化好維護 |
| 後端 | Node.js + Fastify + TypeScript | 與前端共用型別（信件、物流事件） |
| 資料庫 | PostgreSQL 16（開發用 Docker；沒有 Docker 時可用 PGlite），drizzle-orm | 排程查詢、時間區間查詢方便 |
| 排程 | `scheduled_jobs` 資料表 + 獨立 worker 每 30 秒輪詢（D-033），唯一鍵保證冪等 | 24h／48h 提醒、30 天退信、30 天詢問都是「到時間做某事」 |
| 寄信 | 開發：ConsoleMailer（存進 dev_outbox）；正式：Gmail SMTP ＋ outbox（`email_outbox` 表，交易成功後才寄，D-038） | 送達通知、提醒信、退信 |
| 檔案 | 開發：本機資料夾；正式：PostgreSQL 的 `blobs` 表（D-039，和資料同一個交易、跟著資料庫備份） | 信紙圖樣、附件、手寫掃描、上傳字型 |
| 部署 | 一個映像檔：API（同時提供前端網頁，API 在 `/api`）＋ worker ＋ 遷移；Kubernetes／KubeSphere（D-003） | 見 deploy/README.md |
| 外部資料 | 中央氣象署開放資料、政府行政機關辦公日曆表、地圖／據點 API | 天氣延遲、假日、郵局位置 |

## 模組切分
```
apps/web        前端（書桌 / 郵局 / 追蹤 / 字紙冢 / 收件人閱信頁）
apps/api        後端 API
packages/engine 物流時間引擎（純函式，無 I/O，可完整單元測試）
packages/shared 共用型別
```

## 核心資料
- Letter：信件（狀態：drafting / shelved / traveling / sent）
- Sheet：信紙（kind、style、mode、font、chars[{c, marks[]}]、strokes[]、scan）
- Attachment、DiscardedSheet（state: crumple/fold/keep）
- Trip：前往郵局（place、mode、startAt、arriveAt）— **抵達時間由伺服器判定**
- Shipment：寄出的信（trackingNo、plan、events、signedAt、emailEdits、returnedAt）

## 關鍵原則
1. **落子無悔要在伺服器端成立**：書寫內容只接受「追加字元」「追加標記」「追加筆畫」三種操作，API 沒有修改與刪除。
2. 時間引擎是純函式：`plan(shipment, calendar, weather) → events`，原型裡的 `plan()` 可直接移植。
3. 前往郵局的倒數以伺服器時間為準，避免改本機時間作弊。
4. 收件人用開信連結開信，開信或撕毀即簽收。每次投遞一個連結，改信箱或退信後失效。
5. 資料庫層也擋：觸發器讓書寫紀錄不能 UPDATE、不能單獨 DELETE，信寄出後不能再追加。

API 細節見 [api.md](api.md)。

## 上線後的安全與營運（2026-11-12，review-2026-10-21 的修正）
- 設定：只有 NODE_ENV=development／test 才是開發環境；正式環境缺必填設定或用了範例密鑰就拒絕啟動（`apps/api/src/config.ts`）。
- 開發用路由（本機信箱、快轉）只在開發環境且 ENABLE_DEV_ROUTES 沒關時註冊。
- 頻率限制：計數存在 `rate_limits` 表（多副本共用），只管登入信、開信連結、公開追蹤、上傳等容易被濫用的端點；整站粗限制交給 Ingress。
- 上傳只收依檔頭判斷的 PNG／JPEG／WebP／GIF；讀取帶 nosniff 與 CSP sandbox。網頁帶 CSP、Referrer-Policy: no-referrer（網址裡有開信連結）。
- 跨站送來的狀態變更一律 403（Origin／Sec-Fetch-Site），不收 text/plain。
- log 遮掉開信連結與登入 token；寄出的信寄出後清掉內文。
- 收件匣（D-024）、收藏重看（D-025）、開信連結綁第一台動手的瀏覽器（D-029）、收信與登入要按一下（D-030）、公開追蹤只給狀態（D-031）。
- 管理頁 `/admin`（D-040）：ADMIN_EMAILS 指定，只有數字與狀態。

## 防騷擾與帳號（2026-11-12 第二輪）
- 寄信上限、封鎖、檢舉、停權：`apps/api/src/services/abuse.ts`。封鎖在送達排程（deliver）檢查，寄件人看不出來。
- 刪除帳號：`services/account.ts`。使用者這一列匿名化不刪（寄出的信還指向它），寄出的信留給收件人。
- 信紙快照：`sheets.snapshot`／`snapshot_seq`，每 50 筆更新；逐筆 applyOp ＝ 整張 applyOps 由 engine 的隨機測試保證。
- 天氣：`services/weather.ts` 的 CwaWeather（中央氣象署 F-D0047-091），失敗一律退回模擬天氣。

