/**
 * 「检修闯关」三步关卡模型与评分 —— **纯逻辑，无 React、无 three.js**，可直接单测。
 *
 * 每台设备 = 一个关卡，固定三步：
 *   ① `hunt`  观察设备、点击异常部位
 *   ② `tool`  选择正确的检修工具
 *   ③ `order` 按正确顺序操作
 *
 * ## 数据红线（与项目既有口径一致）
 *
 * - **异常判定只认真实遥测**：复用 `statusMapping.telemetryToStatus` 的**同一套阈值**
 *   （温度 80/95/110、振动 4.5/7/10、负载 85/95/100）。逐指标单独送进去判定，
 *   正是 `partEvidence.ts` 已确立的用法，绝不在这里另抄一份阈值。
 * - **没有阈值口径的指标（电流/电压/压力）只如实显示读数**，标注"无阈值"，不判异常。
 * - **读数缺失一律显示"未接入"**，绝不用 0 或编造值顶替。
 * - 题目内容全部来自真实规程（`tools` / `content` / 步骤名），不硬编码编造步骤。
 */
import type { Equipment, MaintenanceProcedure, ProcedureStep } from '../../types';
import { telemetryToStatus, type TelemetryLike } from '../equipment3d/statusMapping';
import { parseTools, splitContentActions } from './gameData';

/* ============================ 类型 ============================ */

export type SpotSeverity = 'normal' | 'warning' | 'fault' | 'critical' | 'unrated' | 'nodata';

export interface HuntSpot {
  key: string;
  /** 部位名（工业口径） */
  label: string;
  /** 指标字段名 */
  metric: string;
  /** 实测读数文案，例如 `72.4 ℃`；无数据时为 null（UI 必须显示"未接入"） */
  reading: string | null;
  severity: SpotSeverity;
  abnormal: boolean;
}

export interface HuntStep {
  kind: 'hunt';
  title: string;
  prompt: string;
  spots: HuntSpot[];
  correctKey: string;
  explain: string;
}

export interface ToolStep {
  kind: 'tool';
  title: string;
  prompt: string;
  options: string[];
  correct: string;
  explain: string;
}

export interface OrderStep {
  kind: 'order';
  title: string;
  prompt: string;
  /** 正确顺序 */
  items: string[];
  explain: string;
}

export type LevelStep = HuntStep | ToolStep | OrderStep;

export interface DeviceLevel {
  equipmentId: string;
  procedureId: string;
  procedureTitle: string;
  equipmentName: string;
  /** 本关卡取材自规程的哪一步 */
  sourceStepNo: number;
  sourceStepName: string;
  steps: LevelStep[];
}

export type Grade = 'S' | 'A' | 'B' | 'C';

/* ============================ 指标 → 测点 ============================ */

interface MetricMeta {
  key: string;
  label: string;
  unit: string;
  /** 是否纳入异常判定（false = 项目没有该指标的阈值口径，只如实显示） */
  rated: boolean;
}

const METRICS: MetricMeta[] = [
  { key: 'temperature', label: '轴承温度测点', unit: '℃', rated: true },
  { key: 'vibration', label: '轴承座振动测点', unit: 'mm/s', rated: true },
  { key: 'loadRate', label: '电机负载测点', unit: '%', rated: true },
  { key: 'current', label: '主回路电流测点', unit: 'A', rated: false },
  { key: 'voltage', label: '进线电压测点', unit: 'V', rated: false },
  { key: 'pressure', label: '出口压力测点', unit: 'MPa', rated: false },
];

const SEVERITY_ORDER: Record<string, number> = { normal: 0, unrated: 0, nodata: -1, warning: 1, fault: 2, critical: 3 };

function readMetric(telemetry: Record<string, unknown> | null | undefined, key: string): number | null {
  const raw = telemetry ? telemetry[key] : undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw;
}

/** 把单个指标包成 `TelemetryLike` 再交给既有阈值函数 —— 只带该指标，取回它自身的严重度。 */
function probeMetric(metric: string, value: number): TelemetryLike {
  if (metric === 'temperature') return { temperature: value };
  if (metric === 'vibration') return { vibration: value };
  if (metric === 'loadRate') return { loadRate: value };
  return {};
}

