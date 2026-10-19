import type { Equipment } from '../types';
import { API_BASE, request } from './client';

/** Equipment registry and telemetry HTTP contract. */
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
  getTelemetryHistory: (id: string, hours?: number) =>
    request<any>(`/equipments/${id}/telemetry-history${hours ? `?hours=${hours}` : ''}`),
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
  }) => request<Equipment>('/equipments', { method: 'POST', body: JSON.stringify(data) }),
};
