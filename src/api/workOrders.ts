import type { WorkOrder } from '../types';
import { API_BASE, request } from './client';

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

/** Work-order HTTP contract. */
export const workOrderApi = {
  list: (params?: { status?: string; priority?: string; equipment_id?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    if (params?.priority && params.priority !== 'all') query.append('priority', params.priority);
    if (params?.equipment_id) query.append('equipment_id', params.equipment_id);
    if (params?.search) query.append('search', params.search);
    const qs = query.toString();
    return request<WorkOrder[]>(`/work-orders${qs ? `?${qs}` : ''}`);
  },
  getStats: () => request<WorkOrderStats>('/work-orders/stats'),
  getById: (id: string) => request<WorkOrder>(`/work-orders/${id}`),
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
  }) => request<WorkOrder>('/work-orders', { method: 'POST', body: JSON.stringify(data) }),
  dispatch: (id: string, data: {
    assigneeId: string;
    assigneeName?: string;
    dispatcher?: string;
    estimatedHours?: number;
    version?: number;
  }) => request<WorkOrder>(`/work-orders/${id}/dispatch`, { method: 'POST', body: JSON.stringify(data) }),
  claim: (id: string, data?: { operatorName?: string; version?: number }) =>
    request<WorkOrder>(`/work-orders/${id}/claim`, { method: 'POST', body: JSON.stringify(data || {}) }),
  complete: (id: string, data: {
    causeAnalysis: string;
    resolutionSteps: string;
    partsUsed?: any[];
    workHours: number;
    completionPhotos?: string[];
    remark?: string;
    operatorName?: string;
    version?: number;
  }) => request<WorkOrder>(`/work-orders/${id}/complete`, { method: 'POST', body: JSON.stringify(data) }),
  accept: (id: string, data: {
    inspectorName?: string;
    pass: boolean;
    score: number;
    comment: string;
    version?: number;
  }) => request<WorkOrder>(`/work-orders/${id}/accept`, { method: 'POST', body: JSON.stringify(data) }),
  transitionStatus: (id: string, data: {
    targetStatus: string;
    operatorName?: string;
    comment?: string;
    version?: number;
  }) => request<WorkOrder>(`/work-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<{ success: boolean; message: string }>(`/work-orders/${id}`, { method: 'DELETE' }),
  exportExcel: async (params?: { status?: string; priority?: string; workshop?: string }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    if (params?.priority && params.priority !== 'all') query.append('priority', params.priority);
    if (params?.workshop && params.workshop !== 'all') query.append('workshop', params.workshop);
    const qs = query.toString();
    const response = await fetch(`${API_BASE}/work-orders/export${qs ? `?${qs}` : ''}`, {
      method: 'GET', credentials: 'include',
    });
    if (!response.ok) throw new Error(`导出工单台账失败: HTTP ${response.status}`);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `工业设备检修工单台账_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    return true;
  },
};
