import { Equipment, UserProfile } from '../../types';
import {
  AiHealthForecast,
  AiWorkOrderDraft,
  AiEquipmentSummary,
  AiAlarmCorrelation,
} from '../../api';

export interface EquipmentHealthViewProps {
  equipments: Equipment[];
  selectedEquipmentId?: string;
  onOpenWorkOrder: (eq: Equipment) => void;
  onOpenAiDiagnose: (eq: Equipment) => void;
  onCreateWorkOrder: (wo: unknown) => void;
  onNavigateTo3D?: (equipmentId: string) => void;
  currentUser?: UserProfile;
}

export interface TelemetrySample {
  time: string;
  // ⚠️ 允许 null：equipment_telemetry 表里各字段无 NOT NULL，缺测必须为 null，绝不能填假默认值
  temperature: number | null;
  vibration: number | null;
  current: number | null;
  voltage: number | null;
  loadRate: number | null;
}

export interface ForecastModalState {
  open: boolean;
  loading: boolean;
  error: string | null;
  degraded?: boolean;
  data?: AiHealthForecast | null;
}

export interface DraftModalState {
  open: boolean;
  loading: boolean;
  error: string | null;
  degraded?: boolean;
  draft?: AiWorkOrderDraft | null;
  equipment?: {
    id: string;
    name: string;
    code: string;
    workshop: string;
  } | null;
}

export interface SummaryModalState {
  open: boolean;
  loading: boolean;
  error: string | null;
  degraded?: boolean;
  data?: AiEquipmentSummary | null;
}

export interface AlarmCorrelationModalState {
  open: boolean;
  loading: boolean;
  error: string | null;
  degraded?: boolean;
  data?: AiAlarmCorrelation | null;
}

export interface AiSafetyNoticeData {
  required?: boolean;
  reason?: string;
  degraded?: boolean;
}

export interface AiDiagTraceabilityData {
  model?: string;
  promptVersion?: string;
}

/** 读数格式化：缺测显示 —（与 DeviceAnalysisPanel 同一口径），不补零、不估算。 */
export function fmtReading(value: number | null | undefined, unit: string): string {
  return value == null ? '—' : `${value}${unit}`;
}
