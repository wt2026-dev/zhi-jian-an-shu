export type UserRole = 'admin' | 'manager' | 'technician' | 'inspector' | 'operator' | 'archivist' | 'user';

export interface UserProfile {
  id: string;
  name: string;
  username?: string;
  role: UserRole;
  roleTitle: string;
  department: string;
  employeeNo?: string;
  phone: string;
  email?: string;
  avatar?: string;
  certifications?: string[];
  qualifications?: string[];
  currentTasksCount?: number;
  activeWorkOrdersCount?: number;
  permissions?: string[];
  status?: 'active' | 'disabled';
}

export type EquipmentStatus = 
  | 'running'       // 正常运行
  | 'warning'       // 预警关注
  | 'fault'         // 故障待修
  | 'overhauling'   // 检修中
  | 'standby'       // 停机备用
  | 'scrapped';      // 报废

export interface TelemetryData {
  temperature: number;   // °C
  vibration: number;     // mm/s (RMS)
  voltage: number;       // V
  current: number;       // A
  pressure?: number;     // MPa
  rpm?: number;          // r/min
  loadRate: number;      // %
  lastUpdated: string;
}

export interface MaintenanceRecord {
  id: string;
  orderNo: string;
  date: string;
  type: '定期大修' | '应急抢修' | '润滑保养' | '状态检修';
  technician: string;
  cost: number;
  durationHours: number;
  summary: string;
  partsReplaced: string[];
}

export interface Equipment {
  id: string;
  code: string;
  name: string;
  category: '泵类设备' | '压缩机' | '传动减速机' | '大型电机' | '数控机床' | '工业机器人' | '换热容器';
  type?: string;
  model: string;
  workshop: string;      // 车间/工段
  location: string;      // 详细安装位
  installDate: string;
  manufacturer: string;
  status: EquipmentStatus;
  healthScore: number;   // 0 - 100
  criticality: '关键核心' | '主要生产' | '通用辅助';
  telemetry: TelemetryData;
  specs: Record<string, string>;
  maintenanceHistory: MaintenanceRecord[];
  nextInspectionDate: string;
  assignedTechnician?: string;
  qrCode: string;
}

export type WorkOrderStatus = 
  | 'created'             // 待派单
  | 'dispatched'          // 待接单
  | 'in_progress'         // 检修中
  | 'pending_acceptance'  // 待验收
  | 'completed'           // 已归档
  | 'cancelled';          // 已取消

export type WorkOrderPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface SparePartUsage {
  id: string;
  name: string;
  code: string;
  spec: string;
  qty: number;
  unit: string;
  unitPrice: number;
}

/** 工单类型（fault_type 枚举口径 —— 建单页 6 宫格分类的来源） */
export type WorkOrderFaultType = WorkOrder['faultType'];

/**
 * 建单预填载荷（故障定位红色脉冲高亮 →「创建维修工单」跳转用）。
 * fields 全部来自真实遥测故障详情：设备 / 指标 / 严重度 / 观察部位，不造数据。
 */
export interface WorkOrderCreatePrefill {
  equipmentId: string;
  title: string;
  faultType: WorkOrderFaultType;
  priority: WorkOrderPriority;
  description: string;
}

export interface WorkOrder {
  id: string;
  orderNo: string;
  title: string;
  equipmentId: string;
  equipmentName: string;
  equipmentCode: string;
  workshop: string;
  faultType: '机械振动' | '轴承过热' | '电气短路' | '密封泄漏' | '结构磨损' | '控制系统异常' | '定期润滑维保';
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  creator: string;
  source?: 'manual' | 'inspection' | 'wx_scan' | string;
  dispatcher?: string;
  assignee?: string;
  assigneeId?: string;
  createdAt: string;
  dispatchedAt?: string;
  acceptedAt?: string;
  completedAt?: string;
  acceptedByInspectorAt?: string;
  description: string;
  version?: number;
  createdTimestamp?: number;
  photos?: string[];
  safetyRequirements?: string[];
  repairLog?: {
    causeAnalysis: string;
    resolutionSteps: string;
    partsUsed: SparePartUsage[];
    workHours: number;
    completionPhotos: string[];
    remark?: string;
  };
  acceptance?: {
    inspectorName: string;
    pass: boolean;
    score: number;      // 1 - 5 stars
    comment: string;
    signatureDate: string;
  };
}

