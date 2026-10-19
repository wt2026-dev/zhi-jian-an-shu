import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";
import type { Equipment } from "../../types/index.ts";

export const EquipmentRepository = {
  async getAll(filters?: { workshop?: string; status?: string; search?: string }) {
    const db = await getDb();
    let sql = `SELECT * FROM equipments WHERE 1=1`;
    const params: any[] = [];

    if (filters?.workshop && filters.workshop !== "all") {
      params.push(filters.workshop);
      sql += ` AND workshop = $${params.length}`;
    }
    if (filters?.status && filters.status !== "all") {
      params.push(filters.status);
      sql += ` AND status = $${params.length}`;
    }
    if (filters?.search) {
      params.push(`%${filters.search}%`);
      sql += ` AND (name ILIKE $${params.length} OR code ILIKE $${params.length} OR category ILIKE $${params.length})`;
    }

    sql += ` ORDER BY id ASC;`;
    const { rows } = await db.query(sql, params);
    return rows.map(mapEquipmentRow);
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM equipments WHERE id = $1 OR code = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    return mapEquipmentRow(rows[0]);
  },

  async updateStatus(id: string, status: string, healthScore?: number) {
    const db = await getDb();
    if (healthScore !== undefined) {
      await db.query(
        `UPDATE equipments SET status = $1, health_score = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3;`,
        [status, healthScore, id]
      );
    } else {
      await db.query(
        `UPDATE equipments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2;`,
        [status, id]
      );
    }
    return this.getById(id);
  },

  async create(eq: {
    id?: string;
    code: string;
    name: string;
    category: string;
    model?: string;
    workshop?: string;
    location?: string;
    installDate?: string;
    manufacturer?: string;
    status?: string;
    healthScore?: number;
    criticality?: string;
    telemetry?: any;
    specs?: any;
    maintenanceHistory?: any[];
    nextInspectionDate?: string;
    assignedTechnician?: string;
    qrCode?: string;
  }) {
    const db = await getDb();
    const id = eq.id || `eq-${Date.now()}`;
    await db.query(
      `INSERT INTO equipments (id, code, name, category, model, workshop, location, install_date, manufacturer, status, health_score, criticality, telemetry, specs, maintenance_history, next_inspection_date, assigned_technician, qr_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (id) DO NOTHING;`,
      [
        id,
        eq.code,
        eq.name,
        eq.category,
        eq.model || null,
        eq.workshop || null,
        eq.location || null,
        eq.installDate || null,
        eq.manufacturer || null,
        eq.status || "running",
        eq.healthScore ?? 100,
        eq.criticality || "主要生产",
        JSON.stringify(eq.telemetry || {}),
        JSON.stringify(eq.specs || {}),
        JSON.stringify(eq.maintenanceHistory || []),
        eq.nextInspectionDate || null,
        eq.assignedTechnician || null,
        eq.qrCode || null,
      ]
    );
    return this.getById(id);
  },
};

/**
 * 行 → 领域对象。
 *
 * ⚠️ 这里曾写 `function mapEquipmentRow(r: any)`（无返回类型），于是 `getById` / `getAll`
 * 的返回类型被推导成 `any`，**所有调用方都拿不到类型**：下游 `businessLoopService.ts`
 * 一度有 91 处 `any`，根因有一半在这里。补上 `Equipment` 返回类型后，字段拼错、
 * 漏字段、把 string 当 number 用都会在编译期暴露。
 */
function mapEquipmentRow(r: any): Equipment {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category,
    model: r.model,
    workshop: r.workshop,
    location: r.location,
    installDate: r.install_date,
    manufacturer: r.manufacturer,
    status: r.status,
    healthScore: r.health_score,
    criticality: r.criticality,
    // 空对象不是合法遥测：DB 默认值就是 '{}'，直接透传会让下游读到 undefined 却以为有值。
    // parseJson 返回 null 表示「未接入」，由调用方决定显示「—」还是「未接入」，不补 0。
    telemetry: (() => {
      const t = parseJson<Record<string, unknown> | null>(r.telemetry, null);
      return t && typeof t === "object" && "temperature" in t ? (t as unknown as Equipment["telemetry"]) : null;
    })(),
    specs: parseJson(r.specs, {}),
    maintenanceHistory: parseJson(r.maintenance_history, []),
    nextInspectionDate: r.next_inspection_date,
    assignedTechnician: r.assigned_technician,
    qrCode: r.qr_code,
  };
}
