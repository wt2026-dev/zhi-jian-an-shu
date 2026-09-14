import { getDb } from "../db.ts";

export const HazardsRepository = {
  mapRow(r: any) {
    if (!r) return null;
    return {
      id: r.id,
      no: r.no,
      title: r.title,
      equipmentId: r.equipment_id,
      equipment_id: r.equipment_id,
      equipmentName: r.equipment_name || "",
      location: r.location,
      level: r.level, // 'general' | 'major'
      description: r.description,
      discoverer: r.discoverer,
      source: r.source, // 'inspection' | 'work_order' | 'report'
      status: r.status, // 'pending' | 'rectifying' | 'verifying' | 'closed'
      relatedWorkOrderId: r.related_work_order_id,
      related_work_order_id: r.related_work_order_id,
      deadline: r.deadline,
      rectificationPlan: r.rectification_plan,
      rectification_plan: r.rectification_plan,
      closedAt: r.closed_at,
      closed_at: r.closed_at,
      createdAt: r.created_at,
      created_at: r.created_at,
      updatedAt: r.updated_at,
      updated_at: r.updated_at,
    };
  },

  async getAll(filters?: { status?: string; level?: string; equipmentId?: string; query?: string }) {
    const db = await getDb();
    let sql = `
      SELECT h.*, e.name as equipment_name 
      FROM hazards h
      LEFT JOIN equipments e ON h.equipment_id = e.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (filters?.status && filters.status !== "all") {
      params.push(filters.status);
      sql += ` AND h.status = $${params.length}`;
    }
    if (filters?.level && filters.level !== "all") {
      params.push(filters.level);
      sql += ` AND h.level = $${params.length}`;
    }
    if (filters?.equipmentId) {
      params.push(filters.equipmentId);
      sql += ` AND h.equipment_id = $${params.length}`;
    }
    if (filters?.query) {
      params.push(`%${filters.query}%`);
      sql += ` AND (h.title ILIKE $${params.length} OR h.no ILIKE $${params.length} OR h.description ILIKE $${params.length} OR h.location ILIKE $${params.length})`;
    }

    // 重大隐患优先置顶展示，未关闭优先
    sql += `
      ORDER BY 
        (CASE WHEN h.level = 'major' AND h.status != 'closed' THEN 0 
              WHEN h.status != 'closed' THEN 1 
              ELSE 2 END),
        h.created_at DESC;
    `;
    const { rows } = await db.query(sql, params);
    return rows.map((r: any) => this.mapRow(r));
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT h.*, e.name as equipment_name 
       FROM hazards h
       LEFT JOIN equipments e ON h.equipment_id = e.id
       WHERE h.id = $1 OR h.no = $1 LIMIT 1;`,
      [id]
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  },

  async create(item: {
    id?: string;
    no?: string;
    title: string;
    equipmentId?: string;
    location: string;
    level: "general" | "major";
    description: string;
    discoverer: string;
    source: "inspection" | "work_order" | "report";
    deadline?: string;
    rectificationPlan?: string;
  }) {
    const db = await getDb();
    const d = new Date();
    const datePrefix = d.toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    const id = item.id || `HZ-${datePrefix}-${randomSuffix}`;
    const no = item.no || id;

    await db.query(
      `INSERT INTO hazards (id, no, title, equipment_id, location, level, description, discoverer, source, status, deadline, rectification_plan, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      [
        id,
        no,
        item.title,
        item.equipmentId || null,
        item.location,
        item.level,
        item.description,
        item.discoverer,
        item.source,
        item.deadline || null,
        item.rectificationPlan || null,
      ]
    );
    return this.getById(id);
  },

  async update(id: string, fields: Partial<{
    title: string;
    level: "general" | "major";
    description: string;
    location: string;
    status: "pending" | "rectifying" | "verifying" | "closed";
    deadline: string;
    rectificationPlan: string;
    relatedWorkOrderId: string;
    closedAt: string;
  }>) {
    const db = await getDb();
    const sets: string[] = [];
    const params: any[] = [id];

    if (fields.title !== undefined) { params.push(fields.title); sets.push(`title = $${params.length}`); }
    if (fields.level !== undefined) { params.push(fields.level); sets.push(`level = $${params.length}`); }
    if (fields.description !== undefined) { params.push(fields.description); sets.push(`description = $${params.length}`); }
    if (fields.location !== undefined) { params.push(fields.location); sets.push(`location = $${params.length}`); }
    if (fields.status !== undefined) { params.push(fields.status); sets.push(`status = $${params.length}`); }
    if (fields.deadline !== undefined) { params.push(fields.deadline); sets.push(`deadline = $${params.length}`); }
    if (fields.rectificationPlan !== undefined) { params.push(fields.rectificationPlan); sets.push(`rectification_plan = $${params.length}`); }
    if (fields.relatedWorkOrderId !== undefined) { params.push(fields.relatedWorkOrderId); sets.push(`related_work_order_id = $${params.length}`); }
    if (fields.closedAt !== undefined) { params.push(fields.closedAt); sets.push(`closed_at = $${params.length}`); }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    const sql = `UPDATE hazards SET ${sets.join(", ")} WHERE id = $1;`;
    await db.query(sql, params);
    return this.getById(id);
  },

  async assignWorkOrder(id: string, workOrderId: string) {
    return this.update(id, {
      relatedWorkOrderId: workOrderId,
      status: "rectifying",
    });
  },

  async verifyAndClose(id: string, verificationNotes: string) {
    const hazard = await this.getById(id);
    const updatedPlan = hazard?.rectificationPlan 
      ? `${hazard.rectificationPlan}\n【现场验收结论】${verificationNotes}`
      : `【现场验收结论】${verificationNotes}`;
    
    return this.update(id, {
      status: "closed",
      rectificationPlan: updatedPlan,
      closedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
  },

  async getMetrics() {
    const db = await getDb();
    const { rows } = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status != 'closed' THEN 1 END) as pending_count,
        COUNT(CASE WHEN level = 'major' AND status != 'closed' THEN 1 END) as major_pending,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count
      FROM hazards;
    `);
    return {
      total: Number(rows[0]?.total || 0),
      pendingCount: Number(rows[0]?.pending_count || 0),
      majorPending: Number(rows[0]?.major_pending || 0),
      closedCount: Number(rows[0]?.closed_count || 0),
    };
  },
};
