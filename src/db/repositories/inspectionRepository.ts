import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

export const InspectionRepository = {
  async getAll(filters?: { status?: string; workshop?: string; inspectorId?: string; search?: string }) {
    const db = await getDb();
    let sql = `SELECT * FROM inspections WHERE 1=1`;
    const params: any[] = [];

    if (filters?.status && filters.status !== "all") {
      params.push(filters.status);
      sql += ` AND status = $${params.length}`;
    }
    if (filters?.workshop && filters.workshop !== "all") {
      params.push(filters.workshop);
      sql += ` AND workshop = $${params.length}`;
    }
    if (filters?.inspectorId) {
      params.push(filters.inspectorId);
      sql += ` AND inspector_id = $${params.length}`;
    }
    if (filters?.search) {
      params.push(`%${filters.search}%`);
      sql += ` AND (title ILIKE $${params.length} OR task_no ILIKE $${params.length} OR route ILIKE $${params.length} OR workshop ILIKE $${params.length})`;
    }

    sql += ` ORDER BY created_at DESC, id DESC;`;
    const { rows } = await db.query(sql, params);
    return rows.map(mapInspectionRow);
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM inspections WHERE id = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    return mapInspectionRow(rows[0]);
  },

  async create(task: any) {
    const db = await getDb();
    const items = task.items || [];
    await db.query(
      `INSERT INTO inspections (id, task_no, title, type, inspector_id, inspector_name, workshop, route, scheduled_date, status, total_points, completed_points, abnormal_count, items, started_at, finished_at, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17);`,
      [
        task.id,
        task.taskNo,
        task.title,
        task.type || "daily",
        task.inspectorId || null,
        task.inspectorName || null,
        task.workshop || null,
        task.route || null,
        task.scheduledDate || null,
        task.status || "pending",
        task.totalPoints ?? items.length,
        task.completedPoints ?? 0,
        task.abnormalCount ?? 0,
        JSON.stringify(items),
        task.startedAt || null,
        task.finishedAt || null,
        task.summary || null,
      ]
    );
    return this.getById(task.id);
  },

  async update(id: string, updates: Partial<any>) {
    const current = await this.getById(id);
    if (!current) return null;

    const merged = { ...current, ...updates };
    const db = await getDb();
    await db.query(
      `UPDATE inspections SET
         title = $1,
         type = $2,
         inspector_id = $3,
         inspector_name = $4,
         workshop = $5,
         route = $6,
         scheduled_date = $7,
         status = $8,
         total_points = $9,
         completed_points = $10,
         abnormal_count = $11,
         items = $12,
         started_at = $13,
         finished_at = $14,
         summary = $15,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $16;`,
      [
        merged.title,
        merged.type || "daily",
        merged.inspectorId || null,
        merged.inspectorName || null,
        merged.workshop || null,
        merged.route || null,
        merged.scheduledDate || null,
        merged.status || "pending",
        merged.totalPoints ?? 0,
        merged.completedPoints ?? 0,
        merged.abnormalCount ?? 0,
        JSON.stringify(merged.items || []),
        merged.startedAt || null,
        merged.finishedAt || null,
        merged.summary || null,
        id,
      ]
    );
    return this.getById(id);
  },

  async delete(id: string) {
    const db = await getDb();
    const { rowCount } = await db.query(`DELETE FROM inspections WHERE id = $1;`, [id]);
    return rowCount > 0;
  },
};

function mapInspectionRow(r: any) {
  const items = parseJson(r.items, []);
  return {
    id: r.id,
    taskNo: r.task_no,
    title: r.title,
    type: r.type,
    inspectorId: r.inspector_id,
    inspectorName: r.inspector_name,
    workshop: r.workshop,
    route: r.route,
    scheduledDate: r.scheduled_date,
    status: r.status,
    totalPoints: r.total_points,
    completedPoints: r.completed_points,
    abnormalCount: r.abnormal_count,
    items,
    points: items, // 前端兼容字段
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    summary: r.summary,
  };
}
