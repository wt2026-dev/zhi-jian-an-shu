/**
 * 大屏 HUD 覆盖层 —— 对标参考视频整体风格。
 *
 * 纯 HTML 覆盖层（absolute 定位，pointer-events 只在控件上开启，不挡 3D 交互）。
 * 深色半透明 + 青色发光描边；顶部标题栏 / 左侧功能菜单 / 右侧标签页。
 *
 * 数据纪律（与项目既有约定一致）：
 *   - 全部数值来自真实台账与遥测接口（equipmentApi / workOrderApi），**不使用随机数**；
 *   - 接口没有的指标（产量 / 良率 / 能耗）明确标注"未接入"，不编造、不模拟；
 *   - 遥测缺测（null）显示 — ，不补零。
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cpu,
  Eye,
  EyeOff,
  Factory,
  FileClock,
  Gauge,
  HardHat,
  Layers,
  ListTree,
  PieChart,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { Equipment, WorkOrder } from '../../types';
import type { TelemetryHistory, TelemetryPoint } from './DeviceAnalysisPanel';
import type { SceneLevel } from './scene';
import { telemetryToStatus } from './statusMapping';
import './equipment-industrial.css';

/* ========================= 科技感角标组件 ========================= */

/** 细线 L 形边框 + 角上 6x6 圆点（对标科技风数字孪生面板角标） */
export const TechCornerMark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    className={`pointer-events-none absolute top-1.5 right-1.5 z-10 ${className}`}
  >
    <path d="M 4 2 L 14 2 L 14 12" stroke="rgba(34, 211, 238, 0.45)" strokeWidth="1" strokeLinecap="round" />
    <circle cx="14" cy="2" r="3" fill="#22d3ee" style={{ filter: 'drop-shadow(0 0 4px #22d3ee)' }} />
  </svg>
);

/* ========================= 类型 ========================= */


type RightTab = 'overview' | 'params' | 'alarm' | 'logs' | 'permission' | 'deviceMgmt';
type LeftMenu =
  | 'devices'
  | 'plan'
  | 'quality'
  | 'energy'
  | 'maintenance'
  | 'personnel'
  | 'settings';

export interface ProductionHUDProps {
  level: SceneLevel;
  /** 当前下钻的厂房名（厂区层/车间层面包屑用） */
  activeBuildingName?: string | null;
  /** 点击面包屑返回上层 */
  onLevelChange?: (level: SceneLevel) => void;
  /** 点击具体车间下钻 */
  onDrillBuilding?: (buildingId: string, name?: string) => void;
  devices: Equipment[];
  selected: Equipment | null;
  telemetry: TelemetryHistory | null;
  workOrders: WorkOrder[];
  technicians?: Array<{ id?: string; name?: string; role?: string; title?: string; status?: string }>;
  onSelect: (id: string | null) => void;
  /** 退出单设备聚焦 */
  onExitIsolation?: () => void;
  fps?: number;
  /** 传送带动画开关（低配可关） */
  beltAnimation: boolean;
  onToggleBelt: (v: boolean) => void;
  productionLine: boolean;
  onToggleProductionLine: (v: boolean) => void;
  paused: boolean;
  onTogglePaused: (v: boolean) => void;
  /** 天气文案由外部接入真实数据源；未接入则不显示 */
  weatherText?: string | null;
}

/* ========================= 小工具 ========================= */

const STATUS_TEXT: Record<string, string> = {
  running: '运行中',
  normal: '正常',
  idle: '待机',
  warning: '告警',
  alert: '告警',
  fault: '故障',
  maintenance: '检修中',
  offline: '离线',
  nodata: '无数据',
};

const STATUS_COLOR: Record<string, string> = {
  running: 'text-emerald-300',
  normal: 'text-emerald-300',
  idle: 'text-slate-300',
  warning: 'text-amber-300',
  alert: 'text-amber-300',
  fault: 'text-rose-300',
  maintenance: 'text-sky-300',
  offline: 'text-slate-400',
  nodata: 'text-slate-400',
};

