import {
  WorkOrder,
  Equipment,
  InspectionTask,
  NotificationItem,
  LotoLock,
  UserProfile,
  SparePart,
  SparePartMovement,
  Hazard,
  FieldWorkLog,
  FieldLotoRecord,
  FieldStepRecord,
  FieldMeasurement,
  FieldPartPhoto,
  AcceptanceVerdict,
  AcceptanceCheckRecord,
  AcceptanceBaseline,
  AcceptanceSignature,
} from '../types';
import { API_BASE, request } from './client';

// Public compatibility barrel. New domain clients should import `request` from ./client,
// never from this file, so extracting a domain cannot create a circular dependency.
export { ApiError, safeStorage, request } from './client';
export type { ApiErrorResponse } from './client';
export { workOrderApi } from './workOrders';
export type { WorkOrderStats } from './workOrders';
export { equipmentApi } from './equipment';

// 拆解视图 ↔ 检修业务联动 API（真实 DB 数据；接口定义见 server/routes/explodedView.ts）
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

export const explodedViewApi = {
  /** 工单 → 拆解视图上下文（设备 + 真实 BOM 命中的目标位号） */
  getWorkOrderBrief: (workOrderId: string) =>
    request<ExplodedWorkOrderBrief>(`/work-orders/${workOrderId}/exploded-brief`),

  /** 拆解位号 → 真实维修历史（真实工单 / 备件库存 / 出入库流水） */
  getPartHistory: (deviceId: string, partId: string) =>
    request<ExplodedPartHistory>(`/equipments/${deviceId}/parts/${partId}/maintenance-history`),

  /** 设备 → 真实遥测故障诊断（拆解视图红色脉冲高亮「未处理故障」用） */
  getFaultDiagnostics: (deviceId: string) =>
    request<ExplodedFaultDiagnostics>(`/equipments/${deviceId}/fault-diagnostics`),

  /** 设备 → 真实零件寿命预警（真实更换记录 × 运行时钟；黄色/红色寿命高亮 + 保养建议用） */
  getPartLifeDiagnostics: (deviceId: string) =>
    request<ExplodedPartLifeDiagnostics>(`/equipments/${deviceId}/part-life-diagnostics`),

  /** 设备 → 真实备件库存联动（spare_parts 台账；库存四要素 + 采购申请用） */
  getPartInventory: (deviceId: string) =>
    request<ExplodedPartInventoryDiagnostics>(`/equipments/${deviceId}/part-inventory`),

  /** 设备 → 检修报告聚合数据（设备台账 + 拆解页 BOM + 故障/寿命/库存标注 + 完工单历史） */
  getMaintenanceReport: (deviceId: string) =>
    request<MaintenanceReportData>(`/equipments/${deviceId}/maintenance-report`),
};

/* ==================== 拆解作业终端（现场维修闭环） ====================
 * 契约与服务端 `fieldOperationService.FieldSession` 一一对应；全部写入直接落
 * work_orders.repair_log.fieldLog（现有检修工单表），操作人取服务端会话身份。
 */
export interface FieldSessionStepInfo {
  index: number;
  text: string;
  matchedPart: { posNo: string; name: string } | null;
  state: FieldStepRecord | null;
  recordable: boolean;
}

export interface FieldSessionOrderInfo {
  id: string;
  orderNo: string;
  title: string;
  description: string;
  faultType: string;
  priority: string;
  status: string;
  statusLabel: string;
  createdAt: string | null;
  assignee: string | null;
  completedAt: string | null;
}

/** 真实点检标准（测量录入的可选科目与限值，来自 inspections.points，不是本地常量） */
export interface FieldMeasurementItem {
  key: string;
  checkPoint: string;
  standard: string | null;
  method: string | null;
  unit: string | null;
  minLimit: number | null;
  maxLimit: number | null;
}

export interface FieldSessionData {
  deviceId: string;
  order: FieldSessionOrderInfo | null;
  canOperate: boolean;
  blockedReason: string | null;
  lotoItems: Array<{ key: string; label: string }>;
  loto: FieldLotoRecord | null;
  steps: FieldSessionStepInfo[];
  progress: { total: number; done: number; skipped: number; issue: number; remaining: number; current: number | null };
  measurements: FieldMeasurement[];
  partPhotos: FieldPartPhoto[];
  events: FieldWorkLog['events'];
  measurementItems: FieldMeasurementItem[];
  autoCompleted: FieldWorkLog['completed'] | null;
  version: number | null;
  dataNote: string;
}

/**
 * 步骤记录端点在会话之外额外返回 justCompleted（本次调用是否触发自动完工）；
 * 会话自身的 autoCompleted 始终是完工留痕对象（未完工为 null）。
 */
export type FieldSessionWithCompletion = FieldSessionData & { justCompleted: boolean };