function formatReading(value: number, unit: string): string {
  const digits = unit === 'mm/s' ? 1 : unit === 'MPa' ? 2 : Math.abs(value) >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

/**
 * 由真实遥测构造"可点击的测点"。
 * 每个测点要么带真实读数，要么是 `nodata`（UI 显示"未接入"），不存在第三种。
 */
export function buildHuntSpots(equipment: Pick<Equipment, 'telemetry'>): HuntSpot[] {
  const telemetry = (equipment?.telemetry ?? null) as unknown as Record<string, unknown> | null;
  return METRICS.map((m) => {
    const value = readMetric(telemetry, m.key);
    if (value === null) {
      return { key: m.key, label: m.label, metric: m.key, reading: null, severity: 'nodata' as SpotSeverity, abnormal: false };
    }
    // 复用项目既有阈值：逐指标单独送进去，取回该指标自身的严重度
    const severity: SpotSeverity = m.rated
      ? ((telemetryToStatus(probeMetric(m.key, value)) as SpotSeverity | null) ?? 'normal')
      : 'unrated';
    return {
      key: m.key,
      label: m.label,
      metric: m.key,
      reading: formatReading(value, m.unit),
      severity,
      abnormal: m.rated && SEVERITY_ORDER[severity] > 0,
    };
  });
}

/** 找出最严重的测点；全正常返回 null。 */
export function worstSpot(spots: HuntSpot[]): HuntSpot | null {
  let worst: HuntSpot | null = null;
  for (const s of spots) {
    if (!s.abnormal) continue;
    if (!worst || SEVERITY_ORDER[s.severity] > SEVERITY_ORDER[worst.severity]) worst = s;
  }
  return worst;
}

/** 规程步骤文本里提到哪个指标 —— 用于"无超限时"决定该重点看哪里。 */
function metricMentionedIn(text: string): string | null {
  if (/温度|轴温|测温|发热|温升/.test(text)) return 'temperature';
  if (/振动|测振|摆度|窜动/.test(text)) return 'vibration';
  if (/负载|负荷|电流/.test(text)) return 'loadRate';
  if (/压力|压差|出口压/.test(text)) return 'pressure';
  return null;
}

/* ============================ 关卡构建 ============================ */

/**
 * 从真实设备 + 真实规程构建一个关卡。
 *
 * @param equipment   台账设备（提供真实遥测）
 * @param procedure   命中的标准化检修规程
 * @param allProcs    全部规程（用于取真实工具池做干扰项）
 */
export function buildDeviceLevel(
  equipment: Equipment,
  procedure: MaintenanceProcedure,
  allProcs: MaintenanceProcedure[]
): DeviceLevel {
  const sourceStep: ProcedureStep | undefined = procedure.steps[0];
  const stepText = `${sourceStep?.name ?? ''} ${sourceStep?.content ?? ''}`;

  /* ---- 第一步：找异常部位 ---- */
  const spots = buildHuntSpots(equipment);
  const worst = worstSpot(spots);
  let correctKey: string;
  let prompt: string;
  let explain: string;

  if (worst) {
    correctKey = worst.key;
    prompt = '观察设备，点击读数异常的部位';
    explain = `${worst.label}实测 ${worst.reading}，已越过${severityLabel(worst.severity)}阈值 —— 这就是本次要处理的异常点。`;
  } else {
    // 没有超限读数时绝不编造故障：改问"本步骤该重点检查哪里"，答案取自真实规程文本
    const mentioned = metricMentionedIn(stepText);
    const fallback = spots.find((s) => s.key === mentioned && s.reading !== null) ?? spots.find((s) => s.reading !== null) ?? spots[0];
    correctKey = fallback.key;
    const anyData = spots.some((s) => s.reading !== null);
    prompt = anyData ? '本设备遥测无超限读数，点击本步骤需要重点检查的部位' : '本设备遥测未接入，点击本步骤需要重点检查的部位';
    explain = anyData
      ? `各测点读数均在阈值内；按规程「${sourceStep?.name ?? ''}」的要求，本步重点检查${fallback.label}。`
      : `遥测未接入，无法判定异常；按规程「${sourceStep?.name ?? ''}」的要求，本步重点检查${fallback.label}。`;
  }

  const hunt: HuntStep = {
    kind: 'hunt',
    title: '第一步 · 观察设备找异常',
    prompt,
    spots,
    correctKey,
    explain,
  };

  /* ---- 第二步：选工具 ---- */
  const tools = parseTools(sourceStep?.tools);
  const toolPool = Array.from(new Set(allProcs.flatMap((p) => p.steps.flatMap((st) => parseTools(st.tools)))));
  const correctTool = tools[0] ?? toolPool[0] ?? '通用检修工具包';
  const distractors = toolPool
    .filter((t) => t !== correctTool && !correctTool.includes(t) && !t.includes(correctTool))
    .slice(0, 3);
  const options = [correctTool, ...distractors].sort(() => Math.random() - 0.5);
  const tool: ToolStep = {
    kind: 'tool',
    title: '第二步 · 选对检修工具',
    prompt: `规程「${sourceStep?.name ?? ''}」应使用哪件工具？`,
    options,
    correct: correctTool,
    explain: `规程该步的工具清单为：${tools.length ? tools.join('、') : correctTool}。`,
  };

  /* ---- 第三步：按顺序操作 ---- */
  const actions = splitContentActions(sourceStep?.content ?? '');
  const orderItems = actions.length >= 3 ? actions.slice(0, 4) : procedure.steps.slice(0, 4).map((s) => s.name).filter(Boolean);
  const order: OrderStep = {
    kind: 'order',
    title: '第三步 · 按正确顺序操作',
    prompt: actions.length >= 3 ? '按正确顺序依次点击本步的作业动作' : '按正确顺序依次点击本次检修的作业步骤',
    items: orderItems,
    explain: `正确顺序：${orderItems.join(' → ')}`,
  };

  return {
    equipmentId: equipment.id,
    procedureId: procedure.id,
    procedureTitle: procedure.title,
    equipmentName: equipment.name,
    sourceStepNo: sourceStep?.step_no ?? 1,
    sourceStepName: sourceStep?.name ?? procedure.title,
    steps: [hunt, tool, order].filter((s) => (s.kind === 'order' ? s.items.length >= 3 : true)),
  };
}

function severityLabel(s: SpotSeverity): string {
  if (s === 'critical') return '紧急';
  if (s === 'fault') return '故障';
  if (s === 'warning') return '预警';
  return '正常';
}

/* ============================ 计时与计分 ============================ */

/** 每步限时（秒）。第一步要找位置、第三步要排序，给的预算不同。 */
export const STEP_SECONDS: Record<LevelStep['kind'], number> = {
  hunt: 30,
  tool: 22,
  order: 40,
};

export const MAX_LIVES = 3;

export interface StepOutcome {
  /** 是否一次答对（用于正确率） */
  firstTry: boolean;
  /** 剩余秒数 */
  secondsLeft: number;
}

/**
 * 单步得分：基础分 + 速度加成。
 * 速度加成按"剩余时间占比"给，避免不同步的限时长短直接比较。
 */
export function scoreStep(outcome: StepOutcome, kind: LevelStep['kind']): number {
  if (!outcome.firstTry) return 0;
  const base = 100;
  const ratio = Math.max(0, Math.min(1, outcome.secondsLeft / STEP_SECONDS[kind]));
  return base + Math.round(ratio * 50);
}

export interface GradeInput {
  /** 总失误次数（含超时） */
  mistakes: number;
  /** 一次通过的小步数 / 总小步数 */
  firstTryRate: number;
}

/**
 * 评级：先看有没有失误，再看正确率。
 * 之所以不用"分数阈值"：分数会被限时长短影响，跨关卡不可比。
 */
export function gradeFor({ mistakes, firstTryRate }: GradeInput): Grade {
  if (mistakes === 0 && firstTryRate >= 1) return 'S';
  if (mistakes <= 1 && firstTryRate >= 0.66) return 'A';
  if (mistakes <= 3) return 'B';
  return 'C';
}

export const GRADE_COLOR: Record<Grade, string> = {
  S: '#ffd54a',
  A: '#5cffa3',
  B: '#22d3ee',
  C: '#94a3b8',
};

/** 评级文案，用于结算画面 */
export const GRADE_TEXT: Record<Grade, string> = {
  S: '完美检修 · 零失误',
  A: '优秀 · 基本一次到位',
  B: '合格 · 仍有改进空间',
  C: '需返工 · 建议重看规程',
};
