import { z } from "zod";

/**
 * 遥测数据摄入（POST /api/v1/telemetry/ingest）。
 *
 * 与 equipment_telemetry 表列对齐：温度/振动/电流/电压/压力/负载率/转速。
 * - 读数允许为空（null / 缺省）表达「该测点本次未采集」，与仓储层 ?? null 语义一致；
 * - 禁止 NaN / Infinity（z.number().finite()）；
 * - 物理范围取宽值：真实读数可能越出种子仿真区间（超限本身就是异常信号），
 *   但离谱垃圾值（如 1e99）必须被拦下。
 */

const reading = z.number().finite().min(-1000).max(100000).nullable().optional();

export const telemetryPointSchema = z.object({
  equipmentId: z.string().min(1).max(64),
  /** ISO 8601 时间戳（UTC 或带偏移均可）；缺省由数据库 CURRENT_TIMESTAMP 兜底 */
  recordedAtDt: z.union([z.string().datetime({ offset: true }), z.string().datetime()]).optional(),
  temperature: reading,
  vibration: reading,
  current: reading,
  voltage: reading,
  pressure: reading,
  loadRate: reading,
  rpm: reading,
});

export const telemetryIngestSchema = z.object({
  /** 数据来源自述（如 "mqtt-simulator" / "csv-import" / "manual"），仅用于审计口径，不落库 */
  source: z.string().min(1).max(64).optional(),
  points: z.array(telemetryPointSchema).min(1).max(500),
});

export type TelemetryPoint = z.infer<typeof telemetryPointSchema>;
export type TelemetryIngestPayload = z.infer<typeof telemetryIngestSchema>;
