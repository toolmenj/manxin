# 慢信 API（apps/api）

Fastify + PostgreSQL（drizzle-orm）。API 規格見 [`docs/api.md`](../../docs/api.md)；時間規則在 [`packages/engine`](../../packages/engine)。

## 需要

- Node 24（`node -v`）
- PostgreSQL 16：用 Docker（`docker compose`），或沒有 Docker 時改用 PGlite（記憶體內的 PostgreSQL，不用安裝任何東西）

## 在本機跑起來

在專案根目錄（`C:\Users\jay\manxin`）：

```powershell
npm install
copy .env.example .env      # 之後視需要修改 .env
```

### A. 用 Docker 的 PostgreSQL（建議）

```powershell
npm run db:up               # docker compose up -d postgres（對外 5433 埠）
npm run db:migrate          # 建立資料表與觸發器
npm run db:seed             # 放入範例資料（可略過）
npm run dev                 # http://127.0.0.1:3000，改程式會自動重啟
```

### B. 沒有 Docker：PGlite

在 `.env` 加上 `DB_DRIVER=pglite`，然後：

```powershell
npm run dev
```

每次啟動都是空的資料庫，會自動遷移並放入範例資料（關掉就消失）。

### 試試看

```powershell
curl http://127.0.0.1:3000/time
curl -X POST http://127.0.0.1:3000/auth/magic-link -H "content-type: application/json" -d "{\"email\":\"zhe@example.com\"}"
curl http://127.0.0.1:3000/dev/outbox      # 看寄出的登入信，token 在 meta.token
```

範例資料的帳號：`zhe@example.com`（寄件人：書桌上一封信、抽屜裡一封、字紙冢兩張、一封已送達未簽收的寄件）、`wen@example.org`（收件人）。開信連結在 `/dev/outbox` 寄給 `wen@example.org` 的那封信裡。

快轉時間（等同原型右上角）：

```powershell
curl -X POST http://127.0.0.1:3000/dev/clock -H "content-type: application/json" -d "{\"advanceMs\":86400000}"
```

## 指令

| 指令（根目錄） | 作用 |
|---|---|
| `npm run dev` | 開發伺服器（tsx watch；排程 worker 在同一個程序，`WORKER_INLINE=true`） |
| `npm run worker` | 獨立的排程 worker（正式環境用；開發時的時鐘偏移只在 API 程序裡，獨立 worker 只讀 `DEV_CLOCK_OFFSET_MS`） |
| `npm test` | engine 與 api 的測試（api 測試預設用 PGlite，不需要 Docker） |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run db:up` | 啟動 docker compose 的 PostgreSQL 16 |
| `npm run db:migrate` | 套用 `apps/api/drizzle/` 的遷移 |
| `npm run db:seed` | 範例資料（已有就略過） |
| `npm run db:generate` | 改了 `src/db/schema.ts` 後產生新的遷移 |

用真的 PostgreSQL 跑 api 測試（會清空資料表，請用另一個資料庫）：

```powershell
$env:TEST_DATABASE_URL="postgres://manxin:manxin@localhost:5433/manxin_test"; npm run test:api
```

## 環境變數

見根目錄 `.env.example`。秘密（`APP_SECRET`、`RESEND_API_KEY`、`CWA_API_KEY`）只放 `.env`，不進版控。正式環境 `APP_SECRET` 至少 32 字元，否則不啟動。

## 目錄

```
src/
  app.ts            Fastify 組裝、錯誤格式、登入檢查
  server.ts         啟動（npm run dev / start）
  worker-main.ts    獨立排程 worker
  config.ts clock.ts context.ts
  db/               schema.ts（drizzle）、client.ts（pg / PGlite）、migrate-cli.ts、seed.ts
  routes/           auth、desk（書桌）、post（郵局、櫃台）、shipments（物流、收藏）、receive（收信）、dev
  services/         letters、counter、shipments、receive、auth、jobs（排程）、mailer、weather、courier、storage、mails（信件文字）
drizzle/            遷移（0000 資料表、0001 落子無悔的觸發器）
test/               API 測試（vitest + fastify.inject）
```

## 可替換的外部服務

| 介面 | 目前 | 之後 |
|---|---|---|
| `Mailer` | `ConsoleMailer`：印 log + 存 `dev_outbox` | `ResendMailer`（`MAILER=resend`，TODO） |
| `WeatherProvider` | `MockWeather`：原型的決定性隨機 | `CwaWeather`（中央氣象署，`WEATHER_PROVIDER=cwa`，TODO） |
| `CourierProvider` | `CountyTableCourier`：原型的縣市距離表 | 快遞網站或付費 API（D-007，TODO） |
| `Storage` | `LocalDiskStorage`（`UPLOAD_DIR`） | S3 相容儲存（TODO） |
