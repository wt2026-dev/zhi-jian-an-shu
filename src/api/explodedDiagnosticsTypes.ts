/**
 * 拆解视图：零件寿命 / 备件库存 / 检修报告契约。
 *
 * 2026-10-20 从 api/index.ts 纯移动（第 1 刀）。仅类型、无运行时代码。
 */

export interface ExplodedPartLifeEntry {
  posNo: string;
  name: string;
  category?: string;
  /** 预期使用寿命（运行小时）；无口径 = null */
  expectedLifeHours: number | null;
  /** 已使用运行小时（自基线折算）；基线缺失 = null */
  usedHours: number | null;
  /** 剩余寿命（运行小时，可为负 = 超期） */
  remainingHours: number | null;
  /** 剩余寿命百分比（0-100） */
  remainingPct: number | null;
  /** 健康状态：正常 / 临近寿命 / 需更换 / 暂无口径 */
  status: 'healthy' | 'nearing' | 'replace' | 'unknown';
  /** 阈值依据：真实换次间隔均值 > 配置阈值 > 缺失 */
  basis: 'real-replacement-intervals' | 'config-threshold' | 'missing';
  /** 配置阈值出处（规则名）；真实换次口径时为规则 label 供参考 */
  lifeRuleLabel: string | null;
  /** 最近一次真实更换时间；从未更换 = null */
  lastReplacedAt: string | null;
  /** 已用期起算基线（上次更换/设备投运） */
  usedSince: string | null;
  /** 推算的"剩余寿命用尽"日期 */
  dueAt: string | null;
}

export interface ExplodedPartLifeDiagnostics {
  deviceId: string;
  deviceName: string;
  deviceCode: string;
  explodedViewFile: string | null;
  generatedAt: string;
  runtimeFactor: number;
  warnFraction: number;
  parts: ExplodedPartLifeEntry[];
  summary: {
    replaceCount: number;
    nearingCount: number;
    healthyCount: number;
    unknownCount: number;
  };
  /** 建议在该日期前安排保养；无到期推算 = null */
  suggestedMaintenanceBefore: string | null;
  dataNote: string;
}

export interface ExplodedPartInventoryMatch {
  id: string;
  name: string;
  spec: string;
  model: string;
  unit: string;
  /** 当前库存（spare_parts.stock 真实台账值） */
  stock: number;
  /** 库存预警阈值（spare_parts.safe_stock；≤ 该值即需采购，与备件页同口径） */
  safeStock: number;
  /** 缺口（预警阈值 − 当前库存，下限 0） */
  shortage: number;
  /** 低库存（当前库存 ≤ 预警阈值） */
  low: boolean;
  /** 存放位置（仓库/货架，真实台账） */
  location: string;
  price: number;
  /** 采购前置期（天；库内无前置期字段，按分类配置给出，如实标注） */
  purchaseLeadDays: number;
  purchaseLeadLabel: string;
}

export interface CatalogPartInventory {
  posNo: string;
  name: string;
  category?: string;
  /** 命中的真实备件台账；无命中 = null（如实展示"无备件记录"） */
  inventory: ExplodedPartInventoryMatch | null;
}

export interface ExplodedPartInventoryDiagnostics {
  deviceId: string;
  deviceName: string;
  deviceCode: string;
  explodedViewFile: string | null;
  generatedAt: string;
  parts: CatalogPartInventory[];
  summary: {
    lowCount: number;
    matchedCount: number;
    totalParts: number;
    totalShortage: number;
  };
  dataNote: string;
}

/** 一键生成采购申请的预填载荷（跳备件库存页的采购入库流程） */
export interface SpareProcurePrefill {
  /** 真实备件台账 id（spare_parts 主键） */
  partId: string;
  partName: string;
  unit: string;
  /** 建议采购量（缺口值） */
  qty: number;
  /** 申请事由（含来源拆解位号与设备，真实上下文） */
  note: string;
}

/* ------------------------------------------------------------------ */
/* 检修报告导出（拆解视图 F7）：聚合数据端点                              */
/* ------------------------------------------------------------------ */
export interface MaintenanceReportBomRow {
  posNo: string;
  name: string;
  category: string | null;
  spec: string | null;
  material: string | null;
  /** 单个位号代表零件的实体数量（拆解页 PARTS 原值；缺失 = null，报告显示"—"） */
  qty: number | null;
  weight: number | null;
  desc: string | null;
  flags: { fault: boolean; lifeNearing: boolean; lifeReplace: boolean; lowStock: boolean };
  faultDetail: string | null;
  lifeStatus: 'healthy' | 'nearing' | 'replace' | 'unknown' | null;
  lifeRemainingPct: number | null;
  inventory: {
    stock: number;
    safeStock: number;
    shortage: number;
    location: string;
    unit: string;
  } | null;
}

export interface MaintenanceReportHistoryEntry {
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
    specs: Array<{ label: string; value: string }>;
  };
  /** BOM 行（拆解页 PARTS 全量原样解析；页面缺失 = 回退服务端目录并注明） */
  bom: MaintenanceReportBomRow[];
  bomSource: 'page-parts' | 'server-catalog' | 'none';
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
  history: MaintenanceReportHistoryEntry[];
  recommendations: {
    mustReplaceNow: Array<{ posNo: string; name: string; reason: string }>;
    scheduleSoon: Array<{ posNo: string; name: string; reason: string }>;
    stockShortages: Array<{ posNo: string; name: string; shortage: number; location: string }>;
  };
  dataNote: string;
}
