#!/bin/sh
# 恢复演练入口——校验备份文件可用性（隔离临时目录，绝不触碰真实数据）。
# 用法: ./restore.sh backups/pglite-snapshot-<TS>.tar.gz
#
# 真实恢复操作（会覆盖数据）不由脚本自动执行：须先停止应用、备份当前数据目录、
# 人工确认后手工解包快照到数据目录，再启动应用并核对 /ready 与关键业务数据。
set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
exec node "$SCRIPT_DIR/restore-drill.mjs" "$@"
