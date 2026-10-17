import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  Equipment,
  WorkOrder,
  InspectionTask,
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
import { Anchor3D, TwinDataSign } from './digital-twin/TwinScene3D';
import { ANCHOR_POS, anchorPct, sandboxStatus } from './cockpit/sandbox';
import { CockpitHeader } from './cockpit/CockpitHeader';
import { CockpitKpiGrid } from './cockpit/CockpitKpiGrid';
import { CockpitSandboxSection } from './cockpit/CockpitSandboxSection';
import { CockpitChartsSection } from './cockpit/CockpitChartsSection';
import { CockpitTicker } from './cockpit/CockpitTicker';
import { CockpitDrillDrawer } from './cockpit/CockpitDrillDrawer';
import { CockpitChartInsightModal } from './cockpit/CockpitChartInsightModal';

interface CockpitDashboardViewProps {
  onNavigateTab?: (tab: string) => void;
  onSelectEquipment?: (eq: Equipment) => void;
  /** 唤起全局悬浮 AI 面板并预填问题（由 App 注入） */
  onAskAi?: (prompt: string) => void;
}

/**
 * 百分比格式化：null → 「—」。
 * 驾驶舱里所有比率都走这里，避免出现「—%」这种半截文案，也避免为了好看去编分母。
 */
const fmtPct = (v: string | null) => (v == null ? '—' : `${v}%`);

const DRILL_META: Record<CockpitAbnormalType, { title: string; hint: (n: number) => string; desc: string }> = {
  health: { title: '设备健康异常定位', hint: (n) => `异常 ${n} 台 · 点击定位干预`, desc: '健康分 / 运行状态异常设备' },
  order: { title: '工单积压定位', hint: (n) => `积压 ${n} 单 · 点击定位干预`, desc: '存在未完结工单的设备' },
  inspection: { title: '巡检异常定位', hint: (n) => `异常 ${n} 项 · 点击定位干预`, desc: '巡检发现异常点位的任务' },
  hazard: { title: '隐患待处理定位', hint: (n) => `待处理 ${n} 项 · 点击定位干预`, desc: '未闭环隐患（重大置顶）' },
};

