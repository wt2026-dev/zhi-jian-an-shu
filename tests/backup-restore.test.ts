// G4 备份/恢复演练测试（2026-10-19 试点加固）
// 目标：验证 PGlite dumpDataDir → 隔离目录重开 → 关键表/迁移版本校验 的完整链路，
// 以及 verifySnapshotDb 对损坏/不完整快照的拒绝能力。全程使用系统临时目录，
// 绝不触碰真实数据目录（安全红线：测试用隔离数据库与临时目录）。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
// 先经 server.ts 建立模块加载环境（与其他测试一致），再引备份服务
import { createApp } from "../server.ts";
import { dumpPgliteToBuffer, verifySnapshotDb, PGlite } from "../src/server/services/backupService.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 在指定目录建立一个"完整业务库"形态的最小快照（含全部关键表与迁移版本） */
async function buildFullSnapshotDb(dataDir: string): Promise<void> {
  const db = new PGlite(dataDir);
  await db.waitReady;
  try {
    await db.exec("CREATE TABLE users (id text, username text, password_hash text);");
    await db.exec("CREATE TABLE equipments (id text, name text);");
    await db.exec("CREATE TABLE work_orders (id text, status text);");
    await db.exec("CREATE TABLE safety_permits (id text, status text);");
    await db.exec("CREATE TABLE audit_logs (id text);");
    await db.exec("CREATE TABLE work_order_logs (id text);");
    await db.exec("CREATE TABLE schema_migrations (filename text, applied_at timestamp);");
    await db.exec("INSERT INTO users VALUES ('u1','admin','x'), ('u2','tech1','y');");
    await db.exec("INSERT INTO equipments VALUES ('e1','泵A');");
    await db.exec("INSERT INTO work_orders VALUES ('w1','created');");
    await db.exec("INSERT INTO schema_migrations VALUES ('001_init.sql', now()), ('027_business_loops.sql', now());");
  } finally {
    await db.close().catch(() => undefined);
  }
}

describe("G4 备份一致性与恢复演练 (Backup & Restore Drill Suite)", () => {
  it("dump → 隔离目录解包重开 → 业务数据完整保留（往返一致性）", { timeout: 120_000 }, async () => {
    const src = tmpDir("g4-src-");
    await buildFullSnapshotDb(src);

    const buf = await dumpPgliteToBuffer(src);
    expect(buf.length).toBeGreaterThan(0);

    // 解包到隔离目录
    const work = tmpDir("g4-drill-");
    const restored = path.join(work, "data");
    fs.mkdirSync(restored, { recursive: true });
    const dumpFile = path.join(work, "snap.tar.gz");
    fs.writeFileSync(dumpFile, buf);
    // 相对路径调用 tar，规避 Windows 盘符歧义（Linux 生产无此问题，行为一致）
    execFileSync("tar", ["-xzf", "snap.tar.gz", "-C", "data"], { cwd: work });

    const db = new PGlite(restored);
    await db.waitReady;
    const users = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM users;");
    const eq = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM equipments;");
    const mig = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM schema_migrations;");
    expect(Number(users.rows[0].n)).toBe(2);
    expect(Number(eq.rows[0].n)).toBe(1);
    expect(Number(mig.rows[0].n)).toBe(2);
    await db.close();

    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("verifySnapshotDb：完整快照 PASS（关键表齐全 + 迁移版本非空）", { timeout: 90_000 }, async () => {
    const src = tmpDir("g4-verify-ok-");
    const db = new PGlite(src);
    await db.waitReady;
    await db.exec("CREATE TABLE users (id text);");
    await db.exec("CREATE TABLE equipments (id text);");
    await db.exec("CREATE TABLE work_orders (id text);");
    await db.exec("CREATE TABLE safety_permits (id text);");
    await db.exec("CREATE TABLE audit_logs (id text);");
    await db.exec("CREATE TABLE work_order_logs (id text);");
    await db.exec("CREATE TABLE schema_migrations (filename text);");
    await db.exec("INSERT INTO schema_migrations VALUES ('001_init.sql');");

    const result = await verifySnapshotDb(db);
    expect(result.ok).toBe(true);
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    await db.close();
    fs.rmSync(src, { recursive: true, force: true });
  });

  it("verifySnapshotDb：缺关键表 FAIL（疑似损坏/外库快照）", { timeout: 90_000 }, async () => {
    const src = tmpDir("g4-verify-missing-");
    const db = new PGlite(src);
    await db.waitReady;
    await db.exec("CREATE TABLE users (id text);"); // 只有 users，其余关键表缺失
    const result = await verifySnapshotDb(db);
    expect(result.ok).toBe(false);
    const failed = result.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toContain("table:schema_migrations");
    expect(failed.length).toBeGreaterThanOrEqual(5);
    await db.close();
    fs.rmSync(src, { recursive: true, force: true });
  });

  it("verifySnapshotDb：schema_migrations 为空 FAIL（迁移版本缺失）", { timeout: 90_000 }, async () => {
    const src = tmpDir("g4-verify-emptymig-");
    const db = new PGlite(src);
    await db.waitReady;
    for (const t of ["users", "equipments", "work_orders", "safety_permits", "audit_logs", "work_order_logs", "schema_migrations"]) {
      await db.exec(`CREATE TABLE ${t} (id text);`);
    }
    // 建了表但没有登记任何迁移版本
    const result = await verifySnapshotDb(db);
    expect(result.ok).toBe(false);
    const emptyMig = result.checks.find((c) => c.name === "table:schema_migrations");
    expect(emptyMig?.ok).toBe(false);
    await db.close();
    fs.rmSync(src, { recursive: true, force: true });
  });
});
