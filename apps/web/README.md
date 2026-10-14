# 慢信前端（apps/web）

Vite + React + TypeScript（D-023）。畫面、互動、動畫、文案以 [`prototype/index.html`](../../prototype/index.html) 為準；資料全部走後端 API（[`docs/api.md`](../../docs/api.md)），型別從 `@manxin/shared` 匯入。

## 跑起來

在專案根目錄：

```bash
npm install
npm run dev:all:pglite   # 後端（PGlite 記憶體資料庫）+ 前端，http://localhost:5173
```

- 前端一律呼叫 `/api/...`，Vite dev server（5173）用 proxy 去掉 `/api` 再轉給 `http://127.0.0.1:3000`。這樣後端的 `/r/:token`、`/track/:no` 不會和前端同名網址撞在一起。要換後端位址：`MANXIN_API=http://… npm run dev:web`。
- 登入：`/login` 寄登入信 → 開發環境到「本機信箱」（`/mailbox`，在右上角「快轉」選單裡）點連結。
- 快轉：右上角「快轉」呼叫 `POST /dev/clock`（只有後端不是 production 時才出現）。

## 測試

```bash
npm run test:web        # vitest + Testing Library（jsdom）
npm run test:e2e        # Playwright：寫信 → 郵局 → 寄出 → 快轉 → 收信開信
                        # 第一次要先：cd apps/web && npx playwright install chromium
                        # 會自己起前後端；已經開著 dev server 就直接用（每次用新帳號，可重跑）
npm run typecheck
npm run build:web
```

## 結構

```
src/
  api/client.ts        API client（/api 前綴、ApiError、只有追加的書寫端點）
  state/app.tsx        登入者、個人偏好、伺服器對時、提示、彈窗、頁首數字
  lib/
    noRegret.ts        落子無悔：輸入框防護（keydown、beforeinput、IME、虛擬鍵盤、右鍵、貼上、拖放）
    sheetWriter.ts     書寫同步：畫面先顯示，再依序送「追加字元／標記／筆畫」，帶 seq，斷線重送
    paper.ts           信紙的畫法（原型 buildPaper／renderType／drawInk／mountSheet）
    art.ts             信封、郵票、郵戳、畚箕掃把垃圾桶
    scenes.ts          長動畫（丟垃圾桶、寄出的單號；原型留下的寄信／拆信場景也在）
    wastepaper.ts      廢紙的樣子（紙球、對摺、平放）與攤開的皺痕
    typewriter.ts      古董打字機外觀、聲音、台灣／中國字盤與備用字盒
    map.ts             郵局示意地圖與腳印
    time.ts            臺北時間、民國紀年的顯示（不計算任何物流時間）
    prefs.ts           個人偏好（年代風格、書桌…存 localStorage）
  pages/               首頁、書桌、郵局（出發前／櫃台）、追蹤、收信、開信（/r/:token）、收藏、字紙冢、登入、本機信箱
  styles/prototype.css 原型的 CSS 整份照搬（之後再逐步拆）
e2e/                   Playwright
```

## 原則

- 畫信紙、信封、動畫的程式是從原型搬過來的命令式 DOM 程式，React 元件用 ref 掛上去；這樣畫面和原型一致。之後可以逐步改寫成元件。
- 時間、送達、提醒、狀態、能不能裝進信封都看後端回傳；前端只負責顯示和倒數（倒數用 `GET /time` 校正）。
- 動畫不卡資料：先送請求，動畫同時播；長動畫有「略過」，`prefers-reduced-motion` 時省略。
