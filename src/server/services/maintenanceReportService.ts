/**
 * 拆解视图 · 检修报告导出服务（F7）。
 *
 * ## 数据来源（全部真实，不编造）
 *   · 设备基本信息：equipments 台账（model/specs/status/health_score/workshop/...）
 *   · BOM 零件清单：拆解页源码里页面自带的 PARTS 数据数组（位号/名称/规格/材质/
 *     数量/重量 —— 与拆解页 3D tooltip 完全同源），服务端从 public/exploded/*.html
 *     中原样解析，不重排不补默认值；
 *   · 故障标注：equipment_telemetry 遥测读数 × 报警阈值（equipmentFaultLocatorService）；
 *   · 寿命标注：真实更换记录 × 真实运行时钟（partLifeService）；
 *   · 库存标注：spare_parts 真实台账（partInventoryService）；
 *   · 维修历史：已完工单 repair_log（getCompletedOrdersSummary，含根本原因/作业
 *     步骤/更换备件）；
 *   · 维修建议：由上述真实标注推导（到期零件 / 临近寿命 / 库存缺口），无则如实写"无"。
 * 3D 截图由客户端从已打开的拆解 iframe 取真实画面（页面暴露 __EXPL_CAPTURE），
 * 服务端不截图、不下载任何图。
 */
import * as fs from 'fs';
import * as path from 'path';
import { EquipmentRepository } from '../../db/repositories/index.ts';
import { PartHistoryRepository } from '../../db/repositories/partHistoryRepository.ts';
import { EXPLODED_VIEW_FILES } from '../../components/equipment3d/explodedViewFiles.ts';
import { getCatalogForDevice } from './partMatchService.ts';
import { getDeviceFaultDiagnostics } from './equipmentFaultLocatorService.ts';
import { getDevicePartLifeDiagnostics } from './partLifeService.ts';
import { getDevicePartInventory } from './partInventoryService.ts';

export interface ReportBomRow {
  posNo: string;
  name: string;
  category: string | null;
  spec: string | null;
  material: string | null;
  /** 单个位号代表零件的实体数量（拆解页 PARTS 原值；缺失 = null） */
  qty: number | null;
  weight: number | null;
  desc: string | null;
  /** 真实标注：遥测故障观察部位 / 临近或需更换寿命 / 台账低库存 */
  flags: { fault: boolean; lifeNearing: boolean; lifeReplace: boolean; lowStock: boolean };
  /** 故障详情一句话（遥测读数 vs 阈值）；无故障 = null */
  faultDetail: string | null;
  /** 寿命状态（life service 真实判定）；无口径 = null */
  lifeStatus: 'healthy' | 'nearing' | 'replace' | 'unknown' | null;
  /** 剩余寿命百分比；无口径 = null */
  lifeRemainingPct: number | null;
  /** 命中的备件台账库存（下单采购参考）；无记录 = null */
  inventory: {
    stock: number;
    safeStock: number;
    shortage: number;
    location: string;
    unit: string;
  } | null;
}

export interface ReportHistoryEntry {
  orderNo: string;
  title: string;
  faultType: string | null;
  completedAt: string | null;
  causeAnalysis: string | null;
  resolutionSteps: string | null;
  usedParts: Array<{ name: string; code: string; spec: string; qty: number; unit: string }> | null;
}

export interface MaintenanceReportData {
  generatedAt: string;
  /** 拆解页文件（有拆解视图才有 PARTS BOM）；无 = null */
  explodedViewFile: string | null;
  device: {
    id: string;
    code: string;
    name: string;
    category: string;
    model: string | null;
    manufacturer: string | null;
    workshop: string | null;
    location: string | null;
    installDate: string | null;
    status: string;
    healthScore: number | null;
    criticality: string | null;
    nextInspectionDate: string | null;
    /** 台账 specs 键值对（无 = 空数组，如实披露） */
    specs: Array<{ label: string; value: string }>;
  };
  /** BOM 行（拆解页 PARTS 全量；页面缺失 = 回退服务端目录并注明） */
  bom: ReportBomRow[];
  bomSource: 'page-parts' | 'server-catalog' | 'none';
  /** 遥测故障概要（最新采样窗口遥测读数 × 阈值） */
  faults: Array<{
    metricLabel: string;
    value: number;
    unit: string;
    warningThreshold: number;
    severity: string;
    suggestion: string;
  }>;
  latestSampleAt: string | null;
  life: { replaceCount: number; nearingCount: number; suggestedMaintenanceBefore: string | null };
  inventory: { lowCount: number; matchedCount: number; totalParts: number; totalShortage: number };
  history: ReportHistoryEntry[];
  recommendations: {
    mustReplaceNow: Array<{ posNo: string; name: string; reason: string }>;
    scheduleSoon: Array<{ posNo: string; name: string; reason: string }>;
    stockShortages: Array<{ posNo: string; name: string; shortage: number; location: string }>;
  };
  dataNote: string;
}

