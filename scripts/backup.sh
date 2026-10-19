#!/bin/sh
# 数据库备份入口（cron 兼容）——实际逻辑在 scripts/backup-db.mjs（一致性快照 + 自校验 + 保留策略）。
# 环境变量说明见 backup-db.mjs 头注释。退出码非 0 = 失败（定时任务可据此告警）。
#
# ⚠️ PGlite 模式须先停止应用（数据目录被持有会 fail-fast，绝不静默产出不一致备份）。
set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
exec node "$SCRIPT_DIR/backup-db.mjs" "$@"