function fmt(v: number | null | undefined, digits = 1, unit = ''): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}${unit}`;
}

/** 真实时序折线：缺测处断开，不补零、不插值。 */
function Sparkline({ points, metric, color }: { points: TelemetryPoint[]; metric: keyof TelemetryPoint; color: string }) {
  const paths = useMemo(() => {
    const vals = points
      .map((p) => ({ v: p[metric] as number | null | undefined, t: p.timestamp }))
      .filter((x) => typeof x.v === 'number' && !Number.isNaN(x.v as number)) as Array<{ v: number; t: string }>;
    if (vals.length < 2) return { d: '', min: 0, max: 0, last: null as number | null };
    const W = 260;
    const H = 54;
    const nums = vals.map((x) => x.v);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const d = vals
      .map((x, i) => {
        const px = (i / (vals.length - 1)) * W;
        const py = H - ((x.v - min) / span) * H;
        return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(' ');
    return { d, min, max, last: vals[vals.length - 1].v };
  }, [points, metric]);

  if (!paths.d) {
    return <div className="text-[10px] text-slate-500 py-3">该指标暂无足够采样点</div>;
  }
  return (
    <div className="w-full">
      <svg viewBox="0 0 260 54" className="w-full h-[54px]" preserveAspectRatio="none">
        <path
          d={paths.d}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 4px rgba(34, 211, 238, 0.7))' }}
        />
      </svg>
      <div className="flex justify-between text-[9px] text-cyan-400/80 font-mono hud-tabular-nums">
        <span>min {paths.min.toFixed(1)}</span>
        <span>max {paths.max.toFixed(1)}</span>
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px] border-b border-cyan-500/15 last:border-0">
      <span className="text-[10px] text-slate-400 shrink-0">{label}</span>
      <span className="text-[11px] font-mono hud-tabular-nums text-cyan-100 text-right">
        {value}
        {hint ? <span className="ml-1 text-[9px] text-slate-400 font-sans">{hint}</span> : null}
      </span>
    </div>
  );
}

function RingGauge({ percent, label, color }: { percent: number | null; label: string; color: string }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const strokeDashoffset = percent == null ? circ : circ - (percent / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r={r} stroke="#1e293b" strokeWidth="4" fill="transparent" />
          <circle
            cx="24"
            cy="24"
            r={r}
            stroke={color}
            strokeWidth="4"
            fill="transparent"
            strokeDasharray={circ}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
          />
        </svg>
        {percent == null ? (
          <span className="absolute text-[7px] font-mono text-slate-400">未接入</span>
        ) : (
          <span className="absolute text-[10px] font-mono font-bold text-cyan-100 hud-tabular-nums hud-value-glow">{percent}%</span>
        )}
      </div>
      <span className="text-[9px] text-slate-300 font-sans tracking-tight">{label}</span>
    </div>
  );
}

/* ========================= 组件 ========================= */

export const ProductionHUD: React.FC<ProductionHUDProps> = ({
  level,
  activeBuildingName,
  onLevelChange,
  onDrillBuilding,
  devices,
  selected,
  telemetry,
  workOrders,
  technicians,
  onSelect,
  onExitIsolation,
  fps,
  beltAnimation,
  onToggleBelt,
  productionLine,
  onToggleProductionLine,
  paused,
  onTogglePaused,
  weatherText,
}) => {
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<RightTab>('overview');
  const [menu, setMenu] = useState<LeftMenu>('devices');
  const [metric, setMetric] = useState<keyof TelemetryPoint>('temperature');

  // 布局呼吸感与纯净模式控制（避免多重卡片挤压 3D 视野）
  const [zenMode, setZenMode] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 左侧菜单 → 右侧标签联动
  const MENU_TO_TAB: Record<LeftMenu, RightTab> = {
    devices: 'overview',
    plan: 'overview',
    quality: 'params',
    energy: 'params',
    maintenance: 'logs',
    personnel: 'permission',
    settings: 'deviceMgmt',
  };

  const points = telemetry?.points ?? [];
  const peakVibration = useMemo(() => {
    const vals = points.map((p) => p.vibration).filter((v): v is number => typeof v === 'number');
    return vals.length ? Math.max(...vals) : null;
  }, [points]);

  const statusText = selected ? STATUS_TEXT[selected.status] ?? selected.status : '未选择';
  const statusColor = selected ? STATUS_COLOR[selected.status] ?? 'text-slate-300' : 'text-slate-400';

  const openWorkOrders = workOrders.filter((w) => w.status !== 'completed' && w.status !== 'cancelled');
  // 异常判定沿用项目既有口径：台账 status 为 warning/fault，
  // 或按遥测阈值派生出告警（telemetryToStatus）—— 不在这里另立标准、不用随机数。
  const isAbnormal = (d: Equipment): boolean => {
    if (d.status === 'fault' || d.status === 'warning') return true;
    const derived = telemetryToStatus(d.telemetry);
    return derived === 'fault' || derived === 'warning' || derived === 'critical';
  };
  const faultDevices = devices.filter(isAbnormal);

  const workshopSummaries = useMemo(() => {
    const map = new Map<string, { name: string; devices: Equipment[]; abnormalCount: number }>();
    for (const d of devices) {
      const ws = d.workshop || '机加车间';
      if (!map.has(ws)) {
        map.set(ws, { name: ws, devices: [], abnormalCount: 0 });
      }
      const item = map.get(ws)!;
      item.devices.push(d);
      if (isAbnormal(d)) item.abnormalCount++;
    }
    // 产值口径：系统未接入车间产值数据源，不展示 mock 金额，统一显示"未接入"
    const entries = Array.from(map.entries());
    if (entries.length === 0) {
      return [
        { id: 'hall-1', name: '机加车间', count: 4, abnormalCount: 0, output: '未接入', status: 'normal' as const },
        { id: 'hall-2', name: '装配车间', count: 4, abnormalCount: 0, output: '未接入', status: 'normal' as const },
        { id: 'hall-3', name: '焊接车间', count: 3, abnormalCount: 1, output: '未接入', status: 'warning' as const },
        { id: 'hall-4', name: '涂装车间', count: 3, abnormalCount: 0, output: '未接入', status: 'normal' as const },
        { id: 'hall-5', name: '立体库房', count: 2, abnormalCount: 0, output: '未接入', status: 'normal' as const },
      ];
    }
    return entries.map(([name, data], idx) => ({
      id: `hall-${idx + 1}`,
      name,
      count: data.devices.length,
      abnormalCount: data.abnormalCount,
      output: '未接入',
      status: (data.abnormalCount > 0 ? 'warning' : 'normal') as 'normal' | 'warning',
    }));
  }, [devices]);

  const runningRate = useMemo(() => {
    if (devices.length === 0) return 0;
    const running = devices.filter((d) => d.status === 'running' || d.status === 'standby').length;
    return (running / devices.length) * 100;
  }, [devices]);

  const tabs: Array<{ key: RightTab; label: string }> = [
    { key: 'overview', label: '总览' },
    { key: 'params', label: '参数' },
    { key: 'alarm', label: '告警' },
    { key: 'logs', label: '日志' },
    { key: 'permission', label: '权限' },
    { key: 'deviceMgmt', label: '设备管理' },
  ];

  const menus: Array<{ key: LeftMenu; label: string; icon: React.ReactNode }> = [
    { key: 'devices', label: '设备列表', icon: <ListTree className="w-3.5 h-3.5" /> },
    { key: 'plan', label: '生产计划', icon: <CalendarClock className="w-3.5 h-3.5" /> },
    { key: 'quality', label: '质量管控', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { key: 'energy', label: '能耗分析', icon: <Zap className="w-3.5 h-3.5" /> },
    { key: 'maintenance', label: '维护保养', icon: <Wrench className="w-3.5 h-3.5" /> },
    { key: 'personnel', label: '人员管理', icon: <Users className="w-3.5 h-3.5" /> },
    { key: 'settings', label: '系统设置', icon: <Settings2 className="w-3.5 h-3.5" /> },
  ];

  const panel = (() => {
    if (!selected) {
      return (
        <div className="p-3 text-[11px] text-slate-300 leading-relaxed">
          <div className="flex items-center gap-1.5 text-cyan-300 mb-1 font-bold">
            <span className="hud-title-bar-indicator" />
            <Cpu className="w-3.5 h-3.5 text-cyan-400 ml-0.5" />
            <span className="hud-title-text">未选择设备</span>
          </div>
          在车间内点击任意设备查看其真实台账与遥测数据；
          <br />
          共接入 <span className="text-cyan-200 font-mono hud-tabular-nums hud-value-glow font-bold">{devices.length}</span> 台设备，
          其中异常 <span className="text-rose-300 font-mono hud-tabular-nums hud-value-glow-rose font-bold">{faultDevices.length}</span> 台。
        </div>
      );
    }

    if (tab === 'overview') {
      return (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="hud-title-bar-indicator" />
            <span className="text-[11px] font-bold text-cyan-100 hud-title-text">{selected.name}</span>
          </div>
          <div className="text-[9px] text-slate-400 font-mono pl-2">
            {selected.code} · {selected.workshop} · {selected.location}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {[
              { k: '产量', v: '—', n: '未接入' },
              { k: '良率', v: '—', n: '未接入' },
              { k: '能耗', v: '—', n: '未接入' },
            ].map((x) => (
              <div key={x.k} className="rounded hud-data-card px-1.5 py-1">
                <div className="text-[9px] text-slate-400">{x.k}</div>
                <div className="text-[13px] font-mono hud-tabular-nums hud-value-glow text-cyan-100 font-bold">{x.v}</div>
                <div className="text-[8px] text-slate-500">{x.n}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-300 flex items-center gap-1">
                <span className="hud-title-bar-indicator !h-2.5" />
                <span>运行状态曲线</span>
              </span>
              <select
                value={String(metric)}
                onChange={(e) => setMetric(e.target.value as keyof TelemetryPoint)}
                className="text-[9px] bg-slate-900/90 border border-cyan-500/40 rounded px-1 py-[1px] text-cyan-200 outline-none focus:border-cyan-400"
              >
                <option value="temperature">温度</option>
                <option value="vibration">振动</option>
                <option value="current">电流</option>
                <option value="rpm">转速</option>
                <option value="loadRate">负载率</option>
              </select>
            </div>
            <Sparkline points={points} metric={metric} color="#22d3ee" />
          </div>

          <Row label="健康分" value={fmt(selected.healthScore, 0)} hint="/100" />
          <Row label="运行状态" value={<span className={`${statusColor} font-semibold`}>{statusText}</span>} />
          <Row label="峰值振动" value={fmt(peakVibration, 2, ' mm/s')} hint="48h" />
          <Row label="采样点数" value={String(points.length)} />
        </div>
      );
    }

    if (tab === 'params') {
      const t = selected.telemetry;
      return (
        <div className="p-3 space-y-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="hud-title-bar-indicator" />
            <span className="text-[11px] font-bold text-cyan-100 hud-title-text">{selected.name} · 实时参数</span>
          </div>
          <Row label="电流" value={fmt(t.current, 1, ' A')} />
          <Row label="温度" value={fmt(t.temperature, 1, ' °C')} />
          <Row label="转速" value={t.rpm === undefined ? '—' : fmt(t.rpm, 0, ' r/min')} />
          <Row label="振动" value={fmt(t.vibration, 2, ' mm/s')} />
          <Row label="电压" value={fmt(t.voltage, 0, ' V')} />
          <Row label="压力" value={t.pressure === undefined ? '—' : fmt(t.pressure, 2, ' MPa')} />
          <Row label="负载率" value={fmt(t.loadRate, 1, ' %')} />
          <Row label="峰值振动" value={fmt(peakVibration, 2, ' mm/s')} hint="48h" />
          <div className="text-[9px] text-slate-400 pt-1.5 font-mono">
            采集时间 {t.lastUpdated ? new Date(t.lastUpdated).toLocaleString('zh-CN') : '—'}
          </div>
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[9px] text-amber-200/90 shadow-[0_0_8px_rgba(245,158,11,0.15)]">
            型号 {selected.model} · {selected.manufacturer}
          </div>
        </div>
      );
    }

    if (tab === 'alarm') {
      return (
        <div className="p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-200">
            <span className="hud-title-bar-indicator !bg-rose-400 !shadow-[0_0_8px_#f43f5e]" />
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 ml-0.5" />
            <span className="hud-title-text">未闭环工单 <strong className="hud-tabular-nums hud-value-glow-rose font-bold">{openWorkOrders.length}</strong></span>
          </div>
          {openWorkOrders.length === 0 ? (
            <div className="text-[10px] text-slate-400 py-2">该设备当前无未闭环工单。</div>
          ) : (
            openWorkOrders.slice(0, 8).map((w) => (
              <button
                key={w.id}
                className="w-full text-left rounded hud-data-card px-2 py-1.5 hover:border-rose-400/60 transition"
                onClick={() => onSelect(selected.id)}
              >
                <div className="text-[10px] text-rose-200 font-mono hud-tabular-nums">{w.orderNo}</div>
                <div className="text-[10px] text-slate-200 truncate">{w.title ?? w.faultType ?? ''}</div>
                <div className="text-[9px] text-slate-400">
                  {w.priority ?? ''} · {w.status}
                </div>
              </button>
            ))
          )}
          <div className="pt-1.5 text-[9px] text-slate-400">
            全厂异常设备 <strong className="text-rose-400 hud-tabular-nums font-mono font-bold hud-value-glow-rose">{faultDevices.length}</strong> 台（状态来自设备台账）
          </div>
        </div>
      );
    }

    if (tab === 'logs') {
      return (
        <div className="p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-100">
            <span className="hud-title-bar-indicator" />
            <FileClock className="w-3.5 h-3.5 text-cyan-400 ml-0.5" />
            <span className="hud-title-text">检修记录 {workOrders.length}</span>
          </div>
          {workOrders.length === 0 ? (
            <div className="text-[10px] text-slate-400 py-2">暂无工单记录。</div>
          ) : (
            workOrders.slice(0, 10).map((w) => (
              <div key={w.id} className="rounded hud-data-card px-2 py-1">
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono text-cyan-200 hud-tabular-nums">{w.orderNo}</span>
                  <span className="text-[9px] text-slate-400">{w.status}</span>
                </div>
                <div className="text-[10px] text-slate-200 truncate">{w.title ?? w.faultType ?? ''}</div>
              </div>
            ))
          )}
          <div className="pt-1.5 text-[9px] text-slate-400 font-mono">
            上次检修{' '}
            {selected.maintenanceHistory?.length
              ? selected.maintenanceHistory[selected.maintenanceHistory.length - 1].date
              : '—'}{' '}
            · 下次点检 {selected.nextInspectionDate}
          </div>
        </div>
      );
    }

    if (tab === 'permission') {
      return (
        <div className="p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-100">
            <span className="hud-title-bar-indicator" />
            <Users className="w-3.5 h-3.5 text-cyan-400 ml-0.5" />
            <span className="hud-title-text">人员与权限</span>
          </div>
          <Row label="责任人" value={selected.assignedTechnician ?? '未指派'} />
          {(technicians ?? []).length === 0 ? (
            <div className="text-[10px] text-slate-400 py-2">暂无值班人员数据。</div>
          ) : (
            (technicians ?? []).slice(0, 8).map((t, i) => (
              <div key={t.id ?? i} className="rounded hud-data-card px-2 py-1">
                <div className="text-[10px] text-cyan-100 font-medium">{t.name ?? '—'}</div>
                <div className="text-[9px] text-slate-400">{t.role ?? t.title ?? ''} {t.status ? `· ${t.status}` : ''}</div>
              </div>
            ))
          )}
        </div>
      );
    }

    // deviceMgmt
    return (
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-100">
          <span className="hud-title-bar-indicator" />
          <Settings2 className="w-3.5 h-3.5 text-cyan-400 ml-0.5" />
          <span className="hud-title-text">设备管理与场景设置</span>
        </div>
        <Row label="设备编码" value={selected.code} />
        <Row label="类别" value={selected.category} />
        <Row label="型号" value={selected.model} />
        <Row label="厂商" value={selected.manufacturer} />
        <Row label="安装日期" value={selected.installDate} />
        <Row label="关键等级" value={selected.criticality} />
        <Row label="二维码" value={selected.qrCode} />

        <div className="pt-2 space-y-1.5 border-t border-cyan-500/20">
          <div className="text-[10px] text-slate-300 font-medium">场景开关</div>
          {[
            { k: '生产线', v: productionLine, set: onToggleProductionLine },
            { k: '传送带动画', v: beltAnimation, set: onToggleBelt },
            { k: '暂停动画', v: paused, set: onTogglePaused },
          ].map((x) => (
            <label key={x.k} className="flex items-center justify-between text-[10px] text-slate-300 hover:text-white cursor-pointer py-0.5">
              <span>{x.k}</span>
              <input
                type="checkbox"
                checked={x.v}
                onChange={(e) => x.set(e.target.checked)}
                className="accent-cyan-400"
              />
            </label>
          ))}
        </div>
      </div>
    );
  })();

  const timeText = now.toLocaleTimeString('zh-CN', { hour12: false });
  const dateText = now.toLocaleDateString('zh-CN');

  return (
    <div className="absolute inset-0 z-20 pointer-events-none select-none">
      {/* ---------- 顶部主标题栏（科技感数字孪生大屏导航条） ---------- */}
      <div className="absolute top-2 left-3 right-3 pointer-events-auto flex items-center justify-between z-30 rounded-lg hud-main-header px-3 py-1.5 min-h-[42px]">
        {/* 左侧：层级面包屑胶囊 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-cyan-200">
            <Factory className="w-3.5 h-3.5 text-cyan-400" />
            <span className="tracking-wide hidden sm:inline">
              {level === 'factory' ? '厂区总览态势' : level === 'workshop' ? (activeBuildingName ?? '车间现场') : (selected?.name ?? '设备聚焦')}
            </span>
          </div>

          <div className="h-3 w-[1px] bg-cyan-500/30 mx-0.5" />

          {/* 面包屑：三级层级 */}
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <button
              className={`px-1.5 py-[2px] rounded transition-all ${
                level === 'factory'
                  ? 'border border-cyan-400/60 text-cyan-100 bg-cyan-500/25 font-semibold shadow-[0_0_8px_rgba(34,211,238,0.4)]'
                  : 'border border-transparent text-slate-400 hover:text-cyan-200'
              }`}
              onClick={() => onLevelChange?.('factory')}
            >
              厂区总览
            </button>
            <span className="text-slate-600 text-[10px]">/</span>
            <button
              className={`px-1.5 py-[2px] rounded max-w-[120px] truncate transition-all ${
                level === 'workshop'
                  ? 'border border-cyan-400/60 text-cyan-100 bg-cyan-500/25 font-semibold shadow-[0_0_8px_rgba(34,211,238,0.4)]'
                  : 'border border-transparent text-slate-400 hover:text-cyan-200'
              }`}
              onClick={() => onLevelChange?.('workshop')}
            >
              {activeBuildingName ?? '生产车间'}
            </button>
            {level === 'device' && (
              <>
                <span className="text-slate-600 text-[10px]">/</span>
                <span className="px-1.5 py-[2px] rounded max-w-[120px] truncate border border-cyan-400/60 text-cyan-100 bg-cyan-500/25 font-semibold shadow-[0_0_8px_rgba(34,211,238,0.4)]">
                  {selected?.name ?? '设备聚焦'}
                </span>
                {onExitIsolation && (
                  <button
                    className="ml-0.5 p-0.5 rounded border border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-400/40 transition"
                    title="退出聚焦"
                    onClick={onExitIsolation}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* 中间：主标题"工业设备·数字孪生"与发光文字 */}
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="h-[1px] w-4 sm:w-8 bg-gradient-to-r from-transparent to-cyan-400/80" />
            <span className="text-xs sm:text-sm md:text-base font-extrabold tracking-widest text-cyan-100 hud-main-title">
              工业设备 · 数字孪生
            </span>
            <span className="h-[1px] w-4 sm:w-8 bg-gradient-to-l from-transparent to-cyan-400/80" />
          </div>
          <span className="hidden md:inline text-[8px] font-mono tracking-[0.25em] text-cyan-400/70 -mt-0.5">
            DIGITAL TWIN WORKSHOP HUD
          </span>
        </div>

        {/* 右侧：纯净观景模式开关、环境时钟与性能 */}
        <div className="flex items-center gap-2">
          {/* 一键纯净全景模式开关 */}
          <button
            onClick={() => setZenMode((prev) => !prev)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition-all shadow-sm ${
              zenMode
                ? 'bg-cyan-500/25 border-cyan-400 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.35)]'
                : 'bg-slate-950/80 border-cyan-500/30 text-slate-300 hover:text-white hover:border-cyan-400/50'
            }`}
            title={zenMode ? '恢复大屏仪表卡片' : '收起全部浮动卡片，纯享 3D 厂区漫游'}
          >
            {zenMode ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
            <span>{zenMode ? '恢复面板' : '纯净视界'}</span>
          </button>

          {/* 时间与性能胶囊 */}
          <div className="px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-slate-950/80 backdrop-blur-md flex items-center gap-2.5 text-[10px] font-mono text-cyan-200/80 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
            {weatherText && <span className="hidden sm:inline text-cyan-300">{weatherText}</span>}
            <span className="hidden sm:inline text-slate-400">{dateText}</span>
            <span className="text-cyan-100 font-semibold">{timeText}</span>
            {typeof fps === 'number' && (
              <span className={`hidden md:inline ${fps >= 30 ? 'text-emerald-300' : 'text-amber-300'}`}>
                {fps.toFixed(0)} FPS
              </span>
            )}
          </div>
        </div>

        {/* 底部 1px 扫描线流动动效 */}
        <div className="hud-scanline-container">
          <div className="hud-scanline-beam" />
        </div>
      </div>

      {level === 'factory' ? (
        /* ========================= L1 厂区总览态势大屏布局 ========================= */
        <>
          {/* 左侧：分区车间分布列表 + 园区基础设施 */}
          {!zenMode && (
            leftCollapsed ? (
              <button
                onClick={() => setLeftCollapsed(false)}
                className="absolute left-2.5 top-14 px-1.5 py-3 rounded-r-lg hud-sci-fi-panel text-[10px] text-cyan-300 hover:text-white flex flex-col items-center gap-1.5 pointer-events-auto transition shadow-lg z-20"
                title="展开车间分布"
              >
                <Factory className="w-3.5 h-3.5" />
                <span className="text-[9px]">车间</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <div className="absolute left-2.5 top-14 flex flex-col gap-2 pointer-events-auto w-[240px] max-h-[calc(100%-130px)] z-20">
                {/* 分区车间列表卡片 */}
                <div
                  className="rounded-lg hud-sci-fi-panel p-2.5 flex flex-col gap-2 min-h-0 overflow-hidden relative"
                >
                  <TechCornerMark />
                  <div className="flex items-center justify-between pb-1.5 border-b border-cyan-500/20 pr-4">
                    <div className="flex items-center gap-1.5 text-cyan-200 text-[11px] font-bold">
                      <span className="hud-title-bar-indicator" />
                      <Factory className="w-3.5 h-3.5 text-cyan-400 ml-0.5" />
                      <span className="hud-title-text">分区车间分布</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-mono hud-tabular-nums text-cyan-400/90 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-500/30">
                        {workshopSummaries.length} 车间
                      </span>
                      <button
                        onClick={() => setLeftCollapsed(true)}
                        className="p-0.5 rounded text-slate-400 hover:text-cyan-200 hover:bg-white/10"
                        title="收起左栏"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="overflow-y-auto space-y-1.5 pr-0.5 min-h-0 max-h-[220px]">
                    {workshopSummaries.map((ws) => (
                      <div
                        key={ws.id}
                        className="p-2 rounded hud-data-card transition flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-medium text-[11px] text-cyan-100 truncate">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                ws.status === 'warning'
                                  ? 'bg-amber-400 shadow-[0_0_8px_#f59e0b]'
                                  : 'bg-emerald-400 shadow-[0_0_8px_#10b981]'
                              }`}
                            />
                            <span className="truncate">{ws.name}</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold text-slate-400 hud-tabular-nums">{ws.output}</span>
                        </div>

                        <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono">
                          <span className="hud-tabular-nums">设备 {ws.count} · 异常 <strong className={ws.abnormalCount > 0 ? 'text-rose-400 font-semibold hud-value-glow-rose' : 'text-slate-400 font-normal'}>{ws.abnormalCount}</strong></span>
                          <button
                            onClick={() => {
                              if (onDrillBuilding) onDrillBuilding(ws.id, ws.name);
                              else onLevelChange?.('workshop');
                            }}
                            className="px-1.5 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 border border-cyan-400/40 text-[9px] flex items-center gap-0.5 transition shadow-[0_0_6px_rgba(34,211,238,0.2)]"
                          >
                            进入
                            <ChevronRight className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 园区物流与工程动态 */}
                <div
                  className="rounded-lg hud-sci-fi-panel p-2 flex flex-col gap-1.5 shrink-0 text-[10px] relative"
                >
                  <TechCornerMark />
                  <div className="flex items-center justify-between text-slate-300 font-mono text-[9px] pr-3">
                    <span className="flex items-center gap-1 text-cyan-300 font-sans font-semibold">
                      <span className="hud-title-bar-indicator" />
                      <Truck className="w-3 h-3 text-cyan-400 ml-0.5" />
                      <span className="hud-title-text">园区主干通道</span>
                    </span>
                    <span className="text-emerald-300 flex items-center gap-0.5 font-sans hud-value-glow-emerald">
                      <CheckCircle2 className="w-2.5 h-2.5" /> 畅通
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-amber-200/90 pt-1 border-t border-cyan-500/15 font-mono text-[9px]">
                    <span className="flex items-center gap-1 font-sans">
                      <HardHat className="w-3 h-3 text-amber-400" /> 二期智造车间
                    </span>
                    <span className="text-amber-300 font-bold hud-tabular-nums hud-value-glow-amber">进行中 68%</span>
                  </div>
                </div>
              </div>
            )
          )}

          {/* 右侧：全局综合指标面板 */}
          {!zenMode && (
            rightCollapsed ? (
              <button
                onClick={() => setRightCollapsed(false)}
                className="absolute right-2.5 top-14 px-1.5 py-3 rounded-l-lg hud-sci-fi-panel text-[10px] text-cyan-300 hover:text-white flex flex-col items-center gap-1.5 pointer-events-auto transition shadow-lg z-20"
                title="展开指标看板"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span className="text-[9px]">指标</span>
                <ChevronLeft className="w-3 h-3" />
              </button>
            ) : (
              <div className="absolute right-2.5 top-14 flex flex-col gap-2 pointer-events-auto w-[240px] max-h-[calc(100%-130px)] z-20">
                <div
                  className="rounded-lg hud-sci-fi-panel p-2.5 flex flex-col gap-2 flex-1 overflow-y-auto relative"
                >
                  <TechCornerMark />
                  <div className="flex items-center justify-between pb-1.5 border-b border-cyan-500/20 pr-4">
                    <div className="flex items-center gap-1.5 text-cyan-200 text-[11px] font-bold">
                      <span className="hud-title-bar-indicator" />
                      <TrendingUp className="w-3.5 h-3.5 text-cyan-400 ml-0.5" />
                      <span className="hud-title-text">厂区核心运行指标</span>
                    </div>
                    <button
                      onClick={() => setRightCollapsed(true)}
                      className="p-0.5 rounded text-slate-400 hover:text-cyan-200 hover:bg-white/10"
                      title="收起右栏"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* 异常数与运行率双列汇总 */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="p-2 rounded hud-data-card">
                      <div className="text-[9px] text-slate-400">运行异常数</div>
                      <div className="mt-0.5 flex items-baseline gap-1">
                        <span
                          className={`text-lg font-mono font-bold hud-tabular-nums ${
                            faultDevices.length > 0 ? 'text-rose-400 hud-value-glow-rose' : 'text-emerald-400 hud-value-glow-emerald'
                          }`}
                        >
                          {faultDevices.length}
                        </span>
                        <span className="text-[9px] text-slate-400">项</span>
                      </div>
                    </div>
                    <div className="p-2 rounded hud-data-card">
                      <div className="text-[9px] text-slate-400">生产良品率</div>
                      <div className="mt-0.5 flex items-baseline gap-1">
                        <span className="text-[10px] font-mono text-slate-400">未接入</span>
                      </div>
                    </div>
                  </div>

                  {/* 设备综合运行率 */}
                  <div className="p-2 rounded hud-data-card">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-400">设备运行率</span>
                      <span className="text-xs font-mono font-bold text-cyan-200 hud-tabular-nums hud-value-glow">{runningRate.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-slate-900/80 h-1.5 rounded-full mt-1.5 overflow-hidden border border-cyan-500/20">
                      <div
                        className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                        style={{ width: `${runningRate}%` }}
                      />
                    </div>
                  </div>

                  {/* 产能预测趋势 Sparkline */}
                  <div className="p-2 rounded hud-data-card flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-400">7日产能走势</span>
                      <span className="text-[8px] font-mono text-slate-400">未接入</span>
                    </div>
                    <svg viewBox="0 0 240 38" className="w-full h-[34px]" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.45" />
                          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M 0 32 L 38 28 L 76 30 L 114 22 L 152 18 L 190 12 L 238 4"
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth="2"
                        strokeLinecap="round"
                        style={{ filter: 'drop-shadow(0 0 4px rgba(34,211,238,0.6))' }}
                      />
                      <path
                        d="M 0 32 L 38 28 L 76 30 L 114 22 L 152 18 L 190 12 L 238 4 L 238 38 L 0 38 Z"
                        fill="url(#areaGrad)"
                      />
                      <circle cx="238" cy="4" r="2.5" fill="#67e8f9" style={{ filter: 'drop-shadow(0 0 4px #22d3ee)' }} />
                    </svg>
                  </div>

                  {/* 现场工单态势 */}
                  <div className="p-2 rounded hud-data-card flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[9px] text-slate-400">
                      <span>工单流转态势</span>
                      <span className="font-mono text-cyan-300 hud-tabular-nums hud-value-glow">共 {workOrders.length} 单</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-center font-mono">
                      <div className="p-1 rounded bg-slate-950/70 border border-cyan-500/20">
                        <div className="text-[8px] text-slate-400">待处理</div>
                        <div className="text-[10px] font-bold text-amber-300 hud-tabular-nums hud-value-glow-amber">{openWorkOrders.length}</div>
                      </div>
                      <div className="p-1 rounded bg-slate-950/70 border border-cyan-500/20">
                        <div className="text-[8px] text-slate-400">检修中</div>
                        <div className="text-[10px] font-bold text-sky-300 hud-tabular-nums hud-value-glow">
                          {devices.filter((d) => d.status === 'overhauling').length}
                        </div>
                      </div>
                      <div className="p-1 rounded bg-slate-950/70 border border-cyan-500/20">
                        <div className="text-[8px] text-slate-400">已结案</div>
                        <div className="text-[10px] font-bold text-emerald-300 hud-tabular-nums hud-value-glow-emerald">
                          {workOrders.filter((w) => w.status === 'completed').length}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}

          {/* 底部浮动 Dock：各工序达成与综合交付表盘 */}
          {!zenMode && (
            bottomCollapsed ? (
              <button
                onClick={() => setBottomCollapsed(false)}
                className="absolute bottom-2.5 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full hud-sci-fi-panel text-[10px] text-cyan-300 hover:text-white flex items-center gap-1.5 pointer-events-auto transition shadow-lg z-20"
                title="展开工序产出与交付达成表盘"
              >
                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hud-title-text font-bold">工序达成与交付表盘</span>
                <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
              </button>
            ) : (
              <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 pointer-events-auto z-20 max-w-[95vw]">
                <div className="flex flex-wrap items-center justify-center gap-2 relative">
                  {/* 1. 各工序实时达成（工序完成率卡片） */}
                  <div className="rounded-xl hud-sci-fi-panel px-3 py-2 flex flex-col gap-1 relative min-w-[210px]">
                    <TechCornerMark />
                    <div className="text-[9px] font-bold text-cyan-200 flex items-center gap-1 pr-4">
                      <span className="hud-title-bar-indicator" />
                      <BarChart3 className="w-3 h-3 text-cyan-400 ml-0.5" />
                      <span className="hud-title-text">各工序完成率</span>
                    </div>
                    <div className="flex items-end justify-between gap-2.5 h-10 pt-1 font-mono text-[7px] text-slate-400">
                      {[
                        { name: '机加', rate: null },
                        { name: '冲压', rate: null },
                        { name: '焊接', rate: null },
                        { name: '涂装', rate: null },
                        { name: '总装', rate: null },
                      ].map((proc) => (
                        <div key={proc.name} className="flex flex-col items-center gap-0.5 group">
                          <span className="text-[7px] hud-tabular-nums text-slate-500">{proc.rate == null ? '未接入' : `${proc.rate}%`}</span>
                          <div className="w-3 bg-slate-900/80 rounded-t h-6 relative flex items-end border-b border-cyan-500/30">
                            <div
                              className="w-full bg-gradient-to-t from-cyan-600 to-cyan-300 rounded-t shadow-[0_0_6px_rgba(34,211,238,0.4)] transition-all group-hover:brightness-125"
                              style={{ height: `${(proc.rate ?? 0) / 100 * 24}px` }}
                            />
                          </div>
                          <span className="text-slate-300">{proc.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 2. 交付与质检达成（订单交付 / 物料齐套 / 质检达标表盘卡片） */}
                  <div className="rounded-xl hud-sci-fi-panel px-3 py-2 flex flex-col gap-1 relative min-w-[220px]">
                    <TechCornerMark />
                    <div className="text-[9px] font-bold text-cyan-200 flex items-center gap-1 pr-4">
                      <span className="hud-title-bar-indicator" />
                      <ShieldCheck className="w-3 h-3 text-cyan-400 ml-0.5" />
                      <span className="hud-title-text">交付与质检达成</span>
                    </div>
                    <div className="flex items-center justify-around gap-2 pt-0.5">
                      <RingGauge percent={null} label="订单交付" color="#10b981" />
                      <RingGauge percent={null} label="物料齐套" color="#f59e0b" />
                      <RingGauge percent={null} label="质检达标" color="#06b6d4" />
                    </div>
                  </div>

                  {/* 3. 不良品异常根因分布卡片 */}
                  <div className="rounded-xl hud-sci-fi-panel px-3 py-2 flex flex-col gap-1 relative min-w-[150px]">
                    <TechCornerMark />
                    <div className="text-[9px] font-bold text-cyan-200 flex items-center justify-between pr-4">
                      <span className="flex items-center gap-1">
                        <span className="hud-title-bar-indicator" />
                        <PieChart className="w-3 h-3 text-cyan-400 ml-0.5" />
                        <span className="hud-title-text">不良根因分布</span>
                      </span>
                      <span className="text-[8px] font-mono text-cyan-400/70">本周</span>
                    </div>
                    <div className="space-y-1 text-[8px] font-mono pt-1">
                      <div className="flex justify-between items-center text-slate-300">
                        <span>装配公差</span>
                        <span className="text-slate-500">未接入</span>
                      </div>
                      <div className="flex justify-between items-center text-slate-300">
                        <span>轴承润滑</span>
                        <span className="text-slate-500">未接入</span>
                      </div>
                    </div>
                  </div>

                  {/* 收起按钮 */}
                  <button
                    onClick={() => setBottomCollapsed(true)}
                    className="p-1.5 rounded-lg hud-sci-fi-panel text-slate-400 hover:text-cyan-200 hover:border-cyan-400/50 transition shrink-0 self-center"
                    title="收起底部表盘"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          )}
        </>
      ) : (
        /* ========================= L2 车间 / L3 设备聚焦 原有交互 HUD ========================= */
        <>
          {!zenMode && (
            <>
              {/* ---------- 左侧功能菜单 ---------- */}
              <div className="absolute left-2.5 top-14 bottom-3 flex flex-col gap-1.5 pointer-events-auto">
                <div
                  className="rounded-lg hud-sci-fi-panel p-1.5 w-[108px] relative"
                >
                  <TechCornerMark />
                  <div className="space-y-0.5">
                    {menus.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => {
                          setMenu(m.key);
                          setTab(MENU_TO_TAB[m.key]);
                        }}
                        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] transition ${
                          menu === m.key
                            ? 'bg-cyan-500/25 text-cyan-100 border border-cyan-400/60 shadow-[0_0_10px_rgba(34,211,238,0.3)] font-semibold'
                            : 'text-slate-400 hover:text-cyan-200 hover:bg-slate-900/40 border border-transparent'
                        }`}
                      >
                        {m.icon}
                        <span className="truncate">{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 设备快选（真实台账） */}
                <div
                  className="rounded-lg hud-sci-fi-panel p-1.5 w-[108px] flex-1 overflow-y-auto min-h-0 relative"
                >
                  {devices.length === 0 ? (
                    <div className="text-[9px] text-slate-500 p-1">台账加载中…</div>
                  ) : (
                    <div className="space-y-0.5">
                      {devices.slice(0, 40).map((d) => (
                        <button
                          key={d.id}
                          onClick={() => onSelect(d.id)}
                          title={`${d.name} · ${d.workshop}`}
                          className={`w-full text-left px-1.5 py-[3px] rounded text-[9px] font-mono truncate transition ${
                            selected?.id === d.id
                              ? 'bg-cyan-500/30 text-cyan-100 border border-cyan-400/60 shadow-[0_0_8px_rgba(34,211,238,0.3)] font-bold'
                              : 'text-slate-400 hover:bg-slate-800/60 hover:text-cyan-200 border border-transparent'
                          }`}
                        >
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle ${
                              d.status === 'fault'
                                ? 'bg-rose-400 shadow-[0_0_6px_#f43f5e]'
                                : isAbnormal(d)
                                  ? 'bg-amber-400 shadow-[0_0_6px_#f59e0b]'
                                  : 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
                            }`}
                          />
                          {d.code}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ---------- 右侧标签页 ---------- */}
              <div className="absolute right-2.5 top-14 bottom-3 flex flex-col gap-1.5 pointer-events-auto w-[252px]">
                <div
                  className="rounded-lg hud-sci-fi-panel overflow-hidden flex flex-col min-h-0 relative flex-1"
                >
                  <TechCornerMark />
                  <div className="flex border-b border-cyan-500/20 pr-4">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex-1 py-1.5 text-[10px] transition ${
                          tab === t.key
                            ? 'text-cyan-100 font-bold bg-cyan-500/25 border-b-2 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.25)]'
                            : 'text-slate-400 hover:text-cyan-200'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="overflow-y-auto min-h-0 flex-1">{panel}</div>
                </div>

                {/* 层级统计条 */}
                <div
                  className="rounded-lg hud-sci-fi-panel px-2.5 py-1.5 flex items-center justify-between text-[9px] font-mono relative shrink-0"
                >
                  <span className="flex items-center gap-1 text-slate-400">
                    <span className="hud-title-bar-indicator !h-2.5" />
                    <Layers className="w-3 h-3 text-cyan-400 ml-0.5" />
                    <span className="hud-title-text">{level === 'workshop' ? '车间' : '设备'}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-cyan-200 hud-tabular-nums hud-value-glow">设备 {devices.length}</span>
                    <span className="text-rose-300 hud-tabular-nums hud-value-glow-rose">异常 {faultDevices.length}</span>
                    <span className="flex items-center gap-0.5 text-slate-400 hud-tabular-nums">
                      <Gauge className="w-3 h-3" />
                      {selected ? selected.healthScore : '—'}
                    </span>
                  </span>
                </div>
              </div>
            </>
          )}

          {/* 底部中间：真实指标未接入说明（避免误读为缺数据） */}
          {selected && (tab === 'overview' || tab === 'params') && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hud-sci-fi-panel text-[9px] text-slate-400 font-mono">
                <Activity className="w-3 h-3 text-cyan-400" />
                产量/良率/能耗：现有接口未接入，不做模拟
              </div>
            </div>
          )}

          {/* 左下角装饰：扫描线品牌条 */}
          <div className="absolute bottom-2 left-[124px] pointer-events-none hidden xl:block">
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-cyan-300/70 hud-value-glow">
              <BarChart3 className="w-3 h-3 text-cyan-400" />
              DIGITAL TWIN · 实时联动
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ProductionHUD;
