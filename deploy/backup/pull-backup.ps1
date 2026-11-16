<#
.SYNOPSIS
  把慢信的資料庫備份拉到這台電腦（異地備份，2026-11-12 使用者決定放自己的電腦）。

.DESCRIPTION
  在叢集裡的 PostgreSQL 跑 pg_dump（自訂格式，含上傳的檔案），再複製回本機，保留 $KeepDays 天。
  叢集裡每天凌晨也有自己的備份（postgres-backup.yaml）；這支是把一份放到叢集外，機器整台壞掉時還救得回來。

  需要：能連到叢集的 kubectl（-Mode k8s，預設），或本機 Docker（-Mode docker，用 deploy/docker-compose.prod.yml 驗證用）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\backup\pull-backup.ps1

.EXAMPLE
  # 每天晚上 11 點自動執行（要不要設由你決定；這會新增一個 Windows 排程工作）
  schtasks /Create /SC DAILY /ST 23:00 /TN "manxin-backup" /TR "powershell -ExecutionPolicy Bypass -File C:\Users\jay\Projects\apps\manxin\deploy\backup\pull-backup.ps1"

.EXAMPLE
  # 還原到叢集（會覆蓋現有資料，先停 API 與 worker，見 deploy/README.md）
  kubectl -n manxin cp .\manxin-20261112-230000.dump manxin-postgres-0:/tmp/restore.dump
  kubectl -n manxin exec manxin-postgres-0 -- pg_restore -U manxin -d manxin --clean --if-exists /tmp/restore.dump
#>
param(
  [string]$Dest = (Join-Path $env:USERPROFILE 'Documents\manxin-backup'),
  [int]$KeepDays = 30,
  [ValidateSet('k8s', 'docker')][string]$Mode = 'k8s',
  [string]$Namespace = 'manxin',
  [string]$Pod = 'manxin-postgres-0',
  [string]$Container = 'manxin-prod-local-postgres-1'
)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "manxin-$stamp.dump"
$remote = "/tmp/$name"
$local = Join-Path $Dest $name

# PowerShell 的管線會把二進位資料當文字改壞，所以先在容器裡寫成檔案，再整個檔案複製回來
if ($Mode -eq 'k8s') {
  & kubectl -n $Namespace exec $Pod -- pg_dump -U manxin -d manxin -Fc -f $remote
  if ($LASTEXITCODE -ne 0) { throw "pg_dump 失敗（exit $LASTEXITCODE）" }
  & kubectl -n $Namespace cp "${Pod}:$remote" $local
  if ($LASTEXITCODE -ne 0) { throw "kubectl cp 失敗（exit $LASTEXITCODE）" }
  & kubectl -n $Namespace exec $Pod -- rm -f $remote | Out-Null
} else {
  & docker exec $Container pg_dump -U manxin -d manxin -Fc -f $remote
  if ($LASTEXITCODE -ne 0) { throw "pg_dump 失敗（exit $LASTEXITCODE）" }
  & docker cp "${Container}:$remote" $local
  if ($LASTEXITCODE -ne 0) { throw "docker cp 失敗（exit $LASTEXITCODE）" }
  & docker exec $Container rm -f $remote | Out-Null
}

# 檢查：檔案要有內容，而且開頭是 pg_dump 自訂格式的標記 PGDMP
$f = Get-Item $local
$head = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($local)[0..4])
if ($f.Length -lt 1024 -or $head -ne 'PGDMP') {
  throw "備份檔看起來不對（大小 $($f.Length) bytes，開頭「$head」），保留原檔供檢查：$local"
}
Write-Output ("備份完成：{0}（{1:N1} MB）" -f $local, ($f.Length / 1MB))

# 刪掉超過 $KeepDays 天的舊備份（只刪這支腳本產生的 manxin-*.dump）
$old = Get-ChildItem -Path $Dest -Filter 'manxin-*.dump' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) }
foreach ($o in $old) {
  Remove-Item -LiteralPath $o.FullName -Force -Confirm:$false
  Write-Output "刪除超過 $KeepDays 天的舊備份：$($o.Name)"
}
