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
import type { FactoryRankMetric, FactoryZoneView } from './factoryOverview';
import {
  ESTIMATE_NOTE,
  estimateDeviceEnergyPerDay,
  estimateDeviceOutput,
  estimateWorkshopMetrics,
  formatWan,
} from './factoryMetrics';
import { roleOfWorkshop } from './factoryBuildingTypes';
import { telemetryToStatus } from './statusMapping';
import { ExplodedViewButton } from './ExplodedViewButton';
import { WorkshopZoneNav } from './WorkshopZoneNav';
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
  /** 切层（左栏分区/车间卡片点回车间层） */
  onLevelChange?: (level: SceneLevel) => void;
  /** 点击具体车间下钻 */
  onDrillBuilding?: (buildingId: string, name?: string) => void;
  devices: Equipment[];
  selected: Equipment | null;
  telemetry: TelemetryHistory | null;
  workOrders: WorkOrder[];
  technicians?: Array<{ id?: string; name?: string; role?: string; title?: string; status?: string }>;
  onSelect: (id: string | null) => void;
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
  /** 厂区总览：分区视图（由 3D 引擎按真实台账聚合，含排名与在建工程信息） */
  factoryZones?: FactoryZoneView[];
  /** 当前选中的分区（点击分区地块 / 左侧分区列表） */
  activeZoneId?: string | null;
  /** 选中 / 取消选中分区 */
  onSelectZone?: (zoneId: string | null) => void;
  /** 切换分区排名口径（产值 / 故障率 / 健康分） */
  onRankMetricChange?: (metric: FactoryRankMetric) => void;
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
  running: 'text-emerald-400',
  normal: 'text-emerald-400',
  idle: 'text-slate-400',
  warning: 'text-amber-400',
  alert: 'text-amber-400',
  fault: 'text-rose-400',
  maintenance: 'text-sky-600',
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
    return <div className="text-[10px] text-slate-400 py-3">该指标暂无足够采样点</div>;
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
    <div className="flex items-baseline justify-between gap-2 py-[3px] border-b border-slate-200 last:border-0">
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
          <span className="absolute text-[9px] font-mono text-slate-400 whitespace-nowrap">未接入</span>
        ) : (
          <span className="absolute text-[9px] font-mono font-bold text-cyan-100 hud-tabular-nums hud-value-glow whitespace-nowrap">
            {percent.toFixed(1)}%
          </span>
        )}
      </div>
      <span className="text-[9px] text-slate-400 font-sans tracking-tight">{label}</span>
    </div>
  );
}

/* ========================= 组件 ========================= */

