import { getDb } from "../db.ts";

function padHour(n: number): string {
  return n.toString().padStart(2, "0");
}

export const TelemetryRepository = {
  // 读取某设备最近 N 条真实落库遥测历史（按时间升序返回，供图表绘制）
  async getHistory(equipmentId: string, limit = 24) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM equipment_telemetry WHERE equipment_id = $1 ORDER BY recorded_at_dt DESC LIMIT $2;`,
      [equipmentId, limit]
    );
    rows.reverse(); // 升序时间轴
    return rows.map((r: any) => {
      const d = r.recorded_at_dt ? new Date(r.recorded_at_dt) : null;
      return {
        timestamp: r.recorded_at || (d ? `${padHour(d.getHours())}:00` : "--:--"),
        fullTime: r.recorded_at_dt,
        temperature: Number(r.temperature),
        vibration: Number(r.vibration),
        current: Number(r.current),
        voltage: Number(r.voltage),
        pressure: Number(r.pressure),
        loadRate: Number(r.load_rate),
        rpm: Number(r.rpm),
      };
    });
  },

  // 显式按实际时间窗口读取；不改变 getHistory 的最近 N 条语义。
  async getHistoryInWindow(equipmentId: string, hours: number) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM equipment_telemetry
       WHERE equipment_id = $1
         AND recorded_at_dt >= CURRENT_TIMESTAMP - ($2::double precision * INTERVAL '1 hour')
         AND recorded_at_dt <= CURRENT_TIMESTAMP
       ORDER BY recorded_at_dt ASC;`,
      [equipmentId, hours]
    );
    // 缺测值保留 null，不能把数据库 NULL 转为 0 读数。
    const reading = (value: unknown) => value == null ? null : Number(value);
    return rows.map((r: any) => ({
      timestamp: r.recorded_at || `${padHour(new Date(r.recorded_at_dt).getHours())}:00`,
      fullTime: r.recorded_at_dt,
      temperature: reading(r.temperature),
      vibration: reading(r.vibration),
      current: reading(r.current),
      voltage: reading(r.voltage),
      pressure: reading(r.pressure),
      loadRate: reading(r.load_rate),
      rpm: reading(r.rpm),
    }));
  },

  // 批量写入遥测历史（种子与后续采集共用）
  async insertBatch(rows: {
    equipmentId: string;
    equipmentCode?: string;
    recordedAt?: string;
    recordedAtDt?: Date | string;
    temperature?: number;
    vibration?: number;
    current?: number;
    voltage?: number;
    pressure?: number;
    loadRate?: number;
    rpm?: number;
  }[]) {
    if (!rows.length) return 0;
    const db = await getDb();
    const COLUMNS = 11;
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const placeholders = chunk
        .map(
          (_, k) =>
            `(${Array.from({ length: COLUMNS }, (_, c) => `$${k * COLUMNS + c + 1}`).join(",")})`
        )
        .join(",");
      const vals = chunk.flatMap((r) => [
        r.equipmentId,
        r.equipmentCode || null,
        r.recordedAt || null,
        r.recordedAtDt ? (r.recordedAtDt instanceof Date ? r.recordedAtDt.toISOString() : r.recordedAtDt) : null,
        r.temperature ?? null,
        r.vibration ?? null,
        r.current ?? null,
        r.voltage ?? null,
        r.pressure ?? null,
        r.loadRate ?? null,
        r.rpm ?? null,
      ]);
      await db.query(
        `INSERT INTO equipment_telemetry (equipment_id, equipment_code, recorded_at, recorded_at_dt, temperature, vibration, current, voltage, pressure, load_rate, rpm)
         VALUES ${placeholders};`,
        vals
      );
    }
    return rows.length;
  },

  async clearAll() {
    const db = await getDb();
    await db.query(`DELETE FROM equipment_telemetry;`);
  },
};
