/**
 * 拆解视图 ↔ 检修业务联动：工单上下文 / 零件历史 / 故障诊断契约。
 *
 * 2026-10-20 从 api/index.ts 纯移动（第 1 刀）。仅类型、无运行时代码；
 * 因机械切出的单文件会跨过 >300 行棘轮门槛，按契约语义再分为本文件与
 * `explodedDiagnosticsTypes.ts` 两个模块。
 */

export interface ExplodedOrderStep {
  /** 序号（从 1 开始，按真实 resolutionSteps 书写顺序） */
  index: number;
  /** 步骤原文（真实工单文本原样，仅去掉序号前缀） */
  text: string;
  /** 从真实 BOM 中匹配到的目标零件；未匹配为 null */
  matchedPart: {
    posNo: string;
    name: string;
  } | null;
  /** 匹配依据（命中的别名/规格词条），透明可解释 */
  matchedBy: string[];
}

export interface ExplodedWorkOrderBrief {
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
  explodedViewFile: string | null;
  /** 加工单里的真实检修步骤（repair_log.resolutionSteps 切分）+ 每步的真实 BOM 匹配零件 */
  steps: ExplodedOrderStep[];
  targetPart: {
    posNo: string;
    name: string;
    category?: string;
    spec?: string;
    matchedBy: string[];
    matchSource: 'parts_used' | 'description';
  } | null;
  candidateParts: Array<{ posNo: string; name: string; matchedBy: string[] }>;
  dataNote: string;
}

export interface ExplodedPartHistory {
  deviceId: string;
  part: { posNo: string; name: string; category?: string; spec?: string };
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
    replacementCount: number;
    lastReplacedAt: string | null;
    avgLifeDays: number | null;
    avgWorkHours: number | null;
    relatedOrderCount: number;
  };
  replacements: Array<{
    workOrderId: string;
    orderNo: string;
    title: string;
    status: string;
    replacedAt: string | null;
    matchedPartName: string;
    qty: number | null;
    causeAnalysis: string;
    resolutionSteps: string;
    workHours: number | null;
  }>;
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
    createdAt: string | null;
    acceptedAt: string | null;
    completedAt: string | null;
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

export interface ExplodedFaultObservation {
  posNo: string;
  name: string;
  category?: string;
  matchedBy: string[];
}

export interface ExplodedFaultMetric {
  metric: 'temperature' | 'vibration' | 'loadRate';
  metricLabel: string;
  value: number;
  unit: string;
  warningThreshold: number;
  severity: 'warning' | 'fault' | 'critical';
  occurredAt: string | null;
  observationParts: ExplodedFaultObservation[];
  suggestion: string;
}

export interface ExplodedFaultDiagnostics {
  deviceId: string;
  deviceName: string;
  deviceCode: string;
  explodedViewFile: string | null;
  faults: ExplodedFaultMetric[];
  latestSampleAt: string | null;
  dataNote: string;
}
