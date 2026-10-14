# 慢信 API 規格

> 版本 0.1（2026-10-14，後端初版）。實作在 `apps/api`，共用型別在 `packages/shared`，時間規則在 `packages/engine`。
> 標「暫定」的行為依待決策的建議先做，使用者拍板後可能調整（見 `docs/decisions.md`）。

## 通則

- REST + JSON。時間一律是 **epoch 毫秒**（number）；伺服器一律以 **Asia/Taipei** 計算，前端顯示時再轉民國紀年。
- 「現在幾點」一律以伺服器為準（`GET /time`）。前端時鐘只拿來畫倒數。
- 登入用 cookie `mx_session`（httpOnly、SameSite=Lax、正式環境 Secure）。標「需登入」的端點沒登入回 401。
- 沒有 body 的 POST 請**不要**帶 `content-type: application/json`（Fastify 會把空 body 當成錯誤）。
- 輸入用 JSON Schema 驗證，**多餘欄位一律 400**（不會被默默忽略）。
- 錯誤格式：

```json
{ "error": { "code": "NOT_ARRIVED", "message": "還沒走到郵局", "details": { "arriveAt": 1791944100000, "serverNow": 1791943500000 } } }
```

### 錯誤碼

| HTTP | code | 意思 |
|---|---|---|
| 400 | `BAD_REQUEST` | 格式不對、多餘欄位、超出範圍 |
| 401 | `UNAUTHORIZED` | 沒登入 |
| 401 | `INVALID_TOKEN` | 登入連結無效或過期 |
| 404 | `NOT_FOUND` | 找不到，或不是你的（不透露存在與否）；也包含不存在的路徑（例如任何修改、刪除信紙內容的路徑） |
| 404 | `INVALID_TOKEN` | 開信連結無效、已改寄或已退回 |
| 409 | `LETTER_LOCKED` | 信已寄出／先放著／帶去郵局了，不能寫 |
| 409 | `SEQ_CONFLICT` | 追加時帶的 `seq` 和伺服器不一致（避免重送造成重複） |
| 409 | `SHEET_EMPTY` / `SHEET_NOT_EMPTY` | 空白不用謄抄／已落筆不能換紙 |
| 409 | `REFS_PENDING` | 桌邊還有舊信紙沒處理 |
| 409 | `LETTER_EMPTY` | 書桌上沒有信 |
| 409 | `TRIP_ACTIVE` / `NO_TRIP` | 已經在路上／還沒出門 |
| 409 | `NOT_ARRIVED` | 還沒走到郵局（伺服器時間判定） |
| 409 | `NOT_AT_POST_OFFICE` | 人不在郵局裡（沒出門或還沒走進去） |
| 409 | `ENVELOPE_LOCKED` / `STAMP_LOCKED` / `POSTMARK_LOCKED` | 信封、郵票、郵戳已鎖定 |
| 409 | `ALREADY_DONE` | 已經做過（貼郵票、蓋郵戳、放進信封、封口） |
| 409 | `TOO_MANY_FOLDS` | 摺超過 6 次 |
| 409 | `INVALID_STATE` | 狀態不允許（收信順序不對等），`details.reason` 有細節 |
| 409 | `NO_EDITS_LEFT` / `SAME_EMAIL` / `NOT_DELIVERED` / `SIGNED` / `RETURNED` | 改收件信箱的各種不允許 |
| 410 | `GONE` | 信已退回 |
| 413 / 415 | `BAD_REQUEST` | 檔案太大／不是 multipart |
| 422 | `INVALID_OP` | 追加操作不合法，`details.reason`：`WRONG_MODE`、`EMPTY_TEXT`、`TEXT_TOO_LONG`、`SHEET_FULL`、`MARK_OUT_OF_RANGE`、`MARK_NOTHING`、`BAD_TOOL`、`BAD_STROKE`、`SHEET_NOT_EMPTY` |
| 422 | `INVALID_EMAIL` | 信箱格式不對 |
| 422 | `TOO_WIDE` / `TOO_LONG` | 信紙塞不進信封（`details` 有寬高與信封內徑） |
| 422 | `FOLD_OUT_OF_RANGE` | 摺線不在信紙上 |
| 422 | `NOT_READY` | 寄出前條件不齊，`details.missing`：`ADDRESS`、`INSERT`、`SEAL`、`STAMP` |
| 500 | `INTERNAL` | 伺服器錯誤 |

### 主要資料型別

完整定義見 `packages/shared/src/index.ts`。

