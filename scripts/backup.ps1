# Windows 宿主机备份脚本：直接压缩挂载卷数据（Docker Desktop WSL2 场景）
# 用法: powershell -File scripts\backup.ps1
$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $PSScriptRoot "..\backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
docker run --rm -v industrial-maintenance_appdata:/data:ro -v "${backupDir}:/backup" alpine `
  tar -czf "/backup/pglite-backup-$ts.tar.gz" -C /data .
Write-Host "[backup] 已生成 $backupDir\pglite-backup-$ts.tar.gz"
# 保留最近 7 天
Get-ChildItem $backupDir -Filter "pglite-backup-*.tar.gz" | Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 7 | ForEach-Object { Remove-Item $_.FullName; Write-Host "[backup] 已删除过期备份: $($_.Name)" }
