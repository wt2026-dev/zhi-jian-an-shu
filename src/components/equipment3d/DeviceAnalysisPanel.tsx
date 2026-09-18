/**
 * 设备实时分析面板 —— 点击 3D 场景里任意一台设备后，右侧展示该设备的
 * 专属档案 / 实时遥测曲线 / AI 诊断 / 最近工单。
 *
 * 数据来源纪律（验收硬要求）：
 *   面板里出现的每一个数字都来自后端接口 ——
 *     台账档案   equipmentApi.getById
 *     遥测曲线   equipmentApi.getTelemetryHistory（真实落库 48 小时时序）
 *     最近工单   workOrderApi.list({ equipment_id })
 *     AI 诊断    POST /api/v1/ai/diagnose
 *   本文件内不存在任何 Math.random() 或本地波形合成。
 *
 * AI 诊断刻意做成**按钮触发**而不是选中即调用：诊断接口会走大模型计费，
 * 每点一次设备就自动请求一遍会产生无谓的成本与延迟。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Cpu,
  Gauge,
  Layers,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Thermometer,
  Wrench,
  X,
} from 'lucide-react';
import type { Equipment, WorkOrder } from '../../types';
import { STATUS_META, statusKey } from './equipment';
import type { DeviceRecipe } from './deviceProfiles';
import {
  normalizeSafetyNotice,
  type AiDiagnosis,
  type AiSafetyNotice,
} from './aiDiagnosis';
import { logger } from '../../utils/logger';
import './equipment-industrial.css';
import {
  WorkOrderStatusBadge,
  WorkOrderPriorityBadge,
} from '../workorders/WorkOrderStatusBadge';

/* ========================= 类型 ========================= */

export interface TelemetryPoint {
  timestamp: string;
  fullTime?: string;
  /** 落库时序里允许缺测：真实采样不保证每个指标都有值，缺测显示 — 不补零。 */
  temperature: number | null;
  vibration: number | null;
  current?: number | null;
  voltage?: number | null;
  pressure?: number | null;
  loadRate: number | null;
  rpm?: number | null;
}

export interface TelemetryHistory {
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  status: string;
  healthScore: number;
  points: TelemetryPoint[];
}

// AI 诊断的类型与 safetyNotice 归一化统一放在 ./aiDiagnosis
// （该模块不依赖 three.js/React，可被 node 环境的单测直接导入）。

interface Props {
  /** 台账条目（接口失败时回退到已加载数据） */
  equipment: Equipment | null;
  /** getById 的详情结果（优先展示） */
  detail: Equipment | null;
  /** 该设备的专属配方（辨识特征） */
  recipe: DeviceRecipe | null;
  telemetry: TelemetryHistory | null;
  orders: WorkOrder[];
  loading: boolean;
  error: string | null;
  onFocus: () => void;
  onClose: () => void;
  onSelectOrder?: (order: WorkOrder) => void;

  // ── 遥测回放控制 ──────────────────────────────────────────────────────────
  /** 是否正在播放 */
  playing?: boolean;
  /** 当前回放时刻对应的遥测点索引（-1 表示未激活 / 末尾） */
  playbackIndex?: number;
  /** 播放/暂停切换回调 */
  onTogglePlayback?: () => void;
  /** 拖动进度条跳转到指定索引 */
  onSeek?: (index: number) => void;
  /** 重置回放到起始位置 */
  onResetPlayback?: () => void;

  // ── 拆解视图控制 ──────────────────────────────────────────────────────────
  /** 是否处于拆解视图 */
  isExploded?: boolean;
  /** 当前设备是否支持拆解视图 */
  isExplodedSupported?: boolean;
  /** 进入拆解视图回调 */
  onEnterExploded?: () => void;
  /** 退出拆解视图回调 */
  onExitExploded?: () => void;
  /** 拆解动画是否进行中 */
  isExplodedAnimating?: boolean;
}

const WO_STATUS_LABEL: Record<string, string> = {
  created: '待派单',
  dispatched: '待接单',
  in_progress: '检修中',
  pending_acceptance: '待验收',
  completed: '已归档',
  cancelled: '已取消',
};

const WO_PRIORITY_LABEL: Record<string, string> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
};

/* ========================= 曲线 ========================= */

interface SeriesSpec {
  key: keyof TelemetryPoint;
  label: string;
  unit: string;
  colour: string;
  digits: number;
}

