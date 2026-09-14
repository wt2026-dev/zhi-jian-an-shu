#!/bin/sh
# PGlite 数据备份脚本：打包数据目录为 tar.gz（文件名带时间戳），保留最近 7 天
set -e
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/backups}"
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/pglite-backup-$TIMESTAMP.tar.gz" -C "$DATA_DIR" .
echo "[backup] 已生成 $BACKUP_DIR/pglite-backup-$TIMESTAMP.tar.gz"
# 只保留最近 7 天（按文件名时间倒序取前 7 个）
ls -1t "$BACKUP_DIR"/pglite-backup-*.tar.gz 2>/dev/null | tail -n +8 | while read f; do
  rm -f "$f"
  echo "[backup] 已删除过期备份: $f"
done