/**
 * 从拆解页 HTML 源码中原样解析页面自带的 `PARTS = [...]` 数据数组（位号/名称/
 * 规格/材质/数量/重量/描述）。纯数据字面量取值：字符串/括号配对扫描 + Function
 * 求值，来源是我们自己打包的页面模板，不含任何用户输入。解析失败/无数组 = null。
 */
export function extractBomRowsFromHtml(html: string): Array<{
  posNo: string;
  name: string;
  category: string | null;
  spec: string | null;
  material: string | null;
  qty: number | null;
  weight: number | null;
  desc: string | null;
}> | null {
  // 各页面数据数组名不统一（PARTS / PARTS_DATA / PUMP_PARTS / MOTOR_PARTS / COMPRESSOR_PARTS…），统一按「×_PARTS」尾匹配
  const start = html.search(/\b[A-Z0-9_]*(PARTS_DATA|_PARTS|PARTS)\s*=\s*\[/);
  if (start < 0) return null;
  const open = html.indexOf('[', start);
  if (open < 0) return null;
  // 括号配对扫描：跳过 '  "  ` 字符串与行/块注释，避免字符串里的 "]" 干扰计数
  let depth = 0;
  let inString: string | null = null;
  let i = open;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue; }
    if (ch === '/' && html[i + 1] === '/') {
      while (i < html.length && html[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && html[i + 1] === '*') {
      const end = html.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || i >= html.length) return null;
  const arrayText = html.slice(open, i + 1);
  try {
    const parsed = new Function('"use strict"; return (' + arrayText + ');')() as unknown[];
    if (!Array.isArray(parsed)) return null;
    const rows: Array<{
      posNo: string; name: string; category: string | null; spec: string | null;
      material: string | null; qty: number | null; weight: number | null; desc: string | null;
    }> = [];
    // 各页字段名差异（真实页面群岛）：
    //   位号 = code（"BOM-01"/"IR005-A01"）?? string id（"P01"/"P-01"/"M-01"）；
    //   规格 = spec ?? specs ?? precision；数量/重量可为数字或字符串前缀（"1 套"/"14.2 kg"）。
    const str = (...vals: unknown[]): string | null => {
      for (const v of vals) {
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return null;
    };
    const num = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const m = v.match(/^\s*([0-9]+(?:\.[0-9]+)?)/);
        if (m) return parseFloat(m[1]);
      }
      return null;
    };
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.name !== 'string' || !r.name) continue;
      const posNo = str(r.code, r.id);
      if (!posNo) continue;
      rows.push({
        posNo,
        name: r.name,
        category: str(r.category),
        spec: str(r.spec, r.specs, r.precision),
        material: str(r.material),
        qty: num(r.qty),
        weight: num(r.weight),
        desc: str(r.desc),
      });
    }
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

/**
 * 维修建议：仅由真实标注推导，不引入任何主观发明 ——
 *   · 立即检修/更换：遥测故障观察部位、寿命"需更换"；
 *   · 近期安排保养：寿命"临近"；
 *   · 库存不足提醒：spare_parts 台账 stock ≤ safe_stock（缺口如实透出）。
 */
export function buildRecommendations(rows: ReportBomRow[]): MaintenanceReportData['recommendations'] {
  const mustReplaceNow: MaintenanceReportData['recommendations']['mustReplaceNow' ] = [];
  const scheduleSoon: MaintenanceReportData['recommendations']['scheduleSoon'] = [];
  const stockShortages: MaintenanceReportData['recommendations']['stockShortages'] = [];
  for (const row of rows) {
    if (row.flags.fault && row.faultDetail) {
      mustReplaceNow.push({ posNo: row.posNo, name: row.name, reason: `遥测故障：${row.faultDetail}（建议先维保确认，再决定是否拆换）` });
    }
    if (row.flags.lifeReplace) {
      mustReplaceNow.push({
        posNo: row.posNo,
        name: row.name,
        reason: row.lifeRemainingPct != null
          ? `寿命已到期：剩余 ${row.lifeRemainingPct.toFixed(0)}%（真实换次记录 × 运行时钟判定）`
          : '寿命已到期（真实换次记录 × 运行时钟判定）',
      });
    }
    if (row.flags.lifeNearing) {
      scheduleSoon.push({
        posNo: row.posNo,
        name: row.name,
        reason: row.lifeRemainingPct != null
          ? `临近寿命阈值：剩余 ${row.lifeRemainingPct.toFixed(0)}%，建议近期安排保养`
          : '临近寿命阈值，建议近期安排保养',
      });
    }
    if (row.flags.lowStock && row.inventory) {
      stockShortages.push({
        posNo: row.posNo,
        name: row.name,
        shortage: row.inventory.shortage,
        location: row.inventory.location,
      });
    }
  }
  return { mustReplaceNow, scheduleSoon, stockShortages };
}

/** 读拆解页源文件（dev 与生产都在仓库根/构建根的 public/exploded 下） */
function readExplodedHtml(file: string): string | null {
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) return null;
  const base = path.resolve(process.cwd(), 'public', 'exploded', file);
  try {
    if (!fs.existsSync(base)) return null;
    return fs.readFileSync(base, 'utf8');
  } catch {
    return null;
  }
}

