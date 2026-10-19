/**
 * 数据库备份/恢复校验服务（G4，2026-10-19 试点加固）
 *
 * 设计目标：
 * - 用 PGlite 官方 dumpDataDir() 生成**数据目录一致性快照**，替代对活数据目录直接 tar
 *   （活目录 tar 在写入进行中会产出不可恢复的损坏备份）。
 * - 恢复演练在**隔离临时目录**完成：解包 → 以 PGlite 重新打开 → 校验关键表与迁移版本 → 清理。
 *   绝不触碰真实数据目录，绝不删除用户数据。
 *
 * 一致性前提：PGlite 为单连接嵌入式库，dump 前数据目录必须未被应用进程持有
 * （即应用已停止）。脚本层会 fail-fast 并给出指引，不静默产出不一致备份。
 *
 * postgres 模式由脚本层调用 pg_dump（自定义格式 -Fc）实现，本模块仅覆盖 PGlite。
 */
import { PGlite } from "@electric-sql/pglite";

export interface SnapshotCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SnapshotVerifyResult {
  ok: boolean;
  checks: SnapshotCheck[];
}

/** 恢复完整性必须存在的关键表（业务闭环 + 审计 + 迁移版本） */
export const CRITICAL_TABLES = [
  "users",
  "equipments",
  "work_orders",
  "safety_permits",
  "audit_logs",
  "work_order_logs",
  "schema_migrations",
] as const;

/**
 * 打开指定数据目录并导出一致性快照（gzip tar 格式）。
 * @param dataDir PGlite 数据目录（如 data/industrial_ops_pg）
 */
export async function dumpPgliteToBuffer(dataDir: string): Promise<Buffer> {
  const db = new PGlite(dataDir);
  await db.waitReady;
  try {
    const dump = await db.dumpDataDir("gzip");
    const buf = Buffer.from(await dump.arrayBuffer());
    return buf;
  } finally {
    await db.close().catch(() => undefined);
  }
}

/**
 * 校验一个已打开的 PGlite 实例是否为可用的本系统数据库快照。
 * 硬性失败条件：关键表缺失、schema_migrations 为空（非本系统库 / 迁移未执行）。
 * users 行数仅报告不强校验（SEED_MODE=off 的合法部署 users 由管理员手工建立）。
 */
export async function verifySnapshotDb(db: PGlite): Promise<SnapshotVerifyResult> {
  const checks: SnapshotCheck[] = [];
  let ok = true;

  for (const table of CRITICAL_TABLES) {
    try {
      const res = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "${table}";`
      );
      const n = Number(res.rows[0]?.n ?? 0);
      const isCriticalEmpty = table === "schema_migrations" && n === 0;
      checks.push({
        name: `table:${table}`,
        ok: !isCriticalEmpty,
        detail: isCriticalEmpty ? "存在但为空（迁移版本缺失）" : `${n} 行`,
      });
      if (isCriticalEmpty) ok = false;
    } catch (err: any) {
      checks.push({ name: `table:${table}`, ok: false, detail: `查询失败: ${err?.message || err}` });
      ok = false;
    }
  }

  if (ok) {
    try {
      const mig = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM schema_migrations;");
      checks.push({
        name: "migrations:versioned",
        ok: true,
        detail: `已记录 ${mig.rows[0]?.n ?? 0} 个迁移版本`,
      });
    } catch {
      /* 上面 table 检查已覆盖 */
    }
  }

  return { ok, checks };
}

export { PGlite };