- `LetterDTO`：`id`、`status`（`drafting` 書桌上／`shelved` 先放著／`sent` 已寄出）、`env`（地址）、`sheet`（目前的信紙）、`refs`（謄抄後留在桌邊的舊信紙）、`attachments`、`askDue`（先放著滿 30 天）、`trip`。
- `SheetDTO`：`kind`（`letter`／`postcard`）、`style`（`lined`／`bahang`／`grid`／`plain`／`custom`）、`mode`（`type`／`hand`）、`font`、`seq`（追加次數）、`chars[{c, m:[{t, g}]}]`、`strokes[{pen, color, pts:[[x,y,壓力]]}]`、`scan`。
- `CounterDTO`：櫃台狀態，`env`（`post`／`kraft`／`chinese`／`wax`／`custom`／`card`）、`envLocked`、`stamp`、`pm`、`stampPos`／`pmPos`（`{x,y,r}`，x、y 是 0–1 相對信封）、`folds[{a:'h'|'v', at}]`、`pack{x0,y0,x1,y1}`（信紙寬 = 1、高 = 1.414）、`rot`、`inserted`、`sealed`、`addrOk`、`etxt`（信封上的字）、`missing`。
- `ShipmentDTO`：`no`（單號）、`state`（`transit` 運送中／`rerouting` 改寄中／`waiting` 已送達未簽收／`signed` 已簽收／`returned` 已退回）、`editsLeft`、`stops`、`reached`、`events`（只列已經發生的，新到舊）、`deliverAt`（送達後才有）、`returnPostmark`。
- `ReceiveDTO`：收件人看到的信封快照 `pkg`、收信狀態 `recv`、攤開後才有的 `letter`。

---

## 1. 帳號（D-008 暫定：email magic link）

| 方法 | 路徑 | 輸入 | 輸出 | 錯誤 |
|---|---|---|---|---|
| POST | `/auth/magic-link` | `{ email }` | 202 `{ ok: true }`；登入信經 Mailer 寄出，連結 `APP_URL/login?token=…`，15 分鐘內有效、只能用一次 | 422 `INVALID_EMAIL` |
| POST | `/auth/verify` | `{ token }` | 200 `{ user }`，並設定 `mx_session` cookie（30 天） | 401 `INVALID_TOKEN` |
| POST | `/auth/logout` | — | 204，清除 cookie | — |
| GET | `/me` | — | `{ user }` | 401 |

- 第一次驗證成功就建立帳號。
- 登入連結與 session 的有效期限用真實時間，不受開發用「快轉」影響。
- TODO：登入信的頻率限制。

## 2. 時間與地點

| 方法 | 路徑 | 輸出 |
|---|---|---|
| GET | `/time` | `{ now, tz: 'Asia/Taipei', offsetMs? }`（`offsetMs` 只在非正式環境出現） |
| GET | `/places` | 原型的三個郵局／郵筒與各前往方式的分鐘數 `{ places, modes }` |

## 3. 書桌（需登入）

### 信

| 方法 | 路徑 | 輸入 | 輸出 | 錯誤 |
|---|---|---|---|---|
| POST | `/letters` | `{ kind?, style?, mode?, font?, env? }` | 201 `LetterDTO`（寄件人資料沿用上一封，信箱預設為帳號信箱） | 400 |
| GET | `/letters?status=` | `drafting`／`shelved`／`sent` | `{ letters: LetterDTO[] }` | — |
| GET | `/letters/:id` | — | `LetterDTO` | 404 |
| PATCH | `/letters/:id` | `{ env?: Partial<EnvAddress>, frontAttachmentId? }` | `LetterDTO`。改了任一個信箱，櫃台的「地址確認」會重設 | 409 `LETTER_LOCKED`（已寄出） |
| PATCH | `/letters/:id/sheet` | `{ kind?, style?, mode?, font?, bgAttachmentId? }`（信紙設定，**不是內容**） | `SheetDTO` | 409 `SHEET_NOT_EMPTY`（已落筆不能換紙種、樣式、圖樣）、409 `LETTER_LOCKED` |

### 信紙內容：只有追加

沒有任何更新或刪除內容的端點。`seq` 選填，帶了就做樂觀鎖（不一致回 409 `SEQ_CONFLICT`），建議前端都帶，重送才不會重複。