export type InspectionTaskType = 'daily' | 'special' | 'monthly';
export type InspectionStatus = 'pending' | 'in_progress' | 'completed' | 'abnormal';

export interface InspectionItem {
  id: string;
  equipmentId: string;
  equipmentName: string;
  equipmentCode: string;
  location: string;
  checkPoint?: string;
  checkItem?: string;
  standard: string;
  method: '目视外观' | '红外测温' | '振动巡测' | '仪表抄表' | '异响辨识';
  unit?: string;
  minLimit?: number;
  maxLimit?: number;
  minVal?: number;
  maxVal?: number;
  recordedValue?: number | string;
  isPass?: boolean;
  status?: 'normal' | 'abnormal' | 'pending';
  notes?: string;
  photos?: string[];
}

// Alias for compatibility
export type InspectionPoint = InspectionItem;

export interface InspectionTask {
  id: string;
  taskNo: string;
  title: string;
  type: InspectionTaskType;
  inspectorId: string;
  inspectorName: string;
  workshop: string;
  route: string;
  scheduledDate: string;
  status: InspectionStatus;
  totalPoints: number;
  completedPoints: number;
  abnormalCount: number;
  items: InspectionItem[];
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
}

export type RiskLevel = 'I' | 'II' | 'III' | 'IV' | '较大风险 (Level 2)' | '重大风险 (Level 1)' | '一般风险 (Level 3)' | '低风险 (Level 4)' | string;

export type SafetyPermitType = 
  | 'hot_work'          // 动火作业
  | 'height_work'       // 高处作业
  | 'confined_space'    // 受限空间
  | 'loto'              // 停电挂牌 LOTO
  | 'lifting'           // 吊装作业
  | 'temporary_power';  // 临时用电

export interface LotoPoint {
  id: string;
  pointName: string;
  location: string;
  energyType: '380V动力电' | '10kV高压电' | '高压蒸汽' | '压缩空气' | '液压源';
  tagNo: string;
  lockNo: string;
  status: 'locked' | 'unlocked';
  lockedBy: string;
  lockedAt: string;
}

export interface SafetyPermit {
  id: string;
  permitNo: string;
  type?: SafetyPermitType;
  permitType?: any;
  title: string;
  riskLevel: any;
  equipmentId?: string;
  equipmentName?: string;
  location?: string;
  workshop: string;
  applicant: string;
  applicantDept?: string;
  applyTime?: string;
  appliedAt?: string;
  validFrom?: string;
  validTo?: string;
  validUntil?: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'active' | 'closed' | 'rejected';
  approver?: string;
  approvedAt?: string;
  guardianApproval?: {
    signed: boolean;
    name: string;
    role?: string;
    signedAt?: string;
    comment?: string;
    gasTestPassed?: boolean;
    signatureHash?: string;
    signatureMethod?: string;
  } | null;
  supervisorApproval?: {
    signed: boolean;
    name: string;
    role?: string;
    signedAt?: string;
    comment?: string;
    signatureHash?: string;
    signatureMethod?: string;
  } | null;
  hazards?: string[];
  safetyChecklist?: {
    item: string;
    checked: boolean;
  }[];
  lotoPoints?: LotoPoint[];
  lotoNumber?: string;
  specialPrecautions?: string;
  precautions?: string[] | string;
  gasTestResults?: {
    oxygen: number;        // %
    combustibleGas: number;// % LEL
    toxicGas: number;      // ppm
    tester: string;
    testTime: string;
  };
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  category: string;
  targetEquipment?: string;
  equipmentCategories?: string[];
  tags: string[];
  summary: string;
  content: string;
  author: string;
  updatedAt: string;
  viewCount?: number;
  views?: number;
  likes?: number;
  attachments?: {
    name: string;
    size: string;
    format: string;
  }[];
}

