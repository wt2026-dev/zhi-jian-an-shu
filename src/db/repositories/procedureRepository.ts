import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

export const ProcedureRepository = {
  mapRow(r: any) {
    return {
      id: r.id,
      title: r.title,
      equipmentType: r.equipment_type,
      maintenanceLevel: r.maintenance_level,
      steps: parseJson(r.steps, []),
      estimatedMinutes: r.estimated_minutes,
      script: parseJson(r.script, null),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async getAll(filters?: { equipmentType?: string; maintenanceLevel?: string; keyword?: string }) {
    const db = await getDb();
    let sql = `SELECT * FROM maintenance_procedures WHERE 1=1`;
    const params: any[] = [];

    if (filters?.equipmentType && filters.equipmentType !== "all") {
      params.push(filters.equipmentType);
      sql += ` AND equipment_type = $${params.length}`;
    }
    if (filters?.maintenanceLevel && filters.maintenanceLevel !== "all") {
      params.push(filters.maintenanceLevel);
      sql += ` AND maintenance_level = $${params.length}`;
    }
    if (filters?.keyword) {
      params.push(`%${filters.keyword}%`);
      sql += ` AND (title ILIKE $${params.length} OR equipment_type ILIKE $${params.length} OR steps::text ILIKE $${params.length})`;
    }

    sql += ` ORDER BY equipment_type ASC, id ASC;`;
    const { rows } = await db.query(sql, params);
    return rows.map((r: any) => this.mapRow(r));
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM maintenance_procedures WHERE id = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    return this.mapRow(rows[0]);
  },

  async create(proc: {
    id?: string;
    title: string;
    equipmentType: string;
    maintenanceLevel: string;
    steps: any[];
    estimatedMinutes?: number;
    script?: any;
  }) {
    const db = await getDb();
    const id = proc.id || `proc-${Date.now()}`;
    await db.query(
      `INSERT INTO maintenance_procedures (id, title, equipment_type, maintenance_level, steps, estimated_minutes, script, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         equipment_type = EXCLUDED.equipment_type,
         maintenance_level = EXCLUDED.maintenance_level,
         steps = EXCLUDED.steps,
         estimated_minutes = EXCLUDED.estimated_minutes,
         script = COALESCE(EXCLUDED.script, maintenance_procedures.script),
         updated_at = CURRENT_TIMESTAMP;`,
      [
        id,
        proc.title,
        proc.equipmentType,
        proc.maintenanceLevel,
        JSON.stringify(proc.steps || []),
        proc.estimatedMinutes || 60,
        proc.script ? JSON.stringify(proc.script) : null,
      ]
    );
    return this.getById(id);
  },

  async updateScript(id: string, script: any) {
    const db = await getDb();
    await db.query(
      `UPDATE maintenance_procedures SET script = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, JSON.stringify(script)]
    );
    return this.getById(id);
  },
};