export async function getMaintenanceReport(deviceId: string): Promise<MaintenanceReportData> {
  const eq = await EquipmentRepository.getById(deviceId);
  if (!eq) throw Object.assign(new Error('设备未找到'), { code: 'EQUIPMENT_NOT_FOUND' });

  const explodedViewFile = EXPLODED_VIEW_FILES[deviceId] ?? null;

  // ---- BOM：优先拆解页 PARTS（含数量/重量/描述），页面读不到时回退服务端目录（如实注明）----
  let bomSource: MaintenanceReportData['bomSource'] = 'none';
  const pageRows = explodedViewFile ? extractBomRowsFromHtml(readExplodedHtml(explodedViewFile) ?? '') : null;
  const catalog = getCatalogForDevice(deviceId);
  type RawRow = {
    posNo: string; name: string; category: string | null; spec: string | null;
    material: string | null; qty: number | null; weight: number | null; desc: string | null;
  };
  let rawRows: RawRow[] = [];
  if (pageRows && pageRows.length) {
    rawRows = pageRows;
    bomSource = 'page-parts';
  } else if (catalog.length) {
    rawRows = catalog.map((p) => ({
      posNo: p.posNo,
      name: p.name,
      category: p.category ?? null,
      spec: p.spec ?? null,
      material: p.material ?? null,
      qty: null,
      weight: null,
      desc: null,
    }));
    bomSource = 'server-catalog';
  }

  // ---- 真实标注三件套 + 完工单历史（并发取数）----
  const [faultDiag, lifeDiag, inventoryDiag, history] = await Promise.all([
    getDeviceFaultDiagnostics(deviceId).catch(() => null),
    getDevicePartLifeDiagnostics(deviceId).catch(() => null),
    getDevicePartInventory(deviceId).catch(() => null),
    PartHistoryRepository.getCompletedOrdersSummary(deviceId).catch(() => []),
  ] as const);

  const faultPosNos = new Set<string>();
  const faultDetailByPos = new Map<string, string>();
  if (faultDiag) {
    for (const fault of faultDiag.faults) {
      const detail = `${fault.metricLabel} 当前 ${fault.value} ${fault.unit}，阈值 ${fault.warningThreshold} ${fault.unit}（${fault.severity === 'critical' ? '严重' : fault.severity === 'fault' ? '故障' : '预警'}）`;
      for (const obs of fault.observationParts) {
        if (!faultPosNos.has(obs.posNo)) faultDetailByPos.set(obs.posNo, detail);
        faultPosNos.add(obs.posNo);
      }
    }
  }
  const lifeByPos = new Map<string, { status: 'healthy' | 'nearing' | 'replace' | 'unknown' | null; pct: number | null }>();
  if (lifeDiag) {
    for (const p of lifeDiag.parts) {
      lifeByPos.set(p.posNo, { status: p.status, pct: p.remainingPct });
    }
  }
  const invByPos = new Map<string, { stock: number; safeStock: number; shortage: number; location: string; unit: string }>();
  if (inventoryDiag) {
    for (const p of inventoryDiag.parts) {
      if (!p.inventory) continue;
      invByPos.set(p.posNo, {
        stock: p.inventory.stock,
        safeStock: p.inventory.safeStock,
        shortage: p.inventory.shortage,
        location: p.inventory.location,
        unit: p.inventory.unit,
      });
    }
  }

  const bom: ReportBomRow[] = rawRows.map((raw) => {
    const fd = faultDetailByPos.get(raw.posNo) ?? null;
    const life = lifeByPos.get(raw.posNo) ?? null;
    const inv = invByPos.get(raw.posNo) ?? null;
    // 目录匹配的备件不一定按位号：库存四要素按同一 posNo 口径来自 partInventoryService
    return {
      posNo: raw.posNo,
      name: raw.name,
      category: raw.category,
      spec: raw.spec,
      material: raw.material,
      qty: raw.qty,
      weight: raw.weight,
      desc: raw.desc,
      flags: {
        fault: fd != null,
        lifeNearing: life?.status === 'nearing',
        lifeReplace: life?.status === 'replace',
        lowStock: inv != null && inv.stock <= inv.safeStock,
      },
      faultDetail: fd,
      lifeStatus: life?.status ?? null,
      lifeRemainingPct: life?.pct ?? null,
      inventory: inv,
    } satisfies ReportBomRow;
  });

  const specs = Object.entries(eq.specs ?? {}).map(([label, value]) => ({
    label,
    value: value == null ? '' : String(value),
  }));

  const notes: string[] = [
    'BOM 位号与规格/材质取自拆解页自带数据数组（与 3D 拆解页同源原样解析）；',
    '数量与重量为拆解页出厂标注，字段缺失时如实显示"—"；',
    '故障标注来自 equipment_telemetry 遥测读数与报警阈值比对；',
    '寿命标注来自真实完工单更换记录 × 真实运行时钟（config 运行系数、阈值口径见 F5 配置）；',
    '库存标注与低库存判定线取自 spare_parts 真实台账（stock ≤ safe_stock）；',
    '维修历史取自已完工单 repair_log；3D 截图为导出时拆解页实时画面。',
  ];
  if (bomSource === 'server-catalog') {
    notes.push('当前环境读不到拆解页源文件，BOM 数量/重量暂不可得，已回退服务端目录（无该两个字段，如实留"—"）。');
  }
  if (!history.length) {
    notes.push('该设备暂无已完工的维修工单记录。');
  }

  const report: MaintenanceReportData = {
    generatedAt: new Date().toISOString(),
    explodedViewFile,
    device: {
      id: eq.id,
      code: eq.code ?? '',
      name: eq.name ?? '',
      category: eq.category ?? '',
      model: eq.model ?? null,
      manufacturer: eq.manufacturer ?? null,
      workshop: eq.workshop ?? null,
      location: eq.location ?? null,
      installDate: eq.installDate ?? null,
      status: eq.status ?? '',
      healthScore: typeof eq.healthScore === 'number' ? eq.healthScore : null,
      criticality: eq.criticality ?? null,
      nextInspectionDate: eq.nextInspectionDate ?? null,
      specs,
    },
    bom,
    bomSource,
    faults: (faultDiag?.faults ?? []).map((f) => ({
      metricLabel: f.metricLabel,
      value: f.value,
      unit: f.unit,
      warningThreshold: f.warningThreshold,
      severity: f.severity,
      suggestion: f.suggestion,
    })),
    latestSampleAt: faultDiag?.latestSampleAt ?? null,
    life: {
      replaceCount: lifeDiag?.summary.replaceCount ?? 0,
      nearingCount: lifeDiag?.summary.nearingCount ?? 0,
      suggestedMaintenanceBefore: lifeDiag?.suggestedMaintenanceBefore ?? null,
    },
    inventory: {
      lowCount: inventoryDiag?.summary.lowCount ?? 0,
      matchedCount: inventoryDiag?.summary.matchedCount ?? 0,
      totalParts: inventoryDiag?.summary.totalParts ?? 0,
      totalShortage: inventoryDiag?.summary.totalShortage ?? 0,
    },
    history: history.map((h) => ({
      orderNo: h.orderNo,
      title: h.title,
      faultType: h.faultType,
      completedAt: h.completedAt,
      causeAnalysis: h.causeAnalysis,
      resolutionSteps: h.resolutionSteps,
      usedParts: h.usedParts
        ? h.usedParts.map((u) => ({ name: u.name, code: u.code, spec: u.spec, qty: u.qty, unit: u.unit }))
        : null,
    })),
    recommendations: buildRecommendations(bom),
    dataNote: notes.join(' '),
  };

  return report;
}
