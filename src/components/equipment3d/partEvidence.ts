import { telemetryToStatus, type TelemetryLike } from './statusMapping';

/** Device-level readings only: these are NOT sensors mounted on the named parts. */
export interface PartTelemetry extends TelemetryLike {
  /** Optional adapter alias; the existing API's temperature field takes precedence. */
  temp?: number;
}

export type PartMetric = 'temp' | 'vibration' | 'loadRate';
export interface PartObservationZone {
  readonly partKey: string;
  readonly partLabel: string;
  readonly metric: PartMetric;
}

const zone = (partKey: string, partLabel: string, metric: PartMetric): PartObservationZone =>
  Object.freeze({ partKey, partLabel, metric });

/** Explicit existing static recipe keys. No invented parts, diagnoses, or category fallback. */
export const PART_OBSERVATION_ZONES: Readonly<Record<string, readonly PartObservationZone[]>> = Object.freeze(
  Object.fromEntries(Object.entries({
    'eq-101': [zone('motor', '顶部电机', 'temp'), zone('coupling', '联轴器护罩', 'vibration'), zone('volute', '蜗壳泵体', 'loadRate')],
    'eq-102': [zone('pipeOut', '出气管', 'temp'), zone('shellL', '隔音箱体侧板', 'vibration'), zone('shellR', '隔音箱体侧板', 'loadRate')],
    'eq-103': [zone('oilTank', '润滑油罐', 'temp'), zone('inShaft', '输入轴', 'vibration'), zone('coupling', '对轮联轴器', 'loadRate')],
    'eq-104': [zone('frame', '电机机壳', 'temp'), zone('capB', '轴端盖', 'vibration'), zone('termBox', '接线盒', 'loadRate')],
    'eq-105': [zone('motor', '驱动电机', 'temp'), zone('inFlange', '入口法兰', 'vibration'), zone('stage3', '中段泵壳', 'loadRate')],
    'eq-106': [zone('outPipe', '排气管', 'temp'), zone('bearingBox', '轴承箱', 'vibration'), zone('volute', '离心蜗壳', 'loadRate')],
    'eq-107': [zone('body', '减速箱体', 'temp'), zone('hShaft', '输入轴', 'vibration'), zone('bigFlange', '输出端法兰', 'loadRate')],
    'eq-108': [zone('coolHood', '冷却风罩', 'temp'), zone('capB', '轴端盖', 'vibration'), zone('exciter', '励磁机', 'loadRate')],
    'eq-109': [zone('spindle', '主轴', 'temp'), zone('table', '工作台', 'vibration'), zone('gantry', '龙门横梁', 'loadRate')],
    'eq-110': [zone('shoulder', '肩部关节', 'temp'), zone('elbow', '肘部关节', 'vibration'), zone('toolBase', '夹爪基座', 'loadRate')],
    'eq-111': [zone('plateHead', '板片组压紧端板', 'temp'), zone('plateEnd', '板片组尾端板', 'vibration')],
    'eq-112': [zone('motor', '驱动电机', 'temp'), zone('flangeS', '吸入口法兰', 'vibration'), zone('discharge', '排出口', 'loadRate')],
    'eq-113': [zone('condenser', '冷凝器', 'temp'), zone('screw', '螺杆主机', 'vibration'), zone('separator', '油分离器', 'loadRate')],
    'eq-114': [zone('fanCabinet', '冷却风机柜', 'temp'), zone('capB', '轴端盖', 'vibration'), zone('frame', '电机机壳', 'loadRate')],
    'eq-115': [zone('shoulder', '肩部关节', 'temp'), zone('elbow', '肘部关节', 'vibration'), zone('foreArm', '前臂', 'loadRate')],
    'eq-116': [zone('casing', '换热器箱体', 'temp')],
  }).map(([id, zones]) => [id, Object.freeze(zones)])),
);

export type PartEvidenceState = 'unavailable' | 'healthy' | 'warning' | 'maintenance' | 'fault';
export interface PartEvidence extends PartObservationZone {
  readonly source: 'device-telemetry';
  readonly relation: 'observation-zone';
  readonly value: number | null;
  readonly unit: string;
  readonly state: PartEvidenceState;
  readonly thresholdStatus: 'warning' | 'fault' | 'critical' | null;
  readonly label: string;
}

export const PART_EVIDENCE_COLOURS = Object.freeze({
  healthy: 0x22d3ee,
  warning: 0xfacc15,
  maintenance: 0xfacc15,
  fault: 0xef4444,
});

const METRICS = {
  temp: { field: 'temperature', label: '设备温度', unit: '°C' },
  vibration: { field: 'vibration', label: '设备振动', unit: 'mm/s' },
  loadRate: { field: 'loadRate', label: '设备负载率', unit: '%' },
} as const;

/** Copy only finite numbers; null/NaN/infinity/strings must never become zero or healthy. */
export function finitePartTelemetry(point: PartTelemetry | null | undefined): TelemetryLike {
  const result: TelemetryLike = {};
  if (!point) return result;
  const temperature = point.temperature === undefined ? point.temp : point.temperature;
  for (const [key, value] of [
    ['temperature', temperature], ['vibration', point.vibration], ['loadRate', point.loadRate],
  ] as const) {
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

export function getPartEvidence(
  recipeId: string,
  telemetry?: PartTelemetry | null,
  status?: string,
): readonly PartEvidence[] {
  const point = finitePartTelemetry(telemetry);
  const maintenance = ['overhauling', 'maintenance', 'repair', 'overhaul'].includes(String(status ?? '').trim().toLowerCase());
  return Object.freeze((PART_OBSERVATION_ZONES[recipeId] ?? []).map((part): PartEvidence => {
    const meta = METRICS[part.metric];
    const value = point[meta.field] ?? null;
    // Delegate a SINGLE metric to the existing threshold policy; never duplicate its numbers.
    const classified = value === null ? null : telemetryToStatus({ [meta.field]: value });
    const thresholdStatus = classified === 'warning' || classified === 'fault' || classified === 'critical' ? classified : null;
    const state: PartEvidenceState = value === null ? 'unavailable'
      : thresholdStatus === 'fault' || thresholdStatus === 'critical'
        ? 'fault' : maintenance ? 'maintenance' : thresholdStatus === 'warning' ? 'warning' : 'healthy';
    return Object.freeze({
      ...part, source: 'device-telemetry', relation: 'observation-zone', value, unit: meta.unit, state, thresholdStatus,
      label: `${meta.label}${value === null ? '暂无读数' : `${value}${meta.unit}`}·${maintenance ? '设备检修中·' : ''}关联检查部位（${part.partLabel}，非部件诊断）`,
    });
  }));
}
