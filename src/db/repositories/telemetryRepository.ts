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
