import fs from "fs";
import path from "path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import dotenv from "dotenv";

dotenv.config();

/**
 * 数据库适配器接口：业务代码（repository 层）只依赖本接口，
 * 不直接依赖 PGlite 或 pg 具体实现。通过 DB_TYPE 环境变量切换：
 *   DB_TYPE=pglite   开发/演示环境（嵌入式，零依赖）
 *   DB_TYPE=postgres 生产环境（独立 PostgreSQL 服务，支持连接池与水平扩展）
 */
export interface DatabaseAdapter {
  readonly type: "pglite" | "postgres";
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** 向后兼容别名（历史代码引用 DatabaseClient） */
export type DatabaseClient = DatabaseAdapter;

let dbInstance: DatabaseAdapter | null = null;

/** 数据库查询性能统计（P2-6：杜绝 N+1、慢查询标记） */
const queryStats = {
  total: 0,
  slowCount: 0,
  totalMs: 0,
  slowThresholdMs: 50,
  recent: [] as { sql: string; ms: number; slow: boolean; at: string }[],
};

function recordQuery(sql: string, ms: number) {
  queryStats.total += 1;
  queryStats.totalMs += ms;
  const slow = ms > queryStats.slowThresholdMs;
  if (slow) {
    queryStats.slowCount += 1;
    console.warn(`[DB][慢查询 ${ms}ms] ${sql.slice(0, 120).replace(/\s+/g, " ")}`);
  }
  queryStats.recent.push({ sql: sql.slice(0, 120).replace(/\s+/g, " "), ms, slow, at: new Date().toISOString() });
  if (queryStats.recent.length > 50) queryStats.recent.shift();
}

export function getQueryStats() {
  return {
    ...queryStats,
    avgMs: queryStats.total ? Number((queryStats.totalMs / queryStats.total).toFixed(2)) : 0,
  };
}

/** 格式化参数化 SQL 查询中的 JSON 参数，确保在 pg 和 pglite 中统一为 string 或 object */
function normalizeParams(params?: any[]): any[] {
  if (!params) return [];
  return params.map((p) => {
    if (p !== null && typeof p === "object" && !(p instanceof Date) && !Buffer.isBuffer(p)) {
      return JSON.stringify(p);
    }
    return p;
  });
}

/** 统计包装：为适配器 query 增加耗时记录 */
function withStats<T extends DatabaseAdapter>(adapter: T): T {
  const rawQuery = adapter.query.bind(adapter);
  return Object.assign(Object.create(Object.getPrototypeOf(adapter)), adapter, {
    query: async (text: string, params?: any[]) => {
      const t0 = Date.now();
      try {
        return await rawQuery(text, params);
      } finally {
        recordQuery(text, Date.now() - t0);
      }
    },
  }) as T;
}

/** 从 DB_* 环境变量构造 PostgreSQL 连接串 */
function buildPostgresUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME || "industrial_maintenance";
  const user = process.env.DB_USER || "postgres";
  const password = process.env.DB_PASSWORD || "";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

async function createPgliteAdapter(): Promise<DatabaseAdapter> {
  // 测试环境使用内存 PGlite：每个测试文件独立数据库实例，彻底避免共享持久化目录
  // （postmaster.pid 互删/文件锁竞争）导致的随机 500。开发/演示仍用磁盘持久化目录。
  if (process.env.NODE_ENV === "test" || process.env.TEST_DB === "true") {
    console.log("[Database] 正在启动内存模式 PGlite（测试环境，文件间隔离）...");
    const pglite = new PGlite();
    console.log("[Database] 内存模式 PostgreSQL 初始化完成！");
    return {
      type: "pglite",
      query: async function (text: string, params?: any[]) {
        const res = await pglite.query(text, normalizeParams(params));
        return { rows: res.rows as any[], rowCount: res.rows.length };
      },
      exec: async function (sql: string) {
        await pglite.exec(sql);
      },
      close: async function () {
        await pglite.close();
        dbInstance = null;
      },
    };
  }
  var dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  }
  var dbFolderName =
    process.env.NODE_ENV === "test" || process.env.TEST_DB === "true"
      ? "test_industrial_ops_pg"
      : "industrial_ops_pg";
  var pgDataPath = path.join(dataDir, dbFolderName);
  var pidFile = path.join(pgDataPath, "postmaster.pid");
  if (fs.existsSync(pidFile)) {
    try {
      fs.unlinkSync(pidFile);
      console.log(`[Database] 已清理异常残留的锁定文件: ${pidFile}`);
    } catch {}
  }
  console.log(`[Database] 正在加载嵌入式持久化 PostgreSQL 数据库 (存储路径: ${pgDataPath}) ...`);
  var pglite = new PGlite(pgDataPath);
  console.log("[Database] 本地持久化 PostgreSQL 数据库初始化完成！");
  return {
    type: "pglite",
    query: async function (text: string, params?: any[]) {
      var res = await pglite.query(text, normalizeParams(params));
      return { rows: res.rows as any[], rowCount: res.rows.length };
    },
    exec: async function (sql: string) {
      await pglite.exec(sql);
    },
    close: async function () {
      await pglite.close();
      dbInstance = null;
    },
  };
}

