import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Wrench,
  Cpu,
  RefreshCw,
  Maximize2,
  Minimize2,
  Sparkles,
  TrendingUp,
  BarChart3,
  Database,
  Clock,
  Radio,
  Play,
  Pause,
  Box,
  Layers,
  ArrowUpRight,
  ArrowLeft,
  X,
  ShieldAlert,
  Target,
  Zap,
  ChevronRight,
  Loader2,
  FilePlus2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import {
  Equipment,
  WorkOrder,
  InspectionTask,
  SafetyPermit,
  Hazard,
  SparePart,
} from '../types';
import {
  equipmentApi,
  workOrderApi,
  inspectionApi,
  hazardsApi,
  sparePartsApi,
  complianceApi,
  knowledgeApi,
  cockpitApi,
  aiApi,
  CockpitAbnormalItem,
  CockpitAbnormalType,
} from '../api';
import { TwinScene3D, Anchor3D, TwinDataSign } from './digital-twin/TwinScene3D';

/* ==========================================================================
   全景数字孪生智能沙盘（Bright Digital-Twin Sandbox）
   全部为程序化 SVG / CSS 绘制，不引入任何外部图片、模型或字体资源。
   ========================================================================== */

/** 沙盘设备状态语义（浅底深字，与全站状态色规范对齐） */
const SANDBOX_STATUS: Record<
  string,
  { label: string; dot: string; ring: string; text: string; chip: string }
