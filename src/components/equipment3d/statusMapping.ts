/**
 * 纯函数：将单个遥测数据点映射为设备状态色（StatusKey）。
 *
 * 用途：遥测回放时，根据当前时刻的温度/振动/负载率判定设备"应该处于什么状态"，
 * 从而驱动 3D 场景中该设备的状态色 / 光环 / 闪烁联动。
 *
 * 设计原则：
 *   - 纯函数，无副作用，无随机数
 *   - 阈值来自工业设备常见报警阈值（与后端 healthScore 判定口径一致）
 *   - 多指标取最严重者（worst-case）
 *   - 未超阈值时返回 null（由调用方回退到台账真实 status）
 */

import type { StatusKey } from './equipment';

export interface TelemetryLike {
  temperature?: number;
  vibration?: number;
  loadRate?: number;
}

/** 报警阈值分界线（从宽松到严格依次为 warning → fault → critical）
 *  导出供服务端故障定位服务复用 —— 全系统只维护这一份阈值口径 */
export const THRESHOLDS = {
  temperature: {
    warning: 80,    // °C — 轴温预警
    fault: 95,      // °C — 轴温故障
    critical: 110,  // °C — 轴温紧急
  },
  vibration: {
    warning: 4.5,   // mm/s — 振动预警
    fault: 7.0,     // mm/s — 振动故障
    critical: 10.0, // mm/s — 振动紧急
  },
  loadRate: {
    warning: 85,    // % — 负载预警
    fault: 95,      // % — 负载故障
    critical: 100,  // % — 负载紧急（满载）
  },
} as const;

function classifyNumeric(
  value: number,
  thresholds: { warning: number; fault: number; critical: number }
): 'warning' | 'fault' | 'critical' | null {
  if (value >= thresholds.critical) return 'critical';
  if (value >= thresholds.fault) return 'fault';
  if (value >= thresholds.warning) return 'warning';
  return null;
}

const SEVERITY_RANK: Record<string, number> = {
  warning: 1,
  fault: 2,
  critical: 3,
};

/**
 * 根据遥测数据点判定设备应处的状态。
 *
 * @returns 最严重的告警状态（warning / fault / critical），
 *          若所有指标均正常则返回 null（调用方应回退到台账真实 status）。
 */
export function telemetryToStatus(point: TelemetryLike | null | undefined): StatusKey | null {
  if (!point) return null;

  let worst: StatusKey | null = null;
  let worstRank = 0;

  const checks: Array<{ value: number | undefined; thresholds: { warning: number; fault: number; critical: number } }> = [
    { value: point.temperature, thresholds: THRESHOLDS.temperature },
    { value: point.vibration, thresholds: THRESHOLDS.vibration },
    { value: point.loadRate, thresholds: THRESHOLDS.loadRate },
  ];

  for (const { value, thresholds } of checks) {
    if (value == null || !Number.isFinite(value)) continue;
    const severity = classifyNumeric(value, thresholds);
    if (severity && SEVERITY_RANK[severity] > worstRank) {
      worstRank = SEVERITY_RANK[severity];
      worst = severity as StatusKey;
    }
  }

  return worst;
}
