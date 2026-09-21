/**
 * 厂区指标口径（纯逻辑层：不依赖 three.js / DOM / 接口，可在 node 环境单测）。
 *
 * 这里解决的是"产值 / 良品率 / 在岗人数一直是『未接入』"这条验收线。做法**不是**
 * 再写一组常量冒充读数，而是将三个数变成**从真实台账派生的规划口径估算**，并显式
 * 打 `estimated` 标记，由标牌与 HUD 把"估算"两个字显示出来：
 *
 *   - deviceCount / abnormalCount / failureRate / healthAvg —— 真实台账可算，不估算；
 *   - outputValue —— Σ 单台「单位台年产值系数 × 实动工时因子 × 健康折损」，
 *                    系数只跟厂房角色与设备重要度相关，是产能测算用的假设值；
 *   - yieldRate  —— 角色基线良品率扣掉故障率与健康折损；
 *   - staffCount —— 角色定员（人/台·班）× 三班倒。
 *
 * 台账里一台设备都没有的车间**返回 null**，不给任何数字：没有样本就没有口径，
 * 编一个数比留白更糟。
 */

import type { FactoryRole } from './factoryBuildingTypes';
import { roleOfWorkshop } from './factoryBuildingTypes';

/** 台账里参与计算的最小字段集（Equipment 结构上直接满足，无需映射）。 */
export interface LedgerDevice {
  status?: string | null;
  healthScore?: number | null;
  /** 设备重要度；本项目台账取值为 关键核心 / 主要生产 / 通用辅助 */
  criticality?: string | null;
}

export interface WorkshopMetrics {
  workshop: string;
  role: FactoryRole;
  /** 真实台账台数 */
  deviceCount: number;
  /** 真实异常台数（status ∈ fault/warning，或调用方遥测派生后传入） */
  abnormalCount: number;
  /** 设备故障率 %；无设备 → null */
  failureRate: number | null;
  /** 平均健康分；台账无健康分 → null */
  healthAvg: number | null;
  /** 年产值估算（万元）；无设备 → null */
  outputValue: number | null;
  /** 良品率估算 %；无设备 → null */
  yieldRate: number | null;
  /** 在岗人数估算（三班）；无设备 → null */
  staffCount: number | null;
  /** true = outputValue/yieldRate/staffCount 为估算口径，界面必须标注 */
  estimated: boolean;
}

export interface ZoneMetrics {
  deviceCount: number;
  abnormalCount: number;
  failureRate: number | null;
  healthAvg: number | null;
  outputValue: number | null;
  yieldRate: number | null;
  staffCount: number | null;
  estimated: boolean;
}

/** 单台设备年产能价值系数（万元/台·年）：角色 × 重要度。产线规划假设值，非实测。 */
const UNIT_OUTPUT: Record<FactoryRole, Record<'high' | 'medium' | 'low', number>> = {
  power: { high: 260, medium: 150, low: 70 },
  heavy: { high: 420, medium: 230, low: 110 },
  light: { high: 180, medium: 120, low: 60 },
  storage: { high: 90, medium: 55, low: 30 },
};

/** 实动工时因子：台账运行状态 → 该台当年的产能发挥程度。 */
const RUNTIME_BY_STATUS: Record<string, number> = {
  running: 1,
  warning: 0.82,
  standby: 0.5,
  overhauling: 0.3,
  fault: 0.15,
  scrapped: 0,
};
const RUNTIME_DEFAULT = 0.6;

/** 角色基线良品率 %（工艺成熟度假设），再按故障率与健康分扣减。 */
const YIELD_BASE: Record<FactoryRole, number> = {
  power: 99.3,
  heavy: 97.6,
  light: 99.1,
  storage: 99.6,
};

/** 角色定员（人/台·班）与班次数。 */
const STAFF_PER_DEVICE: Record<FactoryRole, number> = {
  power: 0.5,
  heavy: 0.8,
  light: 0.35,
  storage: 0.25,
};
const SHIFTS = 3;

