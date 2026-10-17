/**
 * 拆解视图 ↔ 检修业务联动服务：
 *   · getWorkOrderExplodedContext(workOrderId) —— 工单 → 设备 + 目标位号（高亮用）
 *   · getPartMaintenanceHistory(deviceId, partId) —— 位号 → 真实维修历史聚合
 *
 * 所有数据都来自真实 DB 表（work_orders / spare_parts / spare_parts_movements）与
 * 拆解页原文提取的真实 BOM 目录；任何地方都不补假数据。
 */
import { WorkOrderRepository } from "../../db/repositories/workOrderRepository.ts";
import {
  PartHistoryRepository,
  type RelatedWorkOrderRow,
} from "../../db/repositories/partHistoryRepository.ts";
import {
  getCatalogForDevice,
  expandAliases,
  type PartMatch,
} from "./partMatchService.ts";
import { EXPLODED_VIEW_FILES } from "../../components/equipment3d/explodedViewFiles.ts";
import { logger } from "../../utils/logger.ts";
import type { WorkOrder } from "../../types";

/* ------------------------------------------------------------------ */
/* 接口 A：工单 → 拆解视图跳转上下文                                    */
/* ------------------------------------------------------------------ */

/** 底座/螺栓类通用装配件的名字特征：命中时降分，避免"更换某精密件"误锁到通用结构件。 */
const ACCESSORY_HINTS = ['底座', '底盘', '螺栓', '螺母', '垫圈', '垫片', '铭牌', '视镜'];

function isAccessoryPart(name: string): boolean {
  return ACCESSORY_HINTS.some((h) => name.includes(h));
}

/** 台账 WorkOrder → 匹配所需最小对象（repair_log 已由仓库解析为对象）。 */
function toMatchInput(order: WorkOrder) {
  const log = order.repairLog ?? null;
  return {
    id: order.id,
    orderNo: order.orderNo,
    title: order.title,
    description: order.description ?? '',
    faultType: order.faultType ?? '',
    status: order.status,
    usedParts: Array.isArray(log?.partsUsed) ? log.partsUsed : [],
  };
}

export interface WorkOrderExplodedContext {
  workOrder: {
    id: string;
    orderNo: string;
    title: string;
    description: string;
    faultType: string;
    priority: string;
    status: string;
    createdAt: string | null;
    equipmentId: string;
    equipmentName: string;
    equipmentCode: string;
    workshop: string;
    partsUsed: Array<{ name: string; code?: string; qty?: number; spec?: string }>;
  };
  /** 该设备拆解页文件名（无拆解页为 null，前端按 hasExplodedView 判断降级） */
  explodedViewFile: string | null;
  /**
   * 工单真实检修步骤（repair_log.resolutionSteps 原文切分，逐行匹配真实 BOM 位号）。
   * 工单没有填步骤时为空数组 —— 前端如实显示"未填写"，绝不退回硬编码的假步骤。
   */
  steps: Array<{
    index: number;
    text: string;
    matchedPart: { posNo: string; name: string } | null;
    matchedBy: string[];
  }>;
  /** 真实 BOM 中命中的目标位号；无命中为 null（前端如实提示，不强行高亮） */
  targetPart: {
    posNo: string;
    name: string;
    category?: string;
    spec?: string;
    matchedBy: string[];
    matchSource: 'parts_used' | 'description';
  } | null;
  /** 弱命中备选位号（做"备选零件"提示，最多 3 个） */
  candidateParts: Array<{ posNo: string; name: string; matchedBy: string[] }>;
  dataNote: string;
}

