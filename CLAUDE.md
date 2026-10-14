# 慢信（Manxin）

「從前慢，如今也慢。」模擬真實世界寫信、寄信、收信流程的網頁 App。
受眾：有些話不敢當面說、也不敢用網路直接發的人。

## 文件
- 產品規格：[docs/PRD.md](docs/PRD.md)（唯一的需求來源，改需求先改這裡）
- 架構與技術選型：[docs/architecture.md](docs/architecture.md)
- 決策紀錄：[docs/decisions.md](docs/decisions.md)
- 工作看板：[docs/backlog.md](docs/backlog.md)
- 可操作原型：[prototype/index.html](prototype/index.html)（單檔 HTML，瀏覽器直接開；線上版 https://claude.ai/artifact/RjaZaqgKrkLsWzQ4zyyqow ）

## 協作方式
- 使用者是產品負責人：**所有產品與技術取捨由使用者決定**。Agent 負責實作、提出選項與建議，不自行拍板。
- 主對話（Claude）擔任協調者，依任務派給四個 agent：
  - `pm`：拆需求、維護 PRD／backlog／decisions、整理待決策事項
  - `frontend`：書桌、字紙冢、郵局、追蹤等所有畫面與互動
  - `backend`：API、資料庫、物流時間引擎、排程（提醒／退信／30 天詢問）、寄信服務
  - `qa`：測試計畫、自動化測試、驗收規則「落子無悔」等核心體驗
- 需要使用者決定的事，寫進 `docs/decisions.md` 的「待決策」，在回覆中列出來，不要埋在長文裡。
- 不排每日進度；以 backlog 的里程碑為單位。

## 規則
- 一律用繁體中文溝通與撰寫文件；程式碼識別字用英文。
- 「落子無悔」是產品核心：任何功能都不能提供復原、刪除文字、橡皮擦、複製貼上。PR 若碰到書寫區，QA 必須驗這條。
- 時間相關邏輯（發車、上下班、假日、天氣延遲、24h/48h 提醒、30 天退信、30 天詢問）全部集中在後端的時間引擎，前端只顯示結果。
- 所有時間以 Asia/Taipei 計算；畫面上的日期用民國紀年。
- 視覺走復古（八〇年代／民國初年，見 PRD 第 5 章），動作要慢、有手感（PRD 第 6 章）。不要做成現代扁平風或機器式的快速轉場。
- commit 或 push 只在使用者要求時進行。
