import { useState } from 'react';
import { InspectionItem, Equipment, UserProfile } from '../../types';
import { aiApi, hazardsApi, AiReport, AiWorkOrderDraft } from '../../api';
import { useToast } from '../../context/ToastContext';

export function useInspectionAi() {
  const { show: showToast } = useToast();

  const [reportState, setReportState] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    degraded?: boolean;
    reviewId?: string | null;
    data?: AiReport | null;
  }>({ open: false, loading: false, error: null });

  const [aiDraftState, setAiDraftState] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    degraded?: boolean;
    draft?: AiWorkOrderDraft | null;
    equipment?: { id: string; name: string; code: string; workshop: string } | null;
  }>({ open: false, loading: false, error: null });

  const [hazardNotice, setHazardNotice] = useState<string | null>(null);

  const handleConvertAbnormalToHazard = async (pt: InspectionItem, currentUser: UserProfile) => {
    try {
      await hazardsApi.create({
        code: `HAZ-INSP-${Date.now().toString().slice(-5)}`,
        title: `【巡检发现异常】${pt.equipmentName} ${pt.checkPoint || pt.checkItem}超标`,
        level: 'general',
        category: '机械安全',
        equipment_id: pt.equipmentId,
        equipment_name: pt.equipmentName,
        location: '巡检现场',
        description: `日常巡检中发现测点异常：标准要求「${pt.standard}」，实测值「${pt.recordedValue || '超标'} ${pt.unit || ''}」，已超出安全控制阈值。`,
        reported_by: currentUser.name,
        // 不写死处置期限：让派单人来定。空 deadline 会在隐患清单里显示"未设期限"，
      // 由派发步骤补上；写死一个过去日期会让所有隐患一入库就显示"逾期"，那才是编数据。
      deadline: null,
      });
      setHazardNotice(`✅ 测点 [${pt.equipmentName} - ${pt.checkPoint || pt.checkItem}] 已成功转入现场安全隐患闭环治理中枢！`);
      setTimeout(() => setHazardNotice(null), 3500);
    } catch (err: unknown) {
      const errorObj = err as { message?: string } | undefined;
      showToast({ type: 'error', title: '转报隐患失败', message: errorObj?.message || '网络异常' });
    }
  };

  const handleInspectionReport = async (workshop?: string) => {
    const end = new Date();
    const start = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
    setReportState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.generateReport({
        reportType: 'inspection',
        startDate: fmt(start),
        endDate: fmt(end),
        workshop,
      });
      if (res.success && res.report) {
        setReportState({ open: true, loading: false, error: null, data: res.report, reviewId: res.reviewId });
      } else {
        setReportState({ open: true, loading: false, error: res.message || res.error || '报告生成失败', degraded: res.degraded });
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string } | undefined;
      setReportState({ open: true, loading: false, error: errorObj?.message || 'AI 调用失败' });
    }
  };

  const handleAiGenerateWorkOrder = async (point: InspectionItem, equipments: Equipment[]) => {
    const eq =
      equipments.find((e) => e.id === point.equipmentId) ||
      equipments.find((e) => e.name === point.equipmentName) ||
      equipments[0];
    if (!eq) return;
    const desc = `巡检点检发现异常: ${point.checkPoint || point.checkItem || point.equipmentName} 实测 ${point.recordedValue ?? '异常'} ${point.unit || ''} (标准 ${point.standard || point.minVal + '~' + point.maxVal || '限值'})，备注: ${point.notes || '无'}`;
    setAiDraftState({
      open: true,
      loading: true,
      error: null,
      draft: null,
      equipment: { id: eq.id, name: eq.name, code: eq.code, workshop: eq.workshop },
    });
    try {
      const res = await aiApi.generateWorkOrder({
        equipmentId: eq.id,
        abnormalDescription: desc,
        inspectionPointId: point.id,
        telemetrySnapshot: eq.telemetry,
      });
      if (res.success && res.draft) {
        setAiDraftState((prev) => ({ ...prev, loading: false, draft: res.draft }));
      } else {
        setAiDraftState((prev) => ({ ...prev, loading: false, error: res.message || res.error || 'AI 生成失败', degraded: res.degraded }));
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string } | undefined;
      setAiDraftState((prev) => ({ ...prev, loading: false, error: errorObj?.message || 'AI 调用失败' }));
    }
  };

  return {
    reportState,
    setReportState,
    aiDraftState,
    setAiDraftState,
    hazardNotice,
    setHazardNotice,
    handleConvertAbnormalToHazard,
    handleInspectionReport,
    handleAiGenerateWorkOrder,
  };
}
