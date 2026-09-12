import { getDb } from "../db.ts";

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

    await db.query(
      `UPDATE procedure_videos SET ${sets.join(", ")} WHERE task_id = $1;`,
      params
    );
    return this.getByTaskId(taskId);
  },

  async delete(id: string) {
    const db = await getDb();
    const { rowCount } = await db.query(`DELETE FROM procedure_videos WHERE id = $1;`, [id]);
    return (rowCount ?? 0) > 0;
  }
};