| 方法 | 路徑 | 輸入 | 輸出 | 錯誤 |
|---|---|---|---|---|
| POST | `/letters/:id/sheet/chars` | `{ text, seq? }`（打字模式；`\r\n` 轉成 `\n`；一次最多 2000 字，一張最多 20000 字） | 201 `SheetDTO` | 409 `LETTER_LOCKED`／`SEQ_CONFLICT`；422 `INVALID_OP` |
| POST | `/letters/:id/sheet/marks` | `{ from, to, tool, seq? }`，tool：`s1` 單橫線／`s2` 雙橫線／`x` 打叉／`blk` 塗黑／`tape` 修正帶；範圍含頭尾，換行不加標記 | 201 `SheetDTO` | 同上 |
| POST | `/letters/:id/sheet/strokes` | `{ stroke: { pen, color, pts }, seq? }`（手寫模式；pen：`fountain`／`ball`／`pencil`；color `#RRGGBB`；pts 最多 5000 點，x 0–1、y 0–2、壓力 0–1） | 201 `SheetDTO` | 同上 |
| POST | `/letters/:id/sheet/scan` | `{ attachmentId }`（紙本匯入，只能在空白信紙；附件 purpose 必須是 `scan`） | 201 `SheetDTO` | 422 `SHEET_NOT_EMPTY` |

資料庫層另有觸發器：`sheet_ops`、`envelope_ops` 不能 UPDATE、不能單獨 DELETE（只能隨信紙丟進垃圾桶一起刪）、已寄出的信不能再 INSERT。

### 謄抄、舊信紙、字紙冢

| 方法 | 路徑 | 輸入 | 輸出 | 錯誤 |
|---|---|---|---|---|
| POST | `/letters/:id/transcribe` | — | `LetterDTO`：舊紙移到 `refs`，新紙同紙種、樣式、模式、字型，空白 | 409 `SHEET_EMPTY`／`LETTER_LOCKED` |
| POST | `/letters/:id/refs/:sheetId/discard` | `{ state: 'crumple'\|'fold'\|'keep', to: 'tomb'\|'trash' }` | `LetterDTO`。`tomb` 保存並記住狀態與角度；`trash` **真的刪除**（D-009 暫照規格） | 404 |
| GET | `/tomb` | — | `{ sheets: TombItemDTO[], unsent: LetterDTO[] }`（廢紙與先放著的信） | — |

### 先放著（未寄出的信）

| 方法 | 路徑 | 說明 | 錯誤 |
|---|---|---|---|
| POST | `/letters/:id/shelve` | 放進抽屜（`status: shelved`），排入 30 天後的詢問信 | 409 `LETTER_EMPTY`／`LETTER_LOCKED` |
| POST | `/letters/:id/unshelve` | 拿出來放回書桌 | 409 `INVALID_STATE` |
| POST | `/letters/:id/ask-later` | 畫面上按「再放 30 天」：從現在起再等 30 天 | 409 `INVALID_STATE` |

### 附件（開發用本機磁碟）

| 方法 | 路徑 | 輸入 | 輸出 | 錯誤 |
|---|---|---|---|---|
| POST | `/letters/:id/attachments?purpose=` | multipart，欄位 `file`；purpose：`attachment`（預設）、`scan`、`bg`（信紙圖樣）、`front`（明信片正面）、`stamp`、`postmark`、`skin`（信封圖）；只收圖片，上限 `UPLOAD_MAX_BYTES` | 201 `AttachmentDTO` | 409 `LETTER_LOCKED`、413、415、422 |
| POST | `/letters/:id/attachments/:attId/take-out` | 附件「拿出來」（原型有；只在書桌上、出門前） | `LetterDTO` | 409、404 |
| GET | `/attachments/:id` | 讀檔（只有上傳者） | 檔案 | 404 |

TODO：字型上傳（PRD 2.3）、信紙圖樣範本庫、正式環境改 S3 相容儲存。

## 4. 前往郵局（需登入）

| 方法 | 路徑 | 輸入 | 輸出 | 錯誤 |
|---|---|---|---|---|
| POST | `/letters/:id/trip` | `{ place: 'box'\|'po'\|'main', mode: 'walk'\|'bike'\|'car', box: 'green'\|'red' }` | 201 `TripDTO`，`arriveAt` 由伺服器算（`ceil(距離/速度 + 額外分鐘)`） | 409 `REFS_PENDING`／`LETTER_EMPTY`／`TRIP_ACTIVE`／`LETTER_LOCKED` |
| GET | `/letters/:id/trip` | — | `{ trip: TripDTO \| null }`（含 `serverNow`、`arrived`） | — |
| POST | `/letters/:id/trip/enter` | — | `{ trip, counter }` | **409 `NOT_ARRIVED`**（伺服器時間 < arriveAt）、409 `NO_TRIP` |
| POST | `/letters/:id/trip/home` | — | 204。掉頭回家／先帶著信回家；櫃台做過的事（摺痕等）都留著 | 409 `NO_TRIP` |

