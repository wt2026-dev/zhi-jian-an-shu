import { useState } from 'react';
import { SafetyPermit } from '../../types';
import { aiApi, AiSafetyAssessment } from '../../api';

interface RiskAssessState {
  open: boolean;
  loading: boolean;
  error: string | null;
  degraded?: boolean;
  reviewId?: string | null;
  data?: AiSafetyAssessment | null;
}

export function useSafetyAi() {
  const [riskAssessState, setRiskAssessState] = useState<RiskAssessState>({
    open: false,
    loading: false,
    error: null,
  });

  const applyRiskAssessment = (res: {
    success: boolean;
    assessment?: AiSafetyAssessment;
    message?: string;
    error?: string;
    degraded?: boolean;
    reviewId?: string | null;
  }) => {
    if (res.success && res.assessment) {
      setRiskAssessState({ open: true, loading: false, error: null, data: res.assessment, reviewId: res.reviewId });
    } else {
      setRiskAssessState({
        open: true,
        loading: false,
        error: res.message || res.error || 'AI 风险评估失败',
        degraded: res.degraded,
      });
    }
  };

  const handleAssessFromForm = async (params: {
    permitType: string;
    equipmentId: string;
    title: string;
    workshop: string;
    location: string;
  }) => {
    setRiskAssessState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.safetyRiskAssessment({
        permitType: params.permitType,
        equipmentId: params.equipmentId,
        workDescription: params.title || `${params.permitType}作业`,
        location: `${params.workshop} · ${params.location || '现场'}`,
        hazards: [],
      });
      applyRiskAssessment(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI 调用失败';
      setRiskAssessState({ open: true, loading: false, error: msg });
    }
  };

  const handleAssessFromPermit = async (permit: SafetyPermit) => {
    setRiskAssessState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.safetyRiskAssessment({
        permitType: permit.permitType || '动火作业票',
        equipmentId: permit.equipmentId,
        workDescription: permit.title,
        location: `${permit.workshop} · ${permit.location || '现场'}`,
        hazards: Array.isArray(permit.hazards) ? permit.hazards : [],
      });
      applyRiskAssessment(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI 调用失败';
      setRiskAssessState({ open: true, loading: false, error: msg });
    }
  };

  const applyAiMeasuresToForm = <T extends { precautions?: string[] }>(
    setFormData: React.Dispatch<React.SetStateAction<T>>
  ) => {
    const data = riskAssessState.data;
    if (!data) return;
    const measures = (data.jsaMeasures || []).map((m) => `${m.hazard}: ${m.control}`);
    if (!measures.length) return;
    setFormData((prev) => ({ ...prev, precautions: [...(prev.precautions || []), ...measures] }));
    setRiskAssessState((prev) => ({ ...prev, open: false }));
  };

  return {
    riskAssessState,
    setRiskAssessState,
    handleAssessFromForm,
    handleAssessFromPermit,
    applyAiMeasuresToForm,
  };
}
