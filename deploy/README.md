# 部署慢信（自己架 Kubernetes／KubeSphere）

## 架構

```
使用者 ──HTTPS──> Ingress（ingress-nginx，網域與憑證）
                     │
                     ▼
              manxin-api（2 份）     ← 同一個程序提供前端網頁與 /api
                 │   ▲ initContainer：每次啟動前跑資料庫遷移（有鎖，不會互撞）
                 ▼
         manxin-postgres（PostgreSQL 16，持久儲存區 20Gi）  ← 上傳的檔案也存在這裡
                 ▲
              manxin-worker（1 份）  ← 送達通知、提醒、退信、抽屜詢問；用 Gmail 寄出待寄的信
                 │
                 └──> smtp.gmail.com:465

manxin-postgres-backup（CronJob，每天臺北 03:00，保留 14 天）
manxin-pgadmin（只能 port-forward，不對外）
```

一個映像檔三種用法：`node dist/server.mjs`（API＋網頁，預設）、`node dist/worker.mjs`（排程）、`node dist/migrate.mjs`（遷移）。

## 第一次部署

### 1. 準備

| 要準備的 | 怎麼拿 |
|---|---|
| 網域 | 自己的網域，DNS 指到叢集 Ingress 的對外 IP |
| HTTPS 憑證 | 叢集有 cert-manager 就自動申請（ingress.yaml 已寫好 annotation）；沒有就自己建 `manxin-tls` Secret |
| 寄信用的 Gmail | 建議另開一個慢信專用的 Gmail。開兩步驟驗證 → Google 帳戶「安全性」→「應用程式密碼」產生一組 16 碼密碼 |
| 映像檔倉庫 | 叢集拉得到的地方（Harbor、Docker Hub、GHCR…） |

### 2. 建置並推上映像檔

```bash
docker build -t <倉庫>/manxin:0.2.0 .
docker push <倉庫>/manxin:0.2.0
```

### 3. 改設定

- `k8s/kustomization.yaml`：`images` 的 `newName`、`newTag` 改成上一步的映像檔。
- `k8s/configmap.yaml`：`APP_URL`（https 網址）、`MAIL_FROM`（寄信的 Gmail）、`ADMIN_EMAILS`（管理員信箱）、`CONTACT_EMAIL`（隱私權政策上公開的聯絡信箱，**必填**）。寄信上限要調整的話加 `SEND_LIMIT_PER_DAY`（預設 5）、`SEND_LIMIT_PER_RECIPIENT`（預設 1）。
- `k8s/ingress.yaml`：`host` 與 `tls.hosts` 改成你的網域；`ingressClassName` 照叢集實際的 Ingress。
- `k8s/postgres.yaml`：叢集有指定儲存類別就填 `storageClassName`。
- 複製 `k8s/secret.example.yaml` 成 `k8s/secret.yaml` 填值（**不要進 git**，已在 .gitignore）：
  - `APP_SECRET`：`openssl rand -hex 32`。開信連結由它算出來，**上線後不要換**，換了所有舊連結都失效。
  - `POSTGRES_PASSWORD`：`openssl rand -hex 24`；`DATABASE_URL` 裡的密碼要一樣。
  - `SMTP_USER`／`SMTP_PASS`：Gmail 帳號與應用程式密碼。
  - `CWA_API_KEY`（選填）：中央氣象署開放資料授權碼（https://opendata.cwa.gov.tw 註冊會員），有填就用真的一週天氣，沒填用模擬天氣。
  - `PGADMIN_DEFAULT_EMAIL`／`PASSWORD`：pgAdmin 登入用。