export async function getWorkOrderExplodedContext(workOrderId: string): Promise<WorkOrderExplodedContext | null> {
  const order = await WorkOrderRepository.getById(workOrderId);
  if (!order) return null;

  const input = toMatchInput(order);
  const deviceId = order.equipmentId;
  const explodedFile = EXPLODED_VIEW_FILES[deviceId] ?? null;

  let targetPart: WorkOrderExplodedContext['targetPart'] = null;
  let candidateParts: WorkOrderExplodedContext['candidateParts'] = [];
  let matchSource: 'parts_used' | 'description' = 'description';

  // 1) 优先证据：完工上报里技师真实填写的耗用备件名称/型号
  let best: PartMatch | null = null;
  if (input.usedParts.length > 0 && hasCatalog(deviceId)) {
    matchSource = 'parts_used';
    best = rankCatalog(deviceId, [order.title, order.description], input.usedParts, [], { weightPartsUsed: 1 })[0] ?? null;
  }
  // 2) 无完工上报（工单还在进行中）时，退到工单标题/描述/故障类型文本匹配
  if (!best && hasCatalog(deviceId)) {
    matchSource = 'description';
    best = rankCatalog(deviceId, [order.title, order.description, order.faultType ?? ''], [], [], {})[0] ?? null;
  }

  if (best && best.score > 0) {
    targetPart = {
      posNo: best.posNo,
      name: best.name,
      category: best.category,
      spec: best.spec,
      matchedBy: best.matchedBy,
      matchSource,
    };
    candidateParts = rankCatalog(deviceId, [order.title, order.description], input.usedParts, [best.posNo], {})
      .slice(0, 3)
      .map((p) => ({ posNo: p.posNo, name: p.name, matchedBy: p.matchedBy }));
  }

  const log = order.repairLog;
  const realSteps = parseOrderSteps(typeof log?.resolutionSteps === 'string' ? log.resolutionSteps : null);
  return {
    steps: realSteps && deviceId && hasCatalog(deviceId)
      ? matchStepsToParts(deviceId, realSteps)
      : (realSteps ?? []).map((text, i) => ({ index: i + 1, text, matchedPart: null, matchedBy: [] })),
    workOrder: {
      id: order.id,
      orderNo: order.orderNo,
      title: order.title,
      description: order.description ?? '',
      faultType: order.faultType ?? '',
      priority: order.priority,
      status: order.status,
      createdAt: order.createdAt ?? null,
      equipmentId: deviceId,
      equipmentName: order.equipmentName,
      equipmentCode: order.equipmentCode,
      workshop: order.workshop,
      partsUsed: Array.isArray(log?.partsUsed)
        ? log.partsUsed.map((u) => ({
          name: u.name,
          code: u.code ?? undefined,
          qty: typeof u.qty === 'number' ? u.qty : undefined,
          spec: u.spec ?? undefined,
        }))
        : [],
    },
    explodedViewFile: explodedFile,
    targetPart,
    candidateParts,
    dataNote:
      '目标位号由工单真实文本（标题/描述/完工上报耗用备件）与拆解页真实 BOM 名称文本匹配得出'
      + '，并非人工绑定的强关联；未命中时不强行高亮，前端如实展示"未识别到具体零件"。'
      + '检修步骤列表来自工单实填的 resolutionSteps（若为空面板会如实显示未填写），'
      + '每步的目标零件同样按步骤原文在真实 BOM 中文本匹配得出。',
  };
}

function hasCatalog(deviceId: string): boolean {
  return getCatalogForDevice(deviceId).length > 0;
}

/**
 * 把工单里的真实步骤文本（repair_log.resolutionSteps）切成有序步骤：
 * 按换行/分号/顿号序号切分（与 RepairStepCard 同口径），去掉"1. / (2) / 三、"等前缀。
 * 返回 null 表示工单根本没填步骤（前端据此如实展示，不造假）。
 */
function parseOrderSteps(resolutionSteps: string | undefined | null): string[] | null {
  if (!resolutionSteps || typeof resolutionSteps !== 'string' || !resolutionSteps.trim()) return null;
  const lines = resolutionSteps
    .split(/[\n\r;；]+/)
    .map((s) => s.trim().replace(/^(?:\d+[.、\s]*|[（(]?[一二三四五六七八九十]{1,3}[）)].{0,3})\s*/, ''))
    .filter((s) => s.length >= 2);
  return lines;
}

/** 服务端步骤 → BOM 位号匹配：每步用其真实文本在真实 BOM 目录里打分，取最高分命中。 */
function matchStepsToParts(deviceId: string, steps: string[]): Array<{ index: number; text: string; matchedPart: { posNo: string; name: string } | null; matchedBy: string[] }> {
  return steps.map((text, i) => {
    const ranked = rankCatalog(deviceId, [text], [], [], {});
    const best = ranked[0] ?? null;
    return {
      index: i + 1,
      text,
      matchedPart: best && best.score > 0 ? { posNo: best.posNo, name: best.name } : null,
      matchedBy: best?.matchedBy ?? [],
    };
  });
}

interface CatalogRankOptions {
  /** parts_used 是不是最强证据源（乘 +30 分 vs 描述最长词命中） */
  weightPartsUsed?: number;
}

/**
 * BOM 目录打分排序。打分透明：
 *   · 别名展开后的词条在工单文本命中 → 词长 × 权重（泛词减半）
 *   · 备件规格号（如 SKF 22324）出现 → +8
 *   · parts_used 名称/型号命中 → +30（真实完工上报是最强证据）
 *   · 通用结构件（底座/螺栓…）降分 0.5，防误锁
 */