export interface FaultDiagnosisReport {
  severity: string;
  urgencyScore: number;
  summary: string;
  probableCauses: {
    cause: string;
    probability: string | number;
    detail?: string;
  }[];
  safetyPrecautions?: string[];
  recommendedActions: {
    step?: number;
    action: string;
    tools?: string;
    standard?: string;
    safetyNotes?: string;
  }[];
  spareParts?: {
    name: string;
    spec: string;
    qty: number;
    unit: string;
  }[];
  estimatedRepairTime?: string;
  estimatedRepairHours?: number;
}

export interface NotificationItem {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'alert' | 'warning' | 'success';
  time: string;
  read: boolean;
  refType?: string | null;
  refId?: string | null;
}

// LOTO 能量隔离锁具 (后端 loto_locks 表真实落库数据)
export interface LotoLock {
  id: string;
  lockNo: string;
  permitNo?: string | null;
  permitTitle?: string | null;
  pointName?: string | null;
  energySource?: string | null;
  location?: string | null;
  workshop?: string | null;
  lockedBy?: string | null;
  lockedAt?: string | null;
  status: 'locked' | 'unlocked' | string;
  unlockedAt?: string | null;
  unlockRemark?: string | null;
  // 智能物联网 LOTO 锁具物理硬件遥测与锁梁状态 (Smart Lockout IoT)
  hardwareType?: 'BLE_NFC_SMART_PADLOCK' | 'MANUAL_HASP_LOCK' | string;
  batteryLevel?: number; // 锁具电量百分比
  beamState?: 'LOCKED_ENGAGED' | 'RELEASED' | 'TAMPER_ALERT' | string; // 锁梁物理咬合传感器状态
  lastHeartbeat?: string; // 锁具基站通信心跳
}

// 生产环境安全审计日志数据模型 (Operation Audit Log)
export interface AuditLogItem {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: string;
  ip: string;
  actionType: string;
  module: string;
  detail: string;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  metadata?: Record<string, any>;
}

// DashScope / 视觉缺陷检测结构化分析结果
export interface VisionDefectResult {
  severity: '严重' | '较大' | '一般' | '轻微' | '正常';
  defectType: string;
  confidence: number;
  summary: string;
  location: string;
  probableCauses?: string[];
  recommendations: string[];
  safetyNotice?: string;
  modelEngine?: string;
  imageUrl?: string;
}

// Paraformer 语音识别转写结果
export interface SpeechToTextResult {
  success: boolean;
  text: string;
  confidence?: number;
  durationSeconds?: number;
  engine?: string;
}

// 标准化检修作业指引步骤
export interface ProcedureStep {
  step_no: number;
  name: string;
  content: string;
  tools?: string;
  safety?: string;
  acceptance?: string;
}

// 视频讲解分镜脚本
export interface VideoScript {
  title: string;
  duration_estimate?: number;
  voiceover: string[];
  subtitles: string[];
}

// 标准化检修作业指引模型
export interface MaintenanceProcedure {
  id: string;
  title: string;
  equipmentType: string;
  maintenanceLevel: string;
  steps: ProcedureStep[];
  estimatedMinutes?: number;
  script?: VideoScript | null;
  createdAt?: string;
  updatedAt?: string;
}

