/**
 * 设备故障定位服务 —— 把「设备运行状态监测」在真实遥测里检出的超标指标，
 * 与「拆解视图 BOM 位号」对齐，供拆解页自动高亮故障观察部位 + 侧边故障详情卡。
 *
 * ## 数据来源（全部真实，不编造）
 *   · 遥测：equipment_telemetry 表（真实落库时序：temperature / vibration / load_rate …）。
 *     这里只读最近 24h 真实窗口，用与 3D 大厅场景同一份阈值口径
 *     （components/equipment3d/statusMapping.ts —— 全系统唯一阈值源）判定严重度。
 *   · 部位：explodedCatalog.generated.ts —— 拆解页零件数组原文提取的真实 BOM。
 *
 * ## 判定口径（诚实声明）
 *   · "未处理的故障" = 最近 24h 窗口的**最新真实读数**仍在报警阈值之上
 *     （读数恢复正常 = 已处理恢复，不再高亮 —— 不查工单表假装闭环）。
 *   · 遥测是"设备级"读数，不是"零件级"传感器 —— 不做部件诊断。超标指标与拆解页
 *     零件的对应关系按「观察部位」口径（与大厅 partEvidence 一致）：每个指标声明
 *     该设备上应重点检查的真实零件（keyword 在真实 BOM 名称里做子串命中），命中
 *     证据原样透传 matchedBy；命中不到就空着并如实说明，绝不编一个零件位号。
 *   · 遥测窗口无读数 / 指标全部正常 → faults 返回空 + dataNote 如实说明。
 */
import { TelemetryRepository } from '../../db/repository.ts';
import { EquipmentRepository } from '../../db/repositories/equipmentRepository.ts';
import { THRESHOLDS, telemetryToStatus } from '../../components/equipment3d/statusMapping.ts';
import { getCatalogForDevice, type CatalogPart } from './partMatchService.ts';
import { EXPLODED_VIEW_FILES } from '../../components/equipment3d/explodedViewFiles.ts';

export type FaultMetric = 'temperature' | 'vibration' | 'loadRate';

/** 峰值严重度类型（与 statusMapping 的 classifyNumeric 保持 worst-case 语义） */
export type FaultSeverity = 'warning' | 'fault' | 'critical';

export interface FaultObservationPart {
  posNo: string;
  name: string;
  category?: string;
  /** 命中证据（关键词原文，透明可解释） */
  matchedBy: string[];
}

export interface DeviceFaultMetric {
  metric: FaultMetric;
  metricLabel: string;
  value: number;
  unit: string;
  /** 低于该值属正常；达到即为 warning/fault/critical（与 statusMapping 阈值一致） */
  warningThreshold: number;
  severity: FaultSeverity;
  /** 窗口内首次达到当前严重程度的采样时间（ISO）；缺失读法时用最新采样时间兜底 */
  occurredAt: string | null;
  /** 观察部位（拆解页真实位号；第 1 个 = 高亮主目标，余下为关联观察点） */
  observationParts: FaultObservationPart[];
  /** 建议处理方式（经验性建议措辞，非自动诊断结论） */
  suggestion: string;
}

export interface DeviceFaultDiagnostics {
  deviceId: string;
  deviceName: string;
  deviceCode: string;
  /** 设备所属拆解页文件（有拆解视图才有观察部位可对齐） */
  explodedViewFile: string | null;
  /** 检出的未处理故障（最多 3 个指标各一，按严重度降序） */
  faults: DeviceFaultMetric[];
  /** 窗口内最新一次真实采样的时间 */
  latestSampleAt: string | null;
  dataNote: string;
}

const SEVERITY_RANK: Record<FaultSeverity, number> = { warning: 1, fault: 2, critical: 3 };

const METRIC_META: Record<FaultMetric, { label: string; unit: string; fallbackThreshold: number }> = {
  temperature: { label: '设备温度', unit: '°C', fallbackThreshold: 9999 },
  vibration: { label: '设备振动', unit: 'mm/s', fallbackThreshold: 9999 },
  loadRate: { label: '设备负载率', unit: '%', fallbackThreshold: 9999 },
};

/** 每个指标的经验性处理建议 —— 只给方向性建议，不做自动诊断结论 */
const METRIC_SUGGESTIONS: Record<FaultMetric, string> = {
  vibration: '建议按频谱测点复核振值来源，优先检查轴承磨损与转子/轴系对中情况，必要时安排解体检查。',
  temperature: '建议核查润滑油位、冷却回路与测温元件，重点检查轴承座与绕组温升，防止润滑失效扩大。',
  loadRate: '建议核实当前工艺负载是否超出设备额定工况，评估长时间满载运行的部件磨损风险，必要时降载运行。',
};

