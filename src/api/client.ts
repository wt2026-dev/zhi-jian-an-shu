import { FORBIDDEN_HINT } from '../utils/rbac';

/** Shared HTTP transport. Domain API modules must depend on this file, never on the barrel. */
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

// Browser sandbox and cross-origin iframe fallback storage.
const memoryStorage = new Map<string, string>();

export const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(key);
    } catch {
      // Sandboxed iframe or privacy settings may deny localStorage.
    }
    return memoryStorage.get(key) || null;
  },
  setItem: (key: string, value: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(key, value);
    } catch {
      // The in-memory fallback below remains available.
    }
    memoryStorage.set(key, value);
  },
  removeItem: (key: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(key);
    } catch {
      // The in-memory fallback below remains available.
    }
    memoryStorage.delete(key);
  },
};

export const API_BASE = '/api/v1';

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });

  if (!response.ok) {
    let errorData: ApiErrorResponse = {};
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }
    if (response.status === 403) {
      const forbidden = new ApiError(403, errorData);
      const backendMsg = errorData.message || errorData.error;
      forbidden.message = backendMsg ? `${FORBIDDEN_HINT}（${backendMsg}）` : FORBIDDEN_HINT;
      throw forbidden;
    }
    throw new ApiError(response.status, errorData);
  }

  return response.json();
}
