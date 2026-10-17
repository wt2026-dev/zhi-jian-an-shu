/**
 * `procedure_videos`（视频生成历史）的磁盘快照与自愈恢复。
 *
 * ## 为什么必须有这个模块
 *
 * PGlite 是 WASM 里的 PostgreSQL，**扛不住非正常终止**：进程被 SIGKILL / 任务管理器结束 /
 * 沙箱回收后，WAL 里的 checkpoint 记录会被写坏，下次打开直接
 * `LOG: invalid xl_info in checkpoint record` → `PANIC: could not locate a valid checkpoint record`
 * → `RuntimeError: Aborted()`，整个数据目录报废（没有 `pg_resetwal` 可用，救不回来）。
 * 实测 2026-09-18 一天内就这样坏了 5 次。
 *
 * 报废后的既定处置是"把目录改名让开、重建空库"，而重建会走 `seedDatabase()` —— 问题是
 * **`procedure_videos` 不在 `src/db/seed-data/` 里**（迁移 010/011/024 只建表加列，不插数据），
 * 于是这张表被静默清空：规程/设备/工单/用户全被重新灌满，只有视频历史凭空消失，
 * 表面上"一切都正常"，极难察觉。这正是"刚生成的视频在页面里找不到了"的真因。
 *
 * ## 做法
 *
 * 把这张表快照到 `data/video-history-snapshot.json` —— 注意它在**数据库目录之外**，
 * 所以数据库目录被改名/重建都不会带走它。然后：
 *   - 表非空 → 刷新快照（快照永远是"最近一次的好状态"）；
 *   - 表为空且有快照 → 按快照回填，并打印显眼日志。
 *
 * ## 已知取舍
 *
 * 如果用户把历史**全部删光**，下次启动会被快照回填。这是刻意的：相比"悄悄丢掉全部历史"，
 * "多恢复一次"更容易被发现、代价也更小。要彻底关掉自愈，删掉那个 json 即可。
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db.ts";

/** 默认快照路径。刻意放在数据库目录**同级**而不是里面 —— 数据库目录会被改名重建。 */
export const DEFAULT_VIDEO_HISTORY_SNAPSHOT = path.join(process.cwd(), "data", "video-history-snapshot.json");

/**
 * 快照路径（**惰性求值**，不要改成模块级常量）。
 *
 * 两个理由：
 *   1. 模块加载期求值会让测试无法按用例覆盖路径 —— 而本模块**会写文件**，
 *      测试若落到仓库里的真快照上就是测试污染仓库（`UPLOADS_DIR` 踩过同样的坑）。
 *   2. `process.cwd()` 在模块加载期可能还不是最终值。
 */
export function getVideoHistorySnapshotPath(): string {
  return process.env.VIDEO_HISTORY_SNAPSHOT_PATH || DEFAULT_VIDEO_HISTORY_SNAPSHOT;
}

/**
 * 测试环境下的保险丝：没显式指定 `VIDEO_HISTORY_SNAPSHOT_PATH` 就**不读也不写**。
 * 写：宁可少覆盖一个分支，也不能让一次跑测试把仓库里的真快照覆盖掉；
 * 读：否则用例结果会取决于仓库里那份真快照的内容（不确定性）。
 */
function snapshotPathIsSafe(): boolean {
  if (process.env.NODE_ENV === "test" && !process.env.VIDEO_HISTORY_SNAPSHOT_PATH) {
    console.warn(
      "[VideoHistory] 测试环境未指定 VIDEO_HISTORY_SNAPSHOT_PATH，已跳过快照读写（防止污染仓库里的真快照）"
    );
    return false;
  }
  return true;
}

const COLUMNS = [
  "id",
  "procedure_id",
  "task_id",
  "status",
  "video_url",
  "prompt",
  "error",
  "progress_pct",
  "internal_status",
  "created_at",
  "updated_at",
] as const;

type Row = Record<string, any>;

/**
 * 把当前 `procedure_videos` 全量写到快照文件。表为空时**不覆盖**已有快照
 * （否则一次空表就把唯一的好状态抹掉了）。
 * @returns 写入的行数；表为空或写失败返回 0
 */
