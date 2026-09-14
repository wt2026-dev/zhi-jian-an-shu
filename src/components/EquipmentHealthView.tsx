import React, { useState, useEffect } from 'react';
import {
  Zap,
  Activity,
  AlertTriangle,
  Play,
  Pause,
  RefreshCw,
  Sparkles,
  Wrench,
  ShieldCheck,
  TrendingUp,
  Sliders,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import { Equipment, WorkOrder, UserProfile } from '../types';
import { equipmentApi, aiApi, safeStorage } from '../api';
import { AiResultModal } from './ai/AiResultModal';
import { AiWorkOrderDraftModal } from './ai/AiWorkOrderDraftModal';
import { AiHealthForecast, AiWorkOrderDraft, AiEquipmentSummary, AiAlarmCorrelation } from '../api';
import { isDemoMode } from '../utils/demoMode';

interface EquipmentHealthViewProps {
  equipments: Equipment[];
  selectedEquipmentId?: string;
  onOpenWorkOrder: (eq: Equipment) => void;
  onOpenAiDiagnose: (eq: Equipment) => void;
  onCreateWorkOrder: (wo: any) => void;
  currentUser?: UserProfile;
}

interface TelemetrySample {
  time: string;
  temperature: number;
  vibration: number;
  current: number;
  voltage: number;
  loadRate: number;
}

export const EquipmentHealthView: React.FC<EquipmentHealthViewProps> = ({
  equipments,
  selectedEquipmentId,
  onOpenWorkOrder,
  onOpenAiDiagnose,
  onCreateWorkOrder,
  currentUser,
}) => {
  const [activeEqId, setActiveEqId] = useState<string>(
    selectedEquipmentId || equipments[0]?.id || 'eq-001'
  );
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [sampleSpeed, setSampleSpeed] = useState<number>(2000); // ms
  const [historyData, setHistoryData] = useState<TelemetrySample[]>([]);
  const [loadingTelemetry, setLoadingTelemetry] = useState<boolean>(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiSafetyNotice, setAiSafetyNotice] = useState<any | null>(null);
  const [aiDiagTraceability, setAiDiagTraceability] = useState<any | null>(null);

  // AI 健康趋势预测状态 (功能 4)
  const [forecastState, setForecastState] = useState<{ open: boolean; loading: boolean; error: string | null; degraded?: boolean; data?: AiHealthForecast | null }>({ open: false, loading: false, error: null });

  // AI 生成工单草稿状态 (功能 1 健康页入口)
  const [draftState, setDraftState] = useState<{ open: boolean; loading: boolean; error: string | null; degraded?: boolean; draft?: AiWorkOrderDraft | null; equipment?: any }>({ open: false, loading: false, error: null });

  // AI 健康画像状态 (功能 8)
  const [summaryState, setSummaryState] = useState<{ open: boolean; loading: boolean; error: string | null; degraded?: boolean; data?: AiEquipmentSummary | null }>({ open: false, loading: false, error: null });

  // AI 报警关联分析状态 (功能 10)
  const [corrState, setCorrState] = useState<{ open: boolean; loading: boolean; error: string | null; degraded?: boolean; data?: AiAlarmCorrelation | null }>({ open: false, loading: false, error: null });

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
    } catch (err: any) {
      setSummaryState({ open: true, loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  // 多设备报警关联分析：收集所有预警/故障设备的报警清单
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
    } catch (err: any) {
      setCorrState({ open: true, loading: false, error: err?.message || 'AI 调用失败' });
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
        setForecastState({ open: true, loading: false, error: res.message || res.error || 'AI 趋势预测失败', degraded: res.degraded });
      }
    } catch (err: any) {
      setForecastState({ open: true, loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  const handleAiDraftWorkOrder = async () => {
    const eq = equipments.find((e) => e.id === activeEqId);
    if (!eq) return;
    const desc = `健康监测发现「${eq.name} (${eq.code})」异常: 当前健康分 ${eq.healthScore}/100, 状态 ${eq.status}, 轴承温度 ${eq.telemetry.temperature}°C, 振动 ${eq.telemetry.vibration}mm/s, 负载率 ${eq.telemetry.loadRate}%，请生成检修工单草稿。`;
    setDraftState({ open: true, loading: true, error: null, draft: null, equipment: { id: eq.id, name: eq.name, code: eq.code, workshop: eq.workshop } });
    try {
      const res = await aiApi.generateWorkOrder({ equipmentId: eq.id, abnormalDescription: desc, telemetrySnapshot: eq.telemetry });
      if (res.success && res.draft) {
        setDraftState((prev) => ({ ...prev, loading: false, draft: res.draft }));
      } else {
        setDraftState((prev) => ({ ...prev, loading: false, error: res.message || res.error || 'AI 生成失败', degraded: res.degraded }));
      }
    } catch (err: any) {
      setDraftState((prev) => ({ ...prev, loading: false, error: err?.message || 'AI 调用失败' }));
    }
  };
  const [aiAnalysisResult, setAiAnalysisResult] = useState<string | null>(null);

  const currentEquipment = equipments.find((e) => e.id === activeEqId) || equipments[0];

  // 从真实后端接口加载设备24小时时序遥测指标 (替换硬编码假数据)
  const fetchTelemetryHistory = async (eqId: string) => {
    setLoadingTelemetry(true);
    try {
      const res: any = await equipmentApi.getTelemetryHistory(eqId);
      if (res && Array.isArray(res.points) && res.points.length > 0) {
        const points: TelemetrySample[] = res.points.map((p: any) => ({
          time: p.timestamp || p.time || '12:00',
          temperature: p.temperature ?? 65.0,
          vibration: p.vibration ?? 2.5,
          current: p.current ?? 45.0,
          voltage: p.voltage ?? 380.0,
          loadRate: p.loadRate ?? 75.0,
        }));
        setHistoryData(points);
        return;
      }
    } catch (err) {
      console.warn('Backend telemetry-history fetch fallback:', err);
    } finally {
      setLoadingTelemetry(false);
    }

    // 无真实遥测数据且未开启模拟时置空，展示标准空态，坚决不得用伪造数据填充
    setHistoryData([]);
  };

  useEffect(() => {
    if (activeEqId) {
      fetchTelemetryHistory(activeEqId);
    }
  }, [activeEqId]);

  const demo = isDemoMode();

  // Live simulation tick (仅在显式开启模拟且在演示模式下执行)
  useEffect(() => {
    if (!isSimulating || !currentEquipment) return;

    // 若当前没有时序数据，在开启模拟时注入基准点
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

    const interval = setInterval(() => {
      const now = new Date();
      const timeLabel = now.toTimeString().split(' ')[0];
      const baseTemp = currentEquipment.telemetry.temperature;
      const baseVib = currentEquipment.telemetry.vibration;
      const baseCur = currentEquipment.telemetry.current;
      const baseVolt = currentEquipment.telemetry.voltage;
      const baseLoad = currentEquipment.telemetry.loadRate;

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

    return () => clearInterval(interval);
  }, [isSimulating, sampleSpeed, currentEquipment]);

  const latest = historyData[historyData.length - 1] || {
    temperature: currentEquipment?.telemetry.temperature || 60,
    vibration: currentEquipment?.telemetry.vibration || 2.5,
    current: currentEquipment?.telemetry.current || 45,
    voltage: currentEquipment?.telemetry.voltage || 380,
    loadRate: currentEquipment?.telemetry.loadRate || 75,
  };

  // Health Score dynamic calculation
  const isVibAlert = latest.vibration > 4.5;
  const isTempAlert = latest.temperature > 75;
  const isCurrentAlert = latest.loadRate > 90;

  const runAiAnalysis = async () => {
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
          symptoms: `现场监测遥测数据: 轴温 ${latest.temperature}°C, 振动速度 ${latest.vibration}mm/s, 负荷率 ${latest.loadRate}%`,
          telemetry: latest,
        }),
      });
      const data = await res.json();
      if (data.success && data.diagnosis) {
        setAiSafetyNotice(data.safetyNotice || null);
        setAiDiagTraceability(data.traceability || null);
        setAiAnalysisResult(
          `【AI 研判结论】${data.diagnosis.summary}\n【紧急程度】${data.diagnosis.severity} (风险分值 ${data.diagnosis.urgencyScore})\n【首要原因】${data.diagnosis.probableCauses?.[0]?.cause || '轴承与对中磨损'}\n【建议措施】${data.diagnosis.recommendedActions?.[0]?.action || '停机检查'}`
        );
      } else {
        setAiAnalysisResult(`研判失败: ${data.message || '未知错误'}`);
      }
    } catch (err: any) {
      setAiAnalysisResult(`网络异常或服务暂不可用: ${err.message}`);
    } finally {
      setAiAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 顶部常驻显式模拟角标/横幅 */}
      {isSimulating && (
        <div className="p-3.5 bg-amber-500/15 border-2 border-amber-500 rounded-xl flex items-center justify-between text-amber-900 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center space-x-2.5">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </span>
            <span className="font-extrabold text-xs bg-amber-500 text-white px-2.5 py-0.5 rounded shadow-xs">
              模拟数据运行中
            </span>
            <span className="text-xs text-amber-900 font-medium">
              当前展示数据为本地算法生成的演示扰动波形，非现场硬件直连真实传感器数据（参赛演示模式专用）
            </span>
          </div>
          <button
            onClick={() => setIsSimulating(false)}
            className="text-xs text-amber-800 hover:text-amber-950 font-bold underline cursor-pointer ml-3 shrink-0"
          >
            关闭模拟
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <Activity className="w-5 h-5 mr-2 text-blue-600" />
            工业级精密机组健康画像与多维遥测监视
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            采集温度、振动加速度(RMS)、三相电流、电压与工况负荷率，融合AI多参数时序健康算法
          </p>
        </div>

        {/* Simulation Controls (仅演示模式展示) */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => fetchTelemetryHistory(activeEqId)}
            disabled={loadingTelemetry}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 text-blue-700 border border-slate-200 flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            title="调用真实后端 API /api/v1/equipments/:id/telemetry-history 获取最新时序传感器数据"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingTelemetry ? 'animate-spin text-blue-600' : ''}`} />
            <span>{loadingTelemetry ? '同步API中' : '刷新真实时序'}</span>
          </button>

          {demo && (
            <>
              <button
                onClick={() => setIsSimulating(!isSimulating)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  isSimulating
                    ? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold'
                    : 'bg-white text-slate-600 border border-slate-200'
                }`}
                title="演示模式开关：启动前端动态扰动波形模拟"
              >
                {isSimulating ? <Pause className="w-3.5 h-3.5 text-amber-600" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isSimulating ? '模拟运行中' : '启用模拟数据'}</span>
              </button>

              {isSimulating && (
                <select
                  value={sampleSpeed}
                  onChange={(e) => setSampleSpeed(Number(e.target.value))}
                  className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-blue-500 shadow-xs"
                >
                  <option value={1000}>模拟步进: 1秒 (高速)</option>
                  <option value={2000}>模拟步进: 2秒 (标准)</option>
                  <option value={5000}>模拟步进: 5秒 (低频)</option>
                </select>
              )}
            </>
          )}
        </div>
      </div>

      {/* Equipment Selector Chips Bar */}
      <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-none">
        {equipments.map((eq) => {
          const isSelected = eq.id === activeEqId;
          const isBad = eq.healthScore < 60;
          return (
            <button
              key={eq.id}
              onClick={() => {
                setActiveEqId(eq.id);
                setAiAnalysisResult(null);
              }}
              className={`flex items-center space-x-2.5 px-3.5 py-2 rounded-lg text-left whitespace-nowrap transition-all cursor-pointer border ${
                isSelected
                  ? 'bg-blue-50 border-blue-500 shadow-xs ring-1 ring-blue-500/30'
                  : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  isBad ? 'bg-rose-500 animate-ping' : eq.healthScore < 80 ? 'bg-amber-400' : 'bg-emerald-500'
                }`}
              ></div>
              <div>
                <div className={`text-xs font-bold ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}>{eq.name}</div>
                <div className="text-[10px] font-mono text-slate-500">
                  {eq.code} · <span className="text-blue-600 font-semibold">{eq.healthScore}分</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Telemetry & Health Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Col: Health Score & Threshold Limits */}
        <div className="space-y-4">
          {/* Health Score Card */}
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 text-center relative overflow-hidden shadow-xs">
            <h3 className="text-xs font-semibold text-slate-700">实时健康综合评分</h3>
            <div className="my-4 relative flex items-center justify-center">
              <div className="w-28 h-28 rounded-full border-4 border-slate-100 flex items-center justify-center relative">
                <div
                  className={`absolute inset-0 rounded-full border-4 ${
                    currentEquipment.healthScore >= 80
                      ? 'border-emerald-500'
                      : currentEquipment.healthScore >= 60
                      ? 'border-amber-500'
                      : 'border-rose-500 animate-pulse'
                  }`}
                  style={{
                    clipPath: `polygon(50% 50%, 0 0, 100% 0, 100% 100%, 0 100%)`,
                  }}
                ></div>
                <div className="text-center">
                  <span className="text-3xl font-mono font-extrabold text-slate-900">
                    {currentEquipment.healthScore}
                  </span>
                  <span className="text-[10px] block text-slate-500">/ 100 分</span>
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-600 space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">振动权重 (35%):</span>
                <span className={isVibAlert ? 'text-rose-600 font-mono font-bold' : 'text-emerald-700 font-mono'}>
                  {isVibAlert ? '超标扣减' : '正常'}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">温升权重 (30%):</span>
                <span className={isTempAlert ? 'text-rose-600 font-mono font-bold' : 'text-emerald-700 font-mono'}>
                  {isTempAlert ? '偏高扣减' : '正常'}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">电气负荷 (20%):</span>
                <span className="text-slate-700 font-mono">稳定</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">大修周期 (15%):</span>
                <span className="text-slate-700 font-mono">在控</span>
              </div>
            </div>

            {/* Quick Trigger Buttons */}
            <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
              <button
                onClick={runAiAnalysis}
                disabled={aiAnalyzing}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{aiAnalyzing ? 'AI 遥测研判中...' : 'AI 异常预警研判'}</span>
              </button>

              {/* AI 健康趋势预测 (功能 4) */}
              <button
                onClick={handleHealthForecast}
                className="w-full py-2 bg-white hover:bg-slate-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>AI 健康趋势预测</span>
              </button>

              {/* AI 生成检修工单 (功能 1 健康页入口) */}
              <button
                onClick={handleAiDraftWorkOrder}
                className="w-full py-2 bg-white hover:bg-slate-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI 生成检修工单</span>
              </button>

              {/* AI 健康画像 (功能 8) */}
              <button
                onClick={handleEquipmentSummary}
                className="w-full py-2 bg-white hover:bg-slate-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>AI 健康画像</span>
              </button>

              {/* AI 报警关联分析 (功能 10，多设备报警时展示) */}
              {equipments.filter((e) => e.status === 'warning' || e.status === 'fault').length >= 2 && (
                <button
                  onClick={handleAlarmCorrelation}
                  className="w-full py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span>AI 报警关联分析 ({equipments.filter((e) => e.status === 'warning' || e.status === 'fault').length} 台报警)</span>
                </button>
              )}

              <button
                onClick={() => onOpenWorkOrder(currentEquipment)}
                className="w-full py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>一键发起检修单</span>
              </button>
            </div>
          </div>

          {/* Real-time Meter Readings */}
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-xs">
            <h4 className="text-xs font-semibold text-slate-800 flex items-center">
              <Activity className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
              实时仪表传感器读数
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-600">轴承温度 (PT100)</span>
                <span className={`font-mono font-bold ${isTempAlert ? 'text-rose-600' : 'text-slate-800'}`}>
                  {latest.temperature} °C
                </span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-600">振动速度 (IEPE)</span>
                <span className={`font-mono font-bold ${isVibAlert ? 'text-rose-600' : 'text-slate-800'}`}>
                  {latest.vibration} mm/s
                </span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-600">工作电压</span>
                <span className="font-mono font-bold text-slate-800">{latest.voltage} V</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-600">三相电流</span>
                <span className="font-mono font-bold text-slate-800">{latest.current} A</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-600">工况负荷率</span>
                <span className="font-mono font-bold text-slate-800">{latest.loadRate} %</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right 3 Cols: Telemetry Live Charts */}
        <div className="lg:col-span-3 space-y-6">
          {/* AI Live Insight Banner */}
          {aiAnalysisResult && (
            <div className="space-y-2 animate-in fade-in duration-200">
              {/* 元数据 Badge */}
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] text-slate-600">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-slate-700">来源模型:</span>
                  <span className="font-mono text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                    {aiDiagTraceability?.model || 'DashScope qwen-plus'}
                  </span>
                  <span className="font-semibold text-slate-700">Prompt:</span>
                  <span className="font-mono text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">
                    {aiDiagTraceability?.promptVersion || 'v2.1.0'}
                  </span>
                </div>
                <div>
                  {aiSafetyNotice?.degraded ? (
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-bold">
                      规则引擎降级兜底
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                      大模型正常输出
                    </span>
                  )}
                </div>
              </div>

              {/* 红色安全警示条 */}
              {aiSafetyNotice?.required && (
                <div className="p-3.5 rounded-xl bg-rose-50 border-2 border-rose-300 text-xs text-rose-900 space-y-1">
                  <div className="flex items-center space-x-1.5 font-bold text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>【工业高危安全警示】</span>
                  </div>
                  <p className="text-rose-700 leading-relaxed font-medium">{aiSafetyNotice.reason}</p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-900 space-y-1 shadow-xs">
                <div className="flex items-center space-x-1.5 font-bold text-blue-700">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <span>DashScope 通义千问工业诊断引擎即时分析报告</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 leading-relaxed mt-1">
                  {aiAnalysisResult}
                </pre>
              </div>
            </div>
          )}

          {/* Chart 1: Vibration & Temperature (Twin Critical Metrics) */}
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-2"></span>
                  振动速度有效值 (mm/s) 与 轴承温度 (°C) 动态波形
                </h3>
                <span className="text-[11px] text-slate-500">
                  黄色警戒线: 4.5mm/s (振动), 70°C (温度) | 红色停机线: 7.1mm/s, 80°C
                </span>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${isSimulating ? 'text-amber-800 bg-amber-100 border border-amber-300' : 'text-blue-700 bg-blue-50 border border-blue-200'}`}>
                {isSimulating ? '⚠️ 演示模拟波形' : '现场真实时序'}
              </span>
            </div>

            {historyData.length === 0 ? (
              <div className="h-60 w-full flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50 p-6 text-center">
                <Activity className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-xs font-semibold text-slate-700">暂无实时遥测历史数据</p>
                <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
                  {demo ? '未接入现场硬件时序。当前处于演示模式，可点击右上角"启用模拟数据"体验动态波形。' : '设备传感器离线或尚未采集到连续时序样本，请检查现场测点连接状态。'}
                </p>
                {demo && !isSimulating && (
                  <button
                    onClick={() => setIsSimulating(true)}
                    className="mt-3 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-xs transition-colors"
                  >
                    启用演示模拟数据
                  </button>
                )}
              </div>
            ) : (
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={historyData}>
                    <defs>
                      <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorVib" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                    <YAxis yAxisId="left" stroke="#ef4444" fontSize={10} domain={[20, 100]} />
                    <YAxis yAxisId="right" orientation="right" stroke="#2563eb" fontSize={10} domain={[0, 12]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontSize: '11px', color: '#1e293b' }}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="temperature"
                      name="轴承温度(°C)"
                      stroke="#ef4444"
                      fillOpacity={1}
                      fill="url(#colorTemp)"
                      strokeWidth={2}
                    />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="vibration"
                      name="振动RMS(mm/s)"
                      stroke="#2563eb"
                      fillOpacity={1}
                      fill="url(#colorVib)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Chart 2: Current & Load Rate */}
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-500 mr-2"></span>
                  三相运行电流 (A) 与 机组负荷率 (%)
                </h3>
                <span className="text-[11px] text-slate-500">
                  评估电机驱动负荷与传动阻力矩突变
                </span>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${isSimulating ? 'text-amber-800 bg-amber-100 border border-amber-300' : 'text-slate-600 bg-slate-100 border border-slate-200'}`}>
                {isSimulating ? '⚠️ 模拟数据' : '现场真实'}
              </span>
            </div>

            {historyData.length === 0 ? (
              <div className="h-48 w-full flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50 p-4 text-center">
                <p className="text-xs text-slate-400">暂无运行电流与负荷率数据</p>
              </div>
            ) : (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                    <YAxis yAxisId="left" stroke="#f59e0b" fontSize={10} />
                    <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={10} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontSize: '11px', color: '#1e293b' }}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="current"
                      name="电流(A)"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="loadRate"
                      name="负载率(%)"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI 健康趋势预测弹窗 (功能 4) */}
      <AiResultModal
        open={forecastState.open}
        title="AI 设备健康趋势预测"
        loading={forecastState.loading}
        error={forecastState.error}
        degraded={forecastState.degraded}
        data={forecastState.data}
        onClose={() => setForecastState((prev) => ({ ...prev, open: false }))}
      />

      {/* AI 设备健康画像弹窗 (功能 8) */}
      <AiResultModal
        open={summaryState.open}
        title="AI 设备健康画像 (档案 + 遥测 + 工单 + 巡检综合摘要)"
        loading={summaryState.loading}
        error={summaryState.error}
        degraded={summaryState.degraded}
        data={summaryState.data}
        onClose={() => setSummaryState((prev) => ({ ...prev, open: false }))}
      />

      {/* AI 报警关联分析弹窗 (功能 10) */}
      <AiResultModal
        open={corrState.open}
        title="AI 报警关联分析 (根因识别 / 因果图谱 / 处置建议)"
        loading={corrState.loading}
        error={corrState.error}
        degraded={corrState.degraded}
        data={corrState.data}
        onClose={() => setCorrState((prev) => ({ ...prev, open: false }))}
      />

      {/* AI 生成检修工单草稿弹窗 (功能 1 健康页入口) */}
      <AiWorkOrderDraftModal
        open={draftState.open}
        title="AI 智能生成检修工单草稿"
        loading={draftState.loading}
        error={draftState.error}
        degraded={draftState.degraded}
        draft={draftState.draft || undefined}
        equipment={draftState.equipment}
        operatorName={currentUser ? `${currentUser.name} (${currentUser.roleTitle})` : '健康监测转单'}
        onClose={() => setDraftState((prev) => ({ ...prev, open: false }))}
        onCreated={(wo) => onCreateWorkOrder?.(wo)}
      />
    </div>
  );
};