const CRITICALITY_LEVEL: Record<string, 'high' | 'medium' | 'low'> = {
  关键核心: 'high',
  主要生产: 'medium',
  通用辅助: 'low',
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function criticalityLevel(criticality: string | null | undefined): 'high' | 'medium' | 'low' {
  const key = String(criticality ?? '').trim();
  if (CRITICALITY_LEVEL[key]) return CRITICALITY_LEVEL[key];
  if (/关键|core|critical|a\b/i.test(key)) return 'high';
  if (/辅助|general|通用|c\b/i.test(key)) return 'low';
  return 'medium';
}

/**
 * 异常判定口径由调用方决定（遥测阈值派生在这里做不到，且不应重复实现）。
 * 本函数只覆盖台账 status 本身；调用方若已用遥测派生出 abnormal，可通过
 * `isAbnormal` 注入自己的判定。
 */
export type AbnormalPredicate = (d: LedgerDevice) => boolean;

export const statusAbnormal: AbnormalPredicate = (d) =>
  d.status === 'fault' || d.status === 'warning';

export interface WorkshopMetricsInput {
  workshopName: string;
  devices: LedgerDevice[];
  /** 厂房角色判定上下文（车间名未命中关键词时按分区序号轮转） */
  zoneIndex?: number;
  indexInZone?: number;
  /** 显式指定角色（厂区已按类型解析出来时直接传入，避免第二套判定） */
  role?: FactoryRole;
  isAbnormal?: AbnormalPredicate;
}

export function estimateWorkshopMetrics(input: WorkshopMetricsInput): WorkshopMetrics {
  const zoneIndex = Math.max(0, num(input.zoneIndex) ?? 0);
  const indexInZone = Math.max(0, num(input.indexInZone) ?? 0);
  const isAbnormal = input.isAbnormal ?? statusAbnormal;
  const role = input.role ?? roleOfWorkshop(input.workshopName, zoneIndex, indexInZone);
  const devices = Array.isArray(input.devices) ? input.devices : [];

  const deviceCount = devices.length;
  const abnormalCount = devices.filter((d) => isAbnormal(d)).length;

  const healths = devices
    .map((d) => num(d.healthScore))
    .filter((v): v is number => v !== null);
  const healthAvg = healths.length
    ? healths.reduce((a, b) => a + b, 0) / healths.length
    : null;

  if (deviceCount === 0) {
    return {
      workshop: input.workshopName,
      role,
      deviceCount: 0,
      abnormalCount: 0,
      failureRate: null,
      healthAvg: null,
      outputValue: null,
      yieldRate: null,
      staffCount: null,
      estimated: false,
    };
  }

  // 产值：逐台累加，健康分越低、停机越久，该台贡献越小
  const unitByRole = UNIT_OUTPUT[role];
  let output = 0;
  for (const d of devices) {
    const unit = unitByRole[criticalityLevel(d.criticality)];
    const runtime = RUNTIME_BY_STATUS[String(d.status ?? '')] ?? RUNTIME_DEFAULT;
    const h = num(d.healthScore);
    const healthFactor = h === null ? 0.95 : clamp(0.8 + 0.2 * (h / 100), 0.6, 1);
    output += unit * runtime * healthFactor;
  }

  const failureRate = (abnormalCount / deviceCount) * 100;
  const healthPenalty = healthAvg === null ? 0.6 : Math.max(0, 95 - healthAvg) * 0.06;
  const yieldRate = clamp(
    YIELD_BASE[role] - failureRate * 0.12 - healthPenalty,
    92,
    99.9
  );
  const staffCount = Math.max(1, Math.ceil(deviceCount * STAFF_PER_DEVICE[role]) * SHIFTS);

  return {
    workshop: input.workshopName,
    role,
    deviceCount,
    abnormalCount,
    failureRate,
    healthAvg,
    outputValue: Math.round(output),
    yieldRate,
    staffCount,
    estimated: true,
  };
}

/** 分区聚合：产值相加，良率与健康按台数加权，人数相加。 */
export function aggregateZoneMetrics(workshops: WorkshopMetrics[]): ZoneMetrics {
  const list = Array.isArray(workshops) ? workshops : [];
  const deviceCount = list.reduce((a, w) => a + w.deviceCount, 0);
  const abnormalCount = list.reduce((a, w) => a + w.abnormalCount, 0);
  if (deviceCount === 0) {
    return {
      deviceCount: 0,
      abnormalCount: 0,
      failureRate: null,
      healthAvg: null,
      outputValue: null,
      yieldRate: null,
      staffCount: null,
      estimated: false,
    };
  }
  /** 只对有读数的车间做加权，null 不参与、也不被当成 0 */
  const weighted = (pick: (w: WorkshopMetrics) => number | null): number | null => {
    let sum = 0;
    let weight = 0;
    for (const w of list) {
      const v = pick(w);
      if (v === null) continue;
      sum += v * w.deviceCount;
      weight += w.deviceCount;
    }
    return weight > 0 ? sum / weight : null;
  };
  const outputs = list.map((w) => w.outputValue);
  const staff = list.map((w) => w.staffCount);
  return {
    deviceCount,
    abnormalCount,
    failureRate: (abnormalCount / deviceCount) * 100,
    healthAvg: weighted((w) => w.healthAvg),
    outputValue: outputs.some((v) => v !== null)
      ? outputs.reduce<number>((a, v) => a + (v ?? 0), 0)
      : null,
    yieldRate: weighted((w) => w.yieldRate),
    staffCount: staff.some((v) => v !== null)
      ? staff.reduce<number>((a, v) => a + (v ?? 0), 0)
      : null,
    estimated: list.some((w) => w.estimated),
  };
}

/** 估算口径说明文案（HUD 角标与图例共用一份，避免出现第二套说法）。 */
export const ESTIMATE_NOTE = '按台账规模与角色定员测算，非采集读数';

/** 数值 → "1,420" 文案（千分位，不编造小数）。 */
export function formatWan(v: number | null | undefined): string | null {
  const n = num(v);
  if (n === null) return null;
  return Math.round(n).toLocaleString('zh-CN');
}
