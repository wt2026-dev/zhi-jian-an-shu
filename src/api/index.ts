import { WorkOrder, Equipment, InspectionTask, NotificationItem, LotoLock, UserProfile, SparePart, SparePartMovement, Hazard } from '../types';

export interface WorkOrderStats {
  totalCount: number;
  createdCount: number;
  dispatchedCount: number;
  inProgressCount: number;
  pendingAcceptanceCount: number;
  completedCount: number;
  cancelledCount: number;
  urgentCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  mttrHours: number;
  mtbfHours: number;
  completionRate: number;
}

export interface ApiErrorResponse {
  code?: string;
  message?: string;
  error?: string;
  existingOrder?: {
    id: string;
    orderNo: string;
    title: string;
    status: string;
    statusLabel?: string;
    priority: string;
    createdAt: string;
  };
  currentStatus?: string;
  targetStatus?: string;
  allowedStatuses?: string[];
}

export class ApiError extends Error {
  status: number;
  data: ApiErrorResponse;

  constructor(status: number, data: ApiErrorResponse) {
    super(data.message || data.error || `HTTP Error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// 浏览器沙盒与跨域 iframe 安全降级存储机制 (避免无权限引发 DOMException)
const memoryStorage = new Map<string, string>();

export const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {
      // 沙盒 iframe 或隐私设置阻止 localStorage
    }
    return memoryStorage.get(key) || null;
  },
  setItem: (key: string, value: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch (e) {
      // 沙盒 iframe 或隐私设置阻止 localStorage
    }
    memoryStorage.set(key, value);
  },
  removeItem: (key: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (e) {
      // 沙盒 iframe 或隐私设置阻止 localStorage
    }
    memoryStorage.delete(key);
  },
};

const API_BASE = '/api/v1';

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const token = safeStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });
  
  if (!response.ok) {
    let errorData: ApiErrorResponse = {};
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }
    throw new ApiError(response.status, errorData);
  }

  return response.json();
}


// 真实工单数据 API
export const workOrderApi = {
  // 获取工单列表
  list: (params?: { status?: string; priority?: string; equipment_id?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    if (params?.priority && params.priority !== 'all') query.append('priority', params.priority);
    if (params?.equipment_id) query.append('equipment_id', params.equipment_id);
    if (params?.search) query.append('search', params.search);
    const qs = query.toString();
    return request<WorkOrder[]>(`/work-orders${qs ? `?${qs}` : ''}`);
  },

  // 获取工单全局统计数据
  getStats: () => request<WorkOrderStats>('/work-orders/stats'),

  // 获取工单详情
  getById: (id: string) => request<WorkOrder>(`/work-orders/${id}`),

  // 创建工单 (含防重复报单校验)
  create: (data: {
    title: string;
    equipmentId: string;
    faultType: string;
    priority: string;
    description: string;
    safetyRequirements?: string[];
    creator?: string;
    forceSubmit?: boolean;
    idempotencyKey?: string;
  }) =>
    request<WorkOrder>('/work-orders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 主管派单 (状态互斥: created -> dispatched)
  dispatch: (id: string, data: {
    assigneeId: string;
    assigneeName?: string;
    dispatcher?: string;
    estimatedHours?: number;
    version?: number;
  }) =>
    request<WorkOrder>(`/work-orders/${id}/dispatch`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 技师接单 (状态互斥: dispatched -> in_progress)
  claim: (id: string, data?: { operatorName?: string; version?: number }) =>
    request<WorkOrder>(`/work-orders/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  // 技师完工上报 (状态互斥: in_progress -> pending_acceptance)
  complete: (id: string, data: {
    causeAnalysis: string;
    resolutionSteps: string;
    partsUsed?: any[];
    workHours: number;
    completionPhotos?: string[];
    remark?: string;
    operatorName?: string;
    version?: number;
  }) =>
    request<WorkOrder>(`/work-orders/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 质检验收闭环 (状态互斥: pending_acceptance -> completed / in_progress)
  accept: (id: string, data: {
    inspectorName?: string;
    pass: boolean;
    score: number;
    comment: string;
    version?: number;
  }) =>
    request<WorkOrder>(`/work-orders/${id}/accept`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 通用状态机互斥流转
  transitionStatus: (id: string, data: {
    targetStatus: string;
    operatorName?: string;
    comment?: string;
    version?: number;
  }) =>
    request<WorkOrder>(`/work-orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // 取消/删除工单
  delete: (id: string) =>
    request<{ success: boolean; message: string }>(`/work-orders/${id}`, {
      method: 'DELETE',
    }),

  // 导出工单台账至真实 Excel / CSV 文件
  exportExcel: async (params?: { status?: string; priority?: string; workshop?: string }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    if (params?.priority && params.priority !== 'all') query.append('priority', params.priority);
    if (params?.workshop && params.workshop !== 'all') query.append('workshop', params.workshop);
    const qs = query.toString();
    const endpoint = `/work-orders/export${qs ? `?${qs}` : ''}`;
    const token = safeStorage.getItem('auth_token');

    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`导出工单台账失败: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.download = `工业设备检修工单台账_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    return true;
  },
};

// 真实设备资产 API
export const equipmentApi = {
  list: (params?: { workshop?: string; status?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.workshop && params.workshop !== 'all') query.append('workshop', params.workshop);
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    if (params?.search) query.append('search', params.search);
    const qs = query.toString();
    return request<Equipment[]>(`/equipments${qs ? `?${qs}` : ''}`);
  },

  getById: (id: string) => request<Equipment>(`/equipments/${id}`),

  getQrCodeUrl: (id: string) => `${API_BASE}/equipments/${id}/qrcode`,

  getTelemetryHistory: (id: string) => request<any>(`/equipments/${id}/telemetry-history`),

  // 新增设备档案 (真实落库，RBAC: 仅管理员/主管)
  create: (data: {
    code: string;
    name: string;
    category: string;
    model?: string;
    workshop?: string;
    location?: string;
    manufacturer?: string;
    status?: string;
    criticality?: string;
    specs?: Record<string, string>;
  }) =>
    request<Equipment>('/equipments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// 认证与权限 API (JWT / RBAC)
export const authApi = {
  login: (credentials: { username: string; password: string }) =>
    request<{
      token: string;
      tokenType: string;
      expiresIn: number;
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

  getMe: () => request<any>('/auth/me'),

  getCurrentUser: () => request<any>('/auth/me'),

  getUsers: () => request<any[]>('/auth/users'),

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

  saveToken: (token: string) => {
    safeStorage.setItem('auth_token', token);
  },

  getToken: () => safeStorage.getItem('auth_token'),

  clearToken: () => {
    safeStorage.removeItem('auth_token');
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

  logout: () => {
    safeStorage.removeItem('auth_token');
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

  approve: (id: string, data: { step: 'guardian' | 'supervisor'; pass: boolean; comment?: string; gasTestResults?: any }) =>
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
  getVideoStatus: (taskId: string) =>
    request<{ status: string; videoUrl?: string; error?: string }>(
      `/procedures/video-status?taskId=${encodeURIComponent(taskId)}`
    ),
  getVideos: (id: string) =>
    request<any[]>(`/procedures/${id}/videos`),
  deleteVideo: (id: string) =>
    request<{ success: boolean; message: string }>(`/procedures/videos/${id}`, {
      method: 'DELETE',
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

  vision: (imageBase64: string, promptText?: string) =>
    request<{ success: boolean; analysis: any; model: string }>('/ai/vision', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, promptText }),
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
    request<{ success: boolean; degraded?: boolean; message?: string; plan?: AiMaintenancePlan; error?: string; model?: string }>(
      '/ai/generate-maintenance-plan',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 4：设备健康趋势预测
  healthForecast: (data: { equipmentId: string; hours?: number }) =>
    request<{ success: boolean; degraded?: boolean; message?: string; forecast?: AiHealthForecast; statistics?: Record<string, any>; dataPoints?: number; error?: string; model?: string }>(
      '/ai/health-forecast',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 5：智能报告生成 (巡检/检修/月度)
  generateReport: (data: { reportType: 'inspection' | 'maintenance' | 'monthly'; startDate: string; endDate: string; workshop?: string }) =>
    request<{ success: boolean; degraded?: boolean; message?: string; report?: AiReport; meta?: any; error?: string; model?: string }>(
      '/ai/generate-report',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // 功能 6：作业票 AI 风险评估 (JSA)
  safetyRiskAssessment: (data: { permitType: string; equipmentId?: string; workDescription: string; location?: string; hazards?: string[] }) =>
    request<{ success: boolean; degraded?: boolean; message?: string; assessment?: AiSafetyAssessment; error?: string; model?: string }>(
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
