/**
 * Hermes 智能业务管家 - 真实后端接口封装（/api/v1/business-loops）
 *
 * 数据纪律：不提供任何 Mock/演示数据；后端不可达或接口报错时抛出异常（含「无法连接后端服务」指引），由页面如实展示，不用假数据兜底。
 */
import { request, ApiError } from './index';
import type {
  BusinessClosedLoopData,
  HistoryLoopItem,
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

  /** 人工确认闸门：校验当前环节，置 completed 并推进 */
  confirmStage: (id: string, stageNo: number) =>
    request<BusinessClosedLoopData>(`/business-loops/${id}/stages/${stageNo}/confirm`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** LOTO 隔离点逐项确认（环节 3，操作人由服务端会话取） */
  toggleLotoItem: (id: string, data: { itemId: string; confirmed: boolean }) =>
    request<BusinessClosedLoopData>(`/business-loops/${id}/loto-confirm`, {
      method: 'PATCH',
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