// 3D 数字孪生锚点世界坐标（与 BUILDINGS/TANKS 布局对齐）
const ANCHOR_WORLD_POS: [number, number, number][] = [
  [-6, 2.5, -3], [2, 2, -4], [-3, 1.8, 4], [5, 3, 2], [-8, 1.5, 3],
  [8, 2, -2], [0, 1.5, 0], [-1, 1.5, -6], [6, 1.5, -5], [-6, 1.2, -7],
  [-9, 1.8, -1], [-9, 1.5, 1.5], [9, 1.5, 1], [3, 2, 5], [-4, 1.2, -5.5], [0, 1, 2],
];

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
  const [, setHazardMetrics] = useState<any>(null);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [complianceStats, setComplianceStats] = useState<any>(null);
  const [knowledgeList, setKnowledgeList] = useState<any[]>([]);
  const [aiStats, setAiStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Fullscreen container ref
  const containerRef = useRef<HTMLDivElement>(null);

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
  const onlineRate = totalEquipments > 0 ? ((runningEquipments / totalEquipments) * 100).toFixed(1) : null;

  const totalOrders = workOrders.length;
  const completedOrders = workOrders.filter((w) => w.status === 'completed').length;
  const woCompletionRate = totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(1) : null;

  const totalInspections = inspections.length;
  const completedInspections = inspections.filter((i) => i.status === 'completed').length;
  const inspCompletionRate =
    totalInspections > 0 ? ((completedInspections / totalInspections) * 100).toFixed(1) : null;

  const pendingHazards = hazards.filter((h) => h.status !== 'closed');
  const majorHazards = pendingHazards.filter((h) => h.level === 'major');

  // 4 类可下钻指标卡的实时异常计数
  const healthAbnormalCount = equipments.filter(
    (e) => ['warning', 'fault', 'overhauling'].includes(e.status) || (e.healthScore ?? 100) < 70
  ).length;
  const orderBacklogCount = workOrders.filter((w) => !['completed', 'cancelled'].includes(w.status)).length;
  const inspectionAbnormalCount = inspections.filter((i) => (i.abnormalCount || 0) > 0).length;
  const hazardPendingCount = pendingHazards.length;

  const [drillType, setDrillType] = useState<CockpitAbnormalType | null>(null);
  const [drillItems, setDrillItems] = useState<CockpitAbnormalItem[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [creatingKeys, setCreatingKeys] = useState<Set<string>>(new Set());
  const [createdKeys, setCreatedKeys] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // 打开异常定位抽屉
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

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3200);
  };

  // 一键生成检修工单
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

  const aiCallsCount: number | null = aiStats?.totalCalls ?? null;

  const mistakeRate: string | null =
    complianceStats?.mistake_rate !== undefined && complianceStats?.mistake_rate !== null
      ? (complianceStats.mistake_rate * 100).toFixed(1)
      : null;

  const warningEquipments = equipments.filter((e) => e.status === 'warning').length;
  const faultEquipments = equipments.filter((e) => e.status === 'fault' || e.status === 'overhauling').length;
  const offlineEquipments = equipments.filter((e) => e.status === 'standby').length;

  const eqStatusData = [
    { name: '正常运行', value: runningEquipments, color: '#10b981' },
    { name: '预警监测', value: warningEquipments, color: '#f59e0b' },
    { name: '故障检修', value: faultEquipments, color: '#ef4444' },
    { name: '待机离线', value: offlineEquipments, color: '#64748b' },
  ];

  // 近 14 日趋势：由 workOrders.createdAt 真实分桶
  const trendData = (() => {
    const DAYS = 14;
    const buckets = new Map<string, { orders: number; faults: number }>();
    const now = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      buckets.set(key, { orders: 0, faults: 0 });
    }
    for (const w of workOrders) {
      if (!w.createdAt) continue;
      const key = String(w.createdAt).slice(5, 10); // 'YYYY-MM-DD...' → 'MM-DD'
      const b = buckets.get(key);
      if (!b) continue;
      b.orders += 1;
      if (w.faultType !== '定期润滑维保') b.faults += 1;
    }
    return Array.from(buckets.entries()).map(([day, v]) => ({ day, ...v }));
  })();

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

  const [chartInsight, setChartInsight] = useState<{
    title: string;
    items: { label: string; value: string }[];
    prompt: string;
  } | null>(null);

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
        { label: '在线率', value: fmtPct(onlineRate) },
      ],
      prompt: `驾驶舱设备状态环形图显示：${item.name} ${item.value} 台（占比 ${pct}%），设备总数 ${total} 台，在线率 ${fmtPct(onlineRate)}，故障检修 ${faultEquipments} 台、预警 ${warningEquipments} 台。请分析该状态分布反映的风险，给出最需要关注的 3 个问题与处置建议。`,
    });
  };

  const handleTrendClick = (point: any) => {
    if (!point) return;
    setChartInsight({
      title: `趋势数据 · ${point.day}`,
      items: [
        { label: '检修工单', value: `${point.orders} 单` },
        { label: '故障报警', value: `${point.faults} 次` },
        { label: '工单完成率', value: fmtPct(woCompletionRate) },
      ],
      prompt: `驾驶舱 14 天趋势图显示 ${point.day}：检修工单 ${point.orders} 单、故障工单 ${point.faults} 单。当前工单完成率 ${fmtPct(woCompletionRate)}，设备在线率 ${fmtPct(onlineRate)}，待处理隐患 ${pendingHazards.length} 项。请分析该日数据变化的原因并给出深入建议。`,
    });
  };

  const handleAiInterpret = () => {
    const summary = `设备总数 ${totalEquipments} 台（在线率 ${fmtPct(onlineRate)}）；检修工单 ${totalOrders} 单，完成率 ${fmtPct(woCompletionRate)}；巡检任务 ${totalInspections} 项，完成率 ${fmtPct(inspCompletionRate)}；待处理隐患 ${pendingHazards.length} 项（重大 ${majorHazards.length} 项）；AI 调用次数 ${aiCallsCount == null ? '未接入' : `${aiCallsCount} 次`}。`;
    const eqDist = eqStatusData.map((d) => `${d.name} ${d.value} 台`).join('，');
    const recentTrend = trendData
      .slice(-5)
      .map((d) => `${d.day}: 工单 ${d.orders} 单 / 故障 ${d.faults} 单`)
      .join('；');
    onAskAi?.(
      `请解读当前驾驶舱数据，指出最需要关注的 3 个问题。\n\n【统计摘要】\n${summary}\n\n【设备状态分布】\n${eqDist}\n\n【近 5 日趋势】\n${recentTrend}`
    );
  };

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

  const [sandboxEqId, setSandboxEqId] = useState<string | null>(null);
  const [sandboxNodeIdx, setSandboxNodeIdx] = useState<number>(-1);

  const sandboxAnchors = equipments.slice(0, ANCHOR_POS.length).map((eq, i) => ({
    eq,
    ...anchorPct(i),
  }));

  const [anchorProjected, setAnchorProjected] = useState<{ x: number; y: number; visible: boolean }[]>([]);

  const anchor3DList: Anchor3D[] = equipments.slice(0, ANCHOR_WORLD_POS.length).map((eq, i) => ({
    id: eq.id,
    worldPos: ANCHOR_WORLD_POS[i],
    label: eq.code,
    selected: eq.id === sandboxEqId,
  }));

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

  const sandboxEq =
    equipments.find((e) => e.id === sandboxEqId) ||
    equipments.find((e) => e.status === 'fault') ||
    equipments.find((e) => e.status === 'warning') ||
    equipments[0] ||
    null;

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
      {/* 顶部标题与控制栏 */}
      <CockpitHeader
        isFullscreen={isFullscreen}
        isAutoRefresh={isAutoRefresh}
        countdown={countdown}
        isLoading={isLoading}
        onNavigateTab={onNavigateTab}
        onAskAi={onAskAi}
        handleAiInterpret={handleAiInterpret}
        setIsAutoRefresh={setIsAutoRefresh}
        fetchData={fetchData}
        toggleFullscreen={toggleFullscreen}
      />

      {/* 顶部 6 大核心 KPI 卡片网格 */}
      <CockpitKpiGrid
        runningEquipments={runningEquipments}
        totalEquipments={totalEquipments}
        onlineRate={onlineRate}
        healthAbnormalCount={healthAbnormalCount}
        completedOrders={completedOrders}
        totalOrders={totalOrders}
        woCompletionRate={woCompletionRate}
        orderBacklogCount={orderBacklogCount}
        completedInspections={completedInspections}
        totalInspections={totalInspections}
        inspCompletionRate={inspCompletionRate}
        inspectionAbnormalCount={inspectionAbnormalCount}
        pendingHazards={pendingHazards}
        majorHazards={majorHazards}
        hazardsCount={hazards.length}
        hazardPendingCount={hazardPendingCount}
        aiCallsDisplay={aiCallsCount ?? '—'}
        mistakeRate={mistakeRate}
        openDrill={openDrill}
        fmtPct={fmtPct}
      />

      {/* 全景数字孪生智能沙盘与设备 HUD 终端 */}
      <CockpitSandboxSection
        anchor3DList={anchor3DList}
        handleAnchorProject={handleAnchorProject}
        twinDataSigns={twinDataSigns}
        sandboxAnchors={sandboxAnchors}
        anchorProjected={anchorProjected}
        sandboxEq={sandboxEq}
        setSandboxEqId={setSandboxEqId}
        sandboxNodeIdx={sandboxNodeIdx}
        setSandboxNodeIdx={setSandboxNodeIdx}
        sandboxTimeline={sandboxTimeline}
        activeSandboxNode={activeSandboxNode}
        speakSandbox={speakSandbox}
        onSelectEquipment={onSelectEquipment}
        onAskAi={onAskAi}
      />

      {/* 核心可视化图表与风险告警（设备分布环图、工单趋势图、单元负荷图、备件与隐患清单） */}
      <CockpitChartsSection
        runningEquipments={runningEquipments}
        warningEquipments={warningEquipments}
        faultEquipments={faultEquipments}
        onlineRate={onlineRate}
        woCompletionRate={woCompletionRate}
        eqStatusData={eqStatusData}
        handleEqStatusClick={handleEqStatusClick}
        spareParts={spareParts}
        trendData={trendData}
        handleTrendClick={handleTrendClick}
        workshopBarData={workshopBarData}
        knowledgeList={knowledgeList}
        majorHazards={majorHazards}
        onNavigateTab={onNavigateTab}
        onAskAi={onAskAi}
        fmtPct={fmtPct}
      />

      {/* 底部实时动态事件跑马灯 */}
      <CockpitTicker
        eventTicker={eventTicker}
        lastRefreshedAt={lastRefreshedAt}
      />

      {/* 图表点击联动：数据摘要浮层 + 问 AI 深入分析 */}
      <CockpitChartInsightModal
        chartInsight={chartInsight}
        onClose={() => setChartInsight(null)}
        onAskAi={onAskAi}
      />

      {/* 异常定位抽屉：监测 → 定位 → 干预 闭环 */}
      <CockpitDrillDrawer
        drillType={drillType}
        closeDrill={closeDrill}
        drillLoading={drillLoading}
        drillError={drillError}
        drillItems={drillItems}
        creatingKeys={creatingKeys}
        createdKeys={createdKeys}
        handleOneClickRepair={handleOneClickRepair}
        drillMeta={DRILL_META}
      />

      {/* 全局轻提示（创建成功 / 失败原因） */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium max-w-[90vw] ${
            toast.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
          }`}
          role="status"
        >
          <span className="flex items-center">
            {toast.ok ? (
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 mr-1.5" />
            )}
            {toast.text}
          </span>
        </div>
      )}
    </div>
  );
};