// 真实 AI 视频生成记录 (Agnes AI)
export interface ProcedureVideo {
  id: string;
  procedureId: string;
  taskId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | string;
  videoUrl?: string | null;
  prompt?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// 工单合规审查结果模型
export interface ComplianceViolation {
  type: string;
  detail: string;
  deduction: number;
}

export interface ComplianceCheck {
  id: string;
  workOrderId: string;
  operator?: string;
  deviceName?: string;
  violations: (string | ComplianceViolation)[] | any[];
  totalSteps?: number;
  passedSteps?: number;
  score: number;
  summary?: string;
  isCompliant?: boolean;
  suggestions?: string;
  checkedAt?: string;
  createdAt?: string;
}

// 合规与失误率统计
export interface ComplianceStats {
  totalOrders: number;
  totalAuditedOrders?: number;
  avgScore: number;
  mistakeRate: number;
  recentTrend: {
    date: string;
    orders: number;
    mistakeRate: number;
    avgScore: number;
  }[];
  topViolations: {
    name?: string;
    type?: string;
    count: number;
  }[];
}

// 视频多模态智能故障分析结果
export interface VideoAnalysisResult {
  device_part?: string;
  phenomenon?: string;
  causes?: string[];
  suggestions?: string[];
  confidence?: number;
  equipmentType?: string;
  faultType?: string;
  severity?: string;
  diagnosis?: string;
  possibleCauses?: string[];
  recommendations?: string[];
}

// 知识图谱节点与边
export interface KnowledgeGraphNode {
  id: string;
  entity_type: '设备' | '故障' | '方法' | '备件' | '部件' | string;
  entity_name: string;
  article_id: string;
  article_title?: string;
  article_content?: string;
  created_at?: string;
}

export interface KnowledgeGraphEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation: string;
  article_id: string;
  created_at?: string;
}

// AI 纠错反馈
export interface AiFeedback {
  id: string;
  chat_id: string;
  model_response?: string;
  user_correction: string;
  corrected_content: string;
  device_id?: string;
  created_at?: string;
  status: 'pending' | 'adopted';
}

// 工业备件实体
export interface SparePart {
  id: string;
  name: string;
  code?: string;
  spec?: string;
  specification?: string;
  model?: string;
  category: string;
  stock: number;
  stockQuantity?: number;
  safe_stock: number;
  safeQuantity?: number;
  unit: string;
  location: string;
  price: number;
  compatible_models?: string | string[];
  target_equipment_type?: string;
  created_at?: string;
  updated_at?: string;
}

// 备件出入库流水
export interface SparePartMovement {
  id: string;
  part_id: string;
  partId?: string;
  type: 'in' | 'out';
  quantity: number;
  balance_after?: number;
  related_work_order_id?: string;
  work_order_id?: string;
  operator_name?: string;
  operator?: string;
  notes?: string;
  reason?: string;
  created_at: string;
}

// 现场安全隐患闭环
export interface Hazard {
  id: string;
  no?: string;
  code?: string;
  hazardNo?: string;
  title: string;
  equipment_id?: string;
  equipmentId?: string;
  equipment_name?: string;
  equipmentName?: string;
  location?: string;
  level: 'general' | 'major' | 'critical' | 'minor' | string;
  category?: string;
  description: string;
  discoverer?: string;
  reported_by?: string;
  reportedBy?: string;
  source?: 'inspection' | 'work_order' | 'report' | string;
  status: 'pending' | 'rectifying' | 'verifying' | 'closed' | string;
  related_work_order_id?: string;
  relatedWorkOrderId?: string;
  work_order_id?: string;
  deadline?: string;
  rectification_plan?: string;
  rectifier?: string;
  rectify_desc?: string;
  rectified_at?: string;
  verifier?: string;
  verify_comment?: string;
  closed_at?: string;
  created_at?: string;
  updated_at?: string;
}

// 2D 工业数字人形象
export interface DigitalHumanPersona {
  id: string;
  name: string;
  roleTitle: string;
  description: string;
  gender: 'male' | 'female';
  themeColor: string;
  avatarSvgType: 'zhang' | 'li' | 'zhi';
}

