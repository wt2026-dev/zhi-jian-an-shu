export type CapabilityType = 'chat' | 'vision' | 'video';

export const CAP_LABELS: Record<string, string> = {
  chat: '对话',
  vision: '视觉',
  video: '视频',
};

export const HEALTH_META: Record<string, { label: string; cls: string }> = {
  healthy: { label: '健康', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  unhealthy: { label: '异常', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  unknown: { label: '未检测', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};

export interface TestResult {
  id: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ModelFormData {
  provider: string;
  displayName: string;
  baseUrl: string;
  modelName: string;
  apiKey: string;
  apiKeyEnv: string;
  capabilities: CapabilityType[];
  enabled: boolean;
}
