import { useState, useEffect, useCallback } from 'react';
import { Equipment, UserProfile } from '../../types';
import { equipmentApi, aiApi } from '../../api';
import { isDemoMode } from '../../utils/demoMode';
import { logger } from '../../utils/logger';
import {
  TelemetrySample,
  ForecastModalState,
  DraftModalState,
  SummaryModalState,
  AlarmCorrelationModalState,
  AiSafetyNoticeData,
  AiDiagTraceabilityData,
  fmtReading,
} from './healthTypes';

interface TelemetryHistoryResponse {
  equipmentId?: string;
  points?: Array<{
    timestamp?: string;
    time?: string;
    temperature?: number | null;
    vibration?: number | null;
    current?: number | null;
    voltage?: number | null;
    loadRate?: number | null;
  }>;
}

interface UseEquipmentHealthProps {
  equipments: Equipment[];
  selectedEquipmentId?: string;
  onOpenWorkOrder: (eq: Equipment) => void;
  onOpenAiDiagnose: (eq: Equipment) => void;
  onCreateWorkOrder: (wo: unknown) => void;
  onNavigateTo3D?: (equipmentId: string) => void;
  currentUser?: UserProfile;
}

export function useEquipmentHealth({
  equipments,
  selectedEquipmentId,
  onCreateWorkOrder,
}: UseEquipmentHealthProps) {
  const [activeEqId, setActiveEqId] = useState<string>(
    selectedEquipmentId || equipments[0]?.id || 'eq-001'
  );
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [sampleSpeed, setSampleSpeed] = useState<number>(2000); // ms
  const [historyData, setHistoryData] = useState<TelemetrySample[]>([]);
  const [loadingTelemetry, setLoadingTelemetry] = useState<boolean>(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiSafetyNotice, setAiSafetyNotice] = useState<AiSafetyNoticeData | null>(null);
  const [aiDiagTraceability, setAiDiagTraceability] = useState<AiDiagTraceabilityData | null>(null);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<string | null>(null);
  const [selectedChartPoint, setSelectedChartPoint] = useState<TelemetrySample | null>(null);

  // AI 弹窗状态
  const [forecastState, setForecastState] = useState<ForecastModalState>({
    open: false,
    loading: false,
    error: null,
  });

  const [draftState, setDraftState] = useState<DraftModalState>({
    open: false,
    loading: false,
    error: null,
  });

  const [summaryState, setSummaryState] = useState<SummaryModalState>({
    open: false,
    loading: false,
    error: null,
  });

  const [corrState, setCorrState] = useState<AlarmCorrelationModalState>({
    open: false,
    loading: false,
    error: null,
  });

  const currentEquipment = equipments.find((e) => e.id === activeEqId) || equipments[0];

  // 从真实后端接口加载设备24小时时序遥测指标 (替换硬编码假数据)
  const fetchTelemetryHistory = useCallback(async (eqId: string) => {
    setLoadingTelemetry(true);
    try {
      const res = (await equipmentApi.getTelemetryHistory(eqId)) as TelemetryHistoryResponse;
      if (res && Array.isArray(res.points) && res.points.length > 0) {
        const points: TelemetrySample[] = res.points.map((p) => ({
          time: p.timestamp || p.time || '12:00',
          // 缺测就是 null（图表断线、读数显示 —），不补"看起来合理"的默认值
          temperature: p.temperature ?? null,
          vibration: p.vibration ?? null,
          current: p.current ?? null,
          voltage: p.voltage ?? null,
          loadRate: p.loadRate ?? null,
        }));
        setHistoryData(points);
        return;
      }
    } catch (err) {
      logger.warn('Backend telemetry-history fetch fallback:', err);
    } finally {
      setLoadingTelemetry(false);
    }

    // 无真实遥测数据且未开启模拟时置空，展示标准空态，坚决不得用伪造数据填充
    setHistoryData([]);
  }, []);

  useEffect(() => {
    if (activeEqId) {
      void fetchTelemetryHistory(activeEqId);
    }
  }, [activeEqId, fetchTelemetryHistory]);

  const demo = isDemoMode();

  // Live simulation tick (仅在显式开启模拟且在演示模式下执行)
  useEffect(() => {
    if (!isSimulating || !currentEquipment) return;

    // 若当前没有时序数据，在开启模拟时注入基准点
    const initTimer = setTimeout(() => {
      setHistoryData((prev) => {
        if (prev.length > 0) return prev;
        const baseTemp = currentEquipment.telemetry?.temperature || 65;
        const baseVib = currentEquipment.telemetry?.vibration || 2.4;
        const baseCur = currentEquipment.telemetry?.current || 48;
        const baseVolt = currentEquipment.telemetry?.voltage || 380;
        const baseLoad = currentEquipment.telemetry?.loadRate || 72;
        const initial: TelemetrySample[] = [];
        const now = new Date();
        for (let i = 12; i >= 0; i--) {
          const t = new Date(now.getTime() - i * 3600 * 1000);
          initial.push({
            time: `${t.getHours().toString().padStart(2, '0')}:00`,
            temperature: +baseTemp.toFixed(1),
            vibration: +baseVib.toFixed(2),
            current: +baseCur.toFixed(1),
            voltage: +baseVolt.toFixed(1),
            loadRate: +baseLoad.toFixed(1),
          });
        }
        return initial;
      });
    }, 0);

    const interval = setInterval(() => {
      const now = new Date();
      const timeLabel = now.toTimeString().split(' ')[0];
      const baseTemp = currentEquipment.telemetry?.temperature ?? 65;
      const baseVib = currentEquipment.telemetry?.vibration ?? 2.4;
      const baseCur = currentEquipment.telemetry?.current ?? 48;
      const baseVolt = currentEquipment.telemetry?.voltage ?? 380;
      const baseLoad = currentEquipment.telemetry?.loadRate ?? 72;

      // Random industrial noise fluctuation
      const noise = (Math.random() - 0.48) * 2;
      const newPoint: TelemetrySample = {
        time: timeLabel,
        temperature: +(baseTemp + noise * 0.8).toFixed(1),
        vibration: +(Math.max(0.2, baseVib + noise * 0.35)).toFixed(2),
        current: +(baseCur + noise * 1.5).toFixed(1),
        voltage: +(baseVolt + noise * 1.2).toFixed(1),
        loadRate: +(Math.min(100, Math.max(10, baseLoad + noise * 2.5))).toFixed(1),
      };

      setHistoryData((prev) => [...prev.slice(1), newPoint]);
    }, sampleSpeed);

    return () => {
      clearTimeout(initTimer);
      clearInterval(interval);
    };
  }, [isSimulating, sampleSpeed, currentEquipment]);

  // 没有落库时序时退回设备档案里的当前遥测（真实数据）
  const latest: TelemetrySample =
    historyData[historyData.length - 1] || {
      time: '—',
      temperature: currentEquipment?.telemetry?.temperature ?? null,
      vibration: currentEquipment?.telemetry?.vibration ?? null,
      current: currentEquipment?.telemetry?.current ?? null,
      voltage: currentEquipment?.telemetry?.voltage ?? null,
      loadRate: currentEquipment?.telemetry?.loadRate ?? null,
    };

  // 阈值告警只在有值时判定
  const isVibAlert = latest.vibration != null && latest.vibration > 4.5;
  const isTempAlert = latest.temperature != null && latest.temperature > 75;
  const isCurrentAlert = latest.loadRate != null && latest.loadRate > 90;

  const handleSelectEquipment = (id: string) => {
    setActiveEqId(id);
    setAiAnalysisResult(null);
  };

  const handleEquipmentSummary = async () => {
    const eq = equipments.find((e) => e.id === activeEqId);
    if (!eq) return;
    setSummaryState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.equipmentSummary({ equipmentId: eq.id });
      if (res.success && res.summary) {
        setSummaryState({ open: true, loading: false, error: null, data: res.summary });
      } else {
        setSummaryState({ open: true, loading: false, error: res.message || res.error || 'AI 健康画像生成失败', degraded: res.degraded });
      }
    } catch (err: unknown) {
      setSummaryState({ open: true, loading: false, error: err instanceof Error ? err.message : 'AI 调用失败' });
    }
  };

  const handleAlarmCorrelation = async () => {
    const alarmEquipments = equipments.filter((e) => e.status === 'warning' || e.status === 'fault');
    if (alarmEquipments.length < 2) return;
    const alarms = alarmEquipments.map((e) => ({
      equipmentId: e.id,
      alarmType: e.status === 'fault' ? '设备故障停机' : '运行参数预警',
      value: { healthScore: e.healthScore, temperature: e.telemetry.temperature, vibration: e.telemetry.vibration, loadRate: e.telemetry.loadRate },
      timestamp: e.telemetry.lastUpdated || new Date().toLocaleString('zh-CN'),
    }));
    setCorrState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.alarmCorrelation({ alarms });
      if (res.success && res.analysis) {
        setCorrState({ open: true, loading: false, error: null, data: res.analysis });
      } else {
        setCorrState({ open: true, loading: false, error: res.message || res.error || 'AI 关联分析失败', degraded: res.degraded });
      }
    } catch (err: unknown) {
      setCorrState({ open: true, loading: false, error: err instanceof Error ? err.message : 'AI 调用失败' });
    }
  };

  const handleHealthForecast = async () => {
    const eq = equipments.find((e) => e.id === activeEqId);
    if (!eq) return;
    setForecastState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.healthForecast({ equipmentId: eq.id, hours: 168 });
      if (res.success && res.forecast) {
        setForecastState({ open: true, loading: false, error: null, data: res.forecast });
      } else {
        setForecastState({ open: true, loading: false, error: res.message || res.error || 'AI 劣化趋势分析失败', degraded: res.degraded });
      }
    } catch (err: unknown) {
      setForecastState({ open: true, loading: false, error: err instanceof Error ? err.message : 'AI 调用失败' });
    }
  };

  const handleAiDraftWorkOrder = async () => {
    const eq = equipments.find((e) => e.id === activeEqId);
    if (!eq) return;
    const desc = `健康监测发现「${eq.name} (${eq.code})」异常: 当前健康分 ${eq.healthScore}/100, 状态 ${eq.status}, 轴承温度 ${eq.telemetry.temperature}°C, 振动 ${eq.telemetry.vibration}mm/s, 负载率 ${eq.telemetry.loadRate}%，请生成检修工单草稿。`;
    setDraftState({
      open: true,
      loading: true,
      error: null,
      draft: null,
      equipment: {
        id: eq.id,
        name: eq.name,
        code: eq.code,
        workshop: eq.workshop || '默认车间',
      },
    });
    try {
      const res = await aiApi.generateWorkOrder({ equipmentId: eq.id, abnormalDescription: desc, telemetrySnapshot: eq.telemetry });
      if (res.success && res.draft) {
        setDraftState((prev) => ({ ...prev, loading: false, draft: res.draft }));
      } else {
        setDraftState((prev) => ({ ...prev, loading: false, error: res.message || res.error || 'AI 生成失败', degraded: res.degraded }));
      }
    } catch (err: unknown) {
      setDraftState((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'AI 调用失败' }));
    }
  };

  const runAiAnalysis = async () => {
    if (!currentEquipment) return;
    setAiAnalyzing(true);
    setAiAnalysisResult(null);
    setAiSafetyNotice(null);
    setAiDiagTraceability(null);
    try {
      const res = await fetch('/api/v1/ai/diagnose', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          equipmentName: currentEquipment.name,
          equipmentCode: currentEquipment.code,
          category: currentEquipment.category,
          symptoms: `现场监测遥测数据: 轴温 ${fmtReading(latest.temperature, '°C')}, 振动速度 ${fmtReading(latest.vibration, 'mm/s')}, 负荷率 ${fmtReading(latest.loadRate, '%')}`,
          telemetry: latest,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        diagnosis?: {
          summary?: string;
          severity?: string;
          urgencyScore?: number;
          probableCauses?: Array<{ cause?: string }>;
          recommendedActions?: Array<{ action?: string }>;
        };
        safetyNotice?: AiSafetyNoticeData;
        traceability?: AiDiagTraceabilityData;
        message?: string;
      };
      if (data.success && data.diagnosis) {
        setAiSafetyNotice(data.safetyNotice || null);
        setAiDiagTraceability(data.traceability || null);
        setAiAnalysisResult(
          `【AI 研判结论】${data.diagnosis.summary}\n【紧急程度】${data.diagnosis.severity} (风险分值 ${data.diagnosis.urgencyScore})\n【首要原因】${data.diagnosis.probableCauses?.[0]?.cause || '轴承与对中磨损'}\n【建议措施】${data.diagnosis.recommendedActions?.[0]?.action || '停机检查'}`
        );
      } else {
        setAiAnalysisResult(`研判失败: ${data.message || '未知错误'}`);
      }
    } catch (err: unknown) {
      setAiAnalysisResult(`网络异常或服务暂不可用: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleCreatedWorkOrder = (wo: unknown) => {
    onCreateWorkOrder?.(wo);
  };

  return {
    activeEqId,
    currentEquipment,
    isSimulating,
    setIsSimulating,
    sampleSpeed,
    setSampleSpeed,
    historyData,
    loadingTelemetry,
    latest,
    isVibAlert,
    isTempAlert,
    isCurrentAlert,
    aiAnalyzing,
    aiSafetyNotice,
    aiDiagTraceability,
    aiAnalysisResult,
    selectedChartPoint,
    setSelectedChartPoint,
    forecastState,
    setForecastState,
    draftState,
    setDraftState,
    summaryState,
    setSummaryState,
    corrState,
    setCorrState,
    demo,
    fetchTelemetryHistory,
    handleSelectEquipment,
    handleEquipmentSummary,
    handleAlarmCorrelation,
    handleHealthForecast,
    handleAiDraftWorkOrder,
    runAiAnalysis,
    handleCreatedWorkOrder,
  };
}
