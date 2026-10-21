# 慢信

> 從前慢，如今也慢。

慢信是一個模擬寫信、寄信、收信的網頁 App，給有些話不敢當面說、也不想用訊息一下子丟出去的人。

- **落子無悔**：寫信沒有復原、沒有刪除、沒有橡皮擦，也不能複製貼上。寫錯就用鉛筆或修正帶劃掉，痕跡會留著；真的不行，就謄一張新的。
- **自己走去郵局**：在地圖上挑郵局或郵筒，選走路、騎車或開車，路程要真的等完。到了郵局再挑信封、郵票、郵戳，徒手摺信、裝信、貼郵票，最後投進郵筒。
- **信在路上**：送達時間依發車班次、上下班時間、週末、國定假日和天氣計算。可以用單號追蹤。
- **親手拆開**：收件人收到 email 通知，點連結後用開信刀或用手撕開。拆得太粗魯，信會裂成兩半，只能自己拼回去。郵票和火漆可以撬下來收藏。

## 目前進度

這個專案還在開發中：

- `prototype/index.html`：單檔、可完整操作的前端原型，資料只存在瀏覽器。畫面與互動以它為準。
- `apps/web`：正式前端（Vite + React + TypeScript），從原型移植，資料全部走後端 API。
- `apps/api`、`packages/*`：後端第一版，有 API、資料庫、排程和測試。
- 登入 → 寫信 → 郵局 → 寄出 → 快轉 → 收信開信，已經可以從頭走到尾（有端到端測試）。

## 看原型

直接用瀏覽器打開 `prototype/index.html` 就能用。

原型裡有三種年代風格（八〇年代、民國初年、手繪塗鴉）和三種書桌（木桌配綠檯燈、白桌配長燈帶、課桌）。原型的打字機可以選鍵盤輸入、台灣中文打字機（繁體字盤），或中國中文打字機（簡體字盤）；正式版（apps/web）只保留鍵盤輸入和拼音鍵盤，兩種字盤已於 2026-10-21 移除。正式版另有第四種風格「藏寶圖」。右上角的「快轉」可以讓時間往前走，用來看送達、提醒和退信。

## 在本機跑

需要 Node 24。沒有 Docker 也可以：後端改用記憶體資料庫（PGlite，每次啟動都是乾淨的範例資料，關掉就消失）。

```bash
npm install

# 前後端一起起來（後端 PGlite）：前端 http://localhost:5173、API http://127.0.0.1:3000
npm run dev:all:pglite

# 分開起
npm run dev:api:pglite   # 只有後端（PGlite）
npm run dev:web          # 只有前端（/api 會轉給 127.0.0.1:3000）

# 有 Docker 的 PostgreSQL 16
cp .env.example .env
npm run db:up && npm run db:migrate && npm run db:seed
npm run dev:all
```

- 打開 http://localhost:5173 ，按右上角「快轉」→「登入」，用 `zhe@example.com`（寄件人）或 `wen@example.org`（收件人）登入。
- 開發階段不會真的寄 email。登入連結、開信通知、提醒、退信都在前端的「本機信箱」頁（`/mailbox`，在「快轉」選單裡），連結可以直接點；也可以看 `GET /dev/outbox`。
- 右上角「快轉」會讓伺服器的時鐘往前走（`POST /dev/clock`），用來看路程、送達、提醒和退信。

更多細節見 [apps/web/README.md](apps/web/README.md)、[apps/api/README.md](apps/api/README.md)。

## 測試

```bash
npm test          # 物流時間引擎 + API
npm run typecheck
```

API 測試預設用 PGlite。目前還沒在真正的 PostgreSQL 16 上跑過。

## 專案結構

```
prototype/          單檔前端原型
packages/engine/    物流時間引擎（純函式，Asia/Taipei 計時）：發車、上班時間、假日、天氣延遲、送達與提醒、摺信與裝信判斷、收信狀態
packages/shared/    前後端共用型別
apps/api/           Fastify + PostgreSQL（drizzle），API、排程 worker、寄信介面
docs/               產品規格、架構、API、決策紀錄、工作看板
.claude/agents/     協作用的 PM、前端、後端、QA agent 設定
```

## 文件

- [產品規格](docs/PRD.md)
- [架構](docs/architecture.md)
- [API](docs/api.md)
- [決策紀錄](docs/decisions.md)
- [工作看板](docs/backlog.md)
