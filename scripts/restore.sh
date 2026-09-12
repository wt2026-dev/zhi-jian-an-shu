#!/bin/sh
# 恢复脚本：从指定备份文件恢复 PGlite 数据
# 用法: ./restore.sh backups/pglite-backup-20260906-020000.tar.gz
set -e
FILE="$1"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法: $0 <备份文件路径>  (例如 backups/pglite-backup-20260906-020000.tar.gz)"
  exit 1
fi
echo "[restore] 停止应用容器..."
docker compose stop app
echo "[restore] 清空数据卷并恢复 $FILE ..."
docker run --rm -v industrial-maintenance_appdata:/data -v "$(pwd)/$(dirname "$FILE"):/backup:ro" alpine \
  sh -c "rm -rf /data/* && tar -xzf /backup/$(basename $FILE) -C /data"
echo "[restore] 重启应用容器..."
docker compose start app
echo "[restore] 恢复完成。"