出門後信紙鎖住，回家才能繼續寫。

## 5. 櫃台（需登入，且已走進郵局）

所有櫃台端點在「沒出門或還沒走進去」時回 409 `NOT_AT_POST_OFFICE`。

| 方法 | 路徑 | 輸入 | 說明與錯誤 |
|---|---|---|---|
| GET | `/letters/:id/counter` | — | `CounterDTO` |
| PATCH | `/letters/:id/counter` | `{ env?, skinAttachmentId?, stamp?, stampAttachmentId?, pm?, pmAttachmentId?, rot?, emode? }` | 換信封：信放進去、貼郵票或信封寫字後 409 `ENVELOPE_LOCKED`；明信片與信紙不能互換（422）；`custom` 要先上傳信封圖。換郵票：貼上後 409 `STAMP_LOCKED`。換郵戳：蓋下後 409 `POSTMARK_LOCKED`。`rot`（轉方向）：放進去後 409 `ALREADY_DONE` |
| POST | `/letters/:id/counter/confirm-address` | — | 寄件人、收件人信箱都有效才通過；422 `INVALID_EMAIL`（`details.fields`） |
| POST | `/letters/:id/counter/envelope-text` | `{ zone: 'from'\|'to', text }` 或 `{ zone, stroke }` | 201。信封上的字，只追加；寫了就鎖信封 |
| POST | `/letters/:id/counter/folds` | `{ edge: 't'\|'b'\|'l'\|'r', at }` | 201。從某個邊緣往內摺，摺線在 `at`（信紙座標，必須落在目前外框內）；伺服器重算外框。422 `FOLD_OUT_OF_RANGE`、409 `TOO_MANY_FOLDS`（最多 6 次）、409 `ALREADY_DONE`（已放進信封）、422 明信片不用摺 |
| POST | `/letters/:id/counter/insert` | — | 伺服器判斷裝不裝得下（信封內徑：郵政／牛皮紙 1.05×0.52、中式直式 0.45×0.86、米白方 0.75×0.55，容差 0.004；先比寬再比長）。**422 `TOO_WIDE` 或 `TOO_LONG`**，訊息「塞不進去。信紙太寬／長了，要再摺。」 |
| POST | `/letters/:id/counter/seal` | — | 封口。409 `INVALID_STATE`（還沒放進去）、409 `ALREADY_DONE` |
| POST | `/letters/:id/counter/stamp` | `{ x, y, r }` | 貼郵票，一次，不能改。409 `ALREADY_DONE`、422（不在信封上） |
| POST | `/letters/:id/counter/postmark` | `{ x, y, r }` | 蓋郵戳，一次，不能改（可不蓋），記下 `pmAt` |
| POST | `/letters/:id/post` | — | **投郵筒**：檢查寄出前條件（422 `NOT_READY` + `missing`；409 `REFS_PENDING`），建立寄件、單號（UPU S10）、送達計畫與排程；信變唯讀。201 `ShipmentDTO` |

## 6. 物流

| 方法 | 路徑 | 輸入 | 輸出 | 錯誤 |
|---|---|---|---|---|
| GET | `/track/:no` | — | 公開查詢 `TrackDTO`，信箱遮成 `w***@example.org`，只列已發生的事件 | 404（格式或檢查碼不對、查無單號） |
| GET | `/shipments` | — | 需登入。`{ shipments: ShipmentDTO[] }` | — |
| GET | `/shipments/:no` | — | 需登入，只能看自己寄的 | 404 |
| POST | `/shipments/:no/recipient-email` | `{ email }` | 需登入。改收件信箱：送達 24h 後可改 1 次、48h 後再 1 次（沒用掉的會累積，最多共 2 次）；改完舊開信連結立刻失效，一小時後（推到上班時間）重新投遞 | 409 `NOT_DELIVERED`／`NO_EDITS_LEFT`／`SAME_EMAIL`／`SIGNED`／`RETURNED`、422 `INVALID_EMAIL` |

D-005（暫定）：24h／48h／30 天一律從**第一次送達**起算，改信箱不重新起算。

## 7. 收信（不需要登入，靠開信連結）

開信連結：`APP_URL/r/:token`，token 由伺服器密鑰與（寄件, 第幾次投遞）決定。D-004（暫定）：收件人收到的是通知 + 連結，不是信件內容。