function rankCatalog(
  deviceId: string,
  texts: string[],
  partsUsed: Array<{ name?: string; code?: string; spec?: string }>,
  excludePosNos: string[],
  opts: CatalogRankOptions = { weightPartsUsed: 1 }
): PartMatch[] {
  const catalog = getCatalogForDevice(deviceId);
  if (!catalog.length) return [];

  const results: PartMatch[] = [];
  for (const part of catalog) {
    let score = 0;
    const matchedBy: string[] = [];

    // ---- a) 工单文本（title/description/faultType）别名命中 ----
    for (const text of texts) {
      if (!text) continue;
      const norm = text.toLowerCase().replace(/\s+/g, '');
      if (!norm) continue;
      for (const alias of expandAliases(part.name)) {
        const an = alias.toLowerCase().replace(/\s+/g, '');
        if (!an) continue;
        if (!norm.includes(an)) continue;
        const generic = ['密封', '轴承', '轴', '泵体'].includes(alias);
        score += Math.min(an.length, 6) * (generic ? 0.5 : 1);
        if (!matchedBy.includes(alias)) matchedBy.push(alias);
      }
      // 规格号匹配（型号字符串出现在文本里）
      const spec = (part.spec ?? '').toLowerCase().trim();
      if (spec.length >= 3 && norm.includes(spec.replace(/\s+/g, ''))) {
        score += 8;
        if (!matchedBy.includes(`规格:${part.spec}`)) matchedBy.push(`规格:${part.spec}`);
      }
    }

    // ---- b) parts_used 真实备件名/型号命中 ----
    for (const used of partsUsed) {
      const usedTokens = [
        ...(used.name ? expandAliases(used.name) : []),
        ...(used.code ? [used.code.toLowerCase().replace(/\s+/g, '')] : []),
      ];
      const partTexts = [
        ...expandAliases(part.name).map((a) => a.toLowerCase().replace(/\s+/g, '')),
        (part.spec ?? '').toLowerCase().replace(/\s+/g, ''),
        (part.material ?? '').toLowerCase().replace(/\s+/g, ''),
      ];
      for (const token of usedTokens) {
        const tn = token.toLowerCase().replace(/\s+/g, '');
        if (!tn) continue;
        if (partTexts.some((p) => p && p.includes(tn))) {
          score += 30 * (opts.weightPartsUsed ?? 1);
          const evidence = used.name || used.code || '';
          if (evidence && !matchedBy.includes(evidence)) matchedBy.push(evidence);
        }
      }
    }

    // ---- c) 通用结构件降权 ----
    if (isAccessoryPart(part.name)) score *= 0.5;
    if (excludePosNos.includes(part.posNo)) score = 0;

    if (score > 0) {
      results.push({
        posNo: part.posNo,
        name: part.name,
        category: part.category,
        spec: part.spec,
        score,
        matchedBy,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* 接口 B：位号 → 零件维修历史（真实数据聚合）                          */
/* ------------------------------------------------------------------ */

export interface PartHistoryReplacement {
  workOrderId: string;
  orderNo: string;
  title: string;
  status: string;
  /** 真实完工时间；非完工单为 null（不虚构更换时间） */
  replacedAt: string | null;
  matchedPartName: string;
  qty: number | null;
  causeAnalysis: string;
  resolutionSteps: string;
  workHours: number | null;
}

export interface PartMaintenanceHistory {
  deviceId: string;
  part: { posNo: string; name: string; category?: string; spec?: string };
  /** 命中的真实备件目录（spare_parts 行），无命中为 null */
  matchedSparePart: {
    id: string;
    name: string;
    spec: string;
    model: string;
    stock: number;
    safeStock: number;
    unit: string;
    location: string;
    price: number;
  } | null;
  stats: {
    /** 真实完工更换次数（只统计 status=completed 且耗用备件命中该位号名的工单） */
    replacementCount: number;
    /** 上次更换时间（真实完工时间），无记录为 null */
    lastReplacedAt: string | null;
    /** 历次更换的平均间隔天数；只有 ≥2 次真实更换才有统计意义，否则 null */
    avgLifeDays: number | null;
    /** 平均维修工时（真实完工上报 workHours 均值） */
    avgWorkHours: number | null;
    /** 关联（文本/备件命中）到的真实工单总数 */
    relatedOrderCount: number;
  };
  replacements: PartHistoryReplacement[];
  relatedWorkOrders: Array<{
    id: string;
    orderNo: string;
    title: string;
    status: string;
    faultType: string;
    priority: string;
    equipmentName: string;
    equipmentCode: string;
    workshop: string;
    description: string;
    acceptedAt: string | null;
    completedAt: string | null;
    createdAt: string | null;
    matchTypes: string[];
  }>;
  spareMovements: Array<{
    id: string;
    partId: string;
    partName: string;
    partCode: string;
    type: 'in' | 'out';
    quantity: number;
    relatedWorkOrderNo: string | null;
    notes: string;
    createdAt: string | null;
  }>;
  dataNote: string;
}

function safeDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function getPartMaintenanceHistory(deviceId: string, partPosNo: string): Promise<PartMaintenanceHistory | null> {
  const catalog = getCatalogForDevice(deviceId);
  const part = catalog.find((p) => p.posNo === partPosNo) ?? null;
  // 位号必须能在真实 BOM 中找到 —— 找不到就拒绝应答（杜绝"位号错误却返回历史"）
  if (!part) return null;

  const tokens = [
    part.name,
    ...expandAliases(part.name),
    ...(part.spec ? [part.spec] : []),
  ];

  // ---- 1) 真实工单：title/description/repair_log 命中该零件别名与规格 ----
  const orders = await PartHistoryRepository.getRelatedWorkOrders({ equipmentId: deviceId, tokens })
    .catch((err: unknown) => {
      logger.warn('[part-history] 查询真实工单失败:', err);
      return [] as RelatedWorkOrderRow[];
    });

  // ---- 2) 真实备件库存（spare_parts 的真实台账，供维修领料参考） ----
  const spareRaw = await PartHistoryRepository.lookupSparePart(tokens).catch(() => null);
  const matchedSparePart = spareRaw
    ? {
      id: spareRaw.id,
      name: spareRaw.name,
      spec: spareRaw.spec,
      model: spareRaw.model,
      stock: spareRaw.stock,
      safeStock: spareRaw.safeStock,
      unit: spareRaw.unit,
      location: spareRaw.location,
      price: spareRaw.price,
    }
    : null;

  // ---- 3) 真实出入库流水（spare_parts_movements 关联的 take/receipt 事件） ----
  const spareMovements = await PartHistoryRepository.getSpareMovements(tokens).catch(() => []);

  // ---- 4) 更换记录：只统计真实完工单 + 修复记录里真实提及本零件 ----
  const replacements: PartHistoryReplacement[] = [];
  for (const order of orders) {
    if (order.status !== 'completed') continue; // 未完工的工单不能计作"已更换"
    const used = order.usedParts ?? [];
    const hit = used.find((u) => {
      const tok = [u.name, u.code].filter(Boolean).map((x) => x.toLowerCase().replace(/\s+/g, ''));
      const targets = [part.name, ...expandAliases(part.name), part.spec ?? '']
        .map((t) => t.toLowerCase().replace(/\s+/g, ''))
        .filter((t) => t.length >= 2);
      return tok.some((t) => targets.some((tgt) => t.includes(tgt) || tgt.includes(t)));
    });
    if (!hit) continue;
    replacements.push({
      workOrderId: order.id,
      orderNo: order.orderNo,
      title: order.title,
      status: order.status,
      replacedAt: order.completedAt,
      matchedPartName: hit.name,
      qty: hit.qty ?? null,
      causeAnalysis: order.causeAnalysis,
      resolutionSteps: order.resolutionSteps,
      workHours: order.workHours,
    });
  }

  const completedDates = replacements
    .map((r) => safeDate(r.replacedAt))
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());
  const lastReplacedAt = completedDates.length
    ? completedDates[completedDates.length - 1].toISOString()
    : null;

  let avgLifeDays: number | null = null;
  if (completedDates.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < completedDates.length; i++) {
      gaps.push((completedDates[i].getTime() - completedDates[i - 1].getTime()) / 86_400_000);
    }
    avgLifeDays = Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10;
  }

  const hours = replacements
    .map((r) => r.workHours)
    .filter((h): h is number => typeof h === 'number' && h > 0);
  const avgWorkHours = hours.length
    ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
    : null;

  const relatedWorkOrders = orders
    .map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      title: o.title,
      status: o.status,
      faultType: o.faultType,
      priority: o.priority,
      equipmentName: o.equipmentName,
      equipmentCode: o.equipmentCode,
      workshop: o.workshop,
      description: o.description,
      acceptedAt: o.acceptedAt,
      completedAt: o.completedAt,
      createdAt: safeDate(o.createdAt)?.toISOString() ?? null,
      matchTypes: o.matchedBy,
    }))
    .sort((a, b) => (safeDate(b.createdAt)?.getTime() ?? 0) - (safeDate(a.createdAt)?.getTime() ?? 0));

  return {
    deviceId,
    part: { posNo: part.posNo, name: part.name, category: part.category, spec: part.spec },
    matchedSparePart,
    stats: {
      replacementCount: replacements.length,
      lastReplacedAt,
      avgLifeDays,
      avgWorkHours,
      relatedOrderCount: orders.length,
    },
    replacements,
    relatedWorkOrders,
    spareMovements,
    dataNote:
      '零件维修历史只统计真实数据库记录：更换事件=完工单里的真实 parts_used 命中，'
      + '故障相关工单=标题/描述/规格号真实命中；平均更换间隔只在 ≥2 次真实更换后才有数值。'
      + '数据库目前没有以拆解位号为主键的零件级台账（缺失字段见 api 文档），不编造。',
  };
}
