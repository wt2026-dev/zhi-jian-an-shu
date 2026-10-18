/**
 * 当日业务编号分配（撞号防护）。
 *
 * 为什么需要：`inspections.task_no`、`safety_permits.permit_no`、`work_orders.order_no` 都是
 * `VARCHAR(64) UNIQUE NOT NULL`。早期实现用 `Math.random()` 在固定位数里摇号
 * （`INSP-YYYYMMDD-` 后 3 位 = 每天只有 900 个号位），摇重了不是覆盖而是**整条请求 500**。
 * 改成「问数据库要当天最大号 +1」把号位从概率变成确定，但读 MAX 与 INSERT 之间夹着一个
 * `await`，两个并发请求会读到同一个最大值 —— 所以这两步必须用进程内互斥串起来。
 *
 * 单进程够用：PGlite 嵌入式库与 Express 同进程，互斥范围就是全部写入方。
 * 真上多副本时这里要换成 DB 序列或 `INSERT ... SELECT` 一条语句完成，不要留这个内存锁。
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
