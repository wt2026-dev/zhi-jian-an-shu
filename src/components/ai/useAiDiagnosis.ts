import { useState } from 'react';
import type { Equipment } from '../../types';

export function useAiDiagnosis(
  equipments: Equipment[],
  prefilledEquipment?: Equipment | null
) {
  const [diagEqId, setDiagEqId] = useState<string>(
    prefilledEquipment?.id || equipments[0]?.id || ''
  );
  const [diagSymptoms, setDiagSymptoms] = useState('机组带载运行时轴承座伴随规律性低频轰鸣与剧烈振动');
  const [diagCategory, setDiagCategory] = useState('泵类设备');
  const [diagResult, setDiagResult] = useState<Record<string, unknown> | null>(null);
  const [diagSafetyNotice, setDiagSafetyNotice] = useState<Record<string, unknown> | null>(null);
  const [diagTraceability, setDiagTraceability] = useState<Record<string, unknown> | null>(null);
  const [diagSafetyConfirmed, setDiagSafetyConfirmed] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);

  const handleRunDiagnosis = async () => {
    setIsDiagnosing(true);
    setDiagResult(null);
    setDiagSafetyNotice(null);
    setDiagTraceability(null);
    setDiagSafetyConfirmed(false);
    setDiagError(null);

    const targetEq = equipments.find((e) => e.id === diagEqId) || equipments[0];

    try {
      const res = await fetch('/api/v1/ai/diagnose', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          equipmentName: targetEq.name,
          equipmentCode: targetEq.code,
          category: diagCategory,
          symptoms: diagSymptoms,
          telemetry: targetEq.telemetry,
        }),
      });

      const data = await res.json();
      if (data.success && data.diagnosis) {
        setDiagResult(data.diagnosis);
        setDiagSafetyNotice(data.safetyNotice || null);
        setDiagTraceability(data.traceability || null);
        setDiagSafetyConfirmed(false);
      } else {
        throw new Error(data?.error || 'AI 诊断服务未返回有效结论');
      }
    } catch (e: unknown) {
      // 绝不本地伪造诊断结论兜底，失败必须明确提示用户
      setDiagError((e as Error)?.message || 'AI 多维诊断请求失败，请稍后重试');
    } finally {
      setIsDiagnosing(false);
    }
  };

  return {
    diagEqId,
    setDiagEqId,
    diagSymptoms,
    setDiagSymptoms,
    diagCategory,
    setDiagCategory,
    diagResult,
    diagSafetyNotice,
    diagTraceability,
    diagSafetyConfirmed,
    setDiagSafetyConfirmed,
    isDiagnosing,
    diagError,
    handleRunDiagnosis,
  };
}