/**
 * 指标 → 拆解页观察部位的关键词表（取该 metric 最有检查价值的真实零件）。
 * 只声明"应在拆解页重点看的部位"，不是部件级诊断；命中不到就空，不编位号。
 */
const OBSERVATION_HINTS: Record<string, Partial<Record<FaultMetric, string[]>>> = {
  'eq-102': { // 2# 无油螺杆空压机主机
    temperature: ['永磁电机', '圆柱滚子轴承组', '推力球轴承组'],
    vibration: ['推力球轴承组', '圆柱滚子轴承组', '螺旋轴'],
    loadRate: ['永磁电机钕铁硼转子', '同步齿轮', '膜片联轴器'],
  },
  'eq-104': { // 4# 10kV 高压循环水主电机
    temperature: ['定子', '滚柱轴承', '深沟球轴承'],
    vibration: ['滚柱轴承', '深沟球轴承', '转子与主轴'],
    loadRate: ['转子与主轴', '定子机座'],
  },
  'eq-105': { // 5# 多级高压锅炉给水泵
    temperature: ['巴氏合金剖分瓦', '轴承箱体', '机械密封'],
    vibration: ['巴氏合金剖分瓦', '长泵轴', '机械密封'],
    loadRate: ['叶轮', '平衡盘', '长泵轴'],
  },
  'eq-106': { // 6# 离心式工艺空气压缩机
    temperature: ['可倾瓦径向滑动轴承', '推力轴承', '稀油润滑'],
    vibration: ['可倾瓦径向滑动轴承', '可倾瓦推力轴承', '主轴与小齿轮轴', '叶轮'],
    loadRate: ['主轴与小齿轮轴', '离心叶轮', '增速大齿轮'],
  },
  'eq-107': { // 7# 冷轧卷取机主传动硬齿面减速机
    temperature: ['调心滚子轴承', '圆锥滚子轴承组', '强制循环喷油润滑'],
    vibration: ['圆锥滚子轴承组', '调心滚子轴承', '行星架'],
    loadRate: ['行星架', '空心输出主轴', '行星轮'],
  },
  'eq-112': { // 12# 连铸结晶器冷却循环泵
    temperature: ['定子铁芯', '紫铜绕组', '圆柱滚子'],
    vibration: ['轴承箱悬架体', '圆柱滚子', '角接触球轴承', '主泵轴'],
    loadRate: ['鼠笼转子', '电机机座', '闭式离心叶轮'],
  },
  'eq-103': { // 3# 轧机主传动行星减速箱
    temperature: ['调心滚子轴承组', '圆锥滚子轴承组', '行星架', '强制循环喷油润滑'],
    vibration: ['圆锥滚子轴承组', '调心滚子轴承组', '行星架'],
    loadRate: ['行星架', '特大型双列调心滚子轴承组', '输出主轴'],
  },
  'eq-114': { // 14# 成品线变频调速三相异步电机（备用）
    temperature: ['定子铁芯', '圆柱滚子轴承', '深沟球轴承'],
    vibration: ['圆柱滚子轴承', '深沟球轴承', '转子主轴'],
    loadRate: ['鼠笼导条', '转子主轴', '定子铁芯'],
  },
  'eq-115': { // 15# 成品自动码垛工业机器人（六轴机械臂 005）
    temperature: ['J1轴电机/减速器', '驱动电路板'],
    vibration: ['J1轴电机/减速器', 'J2轴关节', 'J3轴'],
    loadRate: ['J2轴关节', 'J3轴', '小臂'],
  },
};

/** 在该设备的真实 BOM 目录里做"名称子串命中"——直接、透明、可解释。 */
export function resolveObservationParts(deviceId: string, keywords: string[], limit = 3): FaultObservationPart[] {
  const catalog = getCatalogForDevice(deviceId);
  if (!catalog.length || !keywords?.length) return [];
  const parts: FaultObservationPart[] = [];
  const used = new Set<string>();
  for (const kw of keywords) {
    if (!kw) continue;
    const hit: CatalogPart | undefined = catalog.find(
      (p) => !used.has(p.posNo) && p.name.includes(kw)
    );
    if (!hit) continue;
    used.add(hit.posNo);
    parts.push({ posNo: hit.posNo, name: hit.name, category: hit.category, matchedBy: [kw] });
    if (parts.length >= limit) break;
  }
  return parts;
}