export async function writeVideoHistorySnapshot(): Promise<number> {
  try {
    if (!snapshotPathIsSafe()) return 0;
    const db = await getDb();
    const { rows } = await db.query<Row>(`SELECT * FROM procedure_videos ORDER BY created_at ASC;`);
    if (!rows.length) return 0;

    const payload = {
      savedAt: new Date().toISOString(),
      count: rows.length,
      rows: rows.map((r) => {
        const o: Row = {};
        for (const c of COLUMNS) o[c] = r[c] ?? null;
        return o;
      }),
    };
    fs.mkdirSync(path.dirname(getVideoHistorySnapshotPath()), { recursive: true });
    fs.writeFileSync(getVideoHistorySnapshotPath(), JSON.stringify(payload, null, 2), "utf8");
    return rows.length;
  } catch {
    // 快照是"锦上添花"的能力，绝不能因为它失败而影响主流程
    return 0;
  }
}

/**
 * 表为空时按快照回填。
 *
 * 严格纪律：
 *   - `procedure_id` 必须**当前库里真的存在**（否则外键会失败，也会凭空造出指向不存在规程的历史）；
 *   - `id` / `task_id` 与已有行冲突就跳过（幂等，可反复跑）；
 *   - 什么都不猜：只搬运快照里已有的值。
 * @returns 实际回填的行数
 */
export async function healVideoHistoryFromSnapshot(): Promise<number> {
  try {
    if (!snapshotPathIsSafe()) return 0;
    if (!fs.existsSync(getVideoHistorySnapshotPath())) return 0;

    const db = await getDb();
    const cur = await db.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM procedure_videos;`);
    if ((cur.rows[0]?.c ?? 0) > 0) return 0; // 表里已有数据，不动

    const payload = JSON.parse(fs.readFileSync(getVideoHistorySnapshotPath(), "utf8")) as {
      savedAt?: string;
      rows?: Row[];
    };
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!rows.length) return 0;

    const procs = new Set(
      (await db.query<{ id: string }>(`SELECT id FROM maintenance_procedures;`)).rows.map((r) => r.id)
    );

    let restored = 0;
    let skipped = 0;
    for (const r of rows) {
      if (!r?.id || !r?.procedure_id || !procs.has(r.procedure_id)) {
        skipped++;
        continue;
      }
      const { rowCount } = await db.query(
        `INSERT INTO procedure_videos
           (id, procedure_id, task_id, status, video_url, prompt, error,
            progress_pct, internal_status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING;`,
        [
          r.id,
          r.procedure_id,
          r.task_id ?? null,
          r.status ?? "failed",
          r.video_url ?? null,
          r.prompt ?? null,
          r.error ?? null,
          r.progress_pct ?? null,
          r.internal_status ?? null,
          r.created_at ?? new Date().toISOString(),
          r.updated_at ?? r.created_at ?? new Date().toISOString(),
        ]
      );
      restored += rowCount ?? 0;
    }

    if (restored > 0) {
      console.log(
        `[VideoHistory] ⚠️ 检测到 procedure_videos 为空（通常是数据库目录损坏后被重建），` +
          `已按快照回填 ${restored} 条视频生成历史` +
          (skipped ? `（跳过 ${skipped} 条：规程不存在或字段缺失）` : "") +
          `。快照时间 ${payload.savedAt || "未知"}`
      );
    }
    return restored;
  } catch (e: any) {
    console.warn("[VideoHistory] 快照回填失败（不影响启动）:", e?.message || e);
    return 0;
  }
}

/**
 * 启动时的入口：先补（若是空表），再存。顺序不能反 —— 反过来会先被空表刷掉快照。
 */
export async function syncVideoHistoryWithSnapshot(): Promise<{ restored: number; saved: number }> {
  const restored = await healVideoHistoryFromSnapshot();
  const saved = await writeVideoHistorySnapshot();
  if (saved > 0) {
    console.log(`[VideoHistory] 已刷新视频历史快照：${saved} 条 → ${getVideoHistorySnapshotPath()}`);
  }
  return { restored, saved };
}
