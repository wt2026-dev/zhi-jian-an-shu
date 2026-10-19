#!/usr/bin/env node
/**
 * 数据库一致性备份脚本（G4，2026-10-19 试点加固）——替代旧 backup.sh 活目录 tar。
 *
 * 用法：
 *   node scripts/backup-db.mjs
 *
 * 环境变量：
 *   DB_TYPE        pglite（默认）| postgres
 *   DATA_DIR       PGlite 数据目录（默认 data/industrial_ops_pg）
 *   BACKUP_DIR     备份输出目录（默认 backups/）
 *   BACKUP_KEEP_N  保留最近 N 份（默认 7，0 = 不清理）
 *   PGDUMP_BIN     postgres 模式的 pg_dump 可执行文件（默认 pg_dump）
 *
 * 退出码：0 成功；非 0 失败（cron/定时任务可据此告警）。
 *
 * ⚠️ PGlite 模式一致性前提：数据目录必须未被应用进程持有（先停应用再备份）。
 *    若应用仍在运行，本脚本会因目录锁 fail-fast 退出，绝不静默产出不一致备份。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

const DB_TYPE = (process.env.DB_TYPE || "pglite").toLowerCase();
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(projectRoot, "backups");
const KEEP_N = Number(process.env.BACKUP_KEEP_N || 7);
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const CRITICAL_TABLES = [
  "users", "equipments", "work_orders", "safety_permits", "audit_logs", "work_order_logs", "schema_migrations",
];

function log(msg) {
  console.log(`[backup] ${msg}`);
}

function pruneOldBackups() {
  if (KEEP_N <= 0) return;
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^(pglite-snapshot|pg-dump)-.*\.(tar\.gz|dump)$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(KEEP_N)) {
    fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
    log(`已删除过期备份: ${f}`);
  }
}

async function backupPglite() {
  const dataDir = process.env.DATA_DIR || path.join(projectRoot, "data", "industrial_ops_pg");
  if (!fs.existsSync(dataDir)) {
    console.error(`[backup][FATAL] 数据目录不存在: ${dataDir}（首次启动前无需备份）`);
    process.exit(1);
  }

  const db = new PGlite(dataDir);
  try {
    await db.waitReady;
  } catch (err) {
    console.error(`[backup][FATAL] 无法打开数据目录 ${dataDir}：${err?.message || err}`);
    console.error(`[backup][FATAL] 最常见原因：应用进程仍在运行并持有该目录。请先停止应用（systemctl stop industrial-app）再执行备份。`);
    process.exit(1);
  }

  log(`正在生成一致性快照（PGlite dumpDataDir/gzip）...`);
  const dump = await db.dumpDataDir("gzip");
  const buf = Buffer.from(await dump.arrayBuffer());
  await db.close().catch(() => undefined);

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const outFile = path.join(BACKUP_DIR, `pglite-snapshot-${TIMESTAMP}.tar.gz`);
  fs.writeFileSync(outFile, buf);
  log(`快照完成: ${outFile}（${(buf.length / 1024 / 1024).toFixed(1)} MB）`);

  // 快照自校验：解包到临时目录重新打开，关键表必须可查、迁移版本必须非空
  log("开始快照自校验（隔离临时目录）...");
  const os = await import("node:os");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pglite-backup-verify-"));
  const extractDir = path.join(workDir, "data");
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    execFileSync("tar", ["-xzf", path.basename(outFile), "-C", "data"], { cwd: workDir });
    const db2 = new PGlite(extractDir);
    await db2.waitReady;
    let ok = true;
    for (const table of CRITICAL_TABLES) {
      try {
        await db2.query(`SELECT COUNT(*) FROM "${table}";`);
      } catch (e) {
        console.error(`[backup][FATAL] 自校验失败：关键表 ${table} 不可查询: ${e?.message || e}`);
        ok = false;
      }
    }
    const mig = await db2.query("SELECT COUNT(*)::int AS n FROM schema_migrations;");
    if (Number(mig.rows[0]?.n ?? 0) === 0) {
      console.error("[backup][FATAL] 自校验失败：schema_migrations 为空（疑似非本系统快照）");
      ok = false;
    }
    await db2.close().catch(() => undefined);
    if (!ok) {
      fs.rmSync(outFile, { force: true });
      console.error("[backup][FATAL] 已删除未通过自校验的备份文件。请检查磁盘与数据目录状态。");
      process.exit(1);
    }
    log(`自校验通过：${CRITICAL_TABLES.length} 张关键表可查、迁移版本 ${mig.rows[0].n} 条`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function backupPostgres() {
  const pgdump = process.env.PGDUMP_BIN || "pg_dump";
  const args = [
    "-Fc", // 自定义格式（支持并行恢复与选择性恢复，比纯 SQL 更紧凑可靠）
    "--no-owner",
    "--no-privileges",
    "-h", process.env.DB_HOST || "localhost",
    "-p", process.env.DB_PORT || "5432",
    "-U", process.env.DB_USER || "postgres",
    "-d", process.env.DB_NAME || "industrial_maintenance",
    "-f", path.join(BACKUP_DIR, `pg-dump-${TIMESTAMP}.dump`),
  ];
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  log(`正在执行 pg_dump（自定义格式）...`);
  try {
    execFileSync(pgdump, args, {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || "" },
      stdio: "inherit",
    });
  } catch (err) {
    console.error(`[backup][FATAL] pg_dump 执行失败（退出码 ${err?.status}）。请检查 DB_* 连接参数与 pg_dump 版本。`);
    process.exit(1);
  }
  log(`备份完成: ${path.join(BACKUP_DIR, `pg-dump-${TIMESTAMP}.dump`)}`);
}

if (DB_TYPE === "postgres") {
  backupPostgres();
} else if (DB_TYPE === "pglite") {
  await backupPglite();
} else {
  console.error(`[backup][FATAL] DB_TYPE 取值非法: ${DB_TYPE}（合法值: pglite | postgres）`);
  process.exit(1);
}
pruneOldBackups();
log(`保留策略：最近 ${KEEP_N} 份（BACKUP_KEEP_N 可调，0 为不清理）`);
log("备份成功。提醒：备份的目标位置（异地/外接存储）与告警通道由部署方配置，本脚本仅保证本地输出与退出码。");