export const fieldOpsApi = {
  /** 设备 → 现场作业会话（工单 + LOTO + 步骤留痕 + 进度 + 测量/照片 + 时间线） */
  getSession: (deviceId: string) =>
    request<FieldSessionData>(`/equipments/${encodeURIComponent(deviceId)}/field-session`),

  /** LOTO 四项强制安全确认（服务端按权威清单复验，全部 confirmed 才放行） */
  confirmLoto: (orderId: string, items: Array<{ key: string; label: string; confirmed: boolean }>) =>
    request<FieldSessionData>(`/work-orders/${encodeURIComponent(orderId)}/field-actions/loto`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  /** 记录单步：done / skip / issue（skip 与 issue 必须带原因，服务端硬校验） */
  recordStep: (orderId: string, data: { index: number; action: 'done' | 'skip' | 'issue'; note?: string }) =>
    request<FieldSessionWithCompletion>(`/work-orders/${encodeURIComponent(orderId)}/field-actions/step`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 录入现场测量值（科目与限值取真实点检标准，超标由服务端复算并留痕） */
  addMeasurement: (orderId: string, data: { posNo: string; checkPoint: string; value: number }) =>
    request<FieldSessionData>(`/work-orders/${encodeURIComponent(orderId)}/field-actions/measure`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 关联现场照片（url 必须是先经 /upload/image 真实落盘的 /uploads/ 资源） */
  addPartPhoto: (orderId: string, data: { posNo: string; url: string; filename?: string; size?: number }) =>
    request<FieldSessionData>(`/work-orders/${encodeURIComponent(orderId)}/field-actions/photo`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

/* ---------------- 修后验收与效果验证 ---------------- */

export interface AcceptanceItem {
  itemKey: string;
  itemLabel: string;
  metric: string;
  unit: string | null;
  minLimit: number | null;
  maxLimit: number | null;
  judgedBy: 'auto' | 'manual';
  standardSource: string;
  confidence: string;
  note: string | null;
  record: AcceptanceCheckRecord | null;
  verdict: AcceptanceVerdict;
}

export interface AcceptanceSessionData {
  order: {
    id: string;
    orderNo: string;
    title: string;
    equipmentId: string;
    equipmentName: string;
    faultType: string;
    status: string;
    statusLabel: string;
    createdAt: string | null;
    assignee: string | null;
  };
  canAccept: boolean;
  blockedReason: string | null;
  items: AcceptanceItem[];
  allPassed: boolean;
  failed: number;
  unconfigured: number;
  pending: number;
  baselines: AcceptanceBaseline[];
  signatures: AcceptanceSignature[];
  nextSigner: 'technician' | 'teamlead' | null;
  /** 本次维修执行人：决定谁有资格签「维修人」（解析不出时 name 为 null） */
  repairer: { id?: string; name: string | null };
  closedAt: string | null;
  summary: { knowledgeId: string; title: string; createdAt: string } | null;
  events: FieldWorkLog['events'];
  version: number | null;
  dataNote: string;
}

/** 签字端点额外返回本次是否关单 + 生成的维修案例引用 */
export type AcceptanceSignResult = AcceptanceSessionData & {
  justClosed: boolean;
  summaryRef: { knowledgeId: string; title: string } | null;
};

export const acceptanceApi = {
  /** 验收会话：清单 + 修前遥测基线 + 已签字 + 总结 */
  get: (orderId: string) => request<AcceptanceSessionData>(`/work-orders/${encodeURIComponent(orderId)}/acceptance`),

  /** 记录一项验收结果（判定由服务端按标准快照复算，前端 verdict 一律忽略） */
  check: (orderId: string, data: { itemKey: string; value?: number | null; confirmed?: boolean; note?: string }) =>
    request<AcceptanceSessionData>(`/work-orders/${encodeURIComponent(orderId)}/acceptance/checks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 签字：先 technician（当前登录者）后 teamlead（manager/admin 且必须另一人） */
  sign: (orderId: string, data: { step: 'technician' | 'teamlead'; comment?: string }) =>
    request<AcceptanceSignResult>(`/work-orders/${encodeURIComponent(orderId)}/acceptance/sign`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// 认证与权限 API (JWT / RBAC)
let memoryAuthToken: string | null = null;
export const authApi = {
  login: (credentials: { username: string; password: string }) =>
    request<{
      token: string;
      tokenType: string;
      expiresIn: number;
      forcePasswordChange?: boolean;
      user: {
        id: string;
        username: string;
        name: string;
        role: string;
        roleTitle: string;
        department: string;
        permissions: string[];
      };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),

  getMe: () => request<UserProfile | null>('/auth/me'),

  getCurrentUser: () => request<UserProfile | null>('/auth/me'),

  getUsers: () => request<UserProfile[]>('/auth/users'),

  // 创建用户账号 (真实落库，RBAC: 仅管理员)
  createUser: (data: {
    username: string;
    name: string;
    password: string;
    role: string;
    roleTitle?: string;
    department?: string;
    phone?: string;
    email?: string;
    permissions?: string[];
  }) =>
    request<UserProfile>('/auth/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAvatar: (data: { imageBase64?: string; avatarUrl?: string }) =>
    request<{ success: boolean; url: string; avatarUrl: string; filename?: string }>('/user/avatar', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUserStatus: (id: string, status: 'active' | 'disabled') =>
    request<{ success: boolean; message: string; user: UserProfile }>(`/auth/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  saveToken: (token: string) => {
    memoryAuthToken = token;
  },

  getToken: () => memoryAuthToken,

  clearToken: () => {
    memoryAuthToken = null;
  },

  switchUser: (userId: string) =>
    request<{
      token: string;
      tokenType: string;
      expiresIn: number;
      user: UserProfile;
    }>('/auth/switch-user', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  logout: async () => {
    memoryAuthToken = null;
    try {
      await request<{ success: boolean; message: string }>('/auth/logout', { method: 'POST' });
    } catch {
      // 忽略登出时的网络错误
    }
  },
};

// 安全管理高危作业票 API (双人会签审批流转)
export const safetyPermitApi = {
  list: (params?: { risk_level?: string; status?: string; workshop?: string }) => {
    const query = new URLSearchParams();
    if (params?.risk_level && params.risk_level !== 'all') query.append('risk_level', params.risk_level);
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    if (params?.workshop && params.workshop !== 'all') query.append('workshop', params.workshop);
    const qs = query.toString();
    return request<any[]>(`/safety-permits${qs ? `?${qs}` : ''}`);
  },

  getById: (id: string) => request<any>(`/safety-permits/${id}`),

  create: (data: any) =>
    request<any>('/safety-permits', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // LOTO 能量隔离锁具看板 (真实落库 loto_locks 表)
  getLotoLocks: (params?: { status?: string }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    const qs = query.toString();
    return request<LotoLock[]>(`/loto-locks${qs ? `?${qs}` : ''}`);
  },

  // 人工登记/释放记录：仅更新台账，不控制现场硬件。
  registerLotoLock: (data: {
    lockNo: string;
    permitNo: string;
    pointName: string;
    energySource?: string;
    location?: string;
  }) =>
    request<LotoLock>('/loto-locks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  releaseLotoLock: (id: string, data: { unlockRemark: string }) =>
    request<LotoLock>(`/loto-locks/${encodeURIComponent(id)}/release`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  approve: (id: string, data: { step: 'guardian' | 'supervisor'; pass: boolean; comment?: string; gasTestResults?: any; signerPassword?: string; signatureMethod?: string }) =>
    request<any>(`/safety-permits/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  close: (id: string, data?: { closeRemark?: string }) =>
    request<any>(`/safety-permits/${id}/close`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  delete: (id: string) =>
    request<{ success: boolean }>(`/safety-permits/${id}`, {
      method: 'DELETE',
    }),
};

// 检修知识库 RAG API (切片/搜索/文件解析导入)
export const knowledgeApi = {
  list: (params?: { category?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.category && params.category !== 'all') query.append('category', params.category);
    if (params?.search) query.append('search', params.search);
    const qs = query.toString();
    return request<any[]>(`/knowledge${qs ? `?${qs}` : ''}`);
  },

  create: (data: any) =>
    request<any>('/knowledge', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  upload: (data: { fileName: string; textContent: string; category?: string; targetEquipment?: string; tags?: string[] }) =>
    request<any>('/knowledge/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  search: (query: string, limit = 5, imageBase64?: string) =>
    request<{ success: boolean; query: string; imageRecognition?: string; results: any[] }>('/knowledge/search', {
      method: 'POST',
      body: JSON.stringify({ query, limit, imageBase64 }),
    }),
  reviewList: (status = 'pending') => request<any[]>(`/knowledge/review/list?status=${encodeURIComponent(status)}`),
  approve: (id: string) => request<any>(`/knowledge/review/${id}/approve`, { method: 'POST', body: '{}' }),
  reject: (id: string, reason?: string) => request<any>(`/knowledge/review/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  graph: (equipment?: string) => request<{ nodes: any[]; edges: any[] }>(`/knowledge/graph${equipment ? `?equipment=${encodeURIComponent(equipment)}` : ''}`),
  extractGraph: () => request<any>('/knowledge/graph/extract', { method: 'POST', body: '{}' }),
};

// 标准化检修作业指引 API
export const procedureApi = {
  list: (params?: { equipmentType?: string; maintenanceLevel?: string; keyword?: string }) => {
    const query = new URLSearchParams();
    if (params?.equipmentType && params.equipmentType !== 'all') query.append('equipmentType', params.equipmentType);
    if (params?.maintenanceLevel && params.maintenanceLevel !== 'all') query.append('maintenanceLevel', params.maintenanceLevel);
    if (params?.keyword) query.append('keyword', params.keyword);
    const qs = query.toString();
    return request<any[]>(`/procedures${qs ? `?${qs}` : ''}`);
  },
  getById: (id: string) => request<any>(`/procedures/${id}`),
  create: (data: any) =>
    request<any>('/procedures', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  generateVideoScript: (id: string, refresh?: boolean) =>
    request<{ success: boolean; script: any; procedure: any; cached?: boolean; degraded?: boolean }>(
      `/procedures/${id}/generate-video-script${refresh ? '?refresh=true' : ''}`,
      { method: 'POST', body: '{}' }
    ),
  generateVideo: (id: string, duration?: number) =>
    request<{ success: boolean; taskId: string; status: string; videoRecord?: any }>(
      `/procedures/${id}/generate-video${duration ? `?duration=${duration}` : ''}`,
      { method: 'POST', body: '{}' }
    ),
  generateVideoFull: (id: string) =>
    request<{ success: boolean; taskId: string; status: string; segmentCount?: number; estimatedSeconds?: number; message?: string }>(
      `/procedures/${id}/generate-video-full`,
      { method: 'POST', body: '{}' }
    ),
  // createdAt：任务入库时间（ISO 字符串）。前端用它算"真实已耗时"，
  // 不能用轮询启动时刻 —— 刷新页面会重新开始轮询，那样耗时会被清零。
  // totalTimeoutMin：后端按段数推导的全局超时（分钟），前端据此决定何时停止轮询，
  // 避免前端写死一个数与后端脱节。
  getVideoStatus: (taskId: string) =>
    request<{
      status: string;
      videoUrl?: string;
      error?: string;
      progressPct?: number | null;
      internalStatus?: string | null;
      elapsedSec?: number | null;
      createdAt?: string;
      totalTimeoutMin?: number;
      fullMode?: boolean;
    }>(`/procedures/video-status?taskId=${encodeURIComponent(taskId)}`),
  getVideos: (id: string) =>
    request<any[]>(`/procedures/${id}/videos`),
  deleteVideo: (id: string) =>
    request<{ success: boolean; message: string }>(`/procedures/videos/${id}`, {
      method: 'DELETE',
    }),
  cancelVideo: (taskId: string) =>
    request<{ success: boolean }>(`/procedures/videos/cancel`, {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    }),
};

// 操作合规与失误率审计 API
export const complianceApi = {
  getStats: (operator?: string) => request<any>(`/compliance-stats${operator ? `?operator=${encodeURIComponent(operator)}` : ''}`),
  getWorkOrderCompliance: (workOrderId: string) => request<any>(`/work-orders/${workOrderId}/compliance`),
  getByWorkOrderId: (workOrderId: string) => request<any>(`/work-orders/${workOrderId}/compliance`),
};

// 多模态 AI 服务 API (智能诊断 / 视频分析 / DashScope 缺陷视觉识别 / Paraformer 工业语音转写)
export const aiApi = {
  chat: (message: string, history: any[] = []) =>
    request<{ success: boolean; chatId: string; reply: string; model: string }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    }),
  submitFeedback: (data: { chatId: string; user_correction: string; corrected_content: string; model_response?: string; device_id?: string }) =>
    request<any>('/ai/feedback', { method: 'POST', body: JSON.stringify(data) }),
  getFeedbackList: (status = 'pending') => request<any[]>(`/ai/feedback?status=${encodeURIComponent(status)}`),
  adoptFeedback: (id: string) => request<any>(`/ai/feedback/${id}/adopt`, { method: 'POST', body: '{}' }),

  // 视频上传与智能分析接口
  uploadVideo: (videoBase64: string, filename?: string) =>
    request<{ success: boolean; url: string; videoId: string; filename: string; size: number }>('/upload/video', {
      method: 'POST',
      body: JSON.stringify({ videoBase64, filename }),
    }),
  analyzeVideo: (data: { frames: string[]; question?: string; deviceModel?: string; videoId?: string }) =>
    request<{ success: boolean; analysis: any; logId: string; videoId?: string; framesCount: number }>('/ai/video-analyze', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 上传图片至服务器静态目录
  uploadImage: (imageBase64: string, filename?: string) =>
    request<{ success: boolean; url: string; filename: string; size: number }>('/upload/image', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, filename }),
    }),

  // 阿里云 DashScope / 通义万象/Qwen-VL 工业缺陷深度识别
  detectVisionDefects: (data: { imageBase64: string; imageUrl?: string; equipmentType?: string; promptText?: string }) =>
    request<{ success: boolean; defectResult: any; rawAnalysis?: string; modelEngine: string }>('/ai/vision-defect-detect', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 功能②：知识贡献识别 (对话后判断是否沉淀为知识案例)
  suggestContribution: (data: { lastUserMessage: string; lastAiReply: string; equipment?: string }) =>
    request<{
      success: boolean;
      suggestion: {
        worthContributing: boolean;
        title: string;
        type: string;
        equipment: string;
        summary: string;
        solution: string;
        id?: string;
        chatId?: string;
      };
    }>('/ai/suggest-contribution', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 提交知识贡献沉淀案例
  submitContribution: (data: { id?: string; title: string; type: string; equipment?: string; summary?: string; solution?: string; chatId?: string }) =>
    request<{ success: boolean; id: string; message: string }>('/ai/contributions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 获取知识贡献审核列表
  getContributions: (status = 'pending') =>
    request<Array<{
      id: string;
      chat_id: string;
      title: string;
      type: string;
      equipment: string;
      summary: string;
      solution: string;
      contributor: string;
      status: string;
      created_at: string;
    }>>(`/ai/contributions?status=${encodeURIComponent(status)}`),

  // 采纳知识贡献
  adoptContribution: (id: string) =>
    request<{ success: boolean; article: any }>(`/ai/contributions/${id}/adopt`, {
      method: 'POST',
    }),

  // 功能④：多模态检索 (看图找相似案例)
  multimodalSearch: (data: { imageBase64: string; userText?: string }) =>
    request<{
      success: boolean;
      visionDescription: string;
      safetyHint?: string;
      cases: Array<{
        id: string;
        title: string;
        category: string;
        targetEquipment?: string;
        summary: string;
        content: string;
      }>;
    }>('/ai/multimodal-search', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 阿里云 DashScope Paraformer 工业现场语音识别转写
  speechToText: (data: { audioBase64?: string; format?: string; mimeType?: string; durationSeconds?: number }) =>
    request<{ success: boolean; text: string; confidence?: number; durationSeconds?: number; engine?: string; message?: string }>(
      '/ai/speech-to-text',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  // ==================== AI 扩展功能 (6 大工业场景) ====================

  // 功能 1：智能工单生成 (巡检异常/设备报警 → 工单草稿)
  generateWorkOrder: (data: { equipmentId: string; abnormalDescription: string; inspectionPointId?: string; telemetrySnapshot?: any }) =>
    request<{ success: boolean; degraded?: boolean; message?: string; draft?: AiWorkOrderDraft; equipment?: any; error?: string; model?: string }>(
      '/ai/generate-work-order',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 2：根因分析 (RCA / 5Why / 故障树)
  rootCauseAnalysis: (data: { workOrderId?: string; equipmentId?: string; faultDescription?: string }) =>
    request<{ success: boolean; degraded?: boolean; message?: string; analysis?: AiRootCauseAnalysis; error?: string; model?: string }>(
      '/ai/root-cause-analysis',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 3：检修方案 / 作业指导书生成
  generateMaintenancePlan: (data: { equipmentId: string; faultDescription: string; workOrderId?: string }) =>
    request<{ success: boolean; degraded?: boolean; message?: string; plan?: AiMaintenancePlan; error?: string; model?: string; reviewId?: string | null }>(
      '/ai/generate-maintenance-plan',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 4：设备劣化趋势预警（确定性统计引擎 + AI 解读）
  healthForecast: (data: { equipmentId: string; hours?: number }) =>
    request<{ success: boolean; degraded?: boolean; message?: string; forecast?: AiHealthForecast; statistics?: Record<string, any>; dataPoints?: number; error?: string; model?: string }>(
      '/ai/health-forecast',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 5：智能报告生成 (巡检/检修/月度)
  generateReport: (data: { reportType: 'inspection' | 'maintenance' | 'monthly'; startDate: string; endDate: string; workshop?: string }) =>
    request<{ success: boolean; degraded?: boolean; message?: string; report?: AiReport; meta?: any; error?: string; model?: string; reviewId?: string | null }>(
      '/ai/generate-report',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 6：作业票 AI 风险评估 (JSA)
  safetyRiskAssessment: (data: { permitType: string; equipmentId?: string; workDescription: string; location?: string; hazards?: string[] }) =>
    request<{ success: boolean; degraded?: boolean; message?: string; assessment?: AiSafetyAssessment; error?: string; model?: string; reviewId?: string | null }>(
      '/ai/safety-risk-assessment',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 7：AI 智能追问建议
  suggestFollowups: (data: { lastUserMessage: string; lastAiReply: string; context?: any }) =>
    request<{ success: boolean; degraded?: boolean; suggestions?: string[]; error?: string; model?: string }>(
      '/ai/suggest-followups',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 8：设备健康画像 / 摘要
  equipmentSummary: (data: { equipmentId: string }) =>
    request<{ success: boolean; degraded?: boolean; summary?: AiEquipmentSummary; message?: string; error?: string; model?: string }>(
      '/ai/equipment-summary',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 9：AI 辅助派单 (推荐主修人 + 工时)
  recommendAssignee: (data: { equipmentId: string; faultDescription: string; priority?: string }) =>
    request<{ success: boolean; degraded?: boolean; recommendation?: AiAssigneeRecommendation; message?: string; error?: string; model?: string }>(
      '/ai/recommend-assignee',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 10：报警智能关联分析
  alarmCorrelation: (data: { alarms: { equipmentId: string; alarmType: string; value?: any; timestamp?: string }[] }) =>
    request<{ success: boolean; degraded?: boolean; analysis?: AiAlarmCorrelation; message?: string; error?: string; model?: string }>(
      '/ai/alarm-correlation',
      { method: 'POST', body: JSON.stringify(data) }
    ),
};

// ==================== AI 扩展功能响应类型 ====================
export interface AiWorkOrderDraft {
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  priorityReason?: string;
  suggestedSteps?: string[];
  spareParts?: { name: string; spec: string; qty: number }[];
  estimatedHours?: number;
}

export interface AiRootCauseAnalysis {
  summary?: string;
  fiveWhys?: { level: number; question: string; reason: string; evidence: string }[];
  rootCauses?: { type: string; cause: string; probability: string; evidence: string }[];
  correctiveActions?: { shortTerm?: string[]; longTerm?: string[] };
  references?: string[];
}

export interface AiMaintenancePlan {
  overview?: string;
  steps?: { step: number; operation: string; qualityStandard: string }[];
  safetyMeasures?: { lotoPoints?: string[]; ppe?: string[]; highRiskNotes?: string[] };
  tools?: { name: string; spec: string }[];
  spareParts?: { name: string; spec: string; qty: number }[];
  qualityCheckpoints?: string[];
  estimatedHours?: number;
  workers?: number;
}

export interface AiHealthForecast {
  healthRating?: string;
  ratingReason?: string;
  trends?: { metric: string; direction: string; rateDescription?: string; description: string }[];
  failureRisks?: { mode: string; basis: string }[];
  watchWindowHours?: number;
  watchWindowNote?: string;
  recommendations?: string[];
}

export interface AiReport {
  summary?: string;
  highlights?: string[];
  problems?: string[];
  statistics?: { label: string; value: string }[];
  topIssues?: { title: string; count: number; analysis: string }[];
  suggestions?: string[];
  markdown?: string;
}

export interface AiSafetyAssessment {
  riskLevel?: string;
  riskReason?: string;
  hazardIdentifications?: { category: string; hazard: string; level: string }[];
  jsaMeasures?: { hazard: string; control: string }[];
  ppeList?: string[];
  lotoAdvice?: { required: boolean; isolationPoints: string[]; lockCount: number };
  approvalFocusPoints?: string[];
}

// 巡检任务真实数据 API (本地落库)
export const inspectionApi = {
  list: (params?: { status?: string; workshop?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    if (params?.workshop && params.workshop !== 'all') query.append('workshop', params.workshop);
    if (params?.search) query.append('search', params.search);
    const qs = query.toString();
    return request<InspectionTask[]>(`/inspections${qs ? `?${qs}` : ''}`);
  },

  getById: (id: string) => request<InspectionTask>(`/inspections/${id}`),

  create: (data: Partial<InspectionTask>) =>
    request<InspectionTask>('/inspections', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<InspectionTask>) =>
    request<InspectionTask>(`/inspections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

// 系统通知中心 API (通知列表 / 已读标记 / 全部已读，真实落库)
export const notificationApi = {
  list: (params?: { unreadOnly?: boolean; limit?: number; userId?: string; all?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.unreadOnly) query.append('unread_only', 'true');
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.userId) query.append('user_id', params.userId);
    if (params?.all) query.append('all', 'true');
    const qs = query.toString();
    return request<NotificationItem[]>(`/notifications${qs ? `?${qs}` : ''}`);
  },

  markRead: (id: string) =>
    request<NotificationItem>(`/notifications/${id}/read`, {
      method: 'PATCH',
    }),

  markAllRead: () =>
    request<{ success: boolean; unreadCount: number }>('/notifications/read-all', {
      method: 'POST',
    }),
};

// 生产环境安全与操作合规审计日志 API
export const auditLogApi = {
  list: (params?: { module?: string; actionType?: string; status?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.module && params.module !== 'all') query.append('module', params.module);
    if (params?.actionType && params.actionType !== 'all') query.append('actionType', params.actionType);
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    if (params?.limit) query.append('limit', params.limit.toString());
    const qs = query.toString();
    return request<any[]>(`/audit-logs${qs ? `?${qs}` : ''}`);
  },
};


// ==================== AI 助手升级 / 功能 7-10 响应类型 ====================
export interface AiEquipmentSummary {
  healthRating?: string;
  healthSummary?: string;
  timeline?: { time: string; event: string }[];
  risks?: string[];
  recommendations?: string[];
}

export interface AiAssigneeRecommendation {
  recommended?: { id: string; name: string; reason: string };
  alternatives?: { id: string; name: string; reason: string }[];
  estimatedHours?: number;
  suggestedPriority?: string;
}

export interface AiAlarmCorrelation {
  summary?: string;
  rootAlarm?: { index: number; equipment: string; reason: string };
  derivedAlarms?: { index: number; equipment: string; relation: string }[];
  correlationGraph?: string;
  actionPlan?: string[];
}

// 工业备件库存与出入库 API
export const sparePartsApi = {
  list: (params?: { query?: string; category?: string; lowStock?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.query) qs.append('query', params.query);
    if (params?.category && params.category !== 'all') qs.append('category', params.category);
    if (params?.lowStock) qs.append('lowStock', 'true');
    const q = qs.toString();
    return request<SparePart[]>(`/spare-parts${q ? `?${q}` : ''}`);
  },
  getById: (id: string) => request<SparePart>(`/spare-parts/${id}`),
  create: (data: Partial<SparePart>) =>
    request<SparePart>('/spare-parts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  inOut: (id: string, data: { type: 'in' | 'out'; quantity: number; operatorName?: string; operator?: string; relatedWorkOrderId?: string; workOrderId?: string; notes?: string; reason?: string }) =>
    request<{ success: boolean; part: SparePart; movement: SparePartMovement }>(`/spare-parts/${id}/in-out`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getLowStock: () => request<SparePart[]>('/spare-parts/low-stock'),
  getMovements: (id: string) => request<SparePartMovement[]>(`/spare-parts/${id}/movements`),
};

// 现场安全隐患闭环管理 API
export const hazardsApi = {
  list: (params?: { status?: string; level?: string; equipmentId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status && params.status !== 'all') qs.append('status', params.status);
    if (params?.level && params.level !== 'all') qs.append('level', params.level);
    if (params?.equipmentId) qs.append('equipmentId', params.equipmentId);
    const q = qs.toString();
    return request<Hazard[]>(`/hazards${q ? `?${q}` : ''}`);
  },
  getById: (id: string) => request<Hazard>(`/hazards/${id}`),
  getMetrics: () => request<any>('/hazards/metrics'),
  create: (data: Partial<Hazard>) =>
    request<Hazard>('/hazards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Hazard>) =>
    request<Hazard>(`/hazards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  assign: (id: string, data?: { priority?: string; assigneeId?: string; assignee_id?: string; deadline?: string; dispatch_note?: string }) =>
    request<{ success: boolean; hazard: Hazard; workOrder: WorkOrder }>(`/hazards/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  verify: (id: string, data: { verificationNotes?: string; comment?: string; pass?: boolean; passed?: boolean; verifierName?: string; verifier?: string }) =>
    request<{ success: boolean; hazard: Hazard }>(`/hazards/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ==================== 驾驶舱异常下钻（监测 → 定位 → 干预 闭环） ====================

export interface CockpitAbnormalItem {
  equipmentId: string | null;
  equipmentName: string;
  equipmentCode: string;
  workshop: string | null;
  abnormalType: string;
  detail: string;
  metricLabel: string;
  metricValue: number | string;
  lastInspectionAt: string | null;
  healthScore: number | null;
  severity: 'high' | 'medium';
  refId: string;
  refTitle?: string;
}

export type CockpitAbnormalType = 'health' | 'order' | 'inspection' | 'hazard';

export const cockpitApi = {
  /** 按指标类型获取异常设备/事件明细，供驾驶舱下钻与一键生成检修工单 */
  getAbnormalEquipments: (type: CockpitAbnormalType) =>
    request<{ type: CockpitAbnormalType; count: number; items: CockpitAbnormalItem[]; timestamp: string }>(
      `/cockpit/abnormal-equipments?type=${type}`
    ),
};

// ==================== AI 协同任务链路（Pipeline） ====================

export interface AiPipelineStep {
  id: string;
  taskId: string;
  stepName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  result: { outcome?: string; degraded?: boolean; message?: string; data?: any } | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AiPipelineReport {
  equipment: { id: string; name: string; code: string; workshop?: string; healthScore?: number };
  problemDescription: string;
  diagnosis?: any;
  plan?: any;
  risk?: any;
  assignee?: any;
  degradedSteps: string[];
  generatedAt: string;
}

export interface AiPipelineTask {
  id: string;
  scene: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  currentStep: string | null;
  result: { failedSteps?: string[]; degradedSteps?: string[]; report?: AiPipelineReport } | null;
  steps: AiPipelineStep[];
  createdAt: string;
  completedAt: string | null;
}

export interface AiPipelineListItem {
  id: string;
  scene: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  equipmentName: string;
  problemDescription: string;
  createdAt: string;
}

export const aiPipelineApi = {
  /** 创建并启动协同任务（故障诊断 → 检修方案 → 风险审核 ∥ 派单推荐） */
  create: (data: { equipmentId: string; problemDescription: string; scene?: string }) =>
    request<{ success: boolean; taskId: string; scene: string; steps: string[]; message: string }>('/ai/pipeline', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 查询协同任务最近列表 */
  list: (limit = 5) =>
    request<{ success: boolean; tasks: AiPipelineListItem[] }>(`/ai/pipeline?limit=${limit}`),

  /** 查询任务与各步骤状态 */
  getById: (id: string) => request<{ success: boolean; task: AiPipelineTask }>(`/ai/pipeline/${id}`),
};

// ==================== AI 生成内容审核台（管理端） ====================

export interface AiGenerationReview {
  id: string;
  aiEndpoint: string;
  sourceType: 'maintenance_plan' | 'safety_risk' | 'report' | 'work_order_draft';
  sourceTypeLabel?: string;
  content: any;
  knowledgeSources: string[];
  knowledgeRefs?: { id: string; title: string; category: string; excerpt: string }[];
  status: 'pending' | 'approved' | 'rejected';
  reviewer: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AiAnalysisTraceLog {
  id: string;
  videoId?: string | null;
  framesCount?: number;
  question: string;
  deviceModel: string;
  model: string;
  promptVersion: string;
  inputDigest: string;
  reviewStatus: string;
  safetyNotice?: {
    required: boolean;
    level: string;
    reason: string;
    requiresConfirmation: boolean;
    riskTypes: string[];
    degraded: boolean;
  };
  result: any;
  createdAt: string;
}

export const adminAiReviewApi = {
  list: (status?: 'pending' | 'approved' | 'rejected') =>
    request<AiGenerationReview[]>(`/admin/ai-reviews${status ? `?status=${status}` : ''}`),

  approve: (id: string, reviewNote?: string) =>
    request<{ success: boolean; review: AiGenerationReview }>(`/admin/ai-reviews/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ review_note: reviewNote || '' }),
    }),

  reject: (id: string, reviewNote: string) =>
    request<{ success: boolean; review: AiGenerationReview }>(`/admin/ai-reviews/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ review_note: reviewNote }),
    }),

  listTraceLogs: (model?: string) =>
    request<AiAnalysisTraceLog[]>(`/admin/ai-analysis-logs${model ? `?model=${encodeURIComponent(model)}` : ''}`),
};


// ==================== AI 模型路由（管理端） ====================

export interface AiModelConfig {
  id: string;
  provider: string;
  displayName: string;
  baseUrl: string;
  apiKeyMasked: string;
  modelName: string;
  capabilities: ('chat' | 'vision' | 'video')[];
  priority: number;
  enabled: boolean;
  healthStatus: 'unknown' | 'healthy' | 'unhealthy';
  lastCheckedAt: string | null;
}

export const adminAiModelApi = {
  list: () => request<AiModelConfig[]>('/admin/ai-models'),

  upsert: (data: {
    id?: string;
    provider: string;
    displayName: string;
    baseUrl?: string;
    apiKey?: string;
    apiKeyEnv?: string;
    modelName: string;
    capabilities: ('chat' | 'vision' | 'video')[];
    priority?: number;
    enabled?: boolean;
  }) =>
    request<{ success: boolean; config: AiModelConfig }>('/admin/ai-models', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  test: (id: string) =>
    request<{ success: boolean; configId: string; latencyMs: number; model: string; error?: string; reply?: string }>(
      `/admin/ai-models/${id}/test`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  reorder: (orderedIds: string[]) =>
    request<{ success: boolean; configs: AiModelConfig[] }>('/admin/ai-models/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    }),
};

// ==================== 内部师傅距离调度 ====================

export interface DutyTechnician {
  id: string;
  username: string;
  name: string;
  role: string;
  roleTitle: string;
  department?: string;
  skills: string[];
  onlineStatus: 'online' | 'idle' | 'offline';
  mapX: number;
  mapY: number;
  geoLng?: number | null;
  geoLat?: number | null;
  lastLocationAt: string | null;
}

export interface EquipmentPoint {
  id: string;
  code: string;
  name: string;
  workshop: string | null;
  status: string;
  healthScore: number;
  mapX: number;
  mapY: number;
  geoLng?: number | null;
  geoLat?: number | null;
  openOrders: number;
}

export interface PendingWorkOrder {
  id: string;
  orderNo: string;
  title: string;
  equipmentId: string;
  equipmentName: string;
  faultType: string | null;
  priority: string;
}

export interface DispatchRecommendationItem {
  technician: {
    id: string;
    name: string;
    roleTitle: string;
    skills: string[];
    mapX: number;
    mapY: number;
    geoLng: number | null;
    geoLat: number | null;
    status: string;
    lastLocationAt: string | null;
  };
  distance: number;
  distanceLabel: string;
  status: string;
  skillMatch: number;
  score: number;
  reason: string;
}

export const dispatchApi = {
  /** 师傅位置上报（technician/inspector）：支持 { lng, lat, status }（真实经纬度，优先）与 { mapX, mapY, status }（旧平面坐标兼容） */
  reportLocation: (data: { lng?: number; lat?: number; mapX?: number; mapY?: number; status?: 'online' | 'idle' | 'offline' }) =>
    request<{ success: boolean; locationId: string; lng: number | null; lat: number | null; mapX: number; mapY: number; status: string; reportedAt: string; message: string }>(
      '/dispatch/location',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  /** 在岗师傅列表 */
  listTechnicians: () =>
    request<{ success: boolean; count: number; idleCount: number; technicians: DutyTechnician[]; timestamp: string }>(
      '/dispatch/technicians'
    ),

  /** 调度大屏聚合（设备点位 + 待派工单） */
  board: () =>
    request<{ success: boolean; equipmentPoints: EquipmentPoint[]; pendingOrders: PendingWorkOrder[]; timestamp: string }>(
      '/dispatch/board'
    ),

  /** 就近派单推荐 */
  recommend: (workOrderId: string) =>
    request<{
      success: boolean;
      workOrder: { id: string; orderNo: string; title: string; faultType: string | null; priority: string; status: string };
      equipment: { id: string; code: string; name: string; workshop: string | null; mapX: number; mapY: number; geoLng: number | null; geoLat: number | null };
      requiredKeywords: string[];
      recommendations: DispatchRecommendationItem[];
      meterPerUnit: number;
      timestamp: string;
    }>(`/dispatch/recommend?workOrderId=${encodeURIComponent(workOrderId)}`),

  /** 派单确认 */
  assign: (data: { workOrderId: string; userId: string }) =>
    request<{ success: boolean; workOrder: any; technician: { id: string; name: string; roleTitle: string }; message: string }>(
      '/dispatch/assign',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  /** 演示接口：模拟在岗师傅位置 */
  mock: () =>
    request<{ success: boolean; demo: boolean; updated: number; message: string }>('/dispatch/mock', { method: 'POST', body: JSON.stringify({}) }),
};