| 方法 | 路徑 | 輸入 | 說明 |
|---|---|---|---|
| GET | `/r/:token` | — | `ReceiveDTO`。攤開（或撕破）之前 `letter` 是 `null` |
| POST | `/r/:token/enter` | — | 點開連結。明信片一進來就算打開（簽收） |
| POST | `/r/:token/open` | `{ method: 'knife'\|'tear', cutPath? }` | **開信即簽收**。膠貼信封用手撕，伺服器擲骰 50% 留下毛邊（`recv.rough`），結果存檔 |
| POST | `/r/:token/tear` | `{ x }`（0–1） | 撕毀（D-013 暫定：前端依軌跡判斷後回報位置，後端只驗證狀態）。位置夾在 0.2–0.8，產生四片碎片，也算簽收 |
| POST | `/r/:token/pieces` | `{ pieces: [{ k, x, y, rot }] }` | 撕毀後移動碎片（k：`eL`／`eR`／`lL`／`lR`） |
| POST | `/r/:token/pry-stamp` | — | 撬郵票，伺服器擲骰 40% 帶紙纖維（D-014 暫定），收進收藏 |
| POST | `/r/:token/pry-wax` | — | 撬火漆（只有火漆信封、開信前），40% 紙纖維，收進收藏 |
| POST | `/r/:token/pour` | — | 倒出來（要先開信） |
| POST | `/r/:token/unfold` | — | 攤開（要先倒出來），之後回應裡才有信的內容與摺痕 |
| POST | `/r/:token/collect` | — | 收進收藏（要先攤開） |
| GET | `/r/:token/attachments/:attId` | — | 讀附件（倒出來之後） |

錯誤：連結無效、已改寄 404 `INVALID_TOKEN`；已退回 410 `GONE`（或 404，退信後連結即清除）；順序不對 409 `INVALID_STATE`（`details.reason`：`NOT_ENTERED`、`NOT_OPENED`、`NOT_POURED`、`NOT_UNFOLDED`、`ALREADY_OPENED`、`ALREADY_TAKEN`、`NO_WAX`、`NOT_TORN` …）。

## 8. 收藏（需登入）

| 方法 | 路徑 | 輸出 |
|---|---|---|
| GET | `/collection` | `CollectionDTO { letters, stamps, waxes }`。收藏屬於**收件信箱**：用收到信的那個信箱登入就看得到 |

## 9. 排程（scheduled_jobs）

worker 每 30 秒（`WORKER_INTERVAL_MS`）輪詢一次到期的工作。`unique_key` 唯一，重排不會多一筆；認領用 `FOR UPDATE SKIP LOCKED`；寄信與標記完成在同一個交易，寄信再用 `unique_key` 當 idempotency key，**重跑不重寄**。失敗重試 5 次（指數退避，最長 60 分鐘）。

| kind | unique_key | 時間 | 動作 |
|---|---|---|---|
| `deliver` | `deliver:<寄件id>:<n>` | 送達時間（n=0）／改信箱後的重新投遞時間（n=1,2） | 產生開信連結，寄「有人給你寄了一封信」給收件人。已簽收、已退回、之後又改過信箱就略過 |
| `remind24` | `remind24:<寄件id>` | 第一次送達 + 24h | 未簽收才寄「24小時未簽收，請確認電子信箱是否正確」給寄件人 |
| `remind48` | `remind48:<寄件id>` | 第一次送達 + 48h | 同上，「48小時未簽收…」 |
| `return30` | `return30:<寄件id>` | 第一次送達 + 30 天 | 未簽收就退回：記下退回時間、清除開信連結、寄「你的信被退回了」給寄件人，`meta.postmark` 附退件郵戳參數 `{ place, shape, color, date }`（依目的地決定，與原型 `postmark()` 相同） |
| `unsent_ask` | `unsent_ask:<信id>:<放進抽屜時間>:<n>` | 放進抽屜（或上次詢問）+ 30 天 | 還在抽屜裡就寄「之前寫的那封信現在想寄出了嗎？」給本人並排下一次；畫面上按過「再放 30 天」就順延 |

## 10. 開發用（`NODE_ENV=production` 時不註冊）

| 方法 | 路徑 | 輸入 | 說明 |
|---|---|---|---|
| GET | `/dev/outbox?to=&limit=` | — | ConsoleMailer 寄出的信（D-002：開發階段不真的寄） |
| GET | `/dev/clock` | — | `{ now, offsetMs }` |
| POST | `/dev/clock` | `{ advanceMs? \| offsetMs? \| reset? }` | 時鐘偏移（等同原型右上角的「快轉」），調整後立刻跑一次排程，回傳 `jobs` |
| POST | `/dev/worker/run` | — | 立刻跑一次排程 |

也可以用環境變數 `DEV_CLOCK_OFFSET_MS` 設定啟動時的偏移。正式環境偏移永遠是 0。
