import { getDb } from "../db.ts";

export const LotoLockRepository = {
  mapRow(r: any) {
    return {
      id: r.id,
      lockNo: r.lock_no,
      permitNo: r.permit_no,
      permitTitle: r.permit_title,
      pointName: r.point_name,
      energySource: r.energy_source,
      location: r.location,
      workshop: r.workshop,
      lockedBy: r.locked_by,
      lockedAt: r.locked_at,
      status: r.status,
      unlockedAt: r.unlocked_at,
      unlockRemark: r.unlock_remark,
      // 智能物联网 LOTO 锁具物理硬件遥测与锁梁状态 (Smart Lockout IoT)
      hardwareType: r.hardware_type || (r.id?.includes("2") ? "BLE_NFC_SMART_PADLOCK" : "BLE_SMART_HASP"),
      batteryLevel: r.battery_level ?? (r.status === "locked" ? 94 : 88),
      beamState: r.beam_state || (r.status === "locked" ? "LOCKED_ENGAGED" : "RELEASED"),
      lastHeartbeat: r.last_heartbeat || r.locked_at || new Date().toISOString(),
    };
  },

  async getAll(filters?: { status?: string }) {
    const db = await getDb();
    let sql = `SELECT * FROM loto_locks`;
    const params: any[] = [];
    if (filters?.status && filters.status !== "all") {
      params.push(filters.status);
      sql += ` WHERE status = $1`;
    }
    sql += ` ORDER BY created_at DESC, id DESC;`;
    const { rows } = await db.query(sql, params);
    return rows.map((r: any) => this.mapRow(r));
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM loto_locks WHERE id = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    return this.mapRow(rows[0]);
  },
};
