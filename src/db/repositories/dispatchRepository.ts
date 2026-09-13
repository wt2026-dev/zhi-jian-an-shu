import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

// ==================== 内部师傅距离调度仓储（technician_locations / users 位置字段 / 设备点位） ====================

export const DispatchRepository = {
  /** 写入一次位置上报（geo_lng/geo_lat 为真实经纬度，可选；map_x/map_y 保留兼容） */
  async insertLocation(entry: {
    id: string;
    userId: string;
    mapX: number;
    mapY: number;
    status: string;
    reportedAt: string;
    geoLng?: number | null;
    geoLat?: number | null;
  }) {
    const db = await getDb();
    await db.query(
      `INSERT INTO technician_locations (id, user_id, map_x, map_y, geo_lng, geo_lat, status, reported_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [entry.id, entry.userId, entry.mapX, entry.mapY, entry.geoLng ?? null, entry.geoLat ?? null, entry.status, entry.reportedAt]
    );
  },

  /** 上报后同步 users 表的在岗状态与最新位置（含真实经纬度） */
  async updateUserPresence(
    userId: string,
    mapX: number,
    mapY: number,
    status: string,
    reportedAt: string,
    geoLng?: number | null,
    geoLat?: number | null
  ) {
    const db = await getDb();
    await db.query(
      `UPDATE users SET online_status = $2, map_x = $3, map_y = $4, geo_lng = $5, geo_lat = $6, last_location_at = $7 WHERE id = $1;`,
      [userId, status, mapX, mapY, geoLng ?? null, geoLat ?? null, reportedAt]
    );
  },

  /** 在岗师傅列表（online / idle），附带技能与位置（含真实经纬度） */
  async listDutyTechnicians() {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT id, username, name, role, role_title, department, skills, online_status, map_x, map_y, geo_lng, geo_lat, last_location_at
       FROM users
       WHERE role IN ('technician', 'inspector') AND online_status IN ('online', 'idle')
       ORDER BY online_status ASC, name ASC;`
    );
    return rows.map((r: any) => ({
      id: r.id,
      username: r.username,
      name: r.name,
      role: r.role,
      roleTitle: r.role_title,
      department: r.department,
      skills: parseJson(r.skills, [] as string[]),
      onlineStatus: r.online_status,
      mapX: r.map_x,
      mapY: r.map_y,
      geoLng: r.geo_lng,
      geoLat: r.geo_lat,
      lastLocationAt: r.last_location_at,
    }));
  },

  /** 单个师傅（用于上报校验与回显） */
  async getUserById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT id, username, name, role, role_title, skills, online_status, map_x, map_y, geo_lng, geo_lat, last_location_at
       FROM users WHERE id = $1;`,
      [id]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      username: r.username,
      name: r.name,
      role: r.role,
      roleTitle: r.role_title,
      skills: parseJson(r.skills, [] as string[]),
      onlineStatus: r.online_status,
      mapX: r.map_x,
      mapY: r.map_y,
      geoLng: r.geo_lng,
      geoLat: r.geo_lat,
      lastLocationAt: r.last_location_at,
    };
  },

  /** 设备点位与车间（recommend 数据源，含真实经纬度） */
  async getEquipmentLocation(equipmentId: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT id, code, name, category, workshop, location, map_x, map_y, geo_lng, geo_lat FROM equipments WHERE id = $1;`,
      [equipmentId]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      workshop: r.workshop,
      location: r.location,
      mapX: r.map_x,
      mapY: r.map_y,
      geoLng: r.geo_lng,
      geoLat: r.geo_lat,
    };
  },

  /** 设备坐标标定（新建设备时自动或手动更新） */
  async setEquipmentCoords(equipmentId: string, mapX: number, mapY: number) {
    const db = await getDb();
    await db.query(`UPDATE equipments SET map_x = $2, map_y = $3 WHERE id = $1;`, [equipmentId, mapX, mapY]);
  },

  /** 全部带坐标设备（大屏渲染点位，含真实经纬度） */
  async listEquipmentPoints() {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT e.id, e.code, e.name, e.workshop, e.status, e.health_score, e.map_x, e.map_y, e.geo_lng, e.geo_lat,
              (SELECT COUNT(*)::int FROM work_orders w WHERE w.equipment_id = e.id AND w.status NOT IN ('completed','cancelled')) AS open_orders
       FROM equipments e WHERE e.map_x IS NOT NULL AND e.map_y IS NOT NULL;`
    );
    return rows.map((r: any) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      workshop: r.workshop,
      status: r.status,
      healthScore: r.health_score,
      mapX: r.map_x,
      mapY: r.map_y,
      geoLng: r.geo_lng,
      geoLat: r.geo_lat,
      openOrders: r.open_orders,
    }));
  },

  /** 模拟位置：按车间区域随机扰动在岗师傅坐标（仅演示接口调用；带真实经纬度扰动） */
  async applyMockPositions(
    updates: { userId: string; mapX: number; mapY: number; status: string; reportedAt: string; geoLng?: number | null; geoLat?: number | null }[]
  ) {
    for (const u of updates) {
      await this.insertLocation({
        id: `tloc-${Date.now()}-${Math.floor(100 + Math.random() * 900)}-${u.userId.slice(-4)}`,
        userId: u.userId,
        mapX: u.mapX,
        mapY: u.mapY,
        status: u.status,
        reportedAt: u.reportedAt,
        geoLng: u.geoLng,
        geoLat: u.geoLat,
      });
      await this.updateUserPresence(u.userId, u.mapX, u.mapY, u.status, u.reportedAt, u.geoLng, u.geoLat);
    }
  },
};
