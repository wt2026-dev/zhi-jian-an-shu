#!/usr/bin/env node
/**
 * 备份恢复演练脚本（G4，2026-10-19 试点加固）——在隔离临时目录验证备份可用性。
 *
 * 用法：
 *   node scripts/restore-drill.mjs backups/pglite-snapshot-2026-10-19T11-50-00.tar.gz
 *
 * 流程：临时目录解包 → PGlite 重新打开 → 校验关键表与迁移版本 → 输出 PASS/FAIL → 清理临时目录。
 * 安全承诺：全程只读真实备份文件、只写系统临时目录，**绝不触碰真实数据目录、绝不删除任何业务数据**。
 *
 * 退出码：0 演练通过（备份可用于恢复）；1 演练失败（该备份不可用，需排查后重新备份）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

const CRITICAL_TABLES = [
  "users", "equipments", "work_orders", "safety_permits", "audit_logs", "work_order_logs", "schema_migrations",
];

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("用法: node scripts/restore-drill.mjs <pglite-snapshot-*.tar.gz>");
  console.error("提示: 先运行 node scripts/backup-db.mjs 生成一致性快照。");
  process.exit(1);
}
const backupAbs = path.resolve(file);

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pglite-restore-drill-"));
const dataDir = path.join(workDir, "restored");
fs.mkdirSync(dataDir, { recursive: true });

let failed = false;
try {
  console.log(`[drill] 备份文件: ${backupAbs}`);
  console.log(`[drill] 隔离工作目录: ${workDir}（演练结束自动清理）`);
  // 备份文件先复制进工作目录再用相对名解包：Git-Bash 的 tar 会把 "D:\..." 里的冒号
  // 当成 host:path（报 Cannot connect to D:），而相对路径 + cwd 是跨 shell 唯一稳的写法。
  const stagedName = path.basename(backupAbs);
  fs.copyFileSync(backupAbs, path.join(workDir, stagedName));
  execFileSync("tar", ["-xzf", stagedName, "-C", path.basename(dataDir)], { cwd: workDir });
  console.log("[drill] 解包完成，正在以 PGlite 重新打开...");

  const db = new PGlite(dataDir);
  await db.waitReady;
  console.log("[drill] 打开成功，开始完整性校验:");

  for (const table of CRITICAL_TABLES) {
    try {
      const res = await db.query(`SELECT COUNT(*)::int AS n FROM "${table}";`);
      const n = Number(res.rows[0]?.n ?? 0);
      const criticalEmpty = table === "schema_migrations" && n === 0;
      console.log(`[drill]   ${criticalEmpty ? "FAIL" : "PASS"}  ${table}: ${n} 行${criticalEmpty ? "（迁移版本为空！）" : ""}`);
      if (criticalEmpty) failed = true;
    } catch (err) {
      console.log(`[drill]   FAIL  ${table}: 不可查询 (${err?.message || err})`);
      failed = true;
    }
  }

  if (!failed) {
    const mig = await db.query("SELECT filename FROM schema_migrations ORDER BY filename;");
    const names = mig.rows.map((r) => r.filename);
    const first = names[0] || "(无)";
    const last = names[names.length - 1] || "(无)";
    console.log(`[drill]   PASS  迁移版本 ${names.length} 个（${first} → ${last}）`);
  }

  await db.close().catch(() => undefined);
} catch (err) {
  console.error(`[drill] FAIL 演练异常: ${err?.message || err}`);
  failed = true;
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
  console.log("[drill] 临时目录已清理（真实数据目录全程未被触碰）。");
}

if (failed) {
  console.error("[drill] 结论：该备份不可用于恢复，请排查后重新执行 backup-db.mjs。");
  process.exit(1);
}
console.log("[drill] 结论：PASS——该备份已通过隔离环境恢复演练，可用于真实恢复。");
console.log("[drill] 提醒：真实恢复操作须先停止应用、确认数据目录路径，并另行人工执行；本脚本不执行真实恢复。");