const SERIES: SeriesSpec[] = [
  { key: 'temperature', label: '轴温', unit: '°C', colour: '#fb923c', digits: 1 },
  { key: 'vibration', label: '振动', unit: 'mm/s', colour: '#60a5fa', digits: 2 },
  { key: 'current', label: '电流', unit: 'A', colour: '#34d399', digits: 1 },
];

/**
 * 单条遥测曲线（轻量 canvas 折线）。
 *
 * 为什么自己画而不是引图表库：面板里同时要放 3 条 48 点曲线，
 * 引 recharts/echarts 会给 3D 场景这个已经很大的 chunk 再叠加几百 KB；
 * 这里只需要一条折线 + 面积填充，canvas 二十行就够，且与场景共用同一帧预算。
 */
function Sparkline({
  points,
  spec,
  cursorIndex,
}: {
  points: TelemetryPoint[];
  spec: SeriesSpec;
  cursorIndex?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const values = useMemo(
    () => points.map((p) => finiteValue(p[spec.key])),
    [points, spec.key]
  );
  const stat = useMemo(() => {
    const available = values.filter((v): v is number => v !== null);
    if (!available.length) return null;
    return { min: Math.min(...available), max: Math.max(...available) };
  }, [values]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 240;
    const h = canvas.clientHeight || 44;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 基线
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i++) {
      const y = Math.round((h - 1) * (i / 2)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (!values.length || !stat) return;
    const span = stat.max - stat.min || 1;
    const pad = 4;
    const xAt = (i: number) => (i / Math.max(1, values.length - 1)) * (w - 1);
    const yAt = (v: number) => h - pad - ((v - stat.min) / span) * (h - pad * 2);

    // Preserve missing samples in their time slots; never connect across gaps.
    ctx.beginPath();
    let connected = false;
    values.forEach((value, index) => {
      if (value === null) { connected = false; return; }
      if (connected) ctx.lineTo(xAt(index), yAt(value));
      else ctx.moveTo(xAt(index), yAt(value));
      connected = true;
    });
    ctx.strokeStyle = spec.colour;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    values.forEach((value, index) => {
      if (value === null) return;
      ctx.beginPath();
      ctx.arc(xAt(index), yAt(value), 1.7, 0, Math.PI * 2);
      ctx.fillStyle = spec.colour;
      ctx.fill();
    });

    // 回放游标线
    if (typeof cursorIndex === 'number' && cursorIndex >= 0 && cursorIndex < values.length && values[cursorIndex] !== null) {
      const cx = xAt(cursorIndex);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      // 游标点
      ctx.beginPath();
      ctx.arc(cx, yAt(values[cursorIndex]), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, yAt(values[cursorIndex]), 2, 0, Math.PI * 2);
      ctx.fillStyle = spec.colour;
      ctx.fill();
    }
  }, [values, stat, spec.colour, cursorIndex]);

  return (
    <div data-series={String(spec.key)} className="mb-2 last:mb-0">
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-[10px] text-slate-300 font-medium">{spec.label}</span>
        <span className="text-[10px] text-slate-200 tabular-nums">
          <span className="font-semibold text-slate-100" style={{ color: spec.colour }}>
            {formatReading(values[values.length - 1], '', spec.digits)}
          </span>
          <span className="text-slate-500"> {spec.unit}</span>
          {stat && (
            <span className="text-slate-500 ml-1.5">
              ({stat.min.toFixed(spec.digits)}~{stat.max.toFixed(spec.digits)})
            </span>
          )}
        </span>
      </div>
      <canvas ref={ref} role="img" aria-label={`${spec.label}，近48小时已落库记录；缺失采样保留断点`} className="block w-full h-[48px] rounded bg-slate-950 border border-slate-700" />
    </div>
  );
}

/* ========================= 小组件 ========================= */

function finiteValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatReading(value: unknown, unit: string, digits = 1): string {
  const numeric = finiteValue(value);
  return numeric === null ? '—' : `${numeric.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}


function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-[11px] font-medium text-slate-100 truncate" title={value == null ? undefined : String(value)}>
        {value == null || value === '' ? '—' : value}
      </div>
    </div>
  );
}

function SeverityTone(severity: string): string {
  const s = severity || '';
  if (/紧急|严重|critical|high|高/.test(s)) return 'bg-rose-50 text-rose-800 border-rose-200 font-semibold';
  if (/中等|中|medium|moderate/.test(s)) return 'bg-amber-50 text-amber-800 border-amber-200 font-semibold';
  return 'bg-emerald-50 text-emerald-800 border-emerald-200 font-semibold';
}

/* ========================= 主组件 ========================= */

export function DeviceAnalysisPanel({
  equipment,
  detail,
  recipe,
  telemetry,
  orders,
  loading,
  error,
  onFocus,
  onClose,
  onSelectOrder,
  playing,
  playbackIndex,
  onTogglePlayback,
  onSeek,
  onResetPlayback,
  isExploded,
  isExplodedSupported,
  onEnterExploded,
  onExitExploded,
  isExplodedAnimating,
}: Props): React.ReactElement {
  const card = detail?.id === equipment?.id ? detail ?? equipment : equipment;
  const meta = STATUS_META[statusKey(card?.status)];
  const points = !loading && telemetry?.equipmentId === card?.id ? telemetry?.points ?? [] : [];
  const latest = points.length ? points[points.length - 1] : null;
  const currentTelemetry = card?.telemetry;

  // ---- AI 诊断（按钮触发，避免每次点选设备都产生大模型计费） ----
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDiag, setAiDiag] = useState<AiDiagnosis | null>(null);
  const [aiSafety, setAiSafety] = useState<AiSafetyNotice | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const aiRequestRef = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);

  // 换设备时清空上一次的诊断结论，避免张冠李戴
  useEffect(() => {
    ++aiRequestRef.current;
    setAiBusy(false);
    setAiDiag(null);
    setAiSafety(null);
    setAiError(null);
    return () => {
      ++aiRequestRef.current;
      aiAbortRef.current?.abort();
    };
  }, [card?.id]);

  const runDiagnose = useCallback(async () => {
    if (!card || !latest || loading || aiBusy) return;
    const request = ++aiRequestRef.current;
    const controller = new AbortController();
    aiAbortRef.current?.abort();
    aiAbortRef.current = controller;
    setAiBusy(true);
    setAiError(null);
    setAiDiag(null);
    setAiSafety(null);
    try {
      const res = await fetch('/api/v1/ai/diagnose', {
        method: 'POST',
        signal: controller.signal,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentName: card.name,
          equipmentCode: card.code,
          category: card.category,
          symptoms: `已落库遥测: 轴温 ${formatReading(latest.temperature, '°C')}，振动 ${formatReading(latest.vibration, 'mm/s', 2)}，电流 ${formatReading(latest.current, 'A')}；— 表示缺测，不估算。`,
          telemetry: latest,
        }),
      });
      const data = await res.json();
      if (request !== aiRequestRef.current) return;
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      if (data.success && data.diagnosis) {
        setAiDiag(data.diagnosis as AiDiagnosis);
        // safetyNotice 是对象（{required, level, reason, requiresConfirmation, riskTypes, degraded}），
        // 必须归一化后再存，绝不可直接当字符串渲染。
        setAiSafety(normalizeSafetyNotice(data.safetyNotice));
      } else {
        setAiError(data.message || 'AI 研判未返回结论');
      }
    } catch (err) {
      if (request !== aiRequestRef.current || controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('[equipment3d] AI 诊断调用失败:', msg);
      setAiError(`网络异常或服务暂不可用：${msg}`);
    } finally {
      if (request === aiRequestRef.current) setAiBusy(false);
    }
  }, [card, latest, loading, aiBusy]);

  if (!card) {
    return (
      <div
        data-testid="equipment3d-analysis"
        className="industrial-analysis min-h-0 p-3.5 rounded-xl bg-slate-900/85 backdrop-blur border border-white/12 text-slate-400 text-[11px]"
      >
        车间总览：点击设备或从上方台账选择，进入单台聚焦。查看真实温度、振动、电流、健康状态及关联工单；按 Esc 返回总览。
      </div>
    );
  }

  return (
    <div
      data-testid="equipment3d-analysis"
      data-equipment-id={card.id}
      className="industrial-analysis min-h-0 p-3.5 rounded-xl bg-slate-900/85 backdrop-blur border border-white/12 text-slate-200 overflow-y-auto max-h-[calc(100%-24px)]"
    >
      {/* ---- 头部 ---- */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-50 truncate" title={card.name}>
            {card.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="font-mono">{card.code}</span>
            <span className="text-slate-300">|</span>
            <span>{card.category}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onFocus}
            title="聚焦到该设备"
            className="text-slate-400 hover:text-slate-100"
            data-testid="equipment3d-analysis-focus"
          >
            <ScanSearch className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-100" aria-label="关闭分析面板">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ---- 状态 + 健康分 ---- */}
      <div className="flex items-center gap-2 mb-2.5">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
          style={{ background: `#${meta.colour.toString(16).padStart(6, '0')}22`, color: `#${meta.glow.toString(16).padStart(6, '0')}` }}
          data-testid="equipment3d-analysis-status"
        >
          <span className="w-2 h-2 rounded-full" style={{ background: `#${meta.colour.toString(16).padStart(6, '0')}` }} />
          {meta.label}
        </span>
        {finiteValue(card.healthScore) !== null && (
          <span className="text-[11px] text-slate-300">
            健康分 <span className="font-semibold text-slate-50 tabular-nums" data-testid="equipment3d-analysis-health">{card.healthScore}</span>
          </span>
        )}
        {card.criticality && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-slate-300">{card.criticality}</span>
        )}
      </div>

      <div className="industrial-readings grid grid-cols-3 gap-2 mb-3" data-testid="equipment3d-current-readings">
        <Field label="温度" value={formatReading(currentTelemetry?.temperature, '°C')} />
        <Field label="振动" value={formatReading(currentTelemetry?.vibration, 'mm/s', 2)} />
        <Field label="电流" value={formatReading(currentTelemetry?.current, 'A')} />
        <div className="col-span-3 text-[10px] text-slate-400">
          台账最新采样 · {currentTelemetry?.lastUpdated || '未提供采样时间'}
          {loading ? ' · 正在获取详情与48h时序…' : ''}
        </div>
      </div>
      {/* ---- 实时遥测曲线 ---- */}
      <div className="mb-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 mb-1.5">
          <Activity className="w-3 h-3" />
          48h 遥测历史
          <span className="font-normal text-slate-500">
            {loading ? '加载中…' : points.length ? `近48小时 · ${points.length} 条落库记录` : '暂无时序数据'}
          </span>
        </div>
        {loading && !points.length ? (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            正在获取遥测时序…
          </div>
        ) : points.length ? (
          <div data-testid="equipment3d-analysis-charts">
            {SERIES.map((s) => (
              <Sparkline key={String(s.key)} points={points} spec={s} cursorIndex={playbackIndex} />
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">暂无历史遥测数据</div>
        )}
        {latest && (
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px]">
            <Field label="电流" value={latest.current != null ? `${latest.current} A` : null} />
            <Field label="电压" value={latest.voltage != null ? `${latest.voltage} V` : null} />
            <Field label="转速" value={latest.rpm != null ? `${latest.rpm} rpm` : null} />
          </div>
        )}
      </div>

      {/* ---- 拆解视图按钮 ---- */}
      {isExplodedSupported && (
        <div className="mb-2.5">
          <button
            type="button"
            onClick={isExploded ? onExitExploded : onEnterExploded}
            disabled={isExplodedAnimating}
            data-testid="equipment3d-exploded-toggle"
            className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-colors ${
              isExploded
                ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40 hover:bg-amber-500/30'
                : 'bg-blue-500/15 text-blue-200 border border-blue-400/35 hover:bg-blue-500/25'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={isExploded ? '退出拆解视图，恢复设备原貌' : '进入拆解视图，查看设备内部结构'}
          >
            {isExplodedAnimating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Layers className="w-3.5 h-3.5" />
            )}
            {isExploded ? '退出拆解' : '设备拆解'}
          </button>
          {!isExploded && (
            <div className="mt-1 text-[10px] text-slate-500 text-center">
              按维护手册顺序展示内部结构
            </div>
          )}
        </div>
      )}

      {/* 健康分条 */}
      {finiteValue(card.healthScore) !== null && (
        <div className="h-1 rounded-full bg-white/8 overflow-hidden mb-2.5">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(0, Math.min(100, card.healthScore))}%`, background: `#${meta.colour.toString(16).padStart(6, '0')}` }}
          />
        </div>
      )}

      {/* ---- 专属辨识特征（单台特征化的直接呈现） ---- */}
      {recipe && (
        <div className="mb-2.5 p-2 rounded-lg bg-white/4 border border-white/8" data-testid="equipment3d-analysis-signature">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 mb-1">
            <Cpu className="w-3 h-3" />
            专属辨识特征
          </div>
          <div className="text-[11px] text-slate-200 leading-relaxed mb-1.5">{recipe.signature}</div>
          <div className="flex flex-wrap gap-1">
            {recipe.features.map((f) => (
              <span key={f} className="px-1.5 py-0.5 rounded text-[10px] bg-white/8 text-slate-300">
                {f}
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-500">
            <span>专属涂装</span>
            <span className="inline-block w-3 h-3 rounded-sm border border-white/20" style={{ background: `#${recipe.livery.toString(16).padStart(6, '0')}` }} />
            {recipe.livery2 != null && (
              <span className="inline-block w-3 h-3 rounded-sm border border-white/20" style={{ background: `#${recipe.livery2.toString(16).padStart(6, '0')}` }} />
            )}
            <span className="font-mono">{recipe.id}</span>
          </div>
        </div>
      )}

      {/* ---- 档案 ---- */}
      <div className="grid grid-cols-2 gap-1.5 mb-2.5 text-[11px]">
        <Field label="型号" value={card.model} />
        <Field label="车间" value={card.workshop} />
        <Field label="安装位" value={card.location} />
        <Field label="制造商" value={card.manufacturer} />
      </div>

      {/* ---- 遥测回放控制条 ---- */}
      {points.length > 0 && (
        <div className="mb-2.5 p-2 rounded-lg bg-white/4 border border-white/8" data-testid="equipment3d-analysis-playback">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 mb-1.5">
            <RotateCcw className="w-3 h-3" />
            时间轴回放
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTogglePlayback}
              disabled={!onTogglePlayback}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/18 text-slate-200 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
              title={playing ? '暂停回放' : '开始回放'}
              data-testid="equipment3d-playback-toggle"
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
            </button>
            <div className="flex-1 min-w-0">
              <input
                type="range"
                aria-label="遥测回放记录"
                min={0}
                max={Math.max(0, points.length - 1)}
                value={typeof playbackIndex === 'number' ? Math.max(0, playbackIndex) : 0}
                onChange={(e) => onSeek?.(Number(e.target.value))}
                disabled={!onSeek}
                className="w-full h-1.5 rounded-full appearance-none bg-white/15 accent-blue-400 cursor-pointer disabled:opacity-35"
                data-testid="equipment3d-playback-slider"
              />
            </div>
            <span className="shrink-0 text-[10px] text-slate-400 tabular-nums w-14 text-right" data-testid="equipment3d-playback-time">
              {typeof playbackIndex === 'number' && playbackIndex >= 0
                ? `${playbackIndex + 1} / ${points.length}`
                : `最新 / ${points.length}`}
            </span>
            {onResetPlayback && (
              <button
                type="button"
                onClick={onResetPlayback}
                className="shrink-0 text-slate-400 hover:text-slate-200 transition-colors"
                title="重置到起始位置"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
          {typeof playbackIndex === 'number' && playbackIndex >= 0 && playbackIndex < points.length && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400" data-testid="equipment3d-playback-values">
              <span>轴温 <span className="text-orange-300 tabular-nums">{formatReading(points[playbackIndex].temperature, '°C')}</span></span>
              <span>振动 <span className="text-blue-300 tabular-nums">{formatReading(points[playbackIndex].vibration, 'mm/s', 2)}</span></span>
              <span>电流 <span className="text-emerald-300 tabular-nums">{formatReading(points[playbackIndex].current, 'A')}</span></span>
              <span>{points[playbackIndex].fullTime || points[playbackIndex].timestamp}</span>
            </div>
          )}
        </div>
      )}

      {/* ---- AI 诊断 ---- */}
      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
            <Sparkles className="w-3 h-3" />
            AI 智能诊断
          </div>
          <button
            type="button"
            onClick={runDiagnose}
            disabled={aiBusy || !latest || loading}
            data-testid="equipment3d-analysis-diagnose"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/85 hover:bg-blue-500 text-white disabled:opacity-45 disabled:cursor-not-allowed"
            title={!latest ? '需要遥测数据才能诊断' : '调用 AI 诊断（会产生模型调用）'}
          >
            {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {aiBusy ? '研判中…' : aiDiag ? '重新研判' : '发起 AI 诊断'}
          </button>
        </div>

        {aiError && (
          <div className="text-[10px] leading-relaxed text-amber-200/90 mb-1" data-testid="equipment3d-analysis-ai-error">
            {aiError}
          </div>
        )}

        {aiDiag && (
          <div className="p-2 rounded-lg bg-white/4 border border-white/8 space-y-1.5" data-testid="equipment3d-analysis-ai">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${SeverityTone(aiDiag.severity)}`}>
                {aiDiag.severity}
              </span>
              <span className="text-[10px] text-slate-400">
                风险分值 <span className="text-slate-100 tabular-nums">{aiDiag.urgencyScore}</span>
              </span>
            </div>
            <div className="text-[11px] text-slate-200 leading-relaxed">{aiDiag.summary}</div>
            {aiDiag.probableCauses?.[0] && (
              <div className="text-[10px] text-slate-300">
                <span className="text-slate-500">首要原因：</span>
                {aiDiag.probableCauses[0].cause}
                {typeof aiDiag.probableCauses[0].probability === 'number' && (
                  <span className="text-slate-500">（{Math.round((aiDiag.probableCauses[0].probability as number) * 100)}%）</span>
                )}
              </div>
            )}
            {aiDiag.recommendedActions?.length ? (
              <div className="text-[10px] text-slate-300">
                <span className="text-slate-500">建议措施：</span>
                {aiDiag.recommendedActions.map((a) => a.action).join('；')}
              </div>
            ) : null}
            {aiDiag.safetyPrecautions?.length ? (
              <div className="text-[10px] text-slate-300">
                <span className="text-slate-500">安全防范：</span>
                {aiDiag.safetyPrecautions.join('；')}
              </div>
            ) : null}
            {aiSafety && (aiSafety.reason || aiSafety.riskTypes.length > 0) && (
              <div
                className="flex items-start gap-1 text-[10px] text-amber-200/90"
                data-testid="equipment3d-analysis-ai-safety"
              >
                <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                <span>
                  {aiSafety.reason}
                  {aiSafety.riskTypes.length > 0 ? (
                    <span className="text-amber-200/70">（{aiSafety.riskTypes.join(' · ')}）</span>
                  ) : null}
                  {aiSafety.degraded ? <span className="text-amber-300/80"> · 规则引擎降级兜底</span> : null}
                </span>
              </div>
            )}
          </div>
        )}

        {!aiDiag && !aiError && !aiBusy && (
          <div className="text-[10px] text-slate-500 leading-relaxed">
            诊断由 AI 大模型按需触发（不计入场景渲染开销）。点击上方按钮开始研判。
          </div>
        )}
      </div>

      {/* ---- 关联工单 ---- */}
      <div data-testid="equipment3d-analysis-orders-section">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
            <Wrench className="w-3 h-3 text-blue-400" />
            <span>关联工单</span>
            {orders.length > 0 && (
              <span className="text-[10px] text-slate-400 font-mono">({orders.length})</span>
            )}
          </div>
          {orders.length > 0 && (
            <span className="text-[9px] text-slate-500">点击查看步骤</span>
          )}
        </div>
        {orders.length === 0 ? (
          <div className="p-2.5 rounded-lg bg-white/4 border border-white/8 text-[11px] text-slate-500 text-center">
            {loading ? '加载中…' : '暂无关联工单'}
          </div>
        ) : (
          <ul className="space-y-1.5" data-testid="equipment3d-analysis-orders">
            {orders.map((wo) => (
              <li key={wo.id}><button
                type="button"
                onClick={() => {
                  onFocus();
                  onSelectOrder?.(wo);
                }}
                className="w-full text-left p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/40 transition-all cursor-pointer group flex flex-col gap-1 text-[11px]"
                title="点击聚焦设备并展开检修步骤卡片"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-mono text-[10px] font-semibold text-cyan-400 group-hover:text-cyan-300 truncate">
                    {wo.orderNo}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <WorkOrderStatusBadge status={wo.status} size="xs" />
                    <WorkOrderPriorityBadge priority={wo.priority} size="xs" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-1 text-slate-300">
                  <span className="truncate group-hover:text-white font-medium" title={wo.title}>
                    {wo.title}
                  </span>
                  <ChevronRight className="w-3 h-3 shrink-0 text-slate-500 group-hover:text-blue-400 transition-colors" />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5 border-t border-white/5">
                  <span className="truncate max-w-[120px]">{wo.faultType || '检修缺陷'}</span>
                  <span className="shrink-0">{wo.createdAt ? String(wo.createdAt).slice(0, 10) : '—'}</span>
                </div>
              </button></li>
            ))}
          </ul>
        )}
      </div>

      {error && <div className="mt-2 text-[10px] leading-relaxed text-amber-200/90">{error}</div>}

      <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
        <Thermometer className="w-3 h-3" />
        数据来源：设备台账 / 遥测时序 / 工单接口（无本地模拟）
      </div>
    </div>
  );
}

export default DeviceAnalysisPanel;