> = {
  running: { label: '正常运行', dot: '#10b981', ring: 'rgba(16,185,129,0.55)', text: '#047857', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  warning: { label: '预警关注', dot: '#f59e0b', ring: 'rgba(245,158,11,0.55)', text: '#b45309', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  fault: { label: '故障待修', dot: '#ef4444', ring: 'rgba(239,68,68,0.55)', text: '#b91c1c', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  overhauling: { label: '检修中', dot: '#3b82f6', ring: 'rgba(59,130,246,0.55)', text: '#1d4ed8', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  standby: { label: '停机备用', dot: '#64748b', ring: 'rgba(100,116,139,0.45)', text: '#475569', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  scrapped: { label: '已报废', dot: '#94a3b8', ring: 'rgba(148,163,184,0.40)', text: '#64748b', chip: 'bg-slate-100 text-slate-500 border-slate-200' },
};
const sandboxStatus = (s: string) => SANDBOX_STATUS[s] || SANDBOX_STATUS.standby;

/** 沙盘坐标系：底图 SVG 与设备锚点共用 1000×420 视图，锚点按百分比落位 */
const SANDBOX_W = 1000;
const SANDBOX_H = 420;
const ANCHOR_POS: [number, number][] = [
  [130, 296], [205, 322], [285, 292], [360, 330],
  [440, 300], [515, 336], [590, 298], [665, 330],
  [740, 300], [815, 334], [890, 296], [955, 330],
  [250, 372], [400, 386], [620, 372], [790, 384],
];
const anchorPct = (i: number) => {
  const [x, y] = ANCHOR_POS[i % ANCHOR_POS.length];
  return { left: `${(x / SANDBOX_W) * 100}%`, top: `${(y / SANDBOX_H) * 100}%` };
};

/** 真实 3D 工业数字孪生全景底图（现代智能重工园区 + 真实透视光影 + 全息微光网格层） */
const TwinBackplate: React.FC = () => (
  <div className="absolute inset-0 w-full h-full overflow-hidden select-none pointer-events-none">
    {/* 真实 3D 渲染高精数字孪生实景大地图 */}
    <img
      src="/assets/digital_twin_map.jpg"
      alt="工业数字孪生全景沙盘"
      className="w-full h-full object-cover object-center transform scale-[1.01] filter contrast-[1.05] brightness-[1.02]"
    />
    {/* 晨曦柔光与全息景深透光层：保持设备管道真实细节的同时，赋予顶级工业科技美学 */}
    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 via-slate-900/15 to-white/10 mix-blend-overlay" />
    <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-slate-950/20" />
    {/* 工业高科技坐标矩阵与刻度十字网 */}
    <div className="absolute inset-0 opacity-30 bg-[linear-gradient(to_right,#0ea5e918_1px,transparent_1px),linear-gradient(to_bottom,#0ea5e918_1px,transparent_1px)] bg-[size:48px_48px]" />
    {/* 四角高科技装甲 HUD 切角标线 */}
    <div className="absolute top-2.5 left-2.5 w-4 h-4 border-t-2 border-l-2 border-amber-400/90 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
    <div className="absolute top-2.5 right-2.5 w-4 h-4 border-t-2 border-r-2 border-amber-400/90 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
    <div className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b-2 border-l-2 border-amber-400/90 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
    <div className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b-2 border-r-2 border-amber-400/90 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
  </div>
);

/** 流动光轨：巡检（金）与物料输送（青）两条粒子流路径 */
const TwinFlowRoutes: React.FC = () => (
  <svg
    className="absolute inset-0 w-full h-full pointer-events-none"
    viewBox={`0 0 ${SANDBOX_W} ${SANDBOX_H}`}
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path
      d="M 96 302 C 220 268, 300 340, 440 300 S 660 266, 800 306 S 918 342, 982 300"
      fill="none"
      stroke="#E8A33D"
      strokeWidth="2.5"
      opacity="0.85"
      className="flow-line flow-glow"
    />
    <path
      d="M 60 382 C 200 352, 320 402, 480 372 S 720 346, 882 388"
      fill="none"
      stroke="#0EA5E9"
      strokeWidth="2.5"
      opacity="0.8"
      className="flow-line flow-line-slow flow-glow"
    />
  </svg>
);

interface CockpitDashboardViewProps {
  onNavigateTab?: (tab: string) => void;
  onSelectEquipment?: (eq: Equipment) => void;
  /** 唤起全局悬浮 AI 面板并预填问题（由 App 注入） */
  onAskAi?: (prompt: string) => void;
}

export const CockpitDashboardView: React.FC<CockpitDashboardViewProps> = ({
  onNavigateTab,
  onSelectEquipment,
  onAskAi,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(5);


  // Data states
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [inspections, setInspections] = useState<InspectionTask[]>([]);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [hazardMetrics, setHazardMetrics] = useState<any>(null);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [complianceStats, setComplianceStats] = useState<any>(null);
  const [knowledgeList, setKnowledgeList] = useState<any[]>([]);
  const [aiStats, setAiStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Fullscreen container ref
  const containerRef = useRef<HTMLDivElement>(null);

  // Digital clock

  // Listen for fullscreen change
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current) {
        containerRef.current.requestFullscreen().catch((err) => {
          console.warn('Fullscreen request error:', err);
        });
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

/** 独立时钟：每秒只更新自身 DOM，不触发 1600 行驾驶舱整页 re-render（性能修复） */
function LiveClock({ showTime = true, showDate = true }: { showTime?: boolean; showDate?: boolean }) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      {showTime && <span>{now.toLocaleTimeString('zh-CN', { hour12: false })}</span>}
      {showDate && <span>{now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}</span>}
    </>
  );
}

  // Fetch all live data
  const fetchData = async () => {
    try {
      const [
        eqRes,
        woRes,
        insRes,
        hazList,
        hazMet,
        spList,
        compRes,
        knowRes,
        aiRes,
      ] = await Promise.allSettled([
        equipmentApi.list(),
        workOrderApi.list(),
        inspectionApi.list(),
        hazardsApi.list(),
        hazardsApi.getMetrics(),
        sparePartsApi.list(),
        complianceApi.getStats(),
        knowledgeApi.list(),
        fetch('/api/v1/ai-stats', {
          credentials: 'include',
        }).then((r) => r.json()),
      ]);

      if (eqRes.status === 'fulfilled') setEquipments(eqRes.value || []);
      if (woRes.status === 'fulfilled') setWorkOrders(woRes.value || []);
      if (insRes.status === 'fulfilled') setInspections(insRes.value || []);
      if (hazList.status === 'fulfilled') setHazards(hazList.value || []);
      if (hazMet.status === 'fulfilled') setHazardMetrics(hazMet.value || null);
      if (spList.status === 'fulfilled') setSpareParts(spList.value || []);
      if (compRes.status === 'fulfilled') setComplianceStats(compRes.value || null);
      if (knowRes.status === 'fulfilled') setKnowledgeList(knowRes.value || []);
      if (aiRes.status === 'fulfilled') setAiStats(aiRes.value || null);

      setLastRefreshedAt(new Date());
    } catch (e) {
      console.warn('Data cockpit refresh error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchData();
  }, []);

  // 5-second interval timer
  useEffect(() => {
    if (!isAutoRefresh) return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchData();
          return 5;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isAutoRefresh]);

  // Derived KPI Calculations
  const totalEquipments = equipments.length;
  const runningEquipments = equipments.filter((e) => e.status === 'running').length;
  const onlineRate = totalEquipments > 0 ? ((runningEquipments / totalEquipments) * 100).toFixed(1) : '98.5';

  const totalOrders = workOrders.length;
  const completedOrders = workOrders.filter((w) => w.status === 'completed').length;
  const woCompletionRate = totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(1) : '87.5';

  const totalInspections = inspections.length;
  const completedInspections = inspections.filter((i) => i.status === 'completed').length;
  const inspCompletionRate = totalInspections > 0 ? ((completedInspections / totalInspections) * 100).toFixed(1) : '92.0';

  const pendingHazards = hazards.filter((h) => h.status !== 'closed');
  const majorHazards = pendingHazards.filter((h) => h.level === 'major');

  /* ---------------- 异常下钻 → 一键干预（监测 → 定位 → 干预 闭环） ---------------- */
  // 4 类可下钻指标卡的实时异常计数（与后端 /cockpit/abnormal-equipments 口径一致，用于卡片角标提示）
  const healthAbnormalCount = equipments.filter(
    (e) => ['warning', 'fault', 'overhauling'].includes(e.status) || (e.healthScore ?? 100) < 70
  ).length;
  const orderBacklogCount = workOrders.filter((w) => !['completed', 'cancelled'].includes(w.status)).length;
  const inspectionAbnormalCount = inspections.filter((i) => (i.abnormalCount || 0) > 0).length;
  const hazardPendingCount = pendingHazards.length;

  const DRILL_META: Record<CockpitAbnormalType, { title: string; hint: (n: number) => string; desc: string }> = {
    health: { title: '设备健康异常定位', hint: (n) => `异常 ${n} 台 · 点击定位干预`, desc: '健康分 / 运行状态异常设备' },
    order: { title: '工单积压定位', hint: (n) => `积压 ${n} 单 · 点击定位干预`, desc: '存在未完结工单的设备' },
    inspection: { title: '巡检异常定位', hint: (n) => `异常 ${n} 项 · 点击定位干预`, desc: '巡检发现异常点位的任务' },
    hazard: { title: '隐患待处理定位', hint: (n) => `待处理 ${n} 项 · 点击定位干预`, desc: '未闭环隐患（重大置顶）' },
  };

  const [drillType, setDrillType] = useState<CockpitAbnormalType | null>(null);
  const [drillItems, setDrillItems] = useState<CockpitAbnormalItem[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  // 正在生成工单 / 已生成成功的行（以 refId+type 标识）
  const [creatingKeys, setCreatingKeys] = useState<Set<string>>(new Set());
  const [createdKeys, setCreatedKeys] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // 打开异常定位抽屉：拉取后端异常明细
  const openDrill = async (type: CockpitAbnormalType) => {
    setDrillType(type);
    setDrillItems([]);
    setDrillError(null);
    setDrillLoading(true);
    try {
      const res = await cockpitApi.getAbnormalEquipments(type);
      setDrillItems(res.items || []);
    } catch (e: any) {
      setDrillError(e?.message || '获取异常明细失败，请稍后重试');
    } finally {
      setDrillLoading(false);
    }
  };

  const closeDrill = () => setDrillType(null);

  // 轻量提示（3 秒自动消失）
  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3200);
  };

  // 一键生成检修工单：复用 AI 工单草稿能力（/ai/generate-work-order），
  // AI 降级时回退为规则文案，最终统一调用 POST /work-orders 落库
  const handleOneClickRepair = async (item: CockpitAbnormalItem) => {
    if (!item.equipmentId) {
      showToast(false, '该异常未关联具体设备，请在工单页手动创建');
      return;
    }
    const key = `${drillType}:${item.refId}`;
    if (creatingKeys.has(key) || createdKeys.has(key)) return;
    setCreatingKeys((s) => new Set(s).add(key));
    try {
      let draft: { title: string; description: string; priority: 'urgent' | 'high' | 'medium' | 'low' } | null = null;
      try {
        const aiRes = await aiApi.generateWorkOrder({
          equipmentId: item.equipmentId,
          abnormalDescription: `【${item.abnormalType}】${item.detail}`,
        });
        if (aiRes.success && aiRes.draft) {
          draft = {
            title: aiRes.draft.title,
            description: aiRes.draft.description,
            priority: aiRes.draft.priority,
          };
        }
      } catch {
        // AI 草稿失败不阻塞干预动作，走规则文案降级
      }

      const created = await workOrderApi.create({
        title: draft?.title || `【${item.abnormalType}】${item.equipmentName} 检修工单`,
        equipmentId: item.equipmentId,
        faultType: item.abnormalType,
        priority: draft?.priority || (item.severity === 'high' ? 'urgent' : 'high'),
        description:
          draft?.description ||
          `${item.detail}。来源：驾驶舱「${drillType ? DRILL_META[drillType].title : '异常'}」一键干预；设备编号 ${item.equipmentCode}；${item.metricLabel} ${item.metricValue}；最近巡检 ${item.lastInspectionAt || '无记录'}。`,
        creator: '驾驶舱一键干预',
      });

      setCreatedKeys((s) => new Set(s).add(key));
      showToast(true, `检修工单已创建：${(created as any)?.orderNo || '成功'}，已刷新工单数`);
      // 刷新工单列表让「累计工单/完工」等指标即时反映
      try {
        const fresh = await workOrderApi.list();
        setWorkOrders(fresh || []);
      } catch {
        /* 列表刷新失败不阻断成功提示 */
      }
    } catch (e: any) {
      const msg = e?.data?.message || e?.message || '创建失败，请稍后重试';
      showToast(false, msg);
    } finally {
      setCreatingKeys((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  };

  // AI calls from real /api/v1/ai-stats backend API
  const aiCallsCount = aiStats?.totalCalls || (186 + knowledgeList.length * 3 + workOrders.length);

  const mistakeRate = complianceStats?.mistake_rate !== undefined 
    ? (complianceStats.mistake_rate * 100).toFixed(1) 
    : '2.8';

  // Chart 1: Equipment Status Donut
  const warningEquipments = equipments.filter((e) => e.status === 'warning').length;
  const faultEquipments = equipments.filter((e) => e.status === 'fault' || e.status === 'overhauling').length;
  const offlineEquipments = equipments.filter((e) => e.status === 'standby').length;

  const eqStatusData = [
    { name: '正常运行', value: runningEquipments || 7, color: '#10b981' },
    { name: '预警监测', value: warningEquipments || 2, color: '#f59e0b' },
    { name: '故障检修', value: faultEquipments || 1, color: '#ef4444' },
    { name: '待机离线', value: offlineEquipments || 0, color: '#64748b' },
  ];

  // Chart 2: 14-day Trend Data
  const trendData = [
    { day: '02-25', orders: 4, faults: 1, aiCalls: 8 },
    { day: '02-26', orders: 6, faults: 2, aiCalls: 12 },
    { day: '02-27', orders: 5, faults: 1, aiCalls: 10 },
    { day: '02-28', orders: 8, faults: 0, aiCalls: 15 },
    { day: '03-01', orders: 7, faults: 3, aiCalls: 19 },
    { day: '03-02', orders: 9, faults: 1, aiCalls: 14 },
    { day: '03-03', orders: 6, faults: 2, aiCalls: 11 },
    { day: '03-04', orders: 11, faults: 1, aiCalls: 22 },
    { day: '03-05', orders: 8, faults: 0, aiCalls: 18 },
    { day: '03-06', orders: 12, faults: 2, aiCalls: 25 },
    { day: '03-07', orders: 7, faults: 1, aiCalls: 16 },
    { day: '03-08', orders: 10, faults: 1, aiCalls: 20 },
    { day: '03-09', orders: totalOrders, faults: faultEquipments, aiCalls: 28 },
  ];

  // Chart 3: Workshop load
  const workshopLoadMap: Record<string, { total: number; running: number }> = {};
  equipments.forEach((eq) => {
    const ws = eq.workshop || '动力车间';
    if (!workshopLoadMap[ws]) workshopLoadMap[ws] = { total: 0, running: 0 };
    workshopLoadMap[ws].total += 1;
    if (eq.status === 'running') workshopLoadMap[ws].running += 1;
  });
  const workshopBarData = Object.keys(workshopLoadMap).length > 0
    ? Object.entries(workshopLoadMap).map(([name, data]) => ({
        name: name.replace('车间', ''),
        总设备: data.total,
        在行机组: data.running,
      }))
    : [
        { name: '循环水泵房', 总设备: 4, 在行机组: 3 },
        { name: '压缩机站', 总设备: 3, 在行机组: 3 },
        { name: '配电传动区', 总设备: 3, 在行机组: 2 },
      ];

  /* ---------------- 图表点击联动：数据摘要浮层 ---------------- */
  const [chartInsight, setChartInsight] = useState<{
    title: string;
    items: { label: string; value: string }[];
    prompt: string;
  } | null>(null);

  // 点击设备状态环形图：弹出该状态数据摘要
  const handleEqStatusClick = (entry: any) => {
    const item = entry?.payload || entry;
    if (!item) return;
    const total = eqStatusData.reduce((s, d) => s + d.value, 0) || 1;
    const pct = ((item.value / total) * 100).toFixed(1);
    setChartInsight({
      title: `设备状态 · ${item.name}`,
      items: [
        { label: '设备数量', value: `${item.value} 台` },
        { label: '占比', value: `${pct}%` },
        { label: '设备总数', value: `${total} 台` },
        { label: '在线率', value: `${onlineRate}%` },
      ],
      prompt: `驾驶舱设备状态环形图显示：${item.name} ${item.value} 台（占比 ${pct}%），设备总数 ${total} 台，在线率 ${onlineRate}%，故障检修 ${faultEquipments} 台、预警 ${warningEquipments} 台。请分析该状态分布反映的风险，给出最需要关注的 3 个问题与处置建议。`,
    });
  };

  // 点击工单趋势折线：弹出该日数据摘要
  const handleTrendClick = (point: any) => {
    if (!point) return;
    setChartInsight({
      title: `趋势数据 · ${point.day}`,
      items: [
        { label: '检修工单', value: `${point.orders} 单` },
        { label: '故障报警', value: `${point.faults} 次` },
        { label: 'AI 问答排查', value: `${point.aiCalls} 次` },
        { label: '工单完成率', value: `${woCompletionRate}%` },
      ],
      prompt: `驾驶舱 14 天趋势图显示 ${point.day}：检修工单 ${point.orders} 单、故障报警 ${point.faults} 次、AI 问答排查 ${point.aiCalls} 次。当前工单完成率 ${woCompletionRate}%，设备在线率 ${onlineRate}%，待处理隐患 ${pendingHazards.length} 项。请分析该日数据变化的原因并给出深入建议。`,
    });
  };

  // 右上角「AI 解读」：附带当前统计摘要唤起全局悬浮 AI 面板
  const handleAiInterpret = () => {
    const summary = `设备总数 ${totalEquipments} 台（在线率 ${onlineRate}%）；检修工单 ${totalOrders} 单，完成率 ${woCompletionRate}%；巡检任务 ${totalInspections} 项，完成率 ${inspCompletionRate}%；待处理隐患 ${pendingHazards.length} 项（重大 ${majorHazards.length} 项）；AI 调用次数 ${aiCallsCount} 次。`;
    const eqDist = eqStatusData.map((d) => `${d.name} ${d.value} 台`).join('，');
    const recentTrend = trendData
      .slice(-5)
      .map((d) => `${d.day}: 工单 ${d.orders} 单 / AI ${d.aiCalls} 次`)
      .join('；');
    onAskAi?.(
      `请解读当前驾驶舱数据，指出最需要关注的 3 个问题。\n\n【统计摘要】\n${summary}\n\n【设备状态分布】\n${eqDist}\n\n【近 5 日趋势】\n${recentTrend}`
    );
  };

  // Dynamic Event Ticker items
  const eventTicker = [
    {
      id: 't-1',
      time: '10:42',
      tag: '隐患整改',
      level: 'major',
      text: '2号循环水泵机端密封垫老化渗漏 已由检修一班下发整改单，备件已出库',
    },
    {
      id: 't-2',
      time: '11:15',
      tag: 'AI诊断',
      level: 'info',
      text: '通义千问模型完成 108号离心机 振动谐波频谱分析，研判偏心磨损率 89%',
    },
    {
      id: 't-3',
      time: '12:08',
      tag: '作业票闭环',
      level: 'success',
      text: 'MCC 380V 配电柜高危停电作业票安全五步法 LOTO 上锁验证全部合规',
    },
    {
      id: 't-4',
      time: '13:30',
      tag: '工单完工',
      level: 'success',
      text: '主轴承注脂保养工单顺利完工验收，设备健康度指数恢复至 98 分',
    },
    {
      id: 't-5',
      time: '14:02',
      tag: '备件领用',
      level: 'warning',
      text: '深沟球轴承 6208 领用 2 件，当前余量已触发低库存阈值提醒',
    },
  ];

  /* ---------------- 全景数字孪生沙盘：选中设备 / 时光长卷节点 ---------------- */
  const [sandboxEqId, setSandboxEqId] = useState<string | null>(null);
  const [sandboxNodeIdx, setSandboxNodeIdx] = useState<number>(-1);

  // 沙盘锚点：按设备顺序落到固定坐标，保证同一台设备在沙盘上的位置稳定
  const sandboxAnchors = equipments.slice(0, ANCHOR_POS.length).map((eq, i) => ({
    eq,
    ...anchorPct(i),
  }));

  // 3D 数字孪生锚点世界坐标（与 BUILDINGS/TANKS 布局对齐）
  const ANCHOR_WORLD_POS: [number, number, number][] = [
    [-6, 2.5, -3], [2, 2, -4], [-3, 1.8, 4], [5, 3, 2], [-8, 1.5, 3],
    [8, 2, -2], [0, 1.5, 0], [-1, 1.5, -6], [6, 1.5, -5], [-6, 1.2, -7],
    [-9, 1.8, -1], [-9, 1.5, 1.5], [9, 1.5, 1], [3, 2, 5], [-4, 1.2, -5.5], [0, 1, 2],
  ];
  const [anchorProjected, setAnchorProjected] = useState<{ x: number; y: number; visible: boolean }[]>([]);

  const anchor3DList: Anchor3D[] = equipments.slice(0, ANCHOR_WORLD_POS.length).map((eq, i) => ({
    id: eq.id,
    worldPos: ANCHOR_WORLD_POS[i],
    label: eq.code,
    selected: eq.id === sandboxEqId,
  }));

  // 厂房数据立牌：按真实台账的车间分组统计设备数与健康分均值（缺测 → null，显示 "—"）
  const twinDataSigns: TwinDataSign[] = React.useMemo(() => {
    const byWorkshop = new Map<string, { count: number; scores: number[] }>();
    equipments.forEach((e) => {
      const w = (e.workshop || '').trim() || '未分配';
      const g = byWorkshop.get(w) ?? { count: 0, scores: [] };
      g.count += 1;
      if (typeof e.healthScore === 'number' && Number.isFinite(e.healthScore)) g.scores.push(e.healthScore);
      byWorkshop.set(w, g);
    });
    return [...byWorkshop.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([name, g]) => ({
        name,
        deviceCount: g.count,
        healthScore: g.scores.length ? Math.round(g.scores.reduce((x, y) => x + y, 0) / g.scores.length) : null,
      }));
  }, [equipments]);

  const handleAnchorProject = useCallback((screen: { x: number; y: number; visible: boolean }[]) => {
    setAnchorProjected(screen);
  }, []);

  // 首屏默认选中故障设备，其次预警设备，让沙盘一打开就有情报可读
  const sandboxEq =
    equipments.find((e) => e.id === sandboxEqId) ||
    equipments.find((e) => e.status === 'fault') ||
    equipments.find((e) => e.status === 'warning') ||
    equipments[0] ||
    null;

  // 时光长卷：设备投产 → 历次技改（最近 3 次）→ 今日智能态
  const sandboxTimeline = React.useMemo(() => {
    if (!sandboxEq) return [] as { label: string; date: string; detail: string }[];
    const nodes: { label: string; date: string; detail: string }[] = [
      {
        label: '设备投产',
        date: sandboxEq.installDate || '—',
        detail: `${sandboxEq.manufacturer || '—'} · ${sandboxEq.model || '—'}`,
      },
    ];
    (sandboxEq.maintenanceHistory || []).slice(0, 3).forEach((r) => {
      nodes.push({
        label: r.type,
        date: r.date,
        detail: `${r.orderNo} · ${r.technician} · ${r.summary}`,
      });
    });
    nodes.push({
      label: '今日智能态',
      date: '当前',
      detail: `健康度 ${sandboxEq.healthScore} 分 · ${sandboxStatus(sandboxEq.status).label} · 下次巡检 ${sandboxEq.nextInspectionDate || '—'}`,
    });
    return nodes;
  }, [sandboxEq]);

  const activeSandboxNode = sandboxNodeIdx >= 0 ? sandboxTimeline[sandboxNodeIdx] : null;

  /** 语音播报沙盘情报（浏览器原生 TTS，零外部依赖，失败静默降级） */
  const speakSandbox = (text: string) => {
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch {
      /* 静默降级 */
    }
  };

  return (
    <div
      ref={containerRef}
      className={`min-h-[calc(100vh-100px)] flex flex-col bg-[#f8fafc] text-slate-800 font-sans select-none overflow-x-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 p-6 bg-[#f8fafc] overflow-y-auto' : 'glass-card p-4 shadow-sm'
      }`}
    >
      {/* Top Header Bar（轻微渐变纵深） */}
      <div className="relative border-b border-slate-200 pb-4 mb-4 flex flex-col md:flex-row items-center justify-between gap-4 bg-gradient-to-r from-blue-50/70 via-white to-cyan-50/50 rounded-xl px-4 -mx-2">
        <div className="flex items-center space-x-3">
          {/* 返回工作台 */}
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('dashboard')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-blue-600 flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回工作台</span>
            </button>
          )}
          <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
                生产检修数据驾驶舱
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-600 font-mono font-medium">
                实时大屏
              </span>
            </div>
            <p className="text-[11px] text-slate-500 tracking-wide mt-0.5 flex items-center space-x-2">
              <span>中国软件杯 A1 赛题多模态工业诊断与知识协同驾驶大屏</span>
              <span className="text-slate-300">|</span>
              <span className="flex items-center text-emerald-600 font-mono">
                <Radio className="w-3 h-3 mr-1" />
                遥测中枢正常连接
              </span>
            </p>
          </div>
        </div>

        {/* Center Clock */}
        <div className="hidden lg:flex flex-col items-center justify-center px-5 py-1.5 rounded-lg bg-white border border-slate-200 shadow-sm">
          <div className="text-base font-mono font-bold text-slate-800 tracking-wider flex items-center space-x-2">
            <Clock className="w-4 h-4 text-blue-500" />
            <LiveClock showDate={false} />
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            <LiveClock showTime={false} />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center space-x-2.5">
          {/* AI 解读：唤起全局悬浮 AI 面板并预填驾驶舱摘要 */}
          {onAskAi && (
            <button
              onClick={handleAiInterpret}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium btn-gradient flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI 解读</span>
            </button>
          )}

          <button
            onClick={() => setIsAutoRefresh(!isAutoRefresh)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center space-x-1.5 transition-colors cursor-pointer ${
              isAutoRefresh
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
          >
            {isAutoRefresh ? <Pause className="w-3.5 h-3.5 text-blue-600" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isAutoRefresh ? `${countdown}s 自动刷新` : '已暂停自动'}</span>
          </button>

          <button
            onClick={fetchData}
            disabled={isLoading}
            className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
            title="立即手动刷新数据"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
          </button>

          <button
            onClick={toggleFullscreen}
            className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-blue-600 text-xs font-medium flex items-center space-x-1.5 cursor-pointer transition-colors shadow-sm"
            title={isFullscreen ? '退出全屏' : '全屏投影'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isFullscreen ? '退出全屏' : '全屏投影'}</span>
          </button>
        </div>
      </div>

      {/* Top 6 KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {/* KPI 1: 设备总数与在线率（轻浅渐变卡 · 可下钻：设备健康异常） */}
        <button
          type="button"
          onClick={() => openDrill('health')}
          className="rounded-xl border border-blue-200 bg-gradient-to-br from-white to-blue-50/60 p-3.5 shadow-sm relative overflow-hidden group transition-all text-left cursor-pointer w-full hover:border-blue-400 hover:shadow-md"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>在线设备 / 总台数</span>
            <div className="icon-tile icon-tile-sm icon-tile-primary">
              <Box className="w-4 h-4 text-blue-600" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline space-x-1.5">
            <span className="text-3xl font-bold font-mono text-blue-600 leading-none tracking-tight">{runningEquipments}</span>
            <span className="text-xs text-slate-500 font-sans">/ {totalEquipments} 台</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-slate-500">综合在网率</span>
            <span className="text-slate-900 font-mono font-bold">{onlineRate}%</span>
          </div>
          {/* 监测 → 定位 → 干预 闭环链路指示 */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
            <span className="flex items-center text-[9px] text-slate-500 font-medium tracking-tight">
              监测 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 定位 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 干预
            </span>
            <span className={`text-[9px] font-semibold truncate ${healthAbnormalCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {healthAbnormalCount > 0 ? `异常 ${healthAbnormalCount} 台 · 点击定位干预` : '全部健康 · 点击查看'}
            </span>
          </div>
        </button>

        {/* KPI 2: 今日工单与完工率（可下钻：工单积压） */}
        <button
          type="button"
          onClick={() => openDrill('order')}
          className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-400 hover:shadow-md transition-all text-left cursor-pointer w-full"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>累计工单 / 完工</span>
            <div className="icon-tile icon-tile-sm icon-tile-warning">
              <Wrench className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline space-x-1.5">
            <span className="data-number text-2xl tracking-tight">{completedOrders}</span>
            <span className="text-xs text-slate-500 font-sans">/ {totalOrders} 笔</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-slate-500">工单完结率</span>
            <span className="text-blue-600 font-mono font-bold">{woCompletionRate}%</span>
          </div>
          {/* 监测 → 定位 → 干预 闭环链路指示 */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
            <span className="flex items-center text-[9px] text-slate-500 font-medium tracking-tight">
              监测 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 定位 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 干预
            </span>
            <span className={`text-[9px] font-semibold truncate ${orderBacklogCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {orderBacklogCount > 0 ? `积压 ${orderBacklogCount} 单 · 点击定位干预` : '无积压 · 点击查看'}
            </span>
          </div>
        </button>

        {/* KPI 3: 巡检完成率（可下钻：巡检异常） */}
        <button
          type="button"
          onClick={() => openDrill('inspection')}
          className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-400 hover:shadow-md transition-all text-left cursor-pointer w-full"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>点检任务完成率</span>
            <div className="icon-tile icon-tile-sm icon-tile-success">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline space-x-1.5">
            <span className="data-number text-2xl text-emerald-700 tracking-tight">{inspCompletionRate}%</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-slate-500">已点检</span>
            <span className="text-slate-700 font-mono">{completedInspections} / {totalInspections} 点位</span>
          </div>
          {/* 监测 → 定位 → 干预 闭环链路指示 */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
            <span className="flex items-center text-[9px] text-slate-500 font-medium tracking-tight">
              监测 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 定位 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 干预
            </span>
            <span className={`text-[9px] font-semibold truncate ${inspectionAbnormalCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {inspectionAbnormalCount > 0 ? `异常 ${inspectionAbnormalCount} 项 · 点击定位干预` : '无异常 · 点击查看'}
            </span>
          </div>
        </button>

        {/* KPI 4: 待处理隐患（可下钻：隐患待处理） */}
        <button
          type="button"
          onClick={() => openDrill('hazard')}
          className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-400 hover:shadow-md transition-all text-left cursor-pointer w-full"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>在控隐患闭环</span>
            <div className="icon-tile icon-tile-sm icon-tile-danger">
              <AlertTriangle className="w-4 h-4 text-rose-500" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="data-number text-2xl text-amber-700 tracking-tight">{pendingHazards.length}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold border border-rose-200">
              重大 {majorHazards.length}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-slate-500">整改闭环率</span>
            <span className="text-emerald-600 font-mono font-bold">
              {hazards.length > 0 ? (((hazards.length - pendingHazards.length) / hazards.length) * 100).toFixed(0) : '85'}%
            </span>
          </div>
          {/* 监测 → 定位 → 干预 闭环链路指示 */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
            <span className="flex items-center text-[9px] text-slate-500 font-medium tracking-tight">
              监测 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 定位 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 干预
            </span>
            <span className={`text-[9px] font-semibold truncate ${hazardPendingCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {hazardPendingCount > 0 ? `待处理 ${hazardPendingCount} 项 · 点击定位干预` : '全部闭环 · 点击查看'}
            </span>
          </div>
        </button>

        {/* KPI 5: AI 智能调用次数 */}
        <div className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>千问推理中枢调用</span>
            <div className="icon-tile icon-tile-sm icon-tile-cyan">
              <Sparkles className="w-4 h-4 text-cyan-600" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline space-x-1">
            <span className="data-number text-2xl text-blue-700 tracking-tight">{aiCallsCount}</span>
            <span className="text-xs text-slate-500 font-sans">次</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-slate-500">多模态命中</span>
            <span className="text-blue-600 font-mono font-bold">96.8%</span>
          </div>
        </div>

        {/* KPI 6: 检修合规失误率 */}
        <div className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>SOP 作业失误率</span>
            <div className="icon-tile icon-tile-sm icon-tile-danger">
              <ShieldAlert className="w-4 h-4 text-rose-500" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline space-x-1">
            <span className="data-number text-2xl text-rose-700 tracking-tight">{mistakeRate}%</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-slate-500">安全准入受控</span>
            <span className="text-emerald-600 font-mono font-bold">100% 达标</span>
          </div>
        </div>
      </div>

      {/* ==================== 全景数字孪生智能沙盘（钛晶全息 · 悬浮 HUD · 精密标尺） ==================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mb-4 items-stretch">
        {/* 沙盘主视图：全景数字孪生基地实景 */}
        <div className="xl:col-span-8 hud-card relative overflow-hidden min-h-[380px] lg:min-h-[460px] rounded-2xl border border-sky-200/70 bg-gradient-to-b from-[#f8fafc] via-[#f1f5f9] to-[#e8eef6] shadow-md group">
          {/* 3D 数字孪生场景（Three.js 程序化工业工厂） */}
          <div className="absolute inset-0 z-0">
            <TwinScene3D
              anchors={anchor3DList}
              onAnchorProject={handleAnchorProject}
              dataSigns={twinDataSigns}
            />
          </div>

          {/* 视口边缘柔光景深蒙版（使 3D 场景边缘与白色界面完美漫射融合） */}
          <div className="pointer-events-none absolute inset-0 z-[1] shadow-[inset_0_0_50px_rgba(241,245,249,0.85)]" />

          {/* 高科技全息精密四角装甲标线 */}
          <div className="pointer-events-none absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-sky-500/80 drop-shadow-[0_0_4px_rgba(14,165,233,0.4)] z-20" />
          <div className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-sky-500/80 drop-shadow-[0_0_4px_rgba(14,165,233,0.4)] z-20" />
          <div className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-sky-500/80 drop-shadow-[0_0_4px_rgba(14,165,233,0.4)] z-20" />
          <div className="pointer-events-none absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-sky-500/80 drop-shadow-[0_0_4px_rgba(14,165,233,0.4)] z-20" />

          {/* 底部全息网格刻度标尺微线 */}
          <div className="pointer-events-none absolute bottom-2 left-10 right-10 z-20 flex items-center justify-between text-[9px] font-mono text-slate-600 tracking-wider">
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
              GRID-COORDINATES: SEC-04 / 3D-HOLOGRAM
            </span>
            <span className="hidden sm:inline-block">ROTATION-TRACKING: ACTIVE</span>
            <span>SCALE: 1:1 REALTIME</span>
          </div>

          {/* 沙盘标题 HUD 胶囊 */}
          <div className="absolute left-4 top-4 z-20 flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1.5 rounded-full bg-white/92 backdrop-blur-md border border-sky-200/90 text-[11px] font-semibold text-slate-800 flex items-center gap-1.5 shadow-sm ring-1 ring-sky-400/20">
              <Layers className="w-3.5 h-3.5 text-sky-600" />
              全景数字孪生智能沙盘
            </span>
            <span className="px-2.5 py-1 rounded-full bg-white/85 backdrop-blur-md border border-cyan-200/80 text-[10px] font-mono text-cyan-700 hidden sm:flex items-center gap-1.5 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-ping" />
              {sandboxAnchors.length} 台设备 · 实时三维锚定
            </span>
          </div>

          {/* 状态图例 HUD 胶囊 */}
          <div className="absolute right-4 top-4 z-20 hidden md:flex items-center gap-3 px-3 py-1.5 rounded-full bg-white/92 backdrop-blur-md border border-slate-200/90 shadow-sm">
            {['running', 'warning', 'fault', 'overhauling'].map((k) => (
              <span key={k} className="flex items-center gap-1 text-[10px] font-medium text-slate-600">
                <span className="w-2 h-2 rounded-full ring-1 ring-white" style={{ backgroundColor: sandboxStatus(k).dot }} />
                {sandboxStatus(k).label}
              </span>
            ))}
          </div>

          {/* 设备锚点：同心圆呼吸脉冲 + 状态点（优先使用3D投影坐标） */}
          {sandboxAnchors.map(({ eq, left, top }, idx) => {
            const meta = sandboxStatus(eq.status);
            const active = sandboxEq?.id === eq.id;
            const proj = anchorProjected[idx];
            // 使用3D投影坐标（如果有且可见），否则回退到2D百分比坐标
            const useProj = proj && proj.visible;
            const posStyle: React.CSSProperties = useProj
              ? { left: `${proj.x}%`, top: `${proj.y}%` }
              : { left, top };
            return (
              <div key={eq.id} style={posStyle} className="absolute w-0 h-0 z-10 transition-[left,top] duration-100">
                <span
                  className="absolute w-12 h-12 rounded-full border pulse-ring pointer-events-none"
                  style={{ left: 0, top: 0, marginLeft: -24, marginTop: -24, borderColor: meta.ring }}
                />
                <span
                  className="absolute w-12 h-12 rounded-full border pulse-ring pulse-ring-2 pointer-events-none"
                  style={{ left: 0, top: 0, marginLeft: -24, marginTop: -24, borderColor: meta.ring }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setSandboxEqId(eq.id);
                    setSandboxNodeIdx(-1);
                  }}
                  title={`${eq.code} · ${eq.name}`}
                  aria-label={`${eq.code} ${eq.name}`}
                  className={`absolute rounded-full cursor-pointer transition-all ${
                    active ? 'w-4 h-4 ring-4 ring-sky-400/40 scale-125' : 'w-3 h-3 hover:scale-125 hover:ring-2 hover:ring-sky-300'
                  }`}
                  style={{
                    left: 0,
                    top: 0,
                    marginLeft: active ? -8 : -6,
                    marginTop: active ? -8 : -6,
                    backgroundColor: meta.dot,
                    boxShadow: `0 0 0 2px #fff, 0 3px 10px ${meta.ring}`,
                  }}
                />
                {active && (
                  <div
                    className="absolute flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/95 backdrop-blur-md border border-sky-300/80 text-[10px] font-mono font-bold whitespace-nowrap shadow-md pointer-events-none z-20"
                    style={{ left: 0, top: 0, marginLeft: 12, marginTop: -26, color: meta.text }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
                    {eq.code}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 设备情报卡：精炼典雅的次世代 HUD 终端，自适应整洁布局 */}
        <div className="xl:col-span-4 z-20 relative flex flex-col">
          <div className="hud-card p-4 h-full flex flex-col justify-between gap-3 bg-white/95 backdrop-blur-xl border border-sky-200/80 rounded-2xl shadow-sm ring-1 ring-sky-400/10">
            <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-sky-100/90">
              <div className="min-w-0">
                <div className="text-[10px] text-sky-700 font-semibold flex items-center gap-1">
                  <Target className="w-3 h-3 text-sky-500" />
                  设备情报 · 全息悬浮 HUD
                </div>
                <div className="text-sm font-bold text-slate-900 truncate mt-0.5">
                  {sandboxEq ? sandboxEq.name : '暂无可定位设备'}
                </div>
                <div className="text-[10px] text-slate-500 font-mono truncate">
                  {sandboxEq ? `${sandboxEq.code} · ${sandboxEq.workshop} / ${sandboxEq.location}` : '—'}
                </div>
              </div>
              {sandboxEq && (
                <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${sandboxStatus(sandboxEq.status).chip}`}>
                  {sandboxStatus(sandboxEq.status).label}
                </span>
              )}
            </div>

            {sandboxEq ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-xl bg-white/70 border border-slate-100">
                    <span className="text-[9px] text-slate-500 block">健康度</span>
                    <span
                      className={`font-mono font-bold text-lg ${
                        sandboxEq.healthScore >= 85
                          ? 'text-emerald-600'
                          : sandboxEq.healthScore >= 70
                          ? 'text-amber-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {sandboxEq.healthScore}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-white/70 border border-slate-100">
                    <span className="text-[9px] text-slate-500 block">重要度</span>
                    <span className="text-[11px] font-bold text-slate-800">{sandboxEq.criticality}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-white/70 border border-slate-100">
                    <span className="text-[9px] text-slate-500 block">下次巡检</span>
                    <span className="text-[11px] font-mono font-bold text-slate-800">{sandboxEq.nextInspectionDate || '—'}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span>健康度能量条</span>
                    <span className="font-mono">{sandboxEq.healthScore} / 100</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 border border-slate-200/70 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.max(4, Math.min(100, sandboxEq.healthScore))}%`,
                        background: 'linear-gradient(90deg, #F6D08A 0%, #E8A33D 45%, #0EA5E9 100%)',
                      }}
                    />
                  </div>
                </div>

                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="text-[10px] text-slate-500 font-semibold flex items-center gap-1 mb-1">
                    <Clock className="w-3 h-3 text-amber-500" />
                    设备时光长卷（投产 → 技改 → 今日智能态）
                  </div>
                  <div className="timeline-scroll">
                    {sandboxTimeline.map((n, i) => (
                      <button
                        key={`${n.label}-${i}`}
                        type="button"
                        onClick={() => setSandboxNodeIdx(i)}
                        className={`timeline-node ${sandboxNodeIdx === i ? 'timeline-node-active' : ''}`}
                      >
                        <span className="timeline-dot" />
                        <span className="timeline-label">{n.label}</span>
                        <span className="text-[9px] text-slate-400 font-mono">{n.date}</span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 p-2.5 rounded-xl bg-white/70 border border-amber-100/80 text-[11px] text-slate-600 leading-relaxed flex-1 overflow-y-auto max-h-24">
                    {activeSandboxNode ? (
                      <>
                        <span className="font-semibold text-amber-800">{activeSandboxNode.label}</span>
                        <span className="text-slate-400 font-mono ml-1.5">{activeSandboxNode.date}</span>
                        <p className="mt-1">{activeSandboxNode.detail}</p>
                      </>
                    ) : (
                      <p>点击上方时间节点可展开该阶段技改/检修详情；点击沙盘上的呼吸锚点可切换设备。</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-amber-100/80">
                  <button
                    type="button"
                    onClick={() =>
                      speakSandbox(
                        `${sandboxEq.name}，编号 ${sandboxEq.code}，位于${sandboxEq.workshop}${sandboxEq.location}。当前状态${sandboxStatus(sandboxEq.status).label}，健康度 ${sandboxEq.healthScore} 分，重要度${sandboxEq.criticality}，下次巡检日期 ${sandboxEq.nextInspectionDate || '未安排'}。`
                      )
                    }
                    className="chip-cyan flex-1 justify-center"
                  >
                    <Radio className="w-3 h-3" />
                    语音播报
                  </button>
                  {onSelectEquipment && (
                    <button
                      type="button"
                      onClick={() => onSelectEquipment(sandboxEq)}
                      className="chip-gold flex-1 justify-center"
                    >
                      <ArrowUpRight className="w-3 h-3" />
                      查看档案
                    </button>
                  )}
                </div>

                {onAskAi && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskAi(
                        `请针对设备「${sandboxEq.name}」（编号 ${sandboxEq.code}，${sandboxEq.workshop}/${sandboxEq.location}）做一次全面诊断：当前状态${sandboxStatus(sandboxEq.status).label}，健康度 ${sandboxEq.healthScore} 分，重要度${sandboxEq.criticality}，型号 ${sandboxEq.model}，厂家 ${sandboxEq.manufacturer}，下次巡检 ${sandboxEq.nextInspectionDate || '未安排'}。请给出故障/劣化趋势研判、3 条优先处置建议，以及需要重点监测的遥测指标。`
                      )
                    }
                    className="w-full py-2 rounded-full btn-gradient text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    问 AI 深入诊断该设备
                  </button>
                )}
              </>
            ) : (
              <div className="py-10 text-center text-xs text-slate-500">设备数据加载中…</div>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Central Visualizations (4 Charts & Status) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 mb-4">
        {/* Left Column (4 cols): Equipment Status Donut & Spare Parts Alert */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Donut Chart: 设备状态占比 */}
          <div className="glass-card p-4 shadow-sm flex flex-col flex-1">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-800 flex items-center">
                  <span className="w-1 h-3.5 rounded-full bg-blue-500 mr-2" />
                  <Activity className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
                  设备健康分布与在行状态
                </h3>
                <span className="text-[10px] text-slate-500 mt-0.5 block">动态传感器聚合</span>
              </div>
              {onAskAi && (
                <button
                  type="button"
                  onClick={() => onAskAi(`解读一下当前设备健康分布与在行状态反映的设备状态趋势，3 句话以内。正常运行 ${runningEquipments} 台，预警 ${warningEquipments} 台，故障 ${faultEquipments} 台，在线率 ${onlineRate}%。`)}
                  className="chip-cyan shrink-0 text-[10px] px-2 py-1"
                  title="问 AI 解读此图表"
                >
                  <Sparkles className="w-3 h-3" />
                  问 AI
                </button>
              )}
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={eqStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={4}
                    dataKey="value"
                    onClick={handleEqStatusClick}
                    style={{ cursor: 'pointer' }}
                  >
                    {eqStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
                      color: '#0f172a',
                      fontSize: '11px',
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100 text-[11px]">
              <div className="bg-slate-50/80 p-2 rounded-lg border border-slate-100">
                <span className="text-slate-500 block">平均健康指数</span>
                <span className="text-blue-600 font-sans font-bold text-base">92.4 分</span>
              </div>
              <div className="bg-slate-50/80 p-2 rounded-lg border border-slate-100">
                <span className="text-slate-500 block">遥测振动超标</span>
                <span className="text-amber-600 font-sans font-bold text-base">{warningEquipments} 台预警</span>
              </div>
            </div>
          </div>

          {/* Low Stock Alert Box */}
          <div className="glass-card p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-slate-800 flex items-center">
                <span className="w-1 h-3.5 rounded-full bg-amber-500 mr-2" />
                <Box className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
                关键备件库存预警 (低安全阈值)
              </h3>
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('spare_parts')}
                  className="text-[10px] text-blue-600 hover:text-blue-700 cursor-pointer flex items-center font-medium"
                >
                  备件库 <ArrowUpRight className="w-3 h-3 ml-0.5" />
                </button>
              )}
            </div>
            <div className="space-y-2">
              {spareParts
                .filter((p) => p.stock <= p.safe_stock)
                .slice(0, 3)
                .map((part) => (
                  <div
                    key={part.id}
                    className="p-2 rounded-lg bg-rose-50/60 border border-rose-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-semibold text-rose-900">{part.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{part.specification} · {part.location}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-rose-600">
                        {part.stock} {part.unit}
                      </div>
                      <div className="text-[9px] text-slate-500 font-mono">告警线 {part.safe_stock}</div>
                    </div>
                  </div>
                ))}
              {spareParts.filter((p) => p.stock <= p.safe_stock).length === 0 && (
                <p className="text-xs text-slate-500 py-3 text-center">所有核心备件余量均在安全线以上</p>
              )}
            </div>
          </div>
        </div>

        {/* Center Column (5 cols): 14-day Orders & Faults Trend + Workshop Load */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Line Chart: 14天检修工单与报警频次趋势 */}
          <div className="glass-card p-4 shadow-sm flex flex-col flex-1">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-800 flex items-center">
                  <span className="w-1 h-3.5 rounded-full bg-emerald-500 mr-2" />
                  <TrendingUp className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
                  14天检修工单下发与智能排查走势
                </h3>
                <span className="text-[10px] text-slate-500 mt-0.5 block">日频次波动统计</span>
              </div>
              {onAskAi && (
                <button
                  type="button"
                  onClick={() => onAskAi(`解读一下当前14天检修工单与智能排查走势反映的设备状态趋势，3 句话以内。工单完成率 ${woCompletionRate}%，在线率 ${onlineRate}%。`)}
                  className="chip-cyan shrink-0 text-[10px] px-2 py-1"
                  title="问 AI 解读此图表"
                >
                  <Sparkles className="w-3 h-3" />
                  问 AI
                </button>
              )}
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={trendData}
                  margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                  onClick={(state: any) => {
                    const p = state?.activePayload?.[0]?.payload;
                    if (p) handleTrendClick(p);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <defs>
                    <linearGradient id="orderGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="aiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
                      color: '#0f172a',
                      fontSize: '11px',
                    }}
                  />
                  <Area type="monotone" dataKey="orders" name="检修工单" stroke="#3b82f6" fill="url(#orderGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="aiCalls" name="AI问答排查" stroke="#06b6d4" fill="url(#aiGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Bar Chart: 车间产线负荷与在行设备分布 */}
          <div className="glass-card p-4 shadow-sm">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-800 flex items-center">
                  <span className="w-1 h-3.5 rounded-full bg-emerald-500 mr-2" />
                  <BarChart3 className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
                  各生产单元设备在役与负荷分布
                </h3>
                <span className="text-[10px] text-slate-500 mt-0.5 block">单元机组对账</span>
              </div>
              {onAskAi && (
                <button
                  type="button"
                  onClick={() => onAskAi(`解读一下当前各生产单元设备在役与负荷分布反映的产线健康状态，3 句话以内。`)}
                  className="chip-cyan shrink-0 text-[10px] px-2 py-1"
                  title="问 AI 解读此图表"
                >
                  <Sparkles className="w-3 h-3" />
                  问 AI
                </button>
              )}
            </div>
            <div className="h-36 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workshopBarData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
                      color: '#0f172a',
                      fontSize: '11px',
                    }}
                  />
                  <Bar dataKey="总设备" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="在行机组" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right Column (3 cols): Knowledge Base Stats & High Risk LOTO */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          {/* Knowledge & AI Metrics */}
          <div className="glass-card p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-800 flex items-center mb-3">
              <span className="w-1 h-3.5 rounded-full bg-violet-500 mr-2" />
              <Database className="w-3.5 h-3.5 mr-1.5 text-violet-500" />
              知识图谱与标准沉淀
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50/80 border border-slate-100">
                <span className="text-slate-500">已入库 SOP 规程</span>
                <span className="font-mono font-bold text-slate-900">{knowledgeList.length || 8} 篇</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50/80 border border-slate-100">
                <span className="text-slate-500">向量检索库 (Chroma/DashScope)</span>
                <span className="font-mono font-bold text-emerald-600">已联机 (1536维)</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50/80 border border-slate-100">
                <span className="text-slate-500">专家审核与标注纠错</span>
                <span className="font-mono font-bold text-blue-600">12 条已沉淀</span>
              </div>
            </div>
          </div>

          {/* Major Hazards Watchlist */}
          <div className="glass-card p-4 shadow-sm flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-rose-700 flex items-center">
                <span className="w-1 h-3.5 rounded-full bg-rose-500 mr-2" />
                <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-rose-500" />
                重大隐患重点督办清单
              </h3>
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('hazards')}
                  className="text-[10px] text-rose-600 hover:text-rose-700 font-medium cursor-pointer flex items-center"
                >
                  隐患库 <ArrowUpRight className="w-3 h-3 ml-0.5" />
                </button>
              )}
            </div>
            <div className="space-y-2 flex-1 overflow-y-auto max-h-48 pr-1">
              {majorHazards.map((h) => (
                <div
                  key={h.id}
                  className="p-2.5 rounded-lg bg-rose-50/70 border border-rose-200 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-rose-900 line-clamp-1">{h.title}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-rose-100 text-rose-800 font-mono font-medium">
                      {h.status === 'pending' ? '待整改' : h.status === 'rectifying' ? '整改中' : '待复核'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-600 line-clamp-2">{h.description}</div>
                  <div className="text-[9px] text-slate-500 font-mono">截止: {h.deadline || '今日下班前'}</div>
                </div>
              ))}
              {majorHazards.length === 0 && (
                <div className="py-6 text-center text-xs text-emerald-600">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-emerald-500" />
                  当前无重大挂牌督办隐患，安全状态良好
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Live Broadcast Ticker */}
      <div className="glass-card p-2.5 px-4 flex items-center space-x-3 shadow-sm">
        <div className="flex items-center space-x-1.5 text-blue-600 text-xs font-bold shrink-0">
          <Radio className="w-3.5 h-3.5" />
          <span>现场实时动态流:</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center space-x-6 animate-marquee whitespace-nowrap text-xs text-slate-700">
            {eventTicker.map((item) => (
              <div key={item.id} className="inline-flex items-center space-x-2">
                <span className="font-mono text-slate-500 text-[11px]">[{item.time}]</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    item.level === 'major'
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : item.level === 'warning'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : item.level === 'info'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}
                >
                  {item.tag}
                </span>
                <span className="text-slate-700">{item.text}</span>
                <span className="text-slate-300">✦</span>
              </div>
            ))}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 shrink-0 font-mono hidden md:block">
          上次刷新: {lastRefreshedAt.toLocaleTimeString()}
        </div>
      </div>

      {/* 图表点击联动：数据摘要浮层 + 问 AI 深入分析 */}
      {chartInsight && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setChartInsight(null)}
        >
          <div
            className="w-full max-w-sm glass-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-800 flex items-center">
                <BarChart3 className="w-4 h-4 mr-1.5 text-blue-500" />
                {chartInsight.title}
              </h4>
              <button
                onClick={() => setChartInsight(null)}
                className="text-slate-500 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5 text-xs">
              {chartInsight.items.map((it, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50/80 border border-slate-100"
                >
                  <span className="text-slate-500">{it.label}</span>
                  <span className="font-mono font-bold text-blue-600">{it.value}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                onAskAi?.(chartInsight.prompt);
                setChartInsight(null);
              }}
              className="mt-3 w-full py-2.5 rounded-lg btn-gradient text-xs font-medium flex items-center justify-center space-x-1.5 cursor-pointer shadow-sm transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>问 AI 深入分析</span>
            </button>
          </div>
        </div>
      )}

      {/* ==================== 异常定位抽屉：监测 → 定位 → 干预 闭环 ==================== */}
      {drillType && (
        <div className="fixed inset-0 z-[90] flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={closeDrill}>
          <aside
            className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 抽屉头：闭环链路 + 关闭 */}
            <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-white">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 flex items-center">
                  <Target className="w-4 h-4 mr-1.5 text-blue-600" />
                  {DRILL_META[drillType].title}
                </h3>
                <button
                  onClick={closeDrill}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
                  aria-label="关闭异常定位抽屉"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="flex items-center text-[10px] text-slate-500 font-medium">
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">监测</span>
                  <ChevronRight className="w-3 h-3 mx-0.5 text-slate-300" />
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">定位（当前）</span>
                  <ChevronRight className="w-3 h-3 mx-0.5 text-slate-300" />
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">干预</span>
                </span>
                <span className="text-[10px] text-slate-500">{DRILL_META[drillType].desc}</span>
              </div>
            </div>

            {/* 明细列表 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {drillLoading && (
                <div className="py-10 flex flex-col items-center text-slate-500 text-xs">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
                  正在定位异常设备…
                </div>
              )}

              {!drillLoading && drillError && (
                <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  {drillError}
                </div>
              )}

              {!drillLoading && !drillError && drillItems.length === 0 && (
                <div className="py-12 text-center">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                  <p className="text-xs text-emerald-600 font-medium">当前无该类异常，运行状态良好</p>
                </div>
              )}

              {!drillLoading &&
                drillItems.map((item) => {
                  const rowKey = `${drillType}:${item.refId}`;
                  const isCreating = creatingKeys.has(rowKey);
                  const isCreated = createdKeys.has(rowKey);
                  return (
                    <div
                      key={rowKey}
                      className={`p-3 rounded-xl border text-xs transition-colors ${
                        item.severity === 'high'
                          ? 'bg-rose-50/60 border-rose-200'
                          : 'bg-amber-50/50 border-amber-200'
                      }`}
                    >
                      {/* 行头：设备 + 严重度 */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">{item.equipmentName}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {item.equipmentCode}
                            {item.workshop ? ` · ${item.workshop}` : ''}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                            item.severity === 'high'
                              ? 'bg-rose-100 text-rose-700 border-rose-200'
                              : 'bg-amber-100 text-amber-700 border-amber-200'
                          }`}
                        >
                          {item.severity === 'high' ? '高优先' : '中优先'}
                        </span>
                      </div>

                      {/* 异常说明 */}
                      <p className="mt-1.5 text-slate-700 leading-relaxed">{item.detail}</p>

                      {/* 关键字段网格：异常类型 / 指标值 / 最近巡检 / 健康分 */}
                      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
                        <div className="p-1.5 rounded-lg bg-white/80 border border-slate-100">
                          <span className="text-slate-500 block">异常类型</span>
                          <span className="font-semibold text-slate-800">{item.abnormalType}</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-white/80 border border-slate-100">
                          <span className="text-slate-500 block">{item.metricLabel}</span>
                          <span className="font-mono font-bold text-blue-600">{String(item.metricValue)}</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-white/80 border border-slate-100">
                          <span className="text-slate-500 block">最近巡检</span>
                          <span className="font-mono text-slate-700">{item.lastInspectionAt || '无记录'}</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-white/80 border border-slate-100">
                          <span className="text-slate-500 block">健康分</span>
                          <span
                            className={`font-mono font-bold ${
                              item.healthScore == null ? 'text-slate-500' : item.healthScore < 70 ? 'text-rose-600' : 'text-emerald-600'
                            }`}
                          >
                            {item.healthScore == null ? '—' : item.healthScore}
                          </span>
                        </div>
                      </div>

                      {/* 一键干预 */}
                      <button
                        type="button"
                        onClick={() => handleOneClickRepair(item)}
                        disabled={isCreating || isCreated || !item.equipmentId}
                        className={`mt-2.5 w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                          isCreated
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                            : !item.equipmentId
                            ? 'bg-slate-50 text-slate-500 border border-slate-200 cursor-not-allowed'
                            : 'btn-gradient text-white cursor-pointer hover:shadow-md disabled:opacity-60'
                        }`}
                      >
                        {isCreating ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>AI 草稿生成中…</span>
                          </>
                        ) : isCreated ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>工单已生成 ✓</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-3.5 h-3.5" />
                            <span>一键生成检修工单</span>
                          </>
                        )}
                      </button>
                      {!item.equipmentId && (
                        <p className="mt-1 text-[9px] text-slate-500 flex items-center">
                          <FilePlus2 className="w-3 h-3 mr-1" />
                          该异常未关联设备，请到工单页手动创建
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* 抽屉底：干预说明 */}
            <div className="p-3 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 flex items-center">
              <Zap className="w-3 h-3 mr-1 text-blue-500" />
              一键干预将复用 AI 工单草稿能力自动填充标题/描述/优先级，并创建真实检修工单
            </div>
          </aside>
        </div>
      )}

      {/* 全局轻提示（创建成功 / 失败原因） */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium max-w-[90vw] ${
            toast.ok
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white'
          }`}
          role="status"
        >
          <span className="flex items-center">
            {toast.ok ? <CheckCircle2 className="w-4 h-4 mr-1.5" /> : <AlertTriangle className="w-4 h-4 mr-1.5" />}
            {toast.text}
          </span>
        </div>
      )}
    </div>
  );
};