### 4. 部署

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/secret.yaml
kubectl apply -k deploy/k8s
kubectl -n manxin get pods -w
```

用 KubeSphere 的話：建立專案 `manxin` → 「應用負載」→「建立」→ 以 YAML 匯入（依序貼 secret.yaml 與 `kubectl kustomize deploy/k8s` 產生的內容）。

設定有錯時 API 與 worker 會**拒絕啟動**，並在 log 列出哪一項不對（例如 APP_URL 不是 https、APP_SECRET 還是範例值、少了 SMTP 密碼）。

### 5. 上線後檢查

1. 打開網站，用自己的信箱登入（收得到登入信 = Gmail 設定對了）。
2. 寄一封信給自己的另一個信箱，等送達（真的時間，不能快轉）。
3. 用 `ADMIN_EMAILS` 裡的信箱登入，頁首會多一個「管理」，看寄信、排程有沒有失敗。

## 更新版本

```bash
docker build -t <倉庫>/manxin:0.2.1 . && docker push <倉庫>/manxin:0.2.1
# 改 kustomization.yaml 的 newTag
kubectl apply -k deploy/k8s
```

API 會一份一份換（maxUnavailable: 0），新的 Pod 啟動前先跑遷移。

## 管理員怎麼看後端

| 要看什麼 | 在哪裡 |
|---|---|
| 服務活著沒、重開、log、CPU 與記憶體 | KubeSphere：專案 manxin →「工作負載」→ 點 manxin-api／manxin-worker →「容器記錄」「監控」 |
| 使用者數、信在路上幾封、寄信或排程失敗、資料庫大小 | 慢信網站的「管理」頁（`/admin`），失敗的可以按「重試」。**看不到信件內容** |
| 檢舉、停權 | 管理頁的「檢舉」區：只看得到原因、檢舉人寫的說明、被檢舉次數；按「停權」對方就不能再寄信，「不成立」關掉這筆 |
| 資料庫原始資料 | pgAdmin：`kubectl -n manxin port-forward svc/manxin-pgadmin 5050:80`，打開 http://localhost:5050 。新增伺服器：主機 `manxin-postgres`、帳號 `manxin`、密碼 `POSTGRES_PASSWORD`。**這裡看得到信件內容，只在處理問題時用** |

常用指令：

```bash
kubectl -n manxin logs deploy/manxin-api -f          # API log（登入與開信連結會被遮成 ***）
kubectl -n manxin logs deploy/manxin-worker -f       # 排程與寄信
kubectl -n manxin rollout restart deploy/manxin-api  # 重開
```

## 備份與還原

每天的備份在 `manxin-backup` 儲存區（`manxin-YYYYMMDD-HHMMSS.dump`）。**這個儲存區還在叢集裡**，機器整台壞掉會一起不見，所以另外用下面的「備份到自己的電腦」拉一份到叢集外。

還原（會覆蓋現有資料，先停 API 與 worker）：

```bash
kubectl -n manxin scale deploy/manxin-api deploy/manxin-worker --replicas=0
kubectl apply -f deploy/k8s/tools/restore-pod.yaml
kubectl -n manxin exec manxin-restore -- ls -lh /backup            # 挑要還原的檔案
kubectl -n manxin exec manxin-restore -- pg_restore -h manxin-postgres -U manxin -d manxin --clean --if-exists /backup/<檔名>.dump
kubectl -n manxin delete pod manxin-restore
kubectl -n manxin scale deploy/manxin-api --replicas=2
kubectl -n manxin scale deploy/manxin-worker --replicas=1
```

## 備份到自己的電腦（D-045）

叢集裡的每日備份機器壞了會一起不見，所以再拉一份到自己電腦（預設 `Documents\manxin-backup`，保留 30 天）：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\backup\pull-backup.ps1
```

腳本會檢查備份檔開頭是 pg_dump 的格式標記，不對就報錯。要每天自動跑，可以自己建 Windows 排程工作（腳本開頭有指令範例；這會改到系統的排程設定，所以沒有幫你設）。

2026-11-12 用 `-Mode docker` 對本機正式環境實測：備份 56,815 bytes，還原到空資料庫後使用者、書寫紀錄、遷移數都對得上。

## 在自己電腦驗證正式版

不用叢集，把正式版整套跑起來（寄信接到假郵件伺服器 Mailpit）：

```bash
docker compose -f deploy/docker-compose.prod.yml up --build
```

- http://localhost:8080 ：慢信（正式設定，只是用 http）
- http://localhost:8025 ：Mailpit，看寄出的登入信與送達通知
- 管理員信箱：`admin@manxin.local`

2026-11-12 實際跑過：遷移完成、API 與 worker 起來、登入信經 SMTP 寄到 Mailpit、寄出的信內文從資料庫清掉、log 裡的登入連結遮成 `token=***`、開發用路由 404、安全標頭齊全、瀏覽器沒有 CSP 錯誤。過程中抓到打包漏了 PGlite 驅動（容器一啟動就找不到套件），已修，CI 也加了檢查。

## 容量估計（推測，上線後用管理頁的數字修正）

- 一封打字的信約幾 KB；手寫一筆筆畫約 1–20 KB；上傳圖片上限 10 MB、字型 20 MB。
- 資料庫 20Gi 足夠初期使用；管理頁的「資料庫大小」接近 15 GB 就要擴充儲存區。
- Gmail 每天的寄信上限（推測一般帳號約 500 封，Google Workspace 較多；以 Google 官方說明為準）。慢信每人每天最多寄 5 封，加上登入信與提醒，使用者多時要留意；寄信量大時改用正式的寄信服務，只要改 SMTP 設定。
