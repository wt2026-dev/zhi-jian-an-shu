import fs from "fs";
import path from "path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import dotenv from "dotenv";
import { logger } from "../utils/logger";

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
    logger.warn(`[DB][慢查询 ${ms}ms] ${sql.slice(0, 120).replace(/\s+/g, " ")}`);
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
    // ⚠️ 数组必须**原样透传**，绝不能 JSON.stringify。
    //
    // pg / pglite 会把 JS 数组编码成 Postgres 数组字面量（{a,b}），这正是 ANY($n::text[]) 需要的形态。
    // 一旦被序列化成 '["a"]'，Postgres 会拿它去按数组字面量解析，直接报
    //   malformed array literal: "["a"]"
    // 实测后果：启动自愈清理僵死视频任务整段失效（`[Startup] 清理僵死视频任务失败`），
    // 进程重启后残留的 processing 行永远不被改判，前端一直转圈；
    // 同一根因也让 runFullVideoGeneration 的"提交前回收僵死任务"失效。
    if (Array.isArray(p)) return p;
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

/**
 * 打开 PGlite 数据目录；失败就**换一个新目录建空库**，让服务能起来。
 *
 * 为什么必须这么干：PGlite 扛不住非正常终止 —— 进程被 SIGKILL / 任务管理器结束 / 沙箱回收后，
 * WAL 里的 checkpoint 记录会被写坏，之后每次打开都是
 * `LOG: invalid xl_info in checkpoint record` → `PANIC: could not locate a valid checkpoint record`
 * → `RuntimeError: Aborted()`，而且没有任何可用工具（pg_resetwal 之类）能修。
 * 以前的表现是**整个服务起不来**，只能人工把目录改名。
 *
 * ⚠️ 为什么是"换新目录"而不是"把坏目录改名"：Windows 上目录里还有未释放的文件句柄时
 * `renameSync` 必定 `EPERM`，而坏掉的 PGlite 实例**连 `close()` 都会抛 `Aborted()`**，
 * 根本松不了手 —— 实测同进程 rename、子进程 rename **都失败**。
 * 所以坏目录只能原地留着（正好当取证素材，用 scratch/recover-videos.ts 抠数据），
 * 新库换个目录名，并把"当前活跃目录"记到 `data/.pglite-active.json`。
 */
async function tryOpenPglite(dir: string): Promise<PGlite> {
  const p = new PGlite(dir);
  try {
    await p.waitReady;
    // 只 waitReady 不够：Aborted() 往往在真正跑第一条语句时才抛出来
    await p.query("SELECT 1;");
    return p;
  } catch (e) {
    try {
      await p.close();
    } catch {}
    throw e;
  }
}

/** 记录"当前活跃的数据目录名"，避免每次都去碰那个已经报废的规范目录。 */
function activePointerPath(dataDir: string) {
  return path.join(dataDir, ".pglite-active.json");
}

function readActiveDirName(dataDir: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(activePointerPath(dataDir), "utf8"));
    return typeof j?.active === "string" && j.active ? j.active : null;
  } catch {
    return null;
  }
}

function writeActiveDirName(dataDir: string, name: string) {
  try {
    fs.writeFileSync(activePointerPath(dataDir), JSON.stringify({ active: name }, null, 2), "utf8");
  } catch {}
}

export async function openPgliteWithFallback(
  dataDir: string,
  baseName: string
): Promise<{ pglite: PGlite; usedPath: string }> {
  const activeName = readActiveDirName(dataDir) || baseName;
  const activePath = path.join(dataDir, activeName);

  try {
    return { pglite: await tryOpenPglite(activePath), usedPath: activePath };
  } catch (e: any) {
    const msg = String(e?.message || e);
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const freshName = `${baseName}-${stamp}`;
    const freshPath = path.join(dataDir, freshName);

    logger.error(
      `[Database] 数据目录无法打开（${msg}）。已保留原目录 ${activeName}（内含损坏的库，可用 scratch/recover-videos.ts 取证），` +
        `并改用新目录 ${freshName} 重建空库。`
    );
    // 注意：不要把这次失败当成"业务数据丢失"—— procedure_videos 会由
    // src/db/videoHistorySnapshot.ts 的快照自愈补回来。
    writeActiveDirName(dataDir, freshName);
    return { pglite: await tryOpenPglite(freshPath), usedPath: freshPath };
  }
}

