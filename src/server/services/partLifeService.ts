/**
 * 零件寿命预警服务 —— 从**真实设备运行时钟 + 真实零件更换记录**计算拆解页每个
 * BOM 位号的已用/剩余寿命，供拆解视图"零件寿命卡片 + 侧边预警汇总 + 保养建议建单"。
 *
 * ## 数据来源（全部真实，不编造）
 *   · 更换记录：work_orders 里 status='completed' 的真实完工单，repair_log.parts_used
 *     命中位号名/规格/别名（与 partHistoryService「位号维修历史」同一条更换判定口径）。
 *     ≥2 次真实更换 → 用换次间隔均值当该零件的**真实预期寿命**（这是最强证据）。
 *   · 运行时钟：零件基线（最近一次真实更换时间，其次设备 install_date 投运时间）至今
 *     的日历时钟小时。**数据库没有运行小时计**（equipments/equipment_telemetry 均无该
 *     字段），已用小时按"时钟小时 × 运行系数"如实折算，系数可调并在 dataNote 披露。
 *   · 阈值：src/server/config/partLifeConfig.ts —— 预期寿命规则/临近判定线/运行系数
 *     都可经环境变量调整；无配置命中且无更换记录的零件**如实 unknown**，不编数额。
 */
import { EquipmentRepository } from '../../db/repositories/index.ts';
import { EXPLODED_VIEW_FILES } from '../../components/equipment3d/explodedViewFiles.ts';
import { getCatalogForDevice, expandAliases, type CatalogPart } from './partMatchService.ts';
import { PartHistoryRepository } from '../../db/repositories/partHistoryRepository.ts';
import {
  getPartLifeRules,
  getPartLifeWarnFraction,
  getPartLifeRuntimeFactor,
  getPartLifeSchedulingHeadroomDays,
  type PartLifeRule,
} from '../config/partLifeConfig.ts';

export type PartLifeStatus = 'healthy' | 'nearing' | 'replace' | 'unknown';

export type PartLifeBasis = 'real-replacement-intervals' | 'config-threshold' | 'missing';

export interface PartLifeEntry {
  posNo: string;
  name: string;
  category?: string;
  /** 预期使用寿命（运行小时）；无口径 = null */
  expectedLifeHours: number | null;
  /** 已使用时长（运行小时，自基线起折算）；基线缺失 = null */
  usedHours: number | null;
  /** 剩余寿命（运行小时，可为负 = 已超期）；无口径 = null */
  remainingHours: number | null;
  /** 剩余寿命百分比（0-100，削顶在 100；超期为 0） */
  remainingPct: number | null;
  /** 健康状态：正常 / 临近寿命 / 需更换 / 暂无口径 */
  status: PartLifeStatus;
  /** 阈值依据：真实换次间隔均值 > 配置阈值 > 缺失 */
  basis: PartLifeBasis;
  /** 配置阈值出处（规则名）；真实换次口径时仍返回规则 label 供参考 */
  lifeRuleLabel: string | null;
  /** 最近一次真实更换时间（真实完工时间；从未更换 = null，已用期自设备投运起算） */
  lastReplacedAt: string | null;
  /** 已用期起算基线（上次更换/设备投运；null = 基线缺失，无法计算） */
  usedSince: string | null;
  /** 按当前运行系数推算的"剩余寿命用尽"日期（ISO 日历时间）；无口径/超期 = null */
  dueAt: string | null;
}

