// 重构说明：多厂区层级数据访问（Migration 025 新增 factories 表）。
// 聚合口径（全部来自真实表，不伪造）：
//   - 设备数        = COUNT(equipments)
//   - 故障数        = status IN ('fault','overhauling') 的设备数
//   - 告警数        = 关联工单处于 created/dispatched/in_progress/pending_acceptance 的去重工单数
//   - 平均健康分    = AVG(equipments.health_score)
import { getDb } from "../db.ts";

export interface FactoryAggregateRow {
  id: string;
  name: string;
  city: string;
  region: string;
  geo_lng: number;
  geo_lat: number;
  address: string;
  status: string;
  is_demo: boolean;
  equipment_count: number;
  fault_count: number;
  alert_count: number;
  avg_health: number;
}

export interface FactoryEquipmentRow {
  id: string;
  code: string;
  name: string;
  category: string;
  model: string;
  workshop: string;
  status: string;
  health_score: number;
  factory_id: string;
}

export class FactoryRepository {
  static async listFactories(): Promise<FactoryAggregateRow[]> {
    const db = await getDb();
    const { rows } = await db.query<FactoryAggregateRow>(
      `SELECT f.id, f.name, f.city, f.region, f.geo_lng, f.geo_lat, f.address, f.status, f.is_demo,
              COUNT(e.id)::int AS equipment_count,
              COUNT(e.id) FILTER (WHERE e.status IN ('fault', 'overhauling'))::int AS fault_count,
              COUNT(DISTINCT wo.id)::int AS alert_count,
              COALESCE(ROUND(AVG(e.health_score)::numeric, 1), 0)::float AS avg_health
       FROM factories f
       LEFT JOIN equipments e ON e.factory_id = f.id
       LEFT JOIN work_orders wo ON wo.equipment_id = e.id
              AND wo.status IN ('created', 'dispatched', 'in_progress', 'pending_acceptance')
       GROUP BY f.id, f.name, f.city, f.region, f.geo_lng, f.geo_lat, f.address, f.status, f.is_demo
       ORDER BY f.is_demo ASC, f.id ASC`
    );
    return rows;
  }

  static async getFactoryById(id: string): Promise<FactoryAggregateRow | null> {
    const db = await getDb();
    const { rows } = await db.query<FactoryAggregateRow>(
      `SELECT f.id, f.name, f.city, f.region, f.geo_lng, f.geo_lat, f.address, f.status, f.is_demo,
              COUNT(e.id)::int AS equipment_count,
              COUNT(e.id) FILTER (WHERE e.status IN ('fault', 'overhauling'))::int AS fault_count,
              COUNT(DISTINCT wo.id)::int AS alert_count,
              COALESCE(ROUND(AVG(e.health_score)::numeric, 1), 0)::float AS avg_health
       FROM factories f
       LEFT JOIN equipments e ON e.factory_id = f.id
       LEFT JOIN work_orders wo ON wo.equipment_id = e.id
              AND wo.status IN ('created', 'dispatched', 'in_progress', 'pending_acceptance')
       WHERE f.id = $1
       GROUP BY f.id, f.name, f.city, f.region, f.geo_lng, f.geo_lat, f.address, f.status, f.is_demo`,
      [id]
    );
    return rows[0] ?? null;
  }

  static async listFactoryEquipments(id: string): Promise<FactoryEquipmentRow[]> {
    const db = await getDb();
    const { rows } = await db.query<FactoryEquipmentRow>(
      `SELECT id, code, name, category, model, workshop, status, health_score, factory_id
       FROM equipments WHERE factory_id = $1 ORDER BY code ASC`,
      [id]
    );
    return rows;
  }

  static async getRegionSummary(): Promise<
    { region: string; factory_count: number; equipment_count: number; fault_count: number; alert_count: number; avg_health: number }[]
  > {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT f.region,
              COUNT(DISTINCT f.id)::int AS factory_count,
              COUNT(e.id)::int AS equipment_count,
              COUNT(e.id) FILTER (WHERE e.status IN ('fault', 'overhauling'))::int AS fault_count,
              COUNT(DISTINCT wo.id)::int AS alert_count,
              COALESCE(ROUND(AVG(e.health_score)::numeric, 1), 0)::float AS avg_health
       FROM factories f
       LEFT JOIN equipments e ON e.factory_id = f.id
       LEFT JOIN work_orders wo ON wo.equipment_id = e.id
              AND wo.status IN ('created', 'dispatched', 'in_progress', 'pending_acceptance')
       GROUP BY f.region
       ORDER BY f.region ASC`
    );
    return rows as { region: string; factory_count: number; equipment_count: number; fault_count: number; alert_count: number; avg_health: number }[];
  }
}
