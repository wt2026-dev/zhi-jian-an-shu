/**
 * SEED_MODE 三档种子策略 + 迁移版本追踪（schema_migrations）行为测试。
 *
 * 背景（生产差距清单 G2/G3）：
 *   - G2：此前 users 表为空即自动灌 9 个源码固定口令演示账号，试点/生产首启即带已知口令；
 *   - G3：此前迁移无版本表，每次启动全量重跑靠吞 "already exists" 报错，无法感知 schema 版本。
 * 本文件验证：SEED_MODE=demo|minimal|off 的行为边界、非法值 fail-fast、
 * 迁移版本表只执行一次、已应用迁移不再重复执行。
 *
 * 环境隔离：NODE_ENV=test → 内存 PGlite（每测试文件独立实例）；不触碰任何真实数据库。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
// 先经 server.ts 建立模块加载环境（与其他测试一致），再引 db 模块
import { createApp } from "../server.ts";
import { initDatabase, resolveSeedMode, getDb, runMigrations } from "../src/db/db.ts";
import { seedMinimalAdmin } from "../src/db/seed.ts";

// 保存/恢复环境变量，避免污染同文件其它用例
const ENV_KEYS = ["SEED_MODE", "SEED_ADMIN_PASSWORD", "SEED_ADMIN_USERNAME"];
const savedEnv: Record<string, string | undefined> = {};
beforeAll(async () => {
  process.env.NODE_ENV = "test";
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  await createApp(); // 建库 + 建版本表（首次以默认行为跑迁移并登记版本）
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("SEED_MODE 种子策略（试点部署基线 G2）", () => {
  // 种子用例彼此要求空 users 表（initDatabase/seedMinimalAdmin 都是"表空才灌"语义）
  beforeEach(async () => {
    const db = await getDb();
    await db.query("DELETE FROM users;");
  });

  it("resolveSeedMode：未配置时默认 demo（保持现状兼容）", () => {
    expect(resolveSeedMode()).toBe("demo");
  });

  it.each(["minimal", "off"])("resolveSeedMode：合法值 %s 被接受", (mode) => {
    process.env.SEED_MODE = mode;
    expect(resolveSeedMode()).toBe(mode);
  });

  it.each(["DEMO", "", "demo ", " Minimal"])(
    "resolveSeedMode：宽容归一化（大小写/首尾空白/空串视为对应合法值）—— %s",
    (raw) => {
      process.env.SEED_MODE = raw;
      // 空串按"未配置"处理回落 demo；带空白/大小写变体归一化后接受
      expect(resolveSeedMode()).toBe(raw.trim().toLowerCase() || "demo");
    }
  );

  it.each(["production", "prod", "yes", "minimalist", "off=1"])(
    "resolveSeedMode：真正非法的取值 fail-fast —— %s",
    (bad) => {
      process.env.SEED_MODE = bad;
      expect(() => resolveSeedMode()).toThrow(/SEED_MODE/);
    }
  );

  it("SEED_MODE=off：users 保持为空，绝不灌任何账号", async () => {
    process.env.SEED_MODE = "off";
    const db = await initDatabase();
    const { rows } = await db.query<{ count: string }>("SELECT COUNT(*) AS count FROM users;");
    expect(Number(rows[0].count)).toBe(0);
  });

  it("SEED_MODE=minimal：仅 1 个 admin，口令来自环境变量且 Bcrypt 可验证，无演示账号", async () => {
    process.env.SEED_MODE = "minimal";
    process.env.SEED_ADMIN_PASSWORD = "Pilot#2026#StrongPass!";
    const db = await initDatabase();
    const { rows } = await db.query<{ username: string; password: string; role: string }>(
      "SELECT username, password, role FROM users;"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe("admin");
    expect(rows[0].role).toBe("admin");
    // 口令必须与注入值匹配，且绝不等于任何演示口令
    expect(bcrypt.compareSync("Pilot#2026#StrongPass!", rows[0].password)).toBe(true);
    expect(bcrypt.compareSync("Admin@2026#Demo", rows[0].password)).toBe(false);
  });

  it("SEED_MODE=minimal：未注入口令时随机生成 16 字符一次性口令（仅控制台输出一次），仍是强哈希", async () => {
    process.env.SEED_MODE = "minimal";
    const logs: string[] = [];
    const conSpy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.join(" "));
    });
    try {
      const result = await seedMinimalAdmin();
      expect(result.passwordSource).toBe("generated");
      expect(result.generatedPassword).toMatch(/^[A-Za-z0-9_-]{16}$/);
      // 一次性口令必须出现在启动日志（否则部署者拿不到），且只出现一次
      const hits = logs.filter((l) => l.includes(result.generatedPassword!));
      expect(hits).toHaveLength(1);
      // 哈希可验证
      const db = await getDb();
      const { rows } = await db.query<{ password: string }>(
        "SELECT password FROM users WHERE username = $1;",
        ["admin"]
      );
      expect(rows).toHaveLength(1);
      expect(bcrypt.compareSync(result.generatedPassword!, rows[0].password)).toBe(true);
    } finally {
      conSpy.mockRestore();
    }
  });

  it("SEED_MODE=minimal：弱口令（<12 位）拒绝创建", async () => {
    process.env.SEED_ADMIN_PASSWORD = "short";
    await expect(seedMinimalAdmin()).rejects.toThrow(/12 位/);
  });

  it("SEED_MODE=minimal：非法用户名拒绝创建", async () => {
    delete process.env.SEED_ADMIN_PASSWORD;
    process.env.SEED_ADMIN_USERNAME = "bad name!!";
    await expect(seedMinimalAdmin()).rejects.toThrow(/SEED_ADMIN_USERNAME/);
  });
});

describe("迁移版本追踪 schema_migrations（试点部署基线 G3）", () => {
  it("runMigrations 后版本表记录全部迁移文件，重复执行时已应用的被跳过（不再重复执行）", async () => {
    const db = await getDb();
    await runMigrations(); // beforeAll 已跑过一次；此处应全部跳过

    const { rows } = await db.query<{ filename: string; applied_at: string }>(
      "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;"
    );
    // 28 个迁移文件全部有版本记录
    expect(rows).toHaveLength(28);
    expect(rows[0].filename).toBe("001_init.sql");
    expect(rows[rows.length - 1].filename).toBe("028_work_order_timestamps_timestamptz.sql");
    expect(rows.every((r) => r.applied_at)).toBe(true);

    // 跳过证明：删掉一张已应用迁移建的业务表，再跑迁移——
    // 若迁移被正确跳过，该表不会被重建（查询应报 does not exist）；
    // 若仍是旧的全量重跑行为，表会被重建且查询成功 → 测试红。
    await db.query("DROP TABLE IF EXISTS factories;");
    await runMigrations();
    let rebuilt = true;
    try {
      await db.query("SELECT 1 FROM factories LIMIT 1;");
      rebuilt = true;
    } catch (e: any) {
      rebuilt = !/does not exist/.test(e.message || "");
    }
    expect(rebuilt).toBe(false);

    // 版本记录数不变（跳过的不重复登记）
    const { rows: after } = await db.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM schema_migrations;"
    );
    expect(Number(after[0].n)).toBe(28);
  });
});
