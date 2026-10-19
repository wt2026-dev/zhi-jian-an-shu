import { getDb } from "../db.ts";
import type { LotoLock } from "../../types/index.ts";

export const LotoLockRepository = {
  mapRow(r: any): LotoLock {
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
      // 智能物联网 LOTO 锁具硬件字段（Smart Lockout IoT）
      //
      // ⚠️ 数据红线（勿改回"兜底默认值"）：`loto_locks` 表**没有** hardware_type /
      // battery_level / beam_state / last_heartbeat 这四列，本系统也没有任何
      // 蓝牙/NFC 锁具的接入通路。旧实现按 status 编造 `batteryLevel ?? (locked ? 94 : 88)`、
      // 按 `id.includes("2")` 猜硬件型号、用 `new Date()` 伪造心跳时间 ——
      // 读起来完全像真实的设备遥测，但全部是凭空生成的。
      // 现在一律如实返回 null；没有硬件就在界面上显示「未接入」。
      hardwareType: null,
      batteryLevel: null,
      beamState: null,
      lastHeartbeat: null,
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

  async create(lock: {
    id?: string;
    lockNo: string;
    permitNo?: string | null;
    permitTitle?: string | null;
    pointName?: string | null;
    energySource?: string | null;
    location?: string | null;
    workshop?: string | null;
    lockedBy: string;
    status?: string;
  }) {
    const db = await getDb();
    const id = lock.id || `lock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { rows } = await db.query(
      `INSERT INTO loto_locks (id, lock_no, permit_no, permit_title, point_name, energy_source, location, workshop, locked_by, locked_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (lock_no) DO NOTHING RETURNING *;`,
      [
        id,
        lock.lockNo,
        lock.permitNo || null,
        lock.permitTitle || null,
        lock.pointName || null,
        lock.energySource || null,
        lock.location || null,
        lock.workshop || null,
        lock.lockedBy,
        new Date().toISOString(),
        lock.status || "locked",
      ]
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  },

  async release(id: string, releasedBy: string, unlockRemark: string) {
    const db = await getDb();
    const { rowCount } = await db.query(
      `UPDATE loto_locks SET status = 'unlocked', unlocked_at = $2, unlock_remark = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'locked';`,
      [id, new Date().toISOString(), `${releasedBy}：${unlockRemark}`]
    );
    if (rowCount === 0) return null;
    return this.getById(id);
  },
};
