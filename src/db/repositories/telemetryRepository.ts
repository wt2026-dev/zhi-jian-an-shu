import { getDb } from "../db.ts";

function padHour(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * 遥测历史仓储。
 *
 * ⚠️ 数据来源诚实性声明（勿删）：本表当前有**两条**写入通路——
 * 1. 种子期写入（`src/db/seed.ts` 调用 `insertBatch`，按 sin 曲线 + 伪随机确定性合成），
 *    仍是演示/开发默认数据源；
 * 2. **摄入接口** `POST /api/v1/telemetry/ingest`（`ingestBatch` 经 `insertBatch` 落库，
 *    见 `src/server/controllers/telemetryController.ts`）：可接入真实采集或模拟采集，
 *    调用方在 source 字段与审计日志中自述来源。
 * 落库后两条通路同表，消费方无法从数据本身区分来源 —— UI 与文档一律不得表述为
 * “真实读数 / 实测数据”；对外口径见 `docs/工业化演进与硬件对接方案.md` 第四节
 * （OPC-UA / Modbus-TCP 协议级接入为 3.0 规划，本端点提供 HTTP 层的先行通道）。
 */
export const TelemetryRepository = {
  // 读取某设备最近 N 条已落库遥测（仿真数据，来源见文件头声明；按时间升序返回，供图表绘制）
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

  // 批量写入遥测历史。种子与摄入接口共用；摄入入口见 ingestBatch。
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

  // 摄入入口：POST /api/v1/telemetry/ingest 的落库通道。controller 已做设备存在性、
  // 读数范围校验与审计留痕；此处与种子共用 insertBatch 底层写入（见文件头声明）。
  async ingestBatch(rows: {
    equipmentId: string;
    recordedAtDt?: Date | string;
    temperature?: number;
    vibration?: number;
    current?: number;
    voltage?: number;
    pressure?: number;
    loadRate?: number;
    rpm?: number;
  }[]) {
    return TelemetryRepository.insertBatch(rows);
  },
};
