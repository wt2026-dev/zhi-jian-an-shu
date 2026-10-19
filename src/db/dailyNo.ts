/**
 * 当日业务编号分配（撞号防护）。
 *
 * 为什么需要：`inspections.task_no`、`safety_permits.permit_no`、`work_orders.order_no` 都是
 * `VARCHAR(64) UNIQUE NOT NULL`。早期实现用 `Math.random()` 在固定位数里摇号
 * （`INSP-YYYYMMDD-` 后 3 位 = 每天只有 900 个号位），摇重了不是覆盖而是**整条请求 500**。
 * 改成「问数据库要当天最大号 +1」把号位从概率变成确定，但读 MAX 与 INSERT 之间夹着一个
 * `await`，两个并发请求会读到同一个最大值 —— 所以这两步必须用进程内互斥串起来。
 *
 * 单进程内：PGlite 嵌入式库与 Express 同进程，互斥范围就是全部写入方，锁内取号+插入
 * 零冲突、零重试。跨副本/多连接时进程锁管不到另一个进程 —— 所以调用方还要在外面套一层
 * `withDailyNoRetry`：撞了唯一约束就重新取号再插（见下方说明），多副本下也安全。
 */
import { getDb } from "./db.ts";

/** 表名/列名会被拼进 SQL：只接受代码里写死的标识符形状，不接受任何外部输入。 */
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

const chains = new Map<string, Promise<void>>();

/**
 * 取到「编号分配 + 落库」的互斥令牌；用完必须调用返回的 release（放在 finally 里）。
 * 同一 key 串行，不同 key 互不阻塞。
 */
export async function acquireNumberLock(key: string): Promise<() => void> {
  const prev = chains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const cur = new Promise<void>((resolve) => {
    release = resolve;
  });
  chains.set(
    key,
    prev.then(() => cur)
  );
  await prev;
  return release;
}

/** `acquireNumberLock` + 执行业务 + 无论成败都释放，调用点不用自己写 try/finally。 */
export async function withNumberLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const release = await acquireNumberLock(key);
  try {
    return await run();
  } finally {
    release();
  }
}

/** 取该列当天前缀下的最大数字后缀 +1，返回补零后的完整编号。 */
export async function nextDailyNo(p: {
  table: string;
  column: string;
  prefix: string;
  pad: number;
}): Promise<string> {
  if (!IDENT_RE.test(p.table) || !IDENT_RE.test(p.column)) {
    throw new Error(`nextDailyNo 只接受内置表/列名，收到 ${p.table}.${p.column}`);
  }
  const db = await getDb();
  const sql =
    `SELECT COALESCE(MAX((regexp_match(${p.column}, '(\\d+)$'))[1])::bigint, 0) + 1 AS seq ` +
    `FROM ${p.table} WHERE ${p.column} LIKE $1 || '%'`;
  const { rows } = await db.query(sql, [p.prefix]);
  const seq = Number(rows[0]?.seq ?? 1);
  return `${p.prefix}${String(seq).padStart(p.pad, "0")}`;
}

/**
 * 判定错误是否为唯一约束冲突（UNIQUE violation）。
 * 真 PostgreSQL（含 PGlite）的 SQLSTATE 是 23505；再加消息兜底以覆盖驱动包装后的变体。
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  return /duplicate key|unique constraint/i.test(String(e.message ?? ""));
}

/**
 * 「取号 + 插入」的跨副本安全包装。
 *
 * 进程内锁（withNumberLock）保证单进程内的并发写方串行、零冲突；但多副本/多连接部署时，
 * 另一个进程可能在我们读 MAX 之后插入了同一个号，INSERT 撞 UNIQUE 直接 500。这里在锁外
 * 再兜一层重试：撞号 → 指数退避一小段 → 重新进锁、重新取号、重新插入，直到成功或重试耗尽。
 *
 * 约束：`run` 必须只包含「取号 + 纯落库」，不得夹审计/通知等副作用（重试会重复执行）——
 * 现有三处调用点（工单/作业票/巡检创建）的副作用全部在锁外，符合约束。
 */
export async function withDailyNoRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (err) {
      if (!isUniqueViolation(err) || i === attempts - 1) throw err;
      lastErr = err;
      // 短退避 + 随机抖动，错开与另一副本的取号竞争；总耗时上限 ~ 数百毫秒，不拖垮请求
      await new Promise((resolve) => setTimeout(resolve, 20 * (i + 1) + Math.floor(Math.random() * 30))); // honesty-guard-allow: 退避抖动只影响等待时长，不参与任何业务数值与编号
    }
  }
  throw lastErr;
}