export interface PartLifeDiagnostics {
  deviceId: string;
  deviceName: string;
  deviceCode: string;
  /** 设备所属拆解页文件（有拆解视图才有位号可对齐） */
  explodedViewFile: string | null;
  /** 诊断生成时间（真实 now） */
  generatedAt: string;
  runtimeFactor: number;
  warnFraction: number;
  parts: PartLifeEntry[];
  summary: {
    replaceCount: number;
    nearingCount: number;
    healthyCount: number;
    unknownCount: number;
  };
  /** 建议在该日期前安排保养（最早到期零件的推算用尽日期 − 排程提前量）；无到期推算 = null */
  suggestedMaintenanceBefore: string | null;
  dataNote: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function safeDateMs(value: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 按 partHistoryService 同款口径把完工单的耗用备件归属到位号（归一化互含匹配） */
export function findReplacedInOrder(
  usedParts: Array<{ name: string; code?: string }>,
  tokens: string[]
): { name: string } | null {
  if (!Array.isArray(usedParts) || !usedParts.length) return null;
  const targets = tokens
    .map((t) => String(t ?? '').toLowerCase().replace(/\s+/g, ''))
    .filter((t) => t.length >= 2);
  if (!targets.length) return null;
  for (const u of usedParts) {
    const candidate = [u.name, u.code ?? ''].filter(Boolean).map((x) =>
      String(x).toLowerCase().replace(/\s+/g, '')
    );
    const hit = candidate.some((t) => targets.some((tgt) => t.includes(tgt) || tgt.includes(t)));
    if (hit) return { name: u.name };
  }
  return null;
}

/** 位号名/规格 → 命中的第一条寿命规则（keywords 在名称或规格里子串命中） */
export function matchLifeRule(rules: PartLifeRule[], part: { name: string; spec?: string }): PartLifeRule | null {
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if ((part.name && part.name.includes(kw)) || (part.spec && part.spec.includes(kw))) {
        return rule;
      }
    }
  }
  return null;
}

export interface PartLifeCoreInput {
  now: number;
  runtimeFactor: number;
  warnFraction: number;
  /** 设备 install_date（真实投运时间），未记录 = null */
  installedMs: number | null;
  /** 最近一次真实更换（完工时间），从未更换 = null */
  lastReplacedMs: number | null;
  /** ≥2 次真实更换间隔均值折算成小时（最强口径），否则 null */
  realAvgLifeHours: number | null;
  configLifeHours: number | null;
}

export interface PartLifeCoreResult {
  status: PartLifeStatus;
  expectedLifeHours: number | null;
  usedHours: number | null;
  remainingHours: number | null;
  remainingPct: number | null;
  usedSinceMs: number | null;
  dueAtMs: number | null;
  basis: PartLifeBasis;
}

/** 寿命计算核心（纯函数）：基线 → 已用 → 剩余 → 状态，缺数据如实 unknown */
export function computePartLife(input: PartLifeCoreInput): PartLifeCoreResult {
  const baseMs = input.lastReplacedMs ?? input.installedMs;
  const expected =
    input.realAvgLifeHours != null && input.realAvgLifeHours > 0
      ? input.realAvgLifeHours
      : input.configLifeHours != null && input.configLifeHours > 0
        ? input.configLifeHours
        : null;
  if (baseMs == null || expected == null || baseMs > input.now) {
    return {
      status: 'unknown',
      expectedLifeHours: expected,
      usedHours: null,
      remainingHours: null,
      remainingPct: null,
      usedSinceMs: null,
      dueAtMs: null,
      basis: 'missing',
    };
  }
  const usedHours = ((input.now - baseMs) / HOUR_MS) * input.runtimeFactor;
  const remainingHours = expected - usedHours;
  const remainingPct = Math.max(0, Math.min(100, Math.round((remainingHours / expected) * 100)));
  const status: PartLifeStatus =
    remainingHours <= 0 ? 'replace'
      : remainingHours / expected <= input.warnFraction ? 'nearing'
        : 'healthy';
  return {
    status,
    expectedLifeHours: expected,
    usedHours: Math.round(usedHours * 10) / 10,
    remainingHours: Math.round(remainingHours * 10) / 10,
    remainingPct,
    usedSinceMs: baseMs,
    dueAtMs: remainingHours > 0 ? input.now + (remainingHours / input.runtimeFactor) * HOUR_MS : null,
    basis: input.realAvgLifeHours != null ? 'real-replacement-intervals' : 'config-threshold',
  };
}