export interface FaultSampleRow {
  fullTime?: string | null;
  temperature?: number | null;
  vibration?: number | null;
  loadRate?: number | null;
}

/** 单指标判定：最新读取 + 严重度 + 窗口内达到该严重度的首次时间。正常返回 null。 */
export function classifyMetricFault(metric: FaultMetric, rows: FaultSampleRow[]): {
  value: number;
  severity: FaultSeverity;
  warningThreshold: number;
  occurredAt: string | null;
} | null {
  const withValue = rows.filter((r) => {
    const v = r[metric];
    return typeof v === 'number' && Number.isFinite(v);
  });
  if (!withValue.length) return null;
  const latest = withValue[withValue.length - 1];
  const value = Number(latest[metric]);
  const severity = telemetryToStatus({ [metric]: value } as any) as FaultSeverity | null;
  if (!severity) return null;
  const warningThreshold = THRESHOLDS[metric].warning;
  // 窗口内第一次"达到当前严重程度"的采样时间（更早历史截在 24h 窗口内，如实）
  const firstHit = withValue.find((r) => {
    const s = telemetryToStatus({ [metric]: r[metric] } as any) as FaultSeverity | null;
    return s != null && SEVERITY_RANK[s] >= SEVERITY_RANK[severity];
  });
  return {
    value,
    severity,
    warningThreshold,
    occurredAt: firstHit?.fullTime ?? latest.fullTime ?? null,
  };
}

/**
 * 读真实遥测（最近 24h）判定该设备当前是否有未处理故障，并把超标指标
 * 与拆解页观察部位对齐。遥测/台账均为真实 DB 记录，窗口无读数时如实说明。
 */
export async function getDeviceFaultDiagnostics(deviceId: string): Promise<DeviceFaultDiagnostics> {
  const eq = await EquipmentRepository.getById(deviceId);
  if (!eq) throw Object.assign(new Error('设备未找到'), { code: 'EQUIPMENT_NOT_FOUND' });

  const WINDOW_HOURS = 24;
  const rows = await TelemetryRepository.getHistoryInWindow(deviceId, WINDOW_HOURS) as FaultSampleRow[];
  const latestSampleAt = rows.length
    ? (rows[rows.length - 1].fullTime ?? null)
    : null;

  if (!rows.length) {
    return {
      deviceId, deviceName: eq.name ?? '', deviceCode: eq.code ?? '', explodedViewFile: null,
      faults: [], latestSampleAt: null,
      dataNote: `最近 ${WINDOW_HOURS} 小时遥测窗口内没有落库读数，无法据此判定设备故障状态（如实说明，不补假数据）。`,
    };
  }

  const hints = OBSERVATION_HINTS[deviceId] ?? {};
  const faults: DeviceFaultMetric[] = [];
  for (const metric of ['temperature', 'vibration', 'loadRate'] as FaultMetric[]) {
    const hit = classifyMetricFault(metric, rows);
    if (!hit) continue;
    faults.push({
      metric,
      metricLabel: METRIC_META[metric].label,
      value: hit.value,
      unit: METRIC_META[metric].unit,
      warningThreshold: hit.warningThreshold,
      severity: hit.severity,
      occurredAt: hit.occurredAt,
      // 只在真实 BOM 中声明关键词命中的观察部位；无拆解页/无命中 → 如实为空
      observationParts: resolveObservationParts(deviceId, hints[metric] ?? []),
      suggestion: METRIC_SUGGESTIONS[metric],
    });
  }
  faults.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.value - a.value);

  const notes: string[] = [
    '故障由设备遥测真实读数与报警阈值判定（与 3D 场景同一份阈值口径）；最新读数仍在阈值之上视为未处理。'
  ];
  if (!faults.length) notes.push('窗口内最新读数均低于报警阈值，设备当前无超标故障。');
  const isOverhauling = ['overhauling', 'maintenance', 'repair', 'overhaul'].includes(String(eq.status ?? '').toLowerCase());
  if (isOverhauling) notes.push(`设备台账状态为「${eq.status}」（检修中），现场处理情况以工单为准。`);
  if (!OBSERVATION_HINTS[deviceId]) notes.push('该设备暂未建拆解视图的观察部位映射，仅显示遥测故障详情，不做部位高亮。');

  return {
    deviceId,
    deviceName: eq.name ?? '',
    deviceCode: eq.code ?? '',
    explodedViewFile: EXPLODED_VIEW_FILES[deviceId] ?? null,
    faults,
    latestSampleAt,
    dataNote: notes.join(' '),
  };
}