export const ProductionHUD: React.FC<ProductionHUDProps> = ({
  level,
  onLevelChange,
  onDrillBuilding,
  devices,
  selected,
  telemetry,
  workOrders,
  technicians,
  onSelect,
  fps,
  beltAnimation,
  onToggleBelt,
  productionLine,
  onToggleProductionLine,
  paused,
  onTogglePaused,
  weatherText,
  factoryZones,
  activeZoneId,
  onSelectZone,
  onRankMetricChange,
}) => {
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<RightTab>('overview');
  const [menu, setMenu] = useState<LeftMenu>('devices');
  const [metric, setMetric] = useState<keyof TelemetryPoint>('temperature');

  // 布局呼吸感与纯净模式控制（避免多重卡片挤压 3D 视野）
  const [zenMode, setZenMode] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // L3 设备聚焦层：左侧功能菜单默认收起为边缘窄 tab —— 给 3D 画布让出 ≥70% 宽度
  const [deviceMenuCollapsed, setDeviceMenuCollapsed] = useState(true);
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
  const statusColor = selected ? STATUS_COLOR[selected.status] ?? 'text-slate-400' : 'text-slate-400';

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
    // 产值口径：台账无产值字段 → 走 factoryMetrics 的角色定员估算（带 estimated
    // 标记，UI 必须标注估算），不展示写死金额；估算口径算不出时为"未接入"。
    const entries = Array.from(map.entries());
    // 台账为空时**返回空数组**，由 UI 显示"台账无数据"。
    // 曾经这里返回一份写死的占位清单（设备 4/4/3/3/2、其中一处异常数 1），
    // 那是把编造的数字当成实测值展示 —— 与"禁止模拟数据"的约束直接冲突，已移除。
    return entries.map(([name, data], idx) => {
      const m = estimateWorkshopMetrics({
        workshopName: name,
        devices: data.devices,
        indexInZone: idx,
        isAbnormal,
      });
      return {
        id: `hall-${idx + 1}`,
        name,
        count: data.devices.length,
        abnormalCount: data.abnormalCount,
        output: m.outputValue != null ? `${formatWan(m.outputValue)} 万元` : '未接入',
        estimated: m.estimated,
        status: (data.abnormalCount > 0 ? 'warning' : 'normal') as 'normal' | 'warning',
      };
    });
  }, [devices]);

  /**
   * 选中设备的三张经营指标卡。台账里没有"单机产量/良率/能耗"字段，口径为：
   * 产值 = factoryMetrics 的角色×重要度×工时×健康估算；良率 = 同车间估算；
   * 能耗 = 真实遥测电压电流按 √3·U·I·cosφ 折算。全部标注估算，缺读数写未接入。
   */
  const selectedEstimate = useMemo(() => {
    if (!selected) return null;
    const role = roleOfWorkshop(selected.workshop || '');
    const peers = devices.filter((d) => (d.workshop || '机加车间') === (selected.workshop || '机加车间'));
    const ws = estimateWorkshopMetrics({
      workshopName: selected.workshop || '',
      devices: peers,
      role,
      isAbnormal,
    });
    const energy = estimateDeviceEnergyPerDay(selected.telemetry);
    return {
      output: `${formatWan(Math.round(estimateDeviceOutput(selected, role)))} 万元`,
      yieldRate: ws.yieldRate != null ? `${ws.yieldRate.toFixed(1)}%` : '未接入',
      energy: energy != null ? `${Math.round(energy)}` : '未接入',
    };
  }, [selected, devices]);

  const runningRate = useMemo(() => {
    if (devices.length === 0) return 0;
    const running = devices.filter((d) => d.status === 'running' || d.status === 'standby').length;
    return (running / devices.length) * 100;
  }, [devices]);

  /**
   * 「各工序完成率」柱组：原来写死 机加99.1/冲压98.6/焊接99.4/涂装98.9/总装99.5，
   * 与台账无关。改为按真实车间算设备可动率 = 100 − 故障率（故障率来自台账异常台数）。
   */
  const workshopUptime = useMemo(
    () =>
      workshopSummaries.slice(0, 5).map((ws) => ({
        name: ws.name.replace(/车间|工段|站房?/g, '').slice(0, 2) || ws.name.slice(0, 2),
        rate: ws.count > 0 ? 100 - (ws.abnormalCount / ws.count) * 100 : 0,
      })),
    [workshopSummaries]
  );

  /** 「交付与质检达成」三环：全部由工单状态与台账健康分实算，不用写死百分比 */
  const deliveryGauges = useMemo(() => {
    const closed = workOrders.filter((w) => w.status === 'completed').length;
    const cancelled = workOrders.filter((w) => w.status === 'cancelled').length;
    const inFlow = workOrders.length - cancelled;
    const awaitingAccept = workOrders.filter((w) => w.status === 'pending_acceptance').length;
    const healths = devices.map((d) => d.healthScore).filter((v) => typeof v === 'number');
    return [
      {
        percent: inFlow > 0 ? (closed / inFlow) * 100 : null,
        label: '工单闭环率',
        color: '#10b981',
      },
      {
        percent: closed + awaitingAccept > 0 ? (closed / (closed + awaitingAccept)) * 100 : null,
        label: '验收通过率',
        color: '#f59e0b',
      },
      {
        percent: healths.length ? healths.reduce((a, b) => a + b, 0) / healths.length : null,
        label: '台账健康分',
        color: '#06b6d4',
      },
    ];
  }, [workOrders, devices]);

  /** 「异常台数构成」：按设备类别统计台账里的异常台，替代原来写死的两行公差/润滑文案 */
  const abnormalByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of faultDevices) {
      const cat = d.category || '未分类';
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count, share: (count / Math.max(1, faultDevices.length)) * 100 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }, [faultDevices]);

  /* ---------- 厂区总览：分区视图（由 3D 引擎按真实台账聚合，含排名与在建工程） ---------- */
  const zones = useMemo(() => factoryZones ?? [], [factoryZones]);
  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId) ?? null,
    [zones, activeZoneId]
  );
  const rankMetric = zones[0]?.rankMetric ?? 'failureRate';
  /** 厂房标签（如 "1 号厂房・机加车间"）→ 左侧车间列表项（id 与 3D 引擎 buildingId 对齐） */
  const workshopByName = (buildingName: string) =>
    workshopSummaries.find((w) => buildingName.includes(w.name)) ?? null;

  /**
   * 在建工程备注（去重）。来自 3D 引擎按真实备注带出的分区 constructionNote —— 进度就写在
   * 备注里（如「二期智能仓储与管廊工程（进度 85%）」），所以这里不做任何百分比推算。
   */
  const constructionNotes = Array.from(
    new Set(zones.map((z) => z.constructionNote).filter((n): n is string => !!n)),
  );

  const RANK_METRIC_LABEL: Record<FactoryRankMetric, string> = {
    output: '工业产值（高→低）',
    failureRate: '设备故障率（低→高）',
    health: '设备健康分（高→低）',
  };

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

  /**
   * 左栏宽度。车间现场层要放下「分区 → 车间 → 设备」三级（`WorkshopZoneNav`），
   * 原来 108px 是给一列 9px 设备码用的，三级缩进排不下；设备聚焦层保持原宽。
   */
  const leftColWidth = level === 'workshop' ? 'w-[176px]' : 'w-[108px]';

  const panel = (() => {
    if (!selected) {
      return (
        <div className="p-3 text-[11px] text-slate-400 leading-relaxed">
          <div className="flex items-center gap-1.5 text-cyan-200 mb-1 font-bold">
            <span className="hud-title-bar-indicator" />
            <Cpu className="w-3.5 h-3.5 text-cyan-400 ml-0.5" />
            <span className="hud-title-text">未选择设备</span>
          </div>
          在车间内点击任意设备查看其真实台账与遥测数据；
          <br />
          共接入 <span className="text-cyan-200 font-mono hud-tabular-nums hud-value-glow font-bold">{devices.length}</span> 台设备，
          其中异常 <span className="text-rose-400 font-mono hud-tabular-nums hud-value-glow-rose font-bold">{faultDevices.length}</span> 台。
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
              { k: '产值', v: selectedEstimate?.output ?? '—', n: '年·估算口径' },
              { k: '良率', v: selectedEstimate?.yieldRate ?? '—', n: '车间·估算口径' },
              { k: '能耗', v: selectedEstimate?.energy ?? '—', n: 'kWh/日·按实测UI' },
            ].map((x) => (
              <div key={x.k} className="rounded hud-data-card px-1.5 py-1">
                <div className="text-[9px] text-slate-400">{x.k}</div>
                <div className="text-[13px] font-mono hud-tabular-nums hud-value-glow text-cyan-100 font-bold">{x.v}</div>
                <div className="text-[8px] text-emerald-400">{x.n}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
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
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-400">
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
                <div className="text-[10px] text-rose-400 font-mono hud-tabular-nums">{w.orderNo}</div>
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
          <div className="text-[10px] text-slate-400 font-medium">场景开关</div>
          {[
            { k: '生产线', v: productionLine, set: onToggleProductionLine },
            { k: '传送带动画', v: beltAnimation, set: onToggleBelt },
            { k: '暂停动画', v: paused, set: onTogglePaused },
          ].map((x) => (
            <label key={x.k} className="flex items-center justify-between text-[10px] text-slate-400 hover:text-white cursor-pointer py-0.5">
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
      {/* ---------- 顶部浮片（半透明数字孪生浮片） ----------
          2026-10-16 起顶部只有一条实心 bar（工具栏），本层是浮在场景上的半透明浮片，
          延伸带已删，不要再把它加回来。
          左边一句「在哪一层」的模式说明（左片），右边「怎么看」
          （纯净视界 + 天气/日期/时间/帧率，右片），两颗各自绝对定位在 top-5。 */}
      {/* 左片（层级） */}
      <div className="absolute top-5 left-3 z-30 pointer-events-auto rounded-lg hud-floating-chip px-2.5 py-1 flex items-center gap-1.5 min-h-[32px] text-[11px] font-mono font-bold text-cyan-200">
        <Factory className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="tracking-wide hidden sm:inline" data-testid="equipment3d-level-label">
          {level === 'factory' ? '厂区总览态势' : level === 'workshop' ? '车间现场' : '单台设备聚焦'}
        </span>
      </div>

      {/* 右片（读数） */}
      <div className="absolute top-5 right-3 z-30 pointer-events-auto rounded-lg hud-floating-chip px-2 py-1 flex items-center gap-2 min-h-[32px] text-[11px] font-mono">
        <button
          onClick={() => setZenMode((prev) => !prev)}
          className={`px-2 py-0.5 flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
            zenMode
              ? 'text-cyan-100 bg-cyan-500/20 rounded-md'
              : 'text-slate-400 hover:text-white'
          }`}
          title={zenMode ? '恢复大屏仪表卡片' : '收起全部浮动卡片，纯享 3D 厂区漫游'}
        >
          {zenMode ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
          <span>{zenMode ? '恢复面板' : '纯净视界'}</span>
        </button>

        {weatherText && <span className="hidden sm:inline text-cyan-200">{weatherText}</span>}
        <span className="hidden sm:inline text-slate-400">{dateText}</span>
        <span className="text-cyan-100 font-semibold">{timeText}</span>
        {typeof fps === 'number' && (
          <span className={`hidden md:inline ${fps >= 30 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {fps.toFixed(0)} FPS
          </span>
        )}
      </div>

      {level === 'factory' ? (
        /* ========================= L1 厂区大屏布局 ========================= */
        <>
          {/* 左侧：分区车间分布列表 + 园区基础设施 */}
          {!zenMode && (
            leftCollapsed ? (
              <button
                onClick={() => setLeftCollapsed(false)}
                className="absolute left-2.5 top-[70px] px-1.5 py-3 rounded-r-lg hud-sci-fi-panel text-[10px] text-cyan-200 hover:text-white flex flex-col items-center gap-1.5 pointer-events-auto transition shadow-lg z-20"
                title="展开车间分布"
              >
                <Factory className="w-3.5 h-3.5" />
                <span className="text-[9px]">车间</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <div className="absolute left-2.5 top-[70px] flex flex-col gap-2 pointer-events-auto w-[240px] max-h-[calc(100%-134px)] z-20">
                {/* 分区工厂分布列表（分区 → 该区厂房，点击分区选中 / 点击厂房下钻） */}
                <div
                  className="rounded-lg hud-sci-fi-panel p-2.5 flex flex-col gap-2 min-h-0 overflow-hidden relative"
                >
                  <TechCornerMark />
                  <div className="flex items-center justify-between pb-1.5 border-b border-cyan-500/20 pr-4">
                    <div className="flex items-center gap-1.5 text-cyan-200 text-[11px] font-bold">
                      <span className="hud-title-bar-indicator" />
                      <Factory className="w-3.5 h-3.5 text-cyan-400 ml-0.5" />
                      <span className="hud-title-text">分区工厂分布</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-mono hud-tabular-nums text-cyan-400/90 bg-cyan-950/60 border-cyan-500/40">
                        {zones.length || workshopSummaries.length} 分区
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

                  <div className="overflow-y-auto space-y-1 pr-0.5 min-h-0 max-h-[260px]">
                    {zones.length > 0
                      ? zones.map((z) => (
                          /* 一个分区一块卡：首行 = 色块 + 名称 +（有异常才补的）⚠ + 设备/异常 + 排名徽章；
                             下面挂该分区厂房（一行一厂房 + 「进入 ›」直接下钻）。
                             2026-09-22 用户发来旧版截图「这样的效果」⇒ 厂房清单从"点中之后的
                             右侧成绩卡"挪回左栏：左栏才是能一眼看到全部分区厂房的地方。 */
                          <div
                            key={z.id}
                            data-testid="factory-zone-row"
                            data-zone-id={z.id}
                            data-zone-rank={z.rank || ''}
                            className={`p-1.5 rounded hud-data-card transition flex flex-col gap-1 cursor-pointer border ${
                              activeZoneId === z.id
                                ? 'border-cyan-400/70 shadow-[0_0_10px_rgba(34,211,238,0.35)]'
                                : 'border-transparent'
                            }`}
                            onClick={() => onSelectZone?.(activeZoneId === z.id ? null : z.id)}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-cyan-100">
                                <span
                                  className="w-2 h-2 rounded-sm shrink-0"
                                  style={{ background: z.color, boxShadow: `0 0 6px ${z.color}` }}
                                />
                                <span className="truncate">{z.name}</span>
                                {z.status !== 'normal' && (
                                  <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] hud-tabular-nums">
                                <span className="text-slate-400">
                                  设备 {z.deviceCount} · 异常{' '}
                                  <strong
                                    className={
                                      z.abnormalCount > 0
                                        ? 'text-rose-400 font-semibold hud-value-glow-rose'
                                        : 'text-slate-400 font-normal'
                                    }
                                  >
                                    {z.abnormalCount}
                                  </strong>
                                </span>
                                {z.rank > 0 && (
                                  <span
                                    className={`text-[9px] font-bold px-1.5 py-[1px] rounded border ${
                                      z.rank === 1
                                        ? 'text-emerald-400 border-emerald-400/50 bg-emerald-500/15'
                                        : 'text-cyan-200 border-cyan-400/40 bg-cyan-500/10'
                                    }`}
                                    title={`排名口径：${RANK_METRIC_LABEL[z.rankMetric]}`}
                                  >
                                    #{z.rank}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 该分区下属厂房：一行一厂房 +「进入 ›」直接下钻。
                                bn 本身就是「N 号厂房・车间名」，别再拼一次车间名。 */}
                            {z.buildingNames.length > 0 && (
                              <div className="flex flex-col gap-0.5 pt-1 border-t border-cyan-500/15">
                                {z.buildingNames.map((bn, bi) => {
                                  const bid = z.buildingIds?.[bi] ?? `${z.id}-bld-${bi}`;
                                  const ws = workshopByName(bn);
                                  return (
                                    <div
                                      key={bid}
                                      className="flex items-center justify-between gap-1 text-[10px] text-slate-400"
                                    >
                                      <span className="truncate" title={bn}>
                                        {bn}
                                      </span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (onDrillBuilding) onDrillBuilding(ws?.id ?? bid, ws?.name ?? bn);
                                          else onLevelChange?.('workshop');
                                        }}
                                        className="px-1.5 py-[1px] rounded bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 border border-cyan-400/40 text-[9px] flex items-center gap-0.5 transition shadow-[0_0_6px_rgba(34,211,238,0.2)] shrink-0"
                                      >
                                        进入
                                        <ChevronRight className="w-2.5 h-2.5" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))
                      : workshopSummaries.length === 0 ? (
                          <div className="p-3 rounded hud-data-card text-[10px] text-slate-400 text-center leading-relaxed">
                            设备台账为空，暂无车间数据
                            <br />
                            <span className="text-[9px] text-slate-400">无数据时不做推算、不模拟</span>
                          </div>
                        ) : workshopSummaries.map((ws) => (
                          <div
                            key={ws.id}
                            className="p-1.5 rounded hud-data-card transition flex items-center justify-between gap-2 cursor-pointer"
                            onClick={() => {
                              if (onDrillBuilding) onDrillBuilding(ws.id, ws.name);
                              else onLevelChange?.('workshop');
                            }}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-cyan-100">
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  ws.status === 'warning'
                                    ? 'bg-amber-400 shadow-[0_0_8px_#f59e0b]'
                                    : 'bg-emerald-400 shadow-[0_0_8px_#10b981]'
                                }`}
                              />
                              <span className="truncate">{ws.name}</span>
                            </div>
                            <span className="shrink-0 flex items-center gap-1.5 font-mono text-[10px] hud-tabular-nums">
                              <span className="text-slate-400">{ws.count} 台</span>
                              {ws.abnormalCount > 0 && (
                                <span className="text-rose-400 font-semibold hud-value-glow-rose">
                                  异常 {ws.abnormalCount}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
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
                className="absolute right-2.5 top-[70px] px-1.5 py-3 rounded-l-lg hud-sci-fi-panel text-[10px] text-cyan-200 hover:text-white flex flex-col items-center gap-1.5 pointer-events-auto transition shadow-lg z-20"
                title="展开指标看板"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span className="text-[9px]">指标</span>
                <ChevronLeft className="w-3 h-3" />
              </button>
            ) : (
              <div className="absolute right-2.5 top-[70px] flex flex-col gap-2 pointer-events-auto w-[240px] max-h-[calc(100%-134px)] z-20">
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

                  {/* ===== 分区成绩卡（点击分区后展示：产值 / 良品率 / 设备故障率 / 在建工程） ===== */}
                  {activeZone && (
                    <div
                      data-testid="factory-zone-scorecard"
                      data-zone-id={activeZone.id}
                      className="p-2 rounded hud-data-card flex flex-col gap-1.5 border border-cyan-400/40 shadow-[0_0_10px_rgba(34,211,238,0.18)]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-100">
                          <span
                            className="w-2 h-2 rounded-sm shrink-0"
                            style={{ background: activeZone.color, boxShadow: `0 0 6px ${activeZone.color}` }}
                          />
                          <span className="truncate">{activeZone.name} · 分区成绩</span>
                          {activeZone.rank > 0 && (
                            <span
                              className={`text-[9px] font-mono font-bold px-1 rounded border ${
                                activeZone.rank === 1
                                  ? 'text-emerald-400 border-emerald-400/50 bg-emerald-500/15'
                                  : 'text-cyan-200 border-cyan-400/40 bg-cyan-500/10'
                              }`}
                            >
                              #{activeZone.rank}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => onSelectZone?.(null)}
                          className="p-0.5 rounded text-slate-400 hover:text-rose-400 hover:bg-white/10"
                          title="取消选中分区"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>

                      {/* 三项经营指标：产值 / 良品率 + 设备故障率（真实可算） */}
                      <div className="grid grid-cols-2 gap-1">
                        <div className="p-1.5 rounded bg-slate-950/70 border border-cyan-500/20">
                          <div className="text-[10px] text-slate-400">工业产值</div>
                          <div className="mt-0.5 text-[12px] font-mono font-bold hud-tabular-nums">
                            <span className="text-cyan-100 hud-value-glow">
                              {activeZone.outputValue != null
                                ? formatWan(activeZone.outputValue)
                                : '未接入'}
                              <span className="text-[10px] font-normal text-slate-400 ml-0.5">
                                {activeZone.outputValue != null ? '万元' : ''}
                              </span>
                              {activeZone.estimated && activeZone.outputValue != null && (
                                <span className="text-[10px] font-normal text-amber-300/80 ml-0.5">估</span>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="p-1.5 rounded bg-slate-950/70 border border-cyan-500/20">
                          <div className="text-[10px] text-slate-400">生产良品率</div>
                          <div className="mt-0.5 text-[12px] font-mono font-bold hud-tabular-nums">
                            <span className="text-cyan-100 hud-value-glow">
                              {activeZone.yieldRate != null
                                ? `${activeZone.yieldRate.toFixed(1)}%${activeZone.estimated ? ' 估' : ''}`
                                : '未接入'}
                            </span>
                          </div>
                        </div>
                        <div className="p-1.5 rounded bg-slate-950/70 border border-cyan-500/20">
                          <div className="text-[10px] text-slate-400">设备故障率</div>
                          <div className="mt-0.5 text-[12px] font-mono font-bold hud-tabular-nums">
                            <span
                              className={
                                (activeZone.failureRate ?? 0) > 0
                                  ? 'text-rose-400 hud-value-glow-rose'
                                  : 'text-cyan-100 hud-value-glow'
                              }
                            >
                              {(activeZone.failureRate ?? 0).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <div className="p-1.5 rounded bg-slate-950/70 border border-cyan-500/20">
                          <div className="text-[10px] text-slate-400">设备健康分</div>
                          <div className="mt-0.5 text-[12px] font-mono font-bold hud-tabular-nums">
                            <span className="text-cyan-200 hud-value-glow">
                              {activeZone.healthAvg == null ? '未接入' : activeZone.healthAvg.toFixed(1)}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            未闭环工单 {activeZone.openWorkOrders ?? 0}
                          </div>
                        </div>
                      </div>

                      {/* 在建工程所在地：没有真实备注就不占一行（曾经的 ?? 写死地名已删） */}
                      {activeZone.constructionNote && (
                        <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-200">
                          <span className="flex items-center gap-1 text-amber-200/90">
                            <HardHat className="w-3 h-3 text-amber-400" />
                            在建工程
                          </span>
                          <span className="text-amber-400/90 font-mono truncate max-w-[132px]">
                            {activeZone.constructionNote}
                          </span>
                        </div>
                      )}

                      {/* 厂房清单不再在这里列：2026-09-22 已挪回左栏分区卡（每个分区一行一厂房 +
                          「进入 ›」），左栏能一眼看全，这里再列一遍就是同一个清单说两遍。
                          本卡只留选中分区的成绩读数。 */}
                    </div>
                  )}

                  {/* 排名口径切换 */}
                  {zones.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] text-slate-400 shrink-0">排名口径</span>
                      {(['output', 'failureRate', 'health'] as FactoryRankMetric[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => onRankMetricChange?.(m)}
                          disabled={m === 'output' && !zones.some((z) => z.outputValue != null)}
                          className={`px-1.5 py-[2px] rounded text-[8px] border transition ${
                            rankMetric === m
                              ? 'border-cyan-400/70 text-cyan-100 bg-cyan-500/25'
                              : m === 'output' && !zones.some((z) => z.outputValue != null)
                                ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                                : 'border-slate-700 text-slate-400 hover:text-cyan-200'
                          }`}
                          title={
                            m === 'output' && !zones.some((z) => z.outputValue != null)
                              ? '产值数据源未接入，无法按产值排名'
                              : RANK_METRIC_LABEL[m]
                          }
                        >
                          {m === 'output' ? '产值' : m === 'failureRate' ? '故障率' : '健康分'}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 运行异常：全大屏唯一的异常计数大字。
                      之前同一个数在三处出现（这里 + 底部类别卡标题 + 左栏各行），
                      现在左栏只在该区有异常时补一句「异常 N」，底部那格只讲类别占比；
                      良率也不再在这里重复一次 —— 它属于分区成绩卡。 */}
                  <div className="p-2 rounded hud-data-card">
                    <div className="text-[10px] text-slate-400">运行异常</div>
                    <div className="mt-0.5 flex items-baseline gap-1">
                      <span
                        className={`text-lg font-mono font-bold hud-tabular-nums ${
                          faultDevices.length > 0 ? 'text-rose-400 hud-value-glow-rose' : 'text-emerald-400 hud-value-glow-emerald'
                        }`}
                      >
                        {faultDevices.length}
                      </span>
                      <span className="text-[10px] text-slate-400">台</span>
                    </div>
                  </div>

                  {/* 设备综合运行率挪到底部「各车间设备可动率」的标题行：
                      全局率和分车间柱状图本来就是同一件事的两个粒度，拆成两栏反而要读两遍。
                      同栏原有的「7 日产能走势」整块删除 —— 折线点位与日均件数都是字面量，
                      没有任何排产数据源（假数守卫见 tests/factory-metrics-honesty.test.ts）。 */}

                  {/* 现场工单态势 */}
                  <div className="p-2 rounded hud-data-card flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>工单流转态势</span>
                      <span className="font-mono text-cyan-200 hud-tabular-nums hud-value-glow">共 {workOrders.length} 单</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-center font-mono">
                      <div className="p-1 rounded bg-slate-950/70 border border-cyan-500/20">
                        <div className="text-[10px] text-slate-400">待处理</div>
                        <div className="text-[11px] font-bold text-amber-400 hud-tabular-nums hud-value-glow-amber">{openWorkOrders.length}</div>
                      </div>
                      <div className="p-1 rounded bg-slate-950/70 border border-cyan-500/20">
                        <div className="text-[10px] text-slate-400">检修中</div>
                        <div className="text-[11px] font-bold text-cyan-200 hud-tabular-nums hud-value-glow">
                          {devices.filter((d) => d.status === 'overhauling').length}
                        </div>
                      </div>
                      <div className="p-1 rounded bg-slate-950/70 border border-cyan-500/20">
                        <div className="text-[10px] text-slate-400">已结案</div>
                        <div className="text-[11px] font-bold text-slate-200 hud-tabular-nums">
                          {workOrders.filter((w) => w.status === 'completed').length}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 园区物流与工程动态（2026-09-22 按旧版截图恢复）。
                    ⚠️ 旧版这张卡是写死的通道状态 + 工程进度百分比（假数守卫里就钉着那条串），
                    已按数据纪律换掉：在建工程直接取分区的 constructionNote
                    （真实备注，进度就写在备注里）。
                    「园区通道通行」那半张卡**没有真实数据源**——库里只有巡检单的 route 字段，
                    没有道路 / 物流 / 闸机的通行状态，所以不编，显式落「未接入」。 */}
                <div className="rounded-lg hud-sci-fi-panel p-2 flex flex-col gap-1.5 shrink-0 text-[10px] relative">
                  <TechCornerMark />
                  <div className="flex items-center justify-between text-slate-300 font-mono text-[9px] pr-3">
                    <span className="flex items-center gap-1 text-cyan-300 font-sans font-semibold">
                      <span className="hud-title-bar-indicator" />
                      <Truck className="w-3 h-3 text-cyan-400 ml-0.5" />
                      <span className="hud-title-text">园区物流与工程动态</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-400 font-mono text-[9px]">
                    <span className="flex items-center gap-1 font-sans">
                      <Truck className="w-3 h-3 text-slate-500" />
                      园区通道通行
                    </span>
                    <span className="text-slate-500">未接入</span>
                  </div>

                  {constructionNotes.length > 0 ? (
                    constructionNotes.slice(0, 2).map((note) => (
                      <div
                        key={note}
                        className="flex items-start justify-between gap-1 text-amber-200/90 pt-1 border-t border-cyan-500/15 font-mono text-[9px]"
                      >
                        <span className="flex items-center gap-1 font-sans shrink-0">
                          <HardHat className="w-3 h-3 text-amber-400" />
                          在建工程
                        </span>
                        <span className="text-amber-300/90 text-right truncate" title={note}>
                          {note}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-between text-slate-500 pt-1 border-t border-cyan-500/15 text-[9px]">
                      <span className="flex items-center gap-1 font-sans">
                        <HardHat className="w-3 h-3 text-slate-500" />
                        在建工程
                      </span>
                      <span>未接入</span>
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {/* 底部浮动 Dock：各工序达成与综合交付表盘 */}
          {!zenMode && (
            bottomCollapsed ? (
              <button
                onClick={() => setBottomCollapsed(false)}
                className="absolute bottom-2.5 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full hud-sci-fi-panel text-[10px] text-cyan-200 hover:text-white flex items-center gap-1.5 pointer-events-auto transition shadow-lg z-20"
                title="展开产出与交付表盘"
              >
                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hud-title-text font-bold">产出与交付</span>
                <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
              </button>
            ) : (
              <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 pointer-events-auto z-20 max-w-[95vw]">
                {/* 间距 16px（gap-4）+ 三卡等高：容器用 items-stretch，卡片给 90px 最小高
                    兜住最矮的那块，最高的「交付与检修达成」（环形表盘 48px + 标签）决定实际
                    行高，因此三块视觉上严格等高，而不会像写死固定高那样把表盘标签裁掉。 */}
                <div className="flex flex-wrap items-stretch justify-center gap-4 relative">
                  {/* 1. 各工序实时达成（工序完成率卡片）
                         综合可动率写进标题行：全局一个数 + 分车间柱状图，同一件事的两种粒度。 */}
                  <div className="rounded-xl hud-sci-fi-panel px-3 py-2 flex flex-col gap-1 relative min-w-[210px] min-h-[90px]">
                    <TechCornerMark />
                    <div className="text-[10px] font-bold text-cyan-200 flex items-center justify-between gap-2 pr-4">
                      <span className="flex items-center gap-1">
                        <span className="hud-title-bar-indicator" />
                        <BarChart3 className="w-3 h-3 text-cyan-400 ml-0.5" />
                        <span className="hud-title-text">各车间设备可动率</span>
                      </span>
                      <span className="font-mono font-bold text-cyan-200 hud-tabular-nums hud-value-glow">
                        综合 {runningRate.toFixed(1)}%
                      </span>
                    </div>
                    {/* 列高 = 数值 12 + 间距 4 + 柱 24 + 间距 4 + 名称 12 ≈ 56px；
                        上一版容器只有 h-10(40px)，数值与名称两行文字挤在柱子上沿。 */}
                    <div className="flex items-end justify-between gap-2.5 h-[56px] pt-1 font-mono text-[10px] text-slate-400">
                      {workshopUptime.map((proc, pIdx) => (
                        <div key={`${proc.name || 'proc'}-${pIdx}`} className="flex flex-col items-center gap-1 group min-w-0">
                          <span className="text-[10px] hud-tabular-nums text-slate-300 whitespace-nowrap">
                            {proc.rate.toFixed(1)}%
                          </span>
                          <div className="w-3 bg-slate-900/80 rounded-t h-6 relative flex items-end border-b border-cyan-500/30">
                            <div
                              className="w-full bg-gradient-to-t from-cyan-600 to-cyan-300 rounded-t shadow-[0_0_6px_rgba(34,211,238,0.4)] transition-all group-hover:brightness-125"
                              style={{ height: `${(proc.rate / 100) * 24}px` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-400 truncate max-w-[46px]">{proc.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 2. 交付与质检达成（订单交付 / 物料齐套 / 质检达标表盘卡片） */}
                  <div className="rounded-xl hud-sci-fi-panel px-3 py-2 flex flex-col gap-1 relative min-w-[220px] min-h-[90px]">
                    <TechCornerMark />
                    <div className="text-[9px] font-bold text-cyan-200 flex items-center gap-1 pr-4">
                      <span className="hud-title-bar-indicator" />
                      <ShieldCheck className="w-3 h-3 text-cyan-400 ml-0.5" />
                      <span className="hud-title-text">交付与检修达成</span>
                    </div>
                    <div className="flex items-center justify-around gap-2 pt-0.5">
                      {deliveryGauges.map((g) => (
                        <RingGauge key={g.label} percent={g.percent} label={g.label} color={g.color} />
                      ))}
                    </div>
                  </div>

                  {/* 3. 异常台数按类别构成（只讲构成，那一个大数在右栏，这里不再重复） */}
                  <div className="rounded-xl hud-sci-fi-panel px-3 py-2 flex flex-col gap-1 relative min-w-[150px] min-h-[90px]">
                    <TechCornerMark />
                    <div className="text-[10px] font-bold text-cyan-200 flex items-center gap-1 pr-4">
                      <span className="hud-title-bar-indicator" />
                      <PieChart className="w-3 h-3 text-cyan-400 ml-0.5" />
                      <span className="hud-title-text">异常类别构成</span>
                    </div>
                    <div className="space-y-1 text-[10px] font-mono pt-1">
                      {abnormalByCategory.length === 0 ? (
                        <div className="text-emerald-400">无异常台</div>
                      ) : (
                        abnormalByCategory.map((c) => (
                          <div key={c.name} className="flex justify-between items-center gap-2 text-slate-300 min-w-0">
                            <span className="truncate">{c.name}</span>
                            <span className="text-cyan-300 hud-tabular-nums whitespace-nowrap">
                              {c.count} 台 · {c.share.toFixed(0)}%
                            </span>
                          </div>
                        ))
                      )}
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
              {/* ---------- 左侧功能菜单（聚焦层默认收起为窄 tab，点击展开） ---------- */}
              {level === 'device' && deviceMenuCollapsed ? (
                <button
                  onClick={() => setDeviceMenuCollapsed(false)}
                  className="absolute left-2.5 top-[70px] px-1.5 py-3 rounded-r-lg hud-sci-fi-panel text-[10px] text-cyan-200 hover:text-white flex flex-col items-center gap-1.5 pointer-events-auto transition shadow-lg z-20"
                  title="展开功能菜单与设备列表"
                >
                  <ListTree className="w-3.5 h-3.5" />
                  <span className="text-[9px]">设备</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              ) : (
              <div className={`absolute left-2.5 top-[70px] bottom-3 flex flex-col gap-1.5 pointer-events-auto ${leftColWidth}`}>
                <div
                  className={`rounded-lg hud-sci-fi-panel p-1.5 relative shrink-0 ${leftColWidth}`}
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

                {/* 车间现场层 = **分区 → 车间 → 设备** 三级导航（`WorkshopZoneNav`）。
                    原来这里是一张全厂设备的平铺清单（最多 40 台），一进车间现场就能点到任意
                    车间里的任意设备 —— 用户看到的就是"跳步"。改为：未选分区时一台设备都不列。
                    设备聚焦层保持原有「设备快选」，方便在设备之间快速切换。 */}
                <div
                  className={`rounded-lg hud-sci-fi-panel p-1.5 flex-1 min-h-0 relative flex flex-col ${leftColWidth}`}
                >
                  <TechCornerMark />
                  {level === 'workshop' ? (
                    <WorkshopZoneNav
                      compact
                      className="flex-1 min-h-0"
                      zones={zones}
                      devices={devices}
                      activeZoneId={activeZoneId ?? null}
                      onSelectZone={(id) => onSelectZone?.(id)}
                      onSelectDevice={onSelect}
                      selectedDeviceId={selected?.id ?? null}
                    />
                  ) : devices.length === 0 ? (
                    <div className="text-[9px] text-slate-400 p-1">台账加载中…</div>
                  ) : (
                    <div data-testid="hud-device-quicklist" className="space-y-0.5 overflow-y-auto min-h-0">
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

              )}
              {level === 'device' && !deviceMenuCollapsed && (
                <button
                  onClick={() => setDeviceMenuCollapsed(true)}
                  className="absolute left-2.5 bottom-3 px-1.5 py-1 rounded-r-lg hud-sci-fi-panel text-[9px] text-slate-400 hover:text-cyan-200 pointer-events-auto transition z-20"
                  title="收起功能菜单"
                >
                  ⟨ 收起
                </button>
              )}

              {/* ---------- 右侧标签页 ---------- */}
              <div
                data-testid="hud-right-panel"
                className="absolute right-2.5 top-[70px] bottom-3 flex flex-col gap-1.5 pointer-events-auto w-[252px]"
              >
                <div
                  className="rounded-lg hud-sci-fi-panel overflow-hidden flex flex-col min-h-0 relative flex-1"
                >
                  <TechCornerMark />
                  <div className="flex border-b border-cyan-500/20 pr-4">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex-1 py-1.5 text-[9px] whitespace-nowrap transition ${
                          tab === t.key
                            ? 'text-cyan-100 font-bold bg-cyan-500/25 border-b-2 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.25)]'
                            : 'text-slate-400 hover:text-cyan-200'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {/* 设备操作条：拆解视图是**整页新标签页**打开的独立单页（自带 three.js），
                      不再塞进这块 250px 宽的侧栏里。选中设备后常驻，切标签页不丢。 */}
                  {selected && (
                    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-cyan-500/20 shrink-0">
                      <span className="text-[9px] font-mono text-slate-400 truncate">{selected.code}</span>
                      <ExplodedViewButton deviceId={selected.id} deviceName={selected.name} compact className="ml-auto shrink-0" />
                    </div>
                  )}
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
                    <span className="text-rose-400 hud-tabular-nums hud-value-glow-rose">异常 {faultDevices.length}</span>
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
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hud-sci-fi-panel text-[9px] text-slate-300 font-mono">
                <Activity className="w-3 h-3 text-cyan-400" />
                能耗按实测电压电流折算；产值/良率{ESTIMATE_NOTE}
              </div>
            </div>
          )}

        </>
      )}
    </div>
  );
};

export default ProductionHUD;