/** 该设备单台诊断：真实更换记录 × 真实运行时钟 → 各位号寿命状态 */
export async function getDevicePartLifeDiagnostics(deviceId: string): Promise<PartLifeDiagnostics> {
  const eq = await EquipmentRepository.getById(deviceId);
  if (!eq) throw Object.assign(new Error('设备未找到'), { code: 'EQUIPMENT_NOT_FOUND' });

  const generatedAt = new Date();
  const nowMs = generatedAt.getTime();
  const runtimeFactor = getPartLifeRuntimeFactor();
  const warnFraction = getPartLifeWarnFraction();
  const headroomDays = getPartLifeSchedulingHeadroomDays();
  const installedMs = safeDateMs(typeof eq.installDate === 'string' ? eq.installDate : null);

  const catalog = getCatalogForDevice(deviceId);
  const explodedViewFile = EXPLODED_VIEW_FILES[deviceId] ?? null;
  if (!catalog.length) {
    return emptyDiagnostics(deviceId, eq, generatedAt, explodedViewFile, runtimeFactor, warnFraction,
      '该设备没有拆解视图 BOM 目录，无位号可计算零件寿命（如实说明，不补假数据）。');
  }

  // 真实完工单一次取足，本地按位号归属（避免逐位号三次查询）
  type CompletedOrder = { id: string; orderNo: string; completedAt: string | null; usedParts: Array<{ name: string; code: string; spec: string; qty: number; unit: string; unitPrice: number }> | null };
  const orders = await PartHistoryRepository.getCompletedOrdersForEquipment(deviceId)
    .catch(() => [] as CompletedOrder[]);

  const rules = getPartLifeRules();
  const parts: PartLifeEntry[] = [];
  for (const part of catalog as CatalogPart[]) {
    const rule = matchLifeRule(rules, { name: part.name, spec: part.spec });
    // 更换判定 tokens 与 partHistoryService 一致：名称 + 别名展开 + 规格
    const tokens: string[] = part.spec ? [part.name, ...expandAliases(part.name), part.spec] : [part.name, ...expandAliases(part.name)];
    const replacedAtMsList: number[] = [];
    for (const order of orders) {
      if (!order.usedParts || !order.completedAt) continue;
      const completedMs = safeDateMs(order.completedAt);
      if (completedMs == null) continue;
      if (!findReplacedInOrder(order.usedParts, tokens)) continue;
      replacedAtMsList.push(completedMs);
    }
    replacedAtMsList.sort((a, b) => a - b);
    const lastReplacedMs = replacedAtMsList.length ? replacedAtMsList[replacedAtMsList.length - 1] : null;
    // ≥2 次真实更换 → 换次间隔均值是这台设备这个零件的实测寿命（最可信口径）
    let realAvgLifeHours: number | null = null;
    if (replacedAtMsList.length >= 2) {
      let gapSum = 0;
      for (let i = 1; i < replacedAtMsList.length; i++) gapSum += replacedAtMsList[i] - replacedAtMsList[i - 1];
      realAvgLifeHours = Math.round(((gapSum / (replacedAtMsList.length - 1)) / HOUR_MS) * 10) / 10;
    }

    const core = computePartLife({
      now: nowMs,
      runtimeFactor,
      warnFraction,
      installedMs,
      lastReplacedMs,
      realAvgLifeHours,
      configLifeHours: rule?.expectedLifeHours ?? null,
    });

    parts.push({
      posNo: part.posNo,
      name: part.name,
      category: part.category,
      expectedLifeHours: core.expectedLifeHours != null ? Math.round(core.expectedLifeHours) : null,
      usedHours: core.usedHours != null ? Math.round(core.usedHours) : null,
      remainingHours: core.remainingHours != null ? Math.round(core.remainingHours) : null,
      remainingPct: core.remainingPct,
      status: core.status,
      basis: core.basis,
      lifeRuleLabel: rule?.label ?? null,
      lastReplacedAt: lastReplacedMs != null ? new Date(lastReplacedMs).toISOString() : null,
      usedSince: core.usedSinceMs != null ? new Date(core.usedSinceMs).toISOString() : null,
      dueAt: core.dueAtMs != null ? new Date(core.dueAtMs).toISOString() : null,
    });
  }

  // 内容排序：需更换 > 临近 > 正常 > unknown；同级按剩余比例升序（最危险在前）
  const order: Record<PartLifeStatus, number> = { replace: 0, nearing: 1, healthy: 2, unknown: 3 };
  parts.sort((a, b) =>
    order[a.status] - order[b.status]
    || (a.remainingPct ?? 101) - (b.remainingPct ?? 101)
  );

  const summary = {
    replaceCount: parts.filter((p) => p.status === 'replace').length,
    nearingCount: parts.filter((p) => p.status === 'nearing').length,
    healthyCount: parts.filter((p) => p.status === 'healthy').length,
    unknownCount: parts.filter((p) => p.status === 'unknown').length,
  };
  const dueList = parts
    .filter((p) => p.status === 'replace' || p.status === 'nearing')
    .map((p) => safeDateMs(p.dueAt))
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);
  const suggestedMaintenanceBefore = dueList.length
    ? new Date(Math.max(0, dueList[0] - headroomDays * DAY_MS)).toISOString()
    : null;

  const notes: string[] = [
    `寿命口径如实说明：已用小时 = 自基线（最近真实更换时间${installedMs != null ? ' / 设备投运 install_date' : ''}）起的日历时钟小时 × 运行系数 ${runtimeFactor}（库内无运行小时计，如实折算，系数可在配置调整）。`,
    '预期寿命优先采用该零件 ≥2 次真实更换间隔的实测均值，其次为寿命阈值配置（PART_LIFE_RULES_JSON / 内置规则，可调）；',
    `临近寿命判定线 = 剩余寿命比例 ≤ ${Math.round(warnFraction * 100)}%。`,
  ];
  if (summary.unknownCount > 0) {
    notes.push(`${summary.unknownCount} 个零件无寿命口径（未配阈值且更换记录不足），如实标记 unknown，不编数额。`);
  }
  if (summary.replaceCount + summary.nearingCount > 0) {
    notes.push(`建议在 ${suggestedMaintenanceBefore ? new Date(suggestedMaintenanceBefore).toLocaleDateString('zh-CN') : '（无法推算日期）'} 前安排保养（最早到期零件的推算用尽日 − ${headroomDays} 天排程提前量）。`);
  } else {
    notes.push('当前无零件到期，暂无强制保养建议。');
  }

  return {
    deviceId,
    deviceName: eq.name ?? '',
    deviceCode: eq.code ?? '',
    explodedViewFile,
    generatedAt: generatedAt.toISOString(),
    runtimeFactor,
    warnFraction,
    parts,
    summary,
    suggestedMaintenanceBefore,
    dataNote: notes.join(' '),
  };
}

function emptyDiagnostics(
  deviceId: string,
  eq: { name?: string; code?: string },
  generatedAt: Date,
  explodedViewFile: string | null,
  runtimeFactor: number,
  warnFraction: number,
  note: string,
): PartLifeDiagnostics {
  return {
    deviceId,
    deviceName: eq.name ?? '',
    deviceCode: eq.code ?? '',
    explodedViewFile,
    generatedAt: generatedAt.toISOString(),
    runtimeFactor,
    warnFraction,
    parts: [],
    summary: { replaceCount: 0, nearingCount: 0, healthyCount: 0, unknownCount: 0 },
    suggestedMaintenanceBefore: null,
    dataNote: note,
  };
}
