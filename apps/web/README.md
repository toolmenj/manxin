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
    scenes.ts          長動畫（丟垃圾桶、寄出後郵差收信→單號、收信的落桌與封口掀起；原型的全自動寄信／拆信場景改成註解保留，見下方）
    postbox.ts         依年代畫郵筒、信滑進投信口、郵筒晃一下
    wastepaper.ts      廢紙的樣子（紙球、對摺、平放）與攤開的皺痕
    typewriter.ts      古董打字機外觀與聲音（鍵盤輸入、拼音鍵盤）
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


## 做過但未使用的動畫

2026-10-21 使用者決定：沒接上的動畫**不刪，改成註解保留**，方便之後報告。

| 動畫 | 位置 | 內容 | 為何沒接上 |
| --- | --- | --- | --- |
| `sendScene`（全自動寄信） | `src/lib/scenes.ts`（連同共用的 `foldable`／`fold`／`envelopeEl`／`flipOver`／`intoBox`） | 信紙三摺 → 裝進信封 → 封口、蓋封緘 → 翻到正面 → 投郵筒 → 單號；明信片是翻面 → 投郵筒 | 流程改為親手做：摺、裝、封、貼、投都在郵局櫃台（`pages/Counter.tsx`）由寄件人自己做，自動動畫會取代這些步驟 |
| `openScene`（全自動拆信） | `src/lib/scenes.ts` | 信封落下 → 翻面 → 封緘掉落、封口掀開 → 抽出信 → 攤開 | 流程改為親手做：翻面、劃開、倒出、攤開都在收信頁（`pages/Receive.tsx`）由收件人自己做。只取用了開頭（→ `arriveLetter`）和封口掀開（→ `openMouth`） |
| 對應的 CSS | `src/styles/prototype.css` 的 `.envl`／`.e-*`／`.fold3`／`.fp`、`src/styles/app.css` 的 `.pb-solo` | 上面兩段專用的信封、三摺信紙、單獨郵筒的樣式 | 同上 |

每段註解開頭都寫了曾經做過什麼、為何沒接上、日期。這些都不在打包結果裡（沒有任何地方 import）。要恢復時把 `// ` 拿掉，並把 `stampSVG`（art.ts）、`esc`（util.ts）加回 scenes.ts 的 import、CSS 一起解除註解。

## 拼音字典（src/lib/pinyin-data.json）

拼音鍵盤的字典。取 Jun Da《現代漢語字頻表》前 4,500 字（經 npm 套件 `hanzi` 的 `lib/data/frequencyjunda.txt.js` 取得），去掉聲調、ü 改寫成 v，依字頻排序；破音字的次要讀音排在後面。`_` 欄位是全部字依字頻的順序，用來合併打到一半的拼音（zh、xia）的候選字。