async function createPgliteAdapter(): Promise<DatabaseAdapter> {
  // 测试环境使用内存 PGlite：每个测试文件独立数据库实例，彻底避免共享持久化目录
  // （postmaster.pid 互删/文件锁竞争）导致的随机 500。开发/演示仍用磁盘持久化目录。
  if (process.env.NODE_ENV === "test" || process.env.TEST_DB === "true") {
    logger.info("[Database] 正在启动内存模式 PGlite（测试环境，文件间隔离）...");
    const pglite = new PGlite();
    logger.info("[Database] 内存模式 PostgreSQL 初始化完成！");
    return {
      type: "pglite",
      query: async function (text: string, params?: any[]) {
        const res = await pglite.query(text, normalizeParams(params));
        // rowCount 采用真实受影响行数（UPDATE/DELETE 时 rows.length 恒为 0，
        // 会误导乐观锁等依赖 rowCount 的调用方误判冲突）；SELECT 语义不变
        return {
          rows: res.rows as any[],
          rowCount: (res as any).affectedRows ?? res.rows.length,
        };
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
    let isStale = true;
    try {
      const pidContent = fs.readFileSync(pidFile, "utf8").trim().split("\n")[0];
      const pidNum = parseInt(pidContent, 10);
      if (!isNaN(pidNum) && pidNum > 0 && pidNum !== process.pid) {
        // 尝试发送信号 0 测试该 PID 进程是否存活
        try {
          process.kill(pidNum, 0);
          // 进程存活！说明已有另一个正在运行的服务实例占用该数据目录
          isStale = false;
          logger.warn(`[Database] 检测到正在运行的活跃实例 (PID ${pidNum}) 持有数据库锁。为防止数据脏写损坏，请勿并发启动多个实例！`);
        } catch {
          // ESRCH 表明进程已不存在，确实是异常退出残留的死锁文件
          isStale = true;
        }
      }
    } catch {}

    if (isStale) {
      try {
        fs.unlinkSync(pidFile);
        logger.info(`[Database] 已清理异常退出残留的陈旧锁定文件: ${pidFile}`);
      } catch {}
    }
  }
  logger.info(`[Database] 正在加载嵌入式持久化 PostgreSQL 数据库 (存储路径: ${pgDataPath}) ...`);
  var opened = await openPgliteWithFallback(dataDir, dbFolderName);
  var pglite = opened.pglite;
  if (opened.usedPath !== pgDataPath) {
    logger.warn(`[Database] 实际使用的数据目录: ${opened.usedPath}`);
  }
  logger.info("[Database] 本地持久化 PostgreSQL 数据库初始化完成！");
  return {
    type: "pglite",
    query: async function (text: string, params?: any[]) {
      var res = await pglite.query(text, normalizeParams(params));
      // 与内存模式适配器同口径：rowCount 为真实受影响行数
      return { rows: res.rows as any[], rowCount: (res as any).affectedRows ?? res.rows.length };
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
  logger.info(
    `[Database] 正在尝试连接 PostgreSQL 服务: ${url.replace(/:[^:@]+@/, ":****@")} ...`
  );
  var pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    max: Number(process.env.DB_POOL_MAX || 10),
  });
  await pool.query("SELECT 1 AS health_check");
  logger.info("[Database] PostgreSQL 连接成功并保持就绪（连接池已启用）！");
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
      const errMsg = `[Database] 生产环境/显式指定 PostgreSQL 连接失败 (${err.message})！严禁静默降级至本地单机文件，防止工业数据分叉与裂脑。进程中止。`;
      logger.error(errMsg);
      // 工业级数据安全底线：生产模式下外部 PG 不可达时直接 Fail-Fast 报错，拒绝写入本地单机库造成数据分叉
      if (process.env.NODE_ENV === "production" || process.env.DB_TYPE === "postgres") {
        throw new Error(errMsg);
      }
      // 仅在非生产开发联调环境下，若未强制锁定 DB_TYPE，才允许输出严重告警并回退
      logger.warn(
        `[Database] [DEV ONLY] 开发调试环境 PostgreSQL 连接失败，临时回退至本地嵌入式 PGlite（数据仅保存在当前单机开发目录）...`
      );
    }
  }

  // 本地嵌入式 PGlite 仅限开发、演示或自动化测试模式
  if (process.env.NODE_ENV === "production") {
    logger.warn("[Database] 警告：生产环境正在以单机嵌入式 PGlite 运行，仅适用于单节点隔离演示部署，多节点集群必须配置 DB_TYPE=postgres！");
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

  // ==================== 迁移版本追踪（schema_migrations） ====================
  // 背景：此前每次启动全量重跑全部 .sql，靠吞掉 "already exists"/"duplicate" 报错实现幂等。
  // 问题：真 PG 上非幂等语句的**意外**报错若文案恰好含这两个词会被静默吞掉；且无法得知
  // 当前 schema 处于哪个版本、回滚无依据。现引入版本表：已应用的迁移文件直接跳过，
  // 每个文件的全部语句成功后记录版本；执行期仍保留 "already exists" 吞错作为存量库
  // （无版本表首次引导）的兼容兜底 —— 存量库首启会把历史文件补记进版本表。
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename VARCHAR(255) PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     );`
  );
  const { rows: appliedRows } = await db.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations;"
  );
  const applied = new Set(appliedRows.map((r) => r.filename));

  // 按文件名顺序执行全部 .sql 迁移文件 (001_init.sql → 002_... → ...)
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error(`No migration .sql files found in: ${migrationsDir}`);
  }

  let executed = 0;
  let skipped = 0;
  for (const file of migrationFiles) {
    // 已应用：直接跳过，不再重复执行（版本追踪的核心收益：启动快 + 不再碰已应用 DDL）
    if (applied.has(file)) {
      skipped++;
      continue;
    }
    const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf-8").replace(/^\uFEFF/, "");
    logger.info(`[Migration] 开始执行 ${file} 建表迁移...`);
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
            // fail-fast：非幂等预期内的报错一律上抛，由启动入口拒绝服务（绝不带病启动）
            throw err;
          }
        }
      }
    }
    await db.query("INSERT INTO schema_migrations (filename) VALUES ($1);", [file]);
    executed++;
  }

  logger.info(
    `[Migration] 数据库建表迁移完成：本次执行 ${executed} 个、跳过已应用 ${skipped} 个（共 ${migrationFiles.length} 个迁移文件）！`
  );
}

/**
 * 解析种子模式（SEED_MODE 环境变量，单一决策点）：
 *   demo    —— 默认。灌入 9 个演示口令账号 + 全量演示业务数据（现状行为，本地演示/测试用）。
 *   minimal —— 仅建 1 个管理员账号（试点/生产用）：口令优先取 SEED_ADMIN_PASSWORD，
 *              未配置则生成随机一次性口令并仅打印一次；配套要求部署时设
 *              DEMO_FORCE_PASSWORD_CHANGE=true 强制首启改密。
 *   off     —— 完全不灌种子（users 保持为空，由现场用 SQL/管理端建号）。
 * 非法取值一律 fail-fast 拒绝启动，绝不静默回落到 demo（生产误配 demo 会灌入演示口令账号）。
 */
export type SeedMode = "demo" | "minimal" | "off";
export function resolveSeedMode(): SeedMode {
  // 宽容归一化：空串/空白视为"未配置"（回落 demo）；大小写不敏感、trim 首尾空白。
  // 这只放宽书写形式，不放宽取值集合 —— 归一化后仍不在三档内的值一律 fail-fast。
  const raw = (process.env.SEED_MODE || "demo").toLowerCase().trim();
  if (raw === "demo" || raw === "minimal" || raw === "off") return raw;
  throw new Error(
    `[配置错误] SEED_MODE 取值非法: "${process.env.SEED_MODE}"（合法值: demo | minimal | off）。拒绝启动。`
  );
}

/**
 * 初始化数据库：自动建表并按 SEED_MODE 决定种子策略
 */
export async function initDatabase(): Promise<DatabaseAdapter> {
  const db = await getDb();
  // 先校验配置再动数据库：配置错误在迁移前就 fail-fast
  const seedMode = resolveSeedMode();
  await runMigrations();

  // 检查 users 表是否为空，按 SEED_MODE 决定种子策略
  const { rows } = await db.query<{ count: string }>("SELECT COUNT(*) as count FROM users;");
  const count = Number(rows[0]?.count || 0);

  if (count === 0) {
    if (seedMode === "off") {
      logger.warn(
        "[Seed] SEED_MODE=off 且 users 表为空：跳过种子导入。系统当前无任何可用账号，请通过管理端或 SQL 建号后再使用。"
      );
    } else if (seedMode === "minimal") {
      logger.info("[Seed] SEED_MODE=minimal：仅创建初始管理员账号（不灌演示数据）...");
      const { seedMinimalAdmin } = await import("./seed.ts");
      await seedMinimalAdmin();
    } else {
      logger.info("[Seed] 检测到 users 表为空，正在自动导入初始管理员、安全员与演示业务数据...");
      const { seedDatabase } = await import("./seed.ts");
      await seedDatabase();
    }
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
    logger.info("[Seed] certifications 更新跳过:", (e as any)?.message);
  }

  return db;
}
