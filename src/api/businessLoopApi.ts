/**
 * Hermes 智能业务管家 - 真实后端接口封装（/api/v1/business-loops）
 *
 * 数据纪律：不提供任何 Mock/演示数据；后端不可达或接口报错时抛出异常（含「无法连接后端服务」指引），由页面如实展示，不用假数据兜底。
 */
import { request, ApiError } from './index';
import type {
  BusinessClosedLoopData,
  HistoryLoopItem,
  LotoFieldDraft,
  StageHumanEdits,
} from '../components/hermes/types';

/** 闭环列表摘要（/history 与列表页共用；详情字段走 detail） */
export interface BusinessLoopSummary {
  id: string;
  loopNo: string;
  goal: string;
  equipmentId: string | null;
  equipmentName: string | null;
  status: 'running' | 'paused' | 'archived';
  currentStage: number;
  startedAt: string | null;
  expectedMinutes: number | null;
  completedAt: string | null;
  initiatorName: string | null;
}

export const businessLoopApi = {
  /** 进行中/按状态过滤的闭环列表 */
  list: (params?: { status?: 'running' | 'paused' | 'archived'; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.limit) query.append('limit', String(params.limit));
    const qs = query.toString();
    return request<BusinessLoopSummary[]>(`/business-loops${qs ? `?${qs}` : ''}`);
  },

  /** 闭环详情（六环节 + AI 预填 + 产出物，前端唯一数据源） */
  getById: (id: string) => request<BusinessClosedLoopData>(`/business-loops/${id}`),

  /** 新建业务闭环：服务端解析目标 → 建六环节 → 异步 AI 预填 */
  create: (data: { goal: string; equipmentId?: string }) =>
    request<BusinessClosedLoopData>('/business-loops', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * 人工确认闸门：校验当前环节，置 completed 并推进。
   * edits 为确认人当场修订的 AI 预填字段（服务端白名单逐字段采纳），无修订时传空。
   */
  confirmStage: (id: string, stageNo: number, edits?: StageHumanEdits) =>
    request<BusinessClosedLoopData>(`/business-loops/${id}/stages/${stageNo}/confirm`, {
      method: 'POST',
      body: JSON.stringify(edits && Object.keys(edits).length ? { edits } : {}),
    }),

  /** LOTO 隔离点逐项确认（环节 3；确认人由服务端会话取，fields 为现场登记字段修订） */
  toggleLotoItem: (id: string, data: { itemId: string; confirmed: boolean; fields?: LotoFieldDraft }) =>
    request<BusinessClosedLoopData>(`/business-loops/${id}/loto-confirm`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  /** LOTO 隔离点现场补登（AI/JSA 清单漏项，来源如实标人工登记） */
  addLotoItem: (id: string, data: { type: string; point: string; requirement?: string; lockNumber?: string }) =>
    request<BusinessClosedLoopData>(`/business-loops/${id}/loto-items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 归档闭环：质检报告 + 知识沉淀，产出物写入档案 */
  complete: (id: string) =>
    request<BusinessClosedLoopData>(`/business-loops/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** 历史闭环（已归档） */
  history: () => request<HistoryLoopItem[]>('/business-loops/history'),
};

export { ApiError };
