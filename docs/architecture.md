# 架構

> 狀態：後端技術棧已決定（D-001、D-002，2026-10-14），後端第一版已實作。前端框架與部署（D-003）還沒定。

## 技術棧
| 層 | 建議 | 理由 |
|---|---|---|
| 前端 | Vite + React + TypeScript（建議，尚未決定） | 書桌互動多（Canvas 手寫、IME 輸入、塗改），元件化好維護 |
| 後端 | Node.js + Fastify + TypeScript | 與前端共用型別（信件、物流事件） |
| 資料庫 | PostgreSQL 16（開發用 Docker；沒有 Docker 時可用 PGlite），drizzle-orm | 排程查詢、時間區間查詢方便 |
| 排程 | `scheduled_jobs` 資料表 + worker 每 30 秒輪詢，唯一鍵保證冪等 | 24h／48h 提醒、30 天退信、30 天詢問都是「到時間做某事」 |
| 寄信 | Mailer 介面：開發用 ConsoleMailer（存進 dev_outbox），之後換 Resend | 送達通知、提醒信、退信 |
| 檔案 | S3 相容儲存（R2／MinIO） | 信紙圖樣、附件、手寫掃描、上傳字型 |
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
