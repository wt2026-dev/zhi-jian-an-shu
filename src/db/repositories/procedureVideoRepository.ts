import { getDb } from "../db.ts";
import { writeVideoHistorySnapshot } from "../videoHistorySnapshot.ts";

/** 只有终态才值得刷快照 —— processing 期间会每 ~30s 更新一次进度，刷快照太吵。 */
const isTerminal = (status: string) => status === "completed" || status === "failed";

export const ProcedureVideoRepository = {
  mapRow(r: any) {
    return {
      id: r.id,
      procedureId: r.procedure_id,
      taskId: r.task_id,
      status: r.status,
      videoUrl: r.video_url,
      prompt: r.prompt,
      error: r.error,
      progressPct: r.progress_pct ?? null,
      internalStatus: r.internal_status ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async getByProcedureId(procedureId: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM procedure_videos WHERE procedure_id = $1 ORDER BY created_at DESC;`,
      [procedureId]
    );
    return rows.map((r: any) => this.mapRow(r));
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM procedure_videos WHERE id = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    return this.mapRow(rows[0]);
  },

  async getByTaskId(taskId: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM procedure_videos WHERE task_id = $1 LIMIT 1;`, [taskId]);
    if (!rows[0]) return null;
    return this.mapRow(rows[0]);
  },

  async create(data: {
    id?: string;
    procedureId: string;
    taskId: string;
    status?: string;
    prompt?: string;
    videoUrl?: string;
    error?: string;
  }) {
    const db = await getDb();
    const id = data.id || `pvid-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const status = data.status || 'queued';
    await db.query(
      `INSERT INTO procedure_videos (id, procedure_id, task_id, status, prompt, video_url, error, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      [id, data.procedureId, data.taskId, status, data.prompt || null, data.videoUrl || null, data.error || null]
    );
    return this.getById(id);
  },

  async updateStatus(
    taskId: string,
    updates: {
      status: string;
      videoUrl?: string | null;
      error?: string | null;
      progressPct?: number | null;
      internalStatus?: string | null;
    }
  ) {
    const db = await getDb();
    const sets: string[] = [`status = $2`, `updated_at = CURRENT_TIMESTAMP`];
    const params: any[] = [taskId, updates.status];

    if (updates.videoUrl !== undefined) {
      params.push(updates.videoUrl);
      sets.push(`video_url = $${params.length}`);
    }
    if (updates.error !== undefined) {
      params.push(updates.error);
      sets.push(`error = $${params.length}`);
    }
    if (updates.progressPct !== undefined) {
      params.push(updates.progressPct);
      sets.push(`progress_pct = $${params.length}`);
    }
    if (updates.internalStatus !== undefined) {
      params.push(updates.internalStatus);
      sets.push(`internal_status = $${params.length}`);
    }

    await db.query(
      `UPDATE procedure_videos SET ${sets.join(", ")} WHERE task_id = $1;`,
      params
    );
    // 终态落库后立刻刷快照：PGlite 数据目录随时可能因非正常终止而报废，
    // 只靠"启动时刷"会漏掉"生成完还没重启就坏了"的那条（详见 videoHistorySnapshot.ts）。
    if (isTerminal(updates.status)) {
      await writeVideoHistorySnapshot();
    }
    return this.getByTaskId(taskId);
  },

  async delete(id: string) {
    const db = await getDb();
    const { rowCount } = await db.query(`DELETE FROM procedure_videos WHERE id = $1;`, [id]);
    return (rowCount ?? 0) > 0;
  },

  /** 按状态列出任务（启动自检用：核对 completed 记录的成片文件是否还在） */
  async listByStatus(status: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM procedure_videos WHERE status = $1;`, [status]);
    return rows.map((r: any) => this.mapRow(r));
  },

  /** 按 taskId 读取当前状态（轻量查询，供后台循环自检防竞态） */
  async getStatus(taskId: string): Promise<string | null> {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT status FROM procedure_videos WHERE task_id = $1 LIMIT 1;`,
      [taskId]
    );
    return rows[0]?.status ?? null;
  },

  /**
   * 查找僵死任务：status = processing/queued 且 updated_at 早于 cutoff。
   * cutoffMs = 距今多久算僵死（由 AGNES_STALE_AFTER_MIN 环境变量控制，默认 60 分钟）。
   * PGlite/PG 方言兼容：用参数化时间戳，不写死 INTERVAL 字符串。
   */
  async findStaleProcessing(cutoffMs: number): Promise<Array<{ taskId: string; updatedAt: string }>> {
    const db = await getDb();
    const cutoffIso = new Date(Date.now() - cutoffMs).toISOString();
    const { rows } = await db.query(
      `SELECT task_id, updated_at FROM procedure_videos
        WHERE status IN ('processing', 'queued')
          AND updated_at < $1;`,
      [cutoffIso]
    );
    return rows.map((r: any) => ({ taskId: r.task_id, updatedAt: r.updated_at }));
  },

  /**
   * 批量把僵死任务标记为失败（启动自愈用）。
   * 与 failStaleProcessing 的区别：本方法接受精确的 taskId 列表，只改判指定行。
   */
  async failTasksByIds(taskIds: string[], reason: string): Promise<number> {
    if (!taskIds.length) return 0;
    const db = await getDb();
    const { rowCount } = await db.query(
      `UPDATE procedure_videos
          SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP,
              progress_pct = NULL, internal_status = NULL
        WHERE task_id = ANY($2::text[])
          AND status IN ('processing', 'queued');`,
      [reason, taskIds]
    );
    return rowCount ?? 0;
  },

  /**
   * 把"僵死"的生成任务标记为失败（无时间过滤，全量置 failed）。
   *
   * 为什么需要：生成任务跑在进程内存里，进程一重启（部署、崩溃、手动 kill）任务就没了，
   * 但库里那一行会永远停在 processing，前端于是一直转圈、也永远不会再更新。
   * 启动时扫一遍即可自愈 —— 进程刚起来时不可能有任何任务在跑，所以 processing 必为孤儿。
   */
  async failStaleProcessing(reason: string) {
    const db = await getDb();
    const { rowCount } = await db.query(
      `UPDATE procedure_videos
          SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP,
              progress_pct = NULL, internal_status = NULL
        WHERE status IN ('processing', 'queued');`,
      [reason]
    );
    return rowCount ?? 0;
  }
};