async function createPostgresAdapter(): Promise<DatabaseAdapter> {
  var url = buildPostgresUrl();
  console.log(
    `[Database] 正在尝试连接 PostgreSQL 服务: ${url.replace(/:[^:@]+@/, ":****@")} ...`
  );
  var pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    max: Number(process.env.DB_POOL_MAX || 10),
  });
  await pool.query("SELECT 1 AS health_check");
  console.log("[Database] PostgreSQL 连接成功并保持就绪（连接池已启用）！");
  return {
    type: "postgres",
    query: async function (text: string, params?: any[]) {
      var res = await pool.query(text, normalizeParams(params));
      return { rows: res.rows as any[], rowCount: res.rowCount || res.rows.length };
    },
    exec: async function (sql: string) {
      await pool.query(sql);
    },
    close: async function () {
      await pool.end();
      dbInstance = null;
    },
  };
}

/**
 * 获取或初始化数据库单例适配器
 * 优先级：DB_TYPE 显式指定 > DATABASE_URL 含 postgres:// > 默认 pglite
 */
export async function getDb(): Promise<DatabaseAdapter> {
  if (dbInstance) return dbInstance;

  var dbType = (process.env.DB_TYPE || "").toLowerCase();
  if (dbType !== "pglite" && dbType !== "postgres") {
    // 未显式指定：生产环境默认 postgres，开发/测试默认 pglite
    dbType =
      process.env.NODE_ENV === "production" && process.env.DB_TYPE !== "pglite"
        ? "postgres"
        : "pglite";
    if (!process.env.DB_TYPE && process.env.DATABASE_URL) {
      dbType =
        process.env.DATABASE_URL.indexOf("postgres://") === 0 ||
        process.env.DATABASE_URL.indexOf("postgresql://") === 0
          ? "postgres"
          : "pglite";
    }
  }

  if (dbType === "postgres") {
    try {
      dbInstance = withStats(await createPostgresAdapter());
      return dbInstance;
    } catch (err: any) {
      console.warn(
        `[Database] PostgreSQL 连接失败 (${err.message})，正在平滑降级至本地持久化 PostgreSQL (PGlite) 引擎...`
      );
    }
  }

  dbInstance = withStats(await createPgliteAdapter());
  return dbInstance;
}

/**
 * 执行数据库迁移与初始表结构建立
 */
export async function runMigrations(): Promise<void> {
  const db = await getDb();
  const migrationsDir = path.join(process.cwd(), "src", "db", "migrations");
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  // 按文件名顺序执行全部 .sql 迁移文件 (001_init.sql → 002_... → ...)
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error(`No migration .sql files found in: ${migrationsDir}`);
  }

  for (const file of migrationFiles) {
    const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf-8").replace(/^\uFEFF/, "");
    console.log(`[Migration] 开始执行 ${file} 建表迁移...`);
    // 按分号切分语句逐条执行，确保 DDL 模式变更立即在后续语句生效 (解决 PGlite 单批次编译报错)
    const statements = sqlContent
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.replace(/--[^\r\n]*/g, "").trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      if (stmt) {
        try {
          await db.exec(stmt + ";");
        } catch (err: any) {
          if (!err.message?.includes("already exists") && !err.message?.includes("duplicate")) {
            throw err;
          }
        }
      }
    }
  }

  console.log(`[Migration] 数据库建表迁移成功完成 (${migrationFiles.length} 个迁移文件)！`);
}

/**
 * 初始化数据库：自动建表并判断是否需要执行种子数据
 */
export async function initDatabase(): Promise<DatabaseAdapter> {
  const db = await getDb();
  await runMigrations();

  // 检查 users 表是否为空，若为空自动执行 seed
  const { rows } = await db.query<{ count: string }>("SELECT COUNT(*) as count FROM users;");
  const count = Number(rows[0]?.count || 0);

  if (count === 0) {
    console.log("[Seed] 检测到 users 表为空，正在自动导入初始管理员、安全员与演示业务数据...");
    const { seedDatabase } = await import("./seed.ts");
    await seedDatabase();
  }

  // 确保 certifications 列存在并为 admin 用户补充证书数据
  try {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb;`);
    const adminCerts = JSON.stringify([
      { name: "注册安全工程师", issuer: "应急管理部", expiry: "2027.06.30", status: "valid" },
      { name: "高压电工作业证", issuer: "省应急管理厅", expiry: "2025.12.31", status: "review" },
      { name: "一级动火监护人证", issuer: "市应急管理局", expiry: "2026.09.15", status: "valid" },
    ]);
    await db.query(`UPDATE users SET certifications = $1 WHERE id = 'u-admin' AND (certifications IS NULL OR certifications = '{}'::jsonb OR certifications = '[]'::jsonb);`, [adminCerts]);
  } catch (e) {
    console.log("[Seed] certifications 更新跳过:", (e as any)?.message);
  }

  return db;
}
