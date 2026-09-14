import React, { useState, useEffect } from 'react';
import {
  CalendarDays,
  Loader2,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  ShieldCheck,
  Zap,
  TrendingUp,
  Clock,
  ArrowUpRight,
  Sparkles,
  ChevronRight,
  Search,
  FileText,
  Lock,
  Play,
  Box,
  ShieldAlert,
  History,
  Check,
  X,
  BookOpen,
  Share2,
  UserCheck,
  Flame,
  Info,
  CheckSquare,
  Layers,
  FileCheck,
  Truck,
} from 'lucide-react';
import {
  Equipment,
  WorkOrder,
  InspectionTask,
  SafetyPermit,
  UserProfile,
  LotoLock,
  ComplianceStats,
  SparePart,
  Hazard,
} from '../types';
import { aiApi, complianceApi, sparePartsApi, hazardsApi, auditLogApi, knowledgeApi, procedureApi } from '../api';
import { AiResultModal } from './ai/AiResultModal';
import { AiReport } from '../api';
import * as echarts from 'echarts';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
// ─── 提取的子组件（原内联于本文件）──────────────────────────────────────────────
// 重构说明：KpiCard 原以内联 JSX 重复实现了 5 次（5张卡片 × ~30行），
// 提取为独立组件后统一样式、减少重复代码，并可在驾驶舱等视图复用。
import { KpiCard } from './dashboard/KpiCard';


interface DashboardViewProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  workOrders: WorkOrder[];
  inspections: InspectionTask[];
  safetyPermits: SafetyPermit[];
  lotoLocks?: LotoLock[];
  onNavigate: (tab: string) => void;
  onSelectEquipment: (eq: Equipment) => void;
  onSelectWorkOrder: (wo: WorkOrder) => void;
  onOpenCreateWorkOrder: () => void;
  onOpenCreateSafetyPermit: () => void;
}

/** 分区标题：彩色左边条 + 图标 + 标题（工作台三层视觉结构的 L2 分区标识） */
const SectionTitle: React.FC<{
  color: 'blue' | 'emerald' | 'amber';
  icon: React.ReactNode;
  title: string;
  hint?: string;
}> = ({ color, icon, title, hint }) => {
  const bar = { blue: 'bg-blue-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500' }[color];
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1 h-4 rounded-full ${bar}`} />
      <span className="flex items-center gap-1.5">{icon}</span>
      <h2 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h2>
      {hint && <span className="text-[11px] text-slate-500 hidden sm:inline">{hint}</span>}
    </div>
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  currentUser,
  equipments,
  workOrders,
  inspections,
  safetyPermits,
  lotoLocks = [],
  onNavigate,
  onSelectEquipment,
  onSelectWorkOrder,
  onOpenCreateWorkOrder,
  onOpenCreateSafetyPermit,
}) => {
  // Statistics calculations
  const totalEquipments = equipments.length;
  const runningEquipments = equipments.filter((e) => e.status === 'running').length;
  const warningEquipments = equipments.filter((e) => e.status === 'warning').length;
  const faultEquipments = equipments.filter((e) => e.status === 'fault' || e.status === 'overhauling').length;
  const avgHealthScore = Math.round(
    equipments.reduce((sum, e) => sum + e.healthScore, 0) / (totalEquipments || 1)
  );

  // 合规与失误率统计状态
  const [complianceStats, setComplianceStats] = useState<ComplianceStats | null>(null);
  const [lowStockParts, setLowStockParts] = useState<SparePart[]>([]);
  const [pendingHazardsList, setPendingHazardsList] = useState<Hazard[]>([]);

  React.useEffect(() => {
    complianceApi.getStats().then(setComplianceStats).catch((e) => console.warn('合规统计加载失败:', e));
    auditLogApi.list({ limit: 4 }).then((res) => setRecentAuditLogs(Array.isArray(res) ? res : [])).catch(() => {});
    sparePartsApi.getLowStock().then((res) => setLowStockParts(Array.isArray(res) ? res : [])).catch(() => {});
    hazardsApi.list({ status: 'all' }).then((res) => {
      if (Array.isArray(res)) {
        setPendingHazardsList(res.filter((h) => h.status !== 'closed'));
      }
    }).catch(() => {});
  }, []);

  // 角色专属工作台模块扩展状态
  const [recentAuditLogs, setRecentAuditLogs] = useState<any[]>([]);
  const [pendingReviewArticles, setPendingReviewArticles] = useState<any[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<{ total: number; categories: Record<string, number> }>({ total: 0, categories: {} });
  const [graphEntityCount, setGraphEntityCount] = useState<number>(0);
  const [recommendProcedures, setRecommendProcedures] = useState<any[]>([]);
  const [isExtractingGraph, setIsExtractingGraph] = useState(false);
  const [extractFeedback, setExtractFeedback] = useState<string | null>(null);

  // 专属模块异步数据拉取 (随 currentUser.role 切换即时更新)
  useEffect(() => {
    if (currentUser.role === 'admin') {
      auditLogApi.list({ limit: 4 }).then((res) => setRecentAuditLogs(Array.isArray(res) ? res : [])).catch(() => {});
    }
    if (currentUser.role === 'archivist' || currentUser.role === 'admin') {
      knowledgeApi.reviewList('pending').then((res) => setPendingReviewArticles(Array.isArray(res) ? res : [])).catch(() => {});
      knowledgeApi.list().then((list) => {
        if (Array.isArray(list)) {
          const cats: Record<string, number> = {};
          list.forEach((item: any) => { cats[item.category] = (cats[item.category] || 0) + 1; });
          setKnowledgeStats({ total: list.length, categories: cats });
        }
      }).catch(() => {});
      knowledgeApi.graph().then((g) => setGraphEntityCount(g?.nodes?.length || 0)).catch(() => {});
    }
    if (['technician', 'operator', 'user'].includes(currentUser.role)) {
      procedureApi.list().then((res) => setRecommendProcedures(Array.isArray(res) ? res.slice(0, 4) : [])).catch(() => {});
    }
  }, [currentUser.id, currentUser.role]);

  // ECharts 引用与合规趋势折线图渲染
  const complianceChartRef = React.useRef<HTMLDivElement>(null);
  const complianceChartInstance = React.useRef<echarts.ECharts | null>(null);

  React.useEffect(() => {
    if (!complianceChartRef.current) return;
    if (!complianceChartInstance.current) {
      complianceChartInstance.current = echarts.init(complianceChartRef.current);
    }
    const chart = complianceChartInstance.current;
    const trend = complianceStats?.recentTrend || [];
    const dates = trend.map((t) => t.date);
    const scores = trend.map((t) => t.avgScore);
    const orders = trend.map((t) => t.orders);

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        textStyle: { color: '#1e293b', fontSize: 11 },
        padding: [6, 10],
      },
      legend: {
        data: ['合规率 (%)', '审计单数 (单)'],
        top: 0,
        right: 10,
        textStyle: { fontSize: 10, color: '#64748b' },
        itemWidth: 10,
        itemHeight: 6,
        itemGap: 16,
      },
      grid: {
        top: 32,
        right: 30,
        bottom: 12,
        left: 12,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates.length ? dates : ['09-05', '09-06', '09-07', '09-08', '09-09', '09-10', '09-11'],
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          name: '合规率%',
          min: 0,
          max: 100,
          splitLine: { lineStyle: { color: '#f1f5f9', type: 'dashed' } },
          axisLabel: { color: '#64748b', fontSize: 10, formatter: '{value}%' },
        },
        {
          type: 'value',
          name: '审计单数',
          min: 0,
          splitLine: { show: false },
          axisLabel: { color: '#64748b', fontSize: 10, formatter: '{value}单' },
        },
      ],
      series: [
        {
          name: '合规率 (%)',
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          showSymbol: true,
          symbolSize: 4,
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 2.5, color: '#10b981' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(16, 185, 129, 0.18)' },
              { offset: 1, color: 'rgba(16, 185, 129, 0.01)' },
            ]),
          },
          data: scores.length ? scores : [81, 52, 94, 72, 96, 81, 68],
        },
        {
          name: '审计单数 (单)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: true,
          symbolSize: 4,
          itemStyle: { color: '#3b82f6' },
          lineStyle: { width: 2, color: '#3b82f6' },
          data: orders.length ? orders : [0, 1, 1, 1, 1, 0, 1],
        },
      ],
    };

    chart.setOption(option);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [complianceStats]);

  const handleApproveKnowledge = async (id: string) => {
    try {
      await knowledgeApi.approve(id);
      setPendingReviewArticles((prev) => prev.filter((a) => a.id !== id));
      setExtractFeedback('✅ 已成功批准入库！');
      setTimeout(() => setExtractFeedback(null), 3000);
    } catch (e: any) {
      alert(`审批失败: ${e.message}`);
    }
  };

  const handleRejectKnowledge = async (id: string) => {
    const reason = window.prompt('请输入驳回原因:', '内容格式不符合SOP编制规范，请核对修正后重提');
    if (reason === null) return;
    try {
      await knowledgeApi.reject(id, reason);
      setPendingReviewArticles((prev) => prev.filter((a) => a.id !== id));
      setExtractFeedback('已驳回该知识条目');
      setTimeout(() => setExtractFeedback(null), 3000);
    } catch (e: any) {
      alert(`操作失败: ${e.message}`);
    }
  };

  const handleExtractGraph = async () => {
    setIsExtractingGraph(true);
    setExtractFeedback(null);
    try {
      const res = await knowledgeApi.extractGraph();
      setIsExtractingGraph(false);
      setExtractFeedback(`✅ 图谱抽取成功！新增关联 ${res.extractedArticles || 0} 篇规程实体`);
      const g = await knowledgeApi.graph();
      setGraphEntityCount(g?.nodes?.length || 0);
      setTimeout(() => setExtractFeedback(null), 4000);
    } catch (e: any) {
      setIsExtractingGraph(false);
      setExtractFeedback(`抽取失败: ${e.message}`);
    }
  };

  const pendingWorkOrders = workOrders.filter(
    (w) => w.status === 'created' || w.status === 'dispatched' || w.status === 'in_progress'
  );
  const urgentOrders = workOrders.filter((w) => w.priority === 'urgent' && w.status !== 'completed');

  // 左侧「紧急检修工单」栏数据源：放宽为全部活动态工单 (待派单/待接单/检修中/待验收)
  // 按优先级 (urgent > high > medium > low) 排序，同优先级按创建时间倒序
  const ACTIVE_WORK_ORDER_STATUSES = ['created', 'dispatched', 'in_progress', 'pending_acceptance'];
  const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

  const activeWorkOrders = workOrders
    .filter((w) => ACTIVE_WORK_ORDER_STATUSES.includes(w.status))
    .sort((a, b) => {
      const byPriority = (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
      if (byPriority !== 0) return byPriority;
      return (b.createdTimestamp || 0) - (a.createdTimestamp || 0);
    });

  // 与右侧巡检任务栏 (约 8 条) 数量保持均衡，最多展示 6 条
  const dashboardWorkOrders = activeWorkOrders.slice(0, 6);

  const activeSafetyPermits = safetyPermits.filter(
    (s) => s.status === 'active' || s.status === 'approved'
  );
  const pendingSafetyApprovals = safetyPermits.filter((s) => s.status === 'pending_approval');

  // 在控作业票分类统计 (真实数据驱动，替换原硬编码数值)
  const lotoPermitCount = activeSafetyPermits.filter(
    (s) => (s.permitType || '').includes('LOTO') || !!s.lotoNumber
  ).length;
  const hotWorkPermitCount = activeSafetyPermits.filter((s) => (s.permitType || '').includes('动火')).length;
  const heightWorkPermitCount = activeSafetyPermits.filter((s) => (s.permitType || '').includes('高处')).length;

  // LOTO 挂锁执行中的锁具 (后端 loto_locks 表真实数据)
  const activeLotoLocks = lotoLocks.filter((l) => l.status === 'locked');

  // AI 智能报告生成状态 (功能 5)
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportType, setReportType] = useState<'inspection' | 'maintenance' | 'monthly'>('monthly');
  const [reportRange, setReportRange] = useState(() => {
    const end = new Date();
    const start = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { start: fmt(start), end: fmt(end) };
  });
  const [reportState, setReportState] = useState<{ loading: boolean; error: string | null; degraded?: boolean; reviewId?: string | null; data?: AiReport | null }>({ loading: false, error: null });

  const handleGenerateReport = async () => {
    setReportState({ loading: true, error: null });
    try {
      const res = await aiApi.generateReport({
        reportType,
        startDate: reportRange.start,
        endDate: reportRange.end,
      });
      if (res.success && res.report) {
        setReportState({ loading: false, error: null, data: res.report, reviewId: res.reviewId });
      } else {
        setReportState({ loading: false, error: res.message || res.error || '报告生成失败', degraded: res.degraded });
      }
    } catch (err: any) {
      setReportState({ loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  // Role-specific filtered work orders
  const myWorkOrders = workOrders.filter(
    (w) => w.assigneeId === currentUser.id || w.assignee?.includes(currentUser.name.split(' ')[0])
  );

  return (
    <div className="space-y-6 pb-12 bg-gradient-to-b from-slate-50 via-white to-slate-100 min-h-[calc(100vh-100px)]">
      {/* L1 Hero：极浅渐变页头 + 主 KPI 大数字（设备综合健康度） */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-white to-blue-50 border border-blue-100 px-6 py-6 shadow-sm">
        <div
          className="absolute inset-0 opacity-5 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 85% 25%, #3b82f6 0, transparent 45%)' }}
        />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div>
            <p className="text-slate-500 text-xs font-medium tracking-wide">
              {new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好'}，{currentUser.name} ·{' '}
              {currentUser.roleTitle || currentUser.role}
            </p>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-1 tracking-tight">检修工作台</h1>
            <p className="text-slate-500 text-xs mt-1">全厂设备状态、检修执行与安全合规一屏总览</p>
          </div>
          <div className="flex items-center gap-6 md:gap-8 shrink-0">
            <div>
              <div className="text-4xl font-bold font-mono leading-none text-blue-600">
                {avgHealthScore}
                <span className="text-base font-normal text-slate-500 ml-1">/100</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1.5">
                设备综合健康度 · {avgHealthScore >= 85 ? '优良状态' : '需重点关注'}
              </div>
            </div>
            <div className="h-12 w-px bg-slate-200 hidden sm:block" />
            <div className="hidden sm:block">
              <div className="text-2xl font-bold font-mono leading-none text-slate-900">{pendingWorkOrders.length}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">待办检修工单</div>
            </div>
            <div className="hidden md:block">
              <div className="text-2xl font-bold font-mono leading-none text-rose-600">{urgentOrders.length}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">紧急告警</div>
            </div>
          </div>
        </div>
      </div>

      {/* 紧急告警横幅（降低视觉权重：白底 + 玫红左边条） */}
      {urgentOrders.length > 0 && (
        <div className="bg-white border border-slate-200 border-l-4 border-l-rose-500 rounded-lg px-4 py-2.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-rose-100 text-rose-600 rounded-md">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-600 text-white uppercase">
                  紧急告警 (SLA 响应中)
                </span>
                <span className="text-sm font-semibold text-rose-900">
                  {urgentOrders[0].title}
                </span>
              </div>
              <p className="text-xs text-rose-700 mt-0.5">
                设备: {urgentOrders[0].equipmentName} ({urgentOrders[0].equipmentCode}) | 车间: {urgentOrders[0].workshop}
              </p>
            </div>
          </div>
          <button
            onClick={() => onSelectWorkOrder(urgentOrders[0])}
            className="px-3.5 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors flex items-center space-x-1 cursor-pointer shrink-0 shadow-xs"
          >
            <span>立即处置抢修</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* L2 KPI 核心态势网格：5 列对称工业玻璃态卡片 */}
      {/* 重构说明：KPI 1–4（设备总数/待办工单/巡检进度/安全作业票）已提取为 <KpiCard> 子组件；
          KPI 5 为 AI 协同卡片，结构上无主数值（标题+描述+标签），不属于 KpiCard 的数值卡形态，故保留独立实现。 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* KPI 1: 设备总数与台账（已提取为 <KpiCard> 组件） */}
        <KpiCard
          title="设备总数"
          value={totalEquipments}
          icon={<Activity className="w-4 h-4" />}
          iconColor="bg-blue-50 text-blue-600"
          accentColor="hover:border-blue-400"
          badge={
            <span className="text-[11px] text-emerald-600 flex items-center font-medium">
              <TrendingUp className="w-3 h-3 mr-0.5" /> 100% 台账
            </span>
          }
          footer={
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
              <span className="text-emerald-600">运行 {runningEquipments}</span>
              <span className="text-amber-600">预警 {warningEquipments}</span>
              <span className="text-rose-600">故障 {faultEquipments}</span>
            </div>
          }
          onClick={() => onNavigate('equipment')}
        />


        {/* KPI 2: 待办检修工单（已提取为 <KpiCard> 组件） */}
        <KpiCard
          title="待办检修工单"
          value={pendingWorkOrders.length}
          icon={<Wrench className="w-4 h-4" />}
          iconColor="bg-amber-50 text-amber-600"
          accentColor="hover:border-amber-400"
          badge={
            urgentOrders.length > 0 ? (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold animate-pulse">
                紧急 {urgentOrders.length}
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">无紧急</span>
            )
          }
          footer={
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>检修中: {workOrders.filter((w) => w.status === 'in_progress').length}</span>
              <span>待验收: {workOrders.filter((w) => w.status === 'pending_acceptance').length}</span>
            </div>
          }
          onClick={() => onNavigate('work_orders')}
        />

        {/* KPI 3: 今日巡检进度（已提取为 <KpiCard> 组件） */}
        <KpiCard
          title="今日巡检进度"
          value={inspections.reduce((s, i) => s + i.completedPoints, 0)}
          unit={`/${inspections.reduce((s, i) => s + i.totalPoints, 0)}点`}
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconColor="bg-cyan-50 text-cyan-600"
          accentColor="hover:border-cyan-400"
          badge={
            <span className={`text-[11px] font-medium ${inspections.reduce((s, i) => s + i.abnormalCount, 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              异常: {inspections.reduce((s, i) => s + i.abnormalCount, 0)}
            </span>
          }
          footer={
            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round(
                    (inspections.reduce((s, i) => s + i.completedPoints, 0) /
                      (inspections.reduce((s, i) => s + i.totalPoints, 0) || 1)) *
                    100
                  )}%`,
                }}
              />
            </div>
          }
          onClick={() => onNavigate('inspections')}
        />

        {/* KPI 4: 在控安全作业票（已提取为 <KpiCard> 组件） */}
        <KpiCard
          title="在控安全作业票"
          value={activeSafetyPermits.length}
          icon={<ShieldCheck className="w-4 h-4" />}
          iconColor="bg-purple-50 text-purple-600"
          accentColor="hover:border-purple-400"
          badge={
            pendingSafetyApprovals.length > 0 ? (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                {pendingSafetyApprovals.length} 待审批
              </span>
            ) : (
              <span className="text-[11px] text-emerald-600 font-medium">受控闭环</span>
            )
          }
          footer={
            <div className="text-[10px] text-slate-500 flex justify-between">
              <span>LOTO: {lotoPermitCount}</span>
              <span>动火: {hotWorkPermitCount}</span>
              <span>高处: {heightWorkPermitCount}</span>
            </div>
          }
          onClick={() => onNavigate('safety')}
        />

        {/* KPI 5: AI 检修大脑 */}
        <div
          onClick={() => onNavigate('ai_pipeline')}
          className="glass-card data-card p-4 relative overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-md transition-all group shadow-sm bg-gradient-to-br from-blue-50/50 via-white to-indigo-50/30"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900 flex items-center">
              <Sparkles className="w-3.5 h-3.5 mr-1 text-blue-600" /> AI 协同编排
            </span>
            <ArrowUpRight className="w-4 h-4 text-blue-600 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </div>
          <div className="mt-2">
            <div className="text-xs font-semibold text-slate-800">4 步机理并发诊断</div>
            <p className="text-[10px] text-slate-500 mt-0.5">串行方案 · 风险与派单并行协同</p>
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
            <span className="text-slate-500">通义千问</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono font-semibold">
              DAG Pipeline
            </span>
          </div>
        </div>
      </div>

      {/* 紧凑型监控警报胶囊条：备件库存告急 + 现场隐患闭环 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* 低库存告警卡片（紧凑横幅） */}
        <div
          onClick={() => onNavigate('spare_parts')}
          className={`p-3 rounded-xl border transition-all cursor-pointer group shadow-sm flex items-center justify-between ${
            lowStockParts.length > 0
              ? 'bg-rose-50/60 border-rose-200 hover:border-rose-300'
              : 'bg-white border-slate-200 hover:border-blue-300'
          }`}
        >
          <div className="flex items-center space-x-3 min-w-0">
            <div className={`p-2 rounded-lg shrink-0 ${lowStockParts.length > 0 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>
              <Box className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-800">工业备件安全库存</span>
                {lowStockParts.length > 0 ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 font-semibold">
                    {lowStockParts.length} 项告急
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                    充足
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                {lowStockParts.length > 0
                  ? `包括 ${lowStockParts.slice(0, 2).map((p) => p.name).join('、')} 等低于安全阈值`
                  : '全厂 22+ 项备件在库充盈，满足维保周转'}
              </p>
            </div>
          </div>
          <span className="text-xs text-blue-600 font-medium group-hover:translate-x-1 transition-transform flex items-center shrink-0 ml-2">
            备件库 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </span>
        </div>

        {/* 现场隐患闭环卡片（紧凑横幅） */}
        <div
          onClick={() => onNavigate('hazards')}
          className={`p-3 rounded-xl border transition-all cursor-pointer group shadow-sm flex items-center justify-between ${
            pendingHazardsList.length > 0
              ? 'bg-amber-50/60 border-amber-200 hover:border-amber-300'
              : 'bg-white border-slate-200 hover:border-blue-300'
          }`}
        >
          <div className="flex items-center space-x-3 min-w-0">
            <div className={`p-2 rounded-lg shrink-0 ${pendingHazardsList.length > 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-800">安全隐患治理闭环</span>
                {pendingHazardsList.filter((h) => h.level === 'major').length > 0 && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 font-semibold">
                    {pendingHazardsList.filter((h) => h.level === 'major').length} 重大
                  </span>
                )}
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-semibold">
                  {pendingHazardsList.length} 在控
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                {pendingHazardsList.length > 0
                  ? `最新: ${pendingHazardsList[0]?.title.slice(0, 24)}...`
                  : '厂区无未消缺隐患，处于安全平稳期'}
              </p>
            </div>
          </div>
          <span className="text-xs text-blue-600 font-medium group-hover:translate-x-1 transition-transform flex items-center shrink-0 ml-2">
            治理台 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </span>
        </div>
      </div>

      {/* ============ 分区② 作业执行（emerald）：快捷通道 + 工单动态 + 执行看板 ============ */}
      <SectionTitle
        color="emerald"
        icon={<Wrench className="w-4 h-4 text-emerald-500" />}
        title="作业执行"
        hint="快捷作业通道 · 工单动态 · 执行与巡检看板"
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 -mt-2">
        {/* Left 2 Cols: Main Operations Hub */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick Actions：彩色 icon 瓷砖矩阵（44px 圆角瓷砖 + hover 上浮） */}
          <div className="glass-card p-4 shadow-sm relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-slate-900 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2"></span>
                快捷作业通道（{currentUser.roleTitle}）
              </h3>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {/* 工单 = blue */}
              <button
                id="btn-quick-create-wo"
                onClick={onOpenCreateWorkOrder}
                className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-blue-300 cursor-pointer group"
              >
                <span className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 group-hover:scale-105 transition-transform">
                  <Wrench className="w-5 h-5" />
                </span>
                <span className="text-[11px] font-semibold text-slate-700 group-hover:text-blue-600 transition-colors">创建报修工单</span>
                <span className="text-[9px] text-slate-500 -mt-1.5">突发故障一键派单</span>
              </button>

              {/* 安全作业票 = amber (LOTO) */}
              <button
                id="btn-quick-safety"
                onClick={onOpenCreateSafetyPermit}
                className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-amber-300 cursor-pointer group"
              >
                <span className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500 group-hover:scale-105 transition-transform">
                  <ShieldCheck className="w-5 h-5" />
                </span>
                <span className="text-[11px] font-semibold text-slate-700 group-hover:text-amber-600 transition-colors">申请安全作业票</span>
                <span className="text-[9px] text-slate-500 -mt-1.5">动火/高处/LOTO</span>
              </button>

              {/* AI 诊断 = sky */}
              <button
                id="btn-quick-ai-diag"
                onClick={() => onNavigate('ai_assistant')}
                className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-sky-300 cursor-pointer group"
              >
                <span className="w-11 h-11 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-500 group-hover:scale-105 transition-transform">
                  <Sparkles className="w-5 h-5" />
                </span>
                <span className="text-[11px] font-semibold text-slate-700 group-hover:text-sky-600 transition-colors">AI故障诊断向导</span>
                <span className="text-[9px] text-slate-500 -mt-1.5">输入症状秒出SOP</span>
              </button>

              {/* 知识库 = purple */}
              <button
                id="btn-quick-knowledge"
                onClick={() => onNavigate('knowledge')}
                className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-purple-300 cursor-pointer group"
              >
                <span className="w-11 h-11 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-500 group-hover:scale-105 transition-transform">
                  <Search className="w-5 h-5" />
                </span>
                <span className="text-[11px] font-semibold text-slate-700 group-hover:text-purple-600 transition-colors">检索检修规程</span>
                <span className="text-[9px] text-slate-500 -mt-1.5">SOP/事故案例/图谱</span>
              </button>

              {/* AI 报告 = violet */}
              <button
                id="btn-quick-ai-report"
                onClick={() => setReportModalOpen(true)}
                className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-violet-300 cursor-pointer group"
              >
                <span className="w-11 h-11 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center text-violet-500 group-hover:scale-105 transition-transform">
                  <CalendarDays className="w-5 h-5" />
                </span>
                <span className="text-[11px] font-semibold text-slate-700 group-hover:text-violet-600 transition-colors">AI 智能报告</span>
                <span className="text-[9px] text-slate-500 -mt-1.5">巡检/检修/月度</span>
              </button>
            </div>
          </div>

          {/* Active Work Orders Table / Queue */}
          <div className="glass-card p-4 shadow-sm relative">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center">
                  <Wrench className="w-4 h-4 mr-2 text-blue-600" />
                  {currentUser.role === 'technician'
                    ? `待我处置的检修工单 (${dashboardWorkOrders.length})`
                    : `紧急检修工单 (活动态 ${activeWorkOrders.length} 条 / 紧急 ${urgentOrders.length} 条)`}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  按优先级排序: 待派单 → 待接单 → 检修处理 → 待验收
                </p>
              </div>
              <button
                onClick={() => onNavigate('work_orders')}
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center font-medium cursor-pointer"
              >
                查看全部工单 ({workOrders.length})
                <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
              </button>
            </div>

            <div className="max-h-[480px] overflow-y-auto pr-1 space-y-2.5">
              {dashboardWorkOrders.map((wo) => {
                const isUrgent = wo.priority === 'urgent';
                const isHigh = wo.priority === 'high';

                const statusMap: Record<string, { label: string; color: string }> = {
                  created: { label: '待派单', color: 'bg-orange-50 text-orange-700 border-orange-200' },
                  dispatched: { label: '待接单', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                  in_progress: { label: '检修中', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                  pending_acceptance: { label: '待验收', color: 'bg-purple-50 text-purple-700 border-purple-200' },
                  completed: { label: '已归档', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                };

                const currentStatus = statusMap[wo.status] || { label: wo.status, color: 'bg-slate-100 text-slate-600 border-slate-200' };

                return (
                  <div
                    key={wo.id}
                    onClick={() => onSelectWorkOrder(wo)}
                    className="p-3 bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-blue-300 rounded-lg transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 group shadow-xs"
                  >
                    <div className="flex items-start space-x-3">
                      <div
                        className={`p-2 rounded-md mt-0.5 ${isUrgent
                            ? 'bg-rose-50 text-rose-600 border border-rose-200'
                            : isHigh
                              ? 'bg-amber-50 text-amber-600 border border-amber-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                      >
                        <Wrench className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-xs text-slate-500">{wo.orderNo}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded border font-semibold ${isUrgent
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : isHigh
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}
                          >
                            {wo.priority === 'urgent' ? '紧急' : wo.priority === 'high' ? '高' : '一般'}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded border font-medium ${currentStatus.color}`}>
                            {currentStatus.label}
                          </span>
                        </div>
                        <h4 className="text-xs font-semibold text-slate-900 group-hover:text-blue-600 transition-colors mt-0.5">
                          {wo.title}
                        </h4>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center space-x-3">
                          <span>设备: {wo.equipmentName}</span>
                          <span>车间: {wo.workshop}</span>
                          <span>主修: {wo.assignee || '待分配'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end space-x-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                      <span className="text-[10px] font-mono text-slate-500 flex items-center">
                        <Clock className="w-3 h-3 mr-1 text-slate-500" />
                        {wo.createdAt.split(' ')[1] || wo.createdAt}
                      </span>
                      <button className="px-2.5 py-1 text-xs bg-slate-100 group-hover:bg-blue-600 text-slate-700 group-hover:text-white rounded-md transition-colors flex items-center font-medium shadow-xs">
                        <span>详情/处理</span>
                        <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {dashboardWorkOrders.length === 0 && (
                <div className="p-8 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center">
                  <CheckCircle2 className="w-8 h-8 text-slate-500 mb-2" />
                  <p className="text-xs font-semibold text-slate-700">暂无进行中工单</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    当前没有待派单 / 待接单 / 检修中 / 待验收的活动工单，可点击上方「创建报修工单」发起。
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right 1 Col: Equipment Health & Inspection Widget */}
        <div className="space-y-6">
          {/* Real-time Focus Equipment Health List */}
          <div className="glass-card p-4 shadow-sm relative">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center">
                <Activity className="w-4 h-4 mr-2 text-emerald-600" />
                设备健康实时雷达
              </h3>
              <button
                onClick={() => onNavigate('health')}
                className="text-xs text-blue-600 hover:underline cursor-pointer font-medium"
              >
                遥测大屏
              </button>
            </div>

            <div className="space-y-2.5">
              {equipments.slice(0, 4).map((eq) => {
                const isAlarm = eq.healthScore < 60 || eq.status === 'fault';
                const isWarn = eq.healthScore >= 60 && eq.healthScore < 80;
                return (
                  <div
                    key={eq.id}
                    onClick={() => onSelectEquipment(eq)}
                    className="p-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 group-hover:text-blue-600 truncate">
                        {eq.name}
                      </span>
                      <span
                        className={`text-xs font-bold font-mono px-1.5 py-0.2 rounded ${isAlarm
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : isWarn
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                      >
                        {eq.healthScore}分
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5 font-medium">
                      <span>温度: <strong className={eq.telemetry.temperature > 75 ? 'text-rose-600 font-mono' : 'text-slate-800 font-mono'}>{eq.telemetry.temperature}°C</strong></span>
                      <span>振动: <strong className={eq.telemetry.vibration > 4.5 ? 'text-rose-600 font-mono' : 'text-slate-800 font-mono'}>{eq.telemetry.vibration}mm/s</strong></span>
                      <span>负荷: <strong className="text-slate-800 font-mono">{eq.telemetry.loadRate}%</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Today's Inspection Progress Widget */}
          <div className="glass-card p-4 shadow-sm relative">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-2 text-blue-600" />
                巡检路线打卡与状态
              </h3>
              <button
                onClick={() => onNavigate('inspections')}
                className="text-xs text-blue-600 hover:underline cursor-pointer font-medium"
              >
                进入巡检终端
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto pr-1 space-y-2">
              {inspections.map((task) => (
                <div key={task.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800 truncate">{task.title}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${task.status === 'in_progress'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                    >
                      {task.status === 'in_progress' ? '进行中' : '未开始'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 truncate">
                    路线: {task.route}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                    <span>已完成: <strong className="text-slate-800 font-mono">{task.completedPoints}/{task.totalPoints}</strong> 测点</span>
                    {task.abnormalCount > 0 && (
                      <span className="text-rose-600 font-medium">发现 {task.abnormalCount} 处异常</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* LOTO Safety Interlock Quick Status */}
          <div className="glass-card p-4 shadow-sm relative">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center">
                <Lock className="w-4 h-4 mr-2 text-purple-600" />
                LOTO 停电挂牌生命锁状态
              </h3>
              <button
                onClick={() => onNavigate('safety')}
                className="text-xs text-blue-600 hover:underline cursor-pointer font-medium"
              >
                安全管理
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
              {activeLotoLocks.map((lock) => (
                <div
                  key={lock.id}
                  className="p-2.5 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-900 space-y-1"
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span className="truncate">{lock.pointName || lock.permitTitle || '能量隔离点已锁定'}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-600 text-white font-mono shrink-0 ml-2">
                      {lock.lockNo}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    隔离动力源: {lock.energySource || '—'} | 锁闭人: {lock.lockedBy || '—'}
                  </p>
                </div>
              ))}
              {activeLotoLocks.length === 0 && (
                <div className="p-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center text-[11px] text-slate-500">
                  当前无挂锁执行中的 LOTO 能量隔离作业
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ============ 分区③ 安全合规（amber）：作业合规审计 + 岗位专属工作台 ============ */}
      <SectionTitle
        color="amber"
        icon={<ShieldCheck className="w-4 h-4 text-amber-500" />}
        title="安全合规"
        hint="AI 实时作业审计 · 岗位专属待办与督办"
      />
      <div className="glass-card p-5 shadow-sm relative overflow-hidden bg-white border border-slate-200/80 rounded-xl -mt-2">
        {/* 细渐变顶线 */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 via-cyan-400 to-blue-500" />

        {/* 头部 */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          {/* 左侧：绿图标块 + 标题 + AI 实时审计徽章 + 副文案 */}
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                  检修作业操作合规与失误率监控
                </h3>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                  AI 实时审计
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                基于通义千问大模型对已闭环工单执行标准化步骤对比与安全违规检测
              </p>
            </div>
          </div>

          {/* 右侧：3 个指标 (竖线分隔) */}
          <div className="flex items-center divide-x divide-slate-200 shrink-0 self-start lg:self-auto">
            {/* 指标 1：累计审计工单 */}
            <div className="px-3 sm:px-4 first:pl-0">
              <div className="text-[11px] text-slate-500">累计审计工单</div>
              <div className="text-base sm:text-lg font-bold text-slate-800 font-mono mt-0.5">
                {complianceStats?.totalAuditedOrders ?? complianceStats?.totalOrders ?? 0}{' '}
                <span className="text-xs font-normal text-slate-500">单</span>
              </div>
            </div>

            {/* 指标 2：平均合规得分 */}
            <div className="px-3 sm:px-4">
              <div className="text-[11px] text-slate-500">平均合规得分</div>
              <div
                className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${
                  (complianceStats?.avgScore ?? 100) >= 90 ? 'text-emerald-600' : 'text-amber-600'
                }`}
              >
                {complianceStats?.avgScore ?? 100}{' '}
                <span className="text-xs font-normal text-slate-500">分</span>
              </div>
            </div>

            {/* 指标 3：失误/违章率 */}
            <div className="px-3 sm:px-4 last:pr-0">
              <div className="text-[11px] text-slate-500">失误/违章率</div>
              {(() => {
                const rawRate = complianceStats?.mistakeRate ?? 0;
                const rateNum = Number(rawRate) <= 1 ? Math.round(Number(rawRate) * 100) : Math.round(Number(rawRate));
                return (
                  <div
                    className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${
                      rateNum > 15 ? 'text-rose-600' : 'text-blue-600'
                    }`}
                  >
                    {rateNum}{' '}
                    <span className="text-xs font-normal text-slate-500">%</span>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* 内容区：grid lg:grid-cols-3 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-4">
          {/* 左侧 lg:col-span-2：「近 14 日作业合规趋势与审计量」ECharts 折线 */}
          <div className="lg:col-span-2 flex flex-col justify-between">
            <div className="mb-1">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                近 14 日作业合规趋势与审计量
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">大模型核验步骤率 + 日审计工单</span>
            </div>
            <div ref={complianceChartRef} className="w-full h-44" />
          </div>

          {/* 右侧 1 列：「安全合规审计日志」列表 + 底部按钮 */}
          <div className="flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-100 pt-4 lg:pt-0 lg:pl-5">
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                  安全合规审计日志
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                  最新 {Math.min(recentAuditLogs.length, 4)} 条
                </span>
              </div>

              {/* 日志列表 */}
              <div className="space-y-2">
                {recentAuditLogs.length > 0 ? (
                  recentAuditLogs.slice(0, 4).map((log: any, idx: number) => (
                    <div
                      key={log.id || idx}
                      className="p-2.5 rounded-lg bg-slate-50/80 border border-slate-100 hover:bg-blue-50/30 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-800 truncate max-w-[140px]">
                          {log.userName || log.operator || '系统审计员'}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {log.timestamp ? String(log.timestamp).split(' ')[1] || log.timestamp : '刚刚'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-600 font-mono text-[10px] border border-blue-100 shrink-0">
                          {log.actionType || '合规审计'}
                        </span>
                        <span className="truncate text-slate-500 text-[11px]" title={log.detail}>
                          {log.detail || '完成标准化作业步骤比对'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-xs text-slate-500">
                    暂无待处理审计告警日志
                  </div>
                )}
              </div>
            </div>

            {/* 底部查看全部工单审计报告按钮 */}
            <button
              type="button"
              onClick={() => onNavigate('work_orders')}
              className="w-full mt-3 py-2 px-3 rounded-lg bg-blue-50 hover:bg-blue-100/70 border border-blue-100 text-xs font-medium text-blue-600 flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <span>查看全部工单审计报告</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 岗位专属协同中枢 (每角色 2-3 个专属模块卡片，由 currentUser.role 条件渲染) */}
      {/* ========================================================================= */}
      <div className="space-y-3 mt-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-amber-500" />
            <UserCheck className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>岗位专属协同工作台</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium border bg-amber-50 text-amber-700 border-amber-200">
                {currentUser.name} · {currentUser.roleTitle || currentUser.role}
              </span>
            </h3>
          </div>
          <span className="text-xs text-slate-500">
            岗位专属核心卡片与即时待办 · 右上角切换用户自动刷新
          </span>
        </div>

        {extractFeedback && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-medium flex items-center justify-between animate-in fade-in">
            <span>{extractFeedback}</span>
            <button onClick={() => setExtractFeedback(null)} className="text-slate-500 hover:text-slate-600 cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* 1. admin（机电部长）：全局待审批 + 最近审计日志 + 隐患未闭环 */}
        {currentUser.role === 'admin' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 全局待审批 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">全局高危待审批</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    {pendingSafetyApprovals.length + workOrders.filter(w => w.status === 'pending_acceptance').length} 项待批
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-3">特种作业票终审与检修工单会签验收核准</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                    <span className="text-slate-600">待审批高危作业票</span>
                    <span className="font-bold text-amber-600 font-mono">{pendingSafetyApprovals.length} 份</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                    <span className="text-slate-600">待验收工单终审会签</span>
                    <span className="font-bold text-purple-600 font-mono">{workOrders.filter(w => w.status === 'pending_acceptance').length} 项</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                    <span className="text-slate-600">在控 LOTO 停电隔离锁</span>
                    <span className="font-bold text-emerald-600 font-mono">{activeLotoLocks.length} 组</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3 flex items-center justify-between">
                <button
                  onClick={() => onNavigate('safety')}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center cursor-pointer"
                >
                  <span>会签作业票</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </button>
                <button
                  onClick={() => onNavigate('work_orders')}
                  className="text-xs text-purple-600 hover:text-purple-700 font-medium flex items-center cursor-pointer"
                >
                  <span>会签工单</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </button>
              </div>
            </div>

            {/* 卡片 2: 最近审计日志 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <History className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">安全合规审计日志</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                    实时留痕
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">全厂鉴权/提单/作业票审批合规记录</p>
                <div className="space-y-1.5 text-xs">
                  {recentAuditLogs.slice(0, 3).map((log, idx) => (
                    <div key={log.id || idx} className="p-2 rounded bg-slate-50 border border-slate-100 text-[11px]">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-semibold text-slate-800">{log.userName || log.userRole} · {log.actionType}</span>
                        <span className="font-mono text-[10px]">{log.createdAt ? new Date(log.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '刚刚'}</span>
                      </div>
                      <p className="text-slate-600 truncate mt-0.5">{log.detail || log.actionDesc || '操作合规留痕'}</p>
                    </div>
                  ))}
                  {recentAuditLogs.length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">暂无最近审计流水</div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('users')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  查看完整审计日志与用户花名册 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 隐患未闭环督办 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">全厂隐患未闭环督办</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold">
                    {pendingHazardsList.length} 项在控
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">重大与一般隐患整改时限与闭环跟踪</p>
                <div className="space-y-1.5 text-xs">
                  {pendingHazardsList.slice(0, 2).map((h) => (
                    <div key={h.id} className="p-2 rounded bg-amber-50/50 border border-amber-200 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate max-w-[180px]">{h.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${h.level === 'major' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                          {h.level === 'major' ? '重大' : '一般'}
                        </span>
                      </div>
                      <div className="text-slate-500 text-[10px] mt-1 flex justify-between">
                        <span>设备: {h.equipment_name || '通用区'}</span>
                        <span className="text-rose-600 font-mono">限期: {h.deadline || '本周内'}</span>
                      </div>
                    </div>
                  ))}
                  {pendingHazardsList.length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">当前全厂无未闭环隐患</div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('hazards')}
                  className="w-full text-center text-xs text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                >
                  进入安全隐患闭环治理中枢 →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2. manager（车间主管）：团队工单完成率 + 待我审批列表 + 预警设备 */}
        {currentUser.role === 'manager' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 团队工单完成率 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">车间团队工单完成率</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                    达标 94.2%
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-3">动力车间运维班组抢修与例行维保执行效能</p>
                <div className="space-y-2 text-xs">
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '94.2%' }}></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 text-center text-[11px]">
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="text-slate-500 text-[10px]">活动中</div>
                      <div className="font-bold text-blue-600 font-mono text-sm">{activeWorkOrders.length}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="text-slate-500 text-[10px]">紧急抢修</div>
                      <div className="font-bold text-rose-600 font-mono text-sm">{urgentOrders.length}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="text-slate-500 text-[10px]">已归档</div>
                      <div className="font-bold text-emerald-600 font-mono text-sm">{workOrders.filter(w => w.status === 'completed').length}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('work_orders')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  工单智能调度与派工中心 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 待我审批列表 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-purple-50 text-purple-600 border border-purple-200">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">待我终审与会签</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">
                    {pendingSafetyApprovals.length} 项待签
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">高危作业票（动火/受限空间/高处）终审</p>
                <div className="space-y-1.5 text-xs">
                  {pendingSafetyApprovals.slice(0, 2).map((s) => (
                    <div key={s.id} className="p-2 rounded bg-purple-50/60 border border-purple-200 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-purple-900 truncate">{s.permitNo} · {s.permitType}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-200 text-purple-800 font-semibold">待审批</span>
                      </div>
                      <p className="text-slate-600 text-[10px] truncate mt-0.5">{(s as any).workContent || s.title || '车间特种作业会签'}</p>
                    </div>
                  ))}
                  {pendingSafetyApprovals.length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">当前无待审批作业票</div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('safety')}
                  className="w-full text-center text-xs text-purple-600 hover:text-purple-700 font-medium cursor-pointer"
                >
                  进入安全作业票审批中心 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 预警设备 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <Zap className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">车间预警设备雷达</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    {equipments.filter(e => e.healthScore < 80 || e.status === 'warning').length} 台重点关注
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">健康分&lt;80或遥测异常机组监控</p>
                <div className="space-y-1.5 text-xs">
                  {equipments.filter(e => e.healthScore < 80 || e.status === 'warning').slice(0, 2).map((eq) => (
                    <div key={eq.id} className="p-2 rounded bg-amber-50/50 border border-amber-200 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate">{eq.name}</span>
                        <span className="text-[10px] font-mono font-bold text-rose-600">{eq.healthScore}分</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                        <span>振动: {eq.telemetry.vibration}mm/s</span>
                        <span>温度: {eq.telemetry.temperature}°C</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('health')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  进入健康监测遥测大屏 →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. technician（机电技师）：分配给我的工单 + 设备健康度预警 + 常用作业指引 */}
        {currentUser.role === 'technician' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 分配给我的工单 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">分配给我的检修工单</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                    {workOrders.filter(w => (w.assignee && w.assignee.includes(currentUser.name)) || w.status === 'dispatched').length} 项待处
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">当前指派给您或维保班组负责的工单</p>
                <div className="space-y-1.5 text-xs">
                  {workOrders.filter(w => (w.assignee && w.assignee.includes(currentUser.name)) || w.status === 'dispatched').slice(0, 2).map((wo) => (
                    <div key={wo.id} onClick={() => onSelectWorkOrder(wo)} className="p-2 rounded bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate">{wo.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${wo.priority === 'urgent' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                          {wo.priority === 'urgent' ? '紧急抢修' : '检修'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                        <span>{wo.equipmentName}</span>
                        <span className="text-blue-600">点击处理 →</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('work_orders')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  查看全部维保工单 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 设备健康度预警 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <Zap className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">负责机组遥测超标预警</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    振动/温升偏高
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">需要现场紧固对中或润滑补油的机组</p>
                <div className="space-y-1.5 text-xs">
                  {equipments.filter(e => e.healthScore < 85).slice(0, 2).map((eq) => (
                    <div key={eq.id} className="p-2 rounded bg-amber-50/50 border border-amber-200 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate">{eq.name}</span>
                        <span className="text-[10px] font-mono font-bold text-rose-600">{eq.healthScore}分</span>
                      </div>
                      <div className="text-[10px] text-slate-600 mt-1 flex justify-between">
                        <span>振动: {eq.telemetry.vibration}mm/s</span>
                        <span>温升: {eq.telemetry.temperature}°C</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('ai_assistant')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  一键启动 AI 多维智能诊断 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 常用作业指引 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">推荐检修作业指引 SOP</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                    SOP标准化
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">机电拆装、对中调校、轴承更换规程</p>
                <div className="space-y-1.5 text-xs">
                  {recommendProcedures.slice(0, 2).map((proc) => (
                    <div key={proc.id} onClick={() => onNavigate('procedures')} className="p-2 rounded bg-slate-50 border border-slate-200 hover:border-emerald-300 transition-colors cursor-pointer text-[11px]">
                      <div className="font-semibold text-slate-900 truncate">{proc.title}</div>
                      <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                        <span>{proc.equipmentType || '通用机电'}</span>
                        <span className="text-emerald-600">查阅规程 →</span>
                      </div>
                    </div>
                  ))}
                  {recommendProcedures.length === 0 && (
                    <div className="p-2 rounded bg-slate-50 text-slate-600 text-[11px]">
                      《硬齿面减速机高速轴轴承更换SOP规程》已就绪
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('procedures')}
                  className="w-full text-center text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
                >
                  进入标准化作业规程库 →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 4. inspector（点检工程师）：我的今日巡检任务 + 安全监护待办 + 隐患上报入口 */}
        {currentUser.role === 'inspector' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 我的今日巡检任务 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-cyan-50 text-cyan-600 border border-cyan-200">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">我的今日巡检打卡任务</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-100 text-cyan-800 font-semibold">
                    进行中
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">关键动设备智能巡检路线与测点打卡</p>
                <div className="space-y-2 text-xs">
                  {inspections.slice(0, 2).map((t) => (
                    <div key={t.id} className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px]">
                      <div className="flex items-center justify-between font-semibold text-slate-900">
                        <span className="truncate">{t.title}</span>
                        <span className="text-[10px] text-cyan-700 font-mono">{t.completedPoints}/{t.totalPoints} 测点</span>
                      </div>
                      <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1.5">
                        <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${Math.round(((t.completedPoints || 1) / (t.totalPoints || 1)) * 100)}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('inspections')}
                  className="w-full text-center text-xs text-cyan-700 hover:text-cyan-800 font-medium cursor-pointer"
                >
                  进入巡检作业终端打卡 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 安全监护待办 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <ShieldAlert className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">专职安全监护会签待办</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                    安全在控
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">动火作业气体检测与现场监护责任人会签</p>
                <div className="space-y-1.5 text-xs">
                  <div className="p-2 rounded bg-amber-50/60 border border-amber-200 text-[11px]">
                    <div className="font-semibold text-slate-900">动火票 SP-20260902-01 现场气体检测</div>
                    <div className="text-[10px] text-slate-600 mt-1">3# 轧机齿圈热喷涂补焊 · 可燃气体含量 0.05% 合格</div>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px]">
                    <div className="font-semibold text-slate-900">高空与吊装作业安全隔离带核检</div>
                    <div className="text-[10px] text-slate-600 mt-1">起重半径警戒线、灭火器具摆放就位核验</div>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('safety')}
                  className="w-full text-center text-xs text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                >
                  签署安全监护会签意见 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 隐患上报入口 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">点检异常与现场隐患上报</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold border border-rose-200">
                    绿色通道
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">现场巡检发现跑冒滴漏或异常测点快速立项</p>
                <div className="p-3 rounded-lg bg-rose-50/50 border border-rose-100 text-xs text-slate-700 space-y-1.5">
                  <div className="text-[11px] font-semibold text-rose-800">点检异常转隐患规范：</div>
                  <div className="text-[10px] text-slate-600 leading-relaxed">
                    1. 拍照留存轴承异常发热或振动超标测温数据<br />
                    2. 评估隐患等级（一般隐患/重大隐患）<br />
                    3. 一键立项直通闭环治理，指派机械/电气专工排查
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('hazards')}
                  className="w-full text-center text-xs text-rose-600 hover:text-rose-700 font-medium cursor-pointer"
                >
                  前往隐患闭环登记新隐患 →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 5. operator（操作工）：我创建的/派给我的工单 + 我的作业指引 + 今日安全须知 */}
        {currentUser.role === 'operator' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 我创建的工单 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">我上报的报修工单</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">
                    现场维保跟进
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">岗位操作报修实时流转节点跟踪</p>
                <div className="space-y-1.5 text-xs">
                  {workOrders.filter(w => (w.creator && w.creator.includes(currentUser.name)) || (w.assignee && w.assignee.includes(currentUser.name))).slice(0, 2).map((wo) => (
                    <div key={wo.id} onClick={() => onSelectWorkOrder(wo)} className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px] cursor-pointer hover:border-emerald-300">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate">{wo.title}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-700">{wo.status}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                        <span>主修: {wo.assignee || '待派单'}</span>
                        <span className="text-emerald-600">查看进度 →</span>
                      </div>
                    </div>
                  ))}
                  {workOrders.filter(w => (w.creator && w.creator.includes(currentUser.name)) || (w.assignee && w.assignee.includes(currentUser.name))).length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">
                      WO-20260904-122 (离心风机皮带异响) 张技师已接单
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3 flex items-center justify-between">
                <button
                  onClick={onOpenCreateWorkOrder}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  快速故障报修 +
                </button>
                <button
                  onClick={() => onNavigate('work_orders')}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
                >
                  查看我的工单 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 我的作业指引 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">岗位日常标准作业指引</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                    岗位操作卡
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">生产机组启停、切换、日常点检规范</p>
                <div className="space-y-1.5 text-xs">
                  <div onClick={() => onNavigate('procedures')} className="p-2 rounded bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer text-[11px]">
                    <div className="font-semibold text-slate-900">《离心式高压注水泵日常启停操作卡》</div>
                    <div className="text-[10px] text-slate-500 mt-1">开阀充水 · 盘车确认 · 启动升压五步法</div>
                  </div>
                  <div onClick={() => onNavigate('procedures')} className="p-2 rounded bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer text-[11px]">
                    <div className="font-semibold text-slate-900">《现场机组轴承日常点检及润滑补油规程》</div>
                    <div className="text-[10px] text-slate-500 mt-1">油位视镜检查 · 油质沉淀排查要点</div>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('procedures')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  查阅全量标准作业规程 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 今日安全须知 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <Flame className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">今日早班安全交底须知</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    班前交底
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">生产一线安全禁令与个人劳保穿戴要求</p>
                <div className="space-y-1.5 text-xs">
                  <div className="p-2 rounded bg-amber-50/60 border border-amber-200 text-[11px]">
                    <span className="font-bold text-amber-900">防机械夹伤红线：</span>
                    <span className="text-slate-700"> 设备运转时严禁接触传动皮带与联轴器防护罩。</span>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px]">
                    <span className="font-bold text-slate-800">动火区域隔离：</span>
                    <span className="text-slate-600"> 维保动火点周边 10 米内严禁堆放油棉纱及可燃包装物。</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('safety')}
                  className="w-full text-center text-xs text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                >
                  查看车间在控高危作业票 →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 6. archivist（档案管理员）：待审核知识条目 + 知识库统计 + 图谱更新 */}
        {currentUser.role === 'archivist' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 待审核知识条目 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-200">
                      <FileCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">待审核知识规程队列</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">
                    {pendingReviewArticles.length} 篇待审
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">技师上报 SOP 与案例快速审批流</p>
                <div className="space-y-2 text-xs">
                  {pendingReviewArticles.slice(0, 2).map((art) => (
                    <div key={art.id} className="p-2 rounded bg-indigo-50/40 border border-indigo-200 text-[11px]">
                      <div className="font-semibold text-slate-900 truncate">{art.title}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">作者: {art.author || '现场维保人员'}</div>
                      <div className="flex items-center space-x-2 mt-2">
                        <button
                          onClick={() => handleApproveKnowledge(art.id)}
                          className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium flex items-center space-x-1 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          <span>批准入库</span>
                        </button>
                        <button
                          onClick={() => handleRejectKnowledge(art.id)}
                          className="px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-medium flex items-center space-x-1 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                          <span>驳回修正</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  {pendingReviewArticles.length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">
                      暂无待审核知识条目，所有提交规程均已完成入库归档
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('knowledge')}
                  className="w-full text-center text-xs text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
                >
                  进入知识库审核中心 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 知识库数字化资产统计 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">数字知识中枢资产</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                    已入库 {knowledgeStats.total || 8}+ 篇
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">规程/典型故障案例/结构图纸分类</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100 text-[11px]">
                    <span className="text-slate-600">标准化作业规程 (SOP)</span>
                    <span className="font-bold text-blue-600 font-mono">4 篇</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100 text-[11px]">
                    <span className="text-slate-600">典型故障分析与案例</span>
                    <span className="font-bold text-indigo-600 font-mono">3 篇</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100 text-[11px]">
                    <span className="text-slate-600">设备机械结构与参数手册</span>
                    <span className="font-bold text-emerald-600 font-mono">2 篇</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('knowledge')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  导入新文档或导出技术档案 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 图谱更新 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
                      <Share2 className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">工业知识图谱动态维护</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                    {graphEntityCount || 18} 实体节点
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">实体抽取: 设备-部件-故障现象-备件</p>
                <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-100 text-xs text-slate-700 space-y-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-600">关联关系统计</span>
                    <span className="font-bold text-emerald-700 font-mono">26 条关联关系</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-600">图谱覆盖设备种类</span>
                    <span className="font-bold text-slate-800 font-mono">100% 核心动力设备</span>
                  </div>
                  <button
                    onClick={handleExtractGraph}
                    disabled={isExtractingGraph}
                    className="w-full mt-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium flex items-center justify-center space-x-1 cursor-pointer disabled:opacity-50 shadow-xs"
                  >
                    <Share2 className={`w-3.5 h-3.5 ${isExtractingGraph ? 'animate-spin' : ''}`} />
                    <span>{isExtractingGraph ? '正在抽取知识图谱...' : '一键抽取未处理规程图谱'}</span>
                  </button>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('knowledge_graph')}
                  className="w-full text-center text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
                >
                  进入三维交互知识图谱中枢 →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 7. user（吊装司机等）：我的作业票 + 安全交底指引 + 我的待办 */}
        {currentUser.role === 'user' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 我的作业票 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-purple-50 text-purple-600 border border-purple-200">
                      <Truck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">我的起重吊装作业票</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">
                    已核发在控
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">特种起重机械吊装作业安全许可证</p>
                <div className="p-3 rounded-lg bg-purple-50/50 border border-purple-200 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-purple-900">SP-20260904-04 (吊装作业)</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">有效在控</span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    作业内容: 12# 结晶器冷却水泵电机起吊更换 (总重 2.8t)
                  </div>
                  <div className="text-[10px] text-slate-500 flex justify-between pt-1 border-t border-purple-100">
                    <span>监护人: 赵安全</span>
                    <span className="font-mono text-purple-700">吊车吨位: 16t 行车</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('safety')}
                  className="w-full text-center text-xs text-purple-600 hover:text-purple-700 font-medium cursor-pointer"
                >
                  查看作业票安全隔离措施 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 安全交底指引 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">起重作业《十不吊》交底</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    安全红线
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">起重机械特种作业安全禁令与交底规范</p>
                <div className="p-2.5 rounded bg-amber-50/60 border border-amber-200 text-[11px] text-slate-700 space-y-1">
                  <div className="font-bold text-amber-900">特种起重核心红线要求：</div>
                  <div className="text-[10px] text-slate-600 leading-relaxed">
                    1. 信号不清或超载绝对不吊<br />
                    2. 斜拉斜拽、重物下有人绝对不吊<br />
                    3. 钢丝绳断丝超标、吊物捆绑不牢绝对不吊
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('procedures')}
                  className="w-full text-center text-xs text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                >
                  查阅起重设备标准化操作规程 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 我的待办 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <CheckSquare className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">司机班前点检与会签待办</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                    2 项待办
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">起重设备日常点检打卡与工单配合</p>
                <div className="space-y-1.5 text-xs">
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px]">
                    <div className="flex items-center justify-between font-semibold text-slate-800">
                      <span>16t 桥式起重机制动器打卡</span>
                      <span className="text-[10px] text-blue-600">已完成</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">主钩开闭动作灵敏，限位器断火正常</div>
                  </div>
                  <div className="p-2 rounded bg-purple-50/50 border border-purple-200 text-[11px]">
                    <div className="flex items-center justify-between font-semibold text-purple-900">
                      <span>WO-20260904-128 配合会签</span>
                      <span className="text-[10px] text-purple-600">待签署</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">电机吊运找正完毕后配合技师签署验收</div>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('inspections')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  进入起重设备点检终端 →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI 智能报告生成弹窗 (功能 5)：参数配置 → 真实数据聚合 → qwen-plus 生成 */}
      <AiResultModal
        open={reportModalOpen}
        title="AI 智能报告生成 (基于真实业务数据聚合)"
        loading={reportState.loading}
        error={reportState.error}
        degraded={reportState.degraded}
        pendingReview={!!reportState.reviewId}
        data={reportState.data}
        onClose={() => setReportModalOpen(false)}
        configForm={
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-700">
              系统将实时聚合所选范围内巡检/工单/设备健康/作业票真实落库数据，交由 qwen-plus 生成结构化报告。
            </div>
            <div>
              <label className="block text-slate-700 font-medium mb-1">报告类型</label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as any)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
              >
                <option value="monthly">月度设备运行报告</option>
                <option value="inspection">巡检报告</option>
                <option value="maintenance">检修报告</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-700 font-medium mb-1">开始日期</label>
                <input
                  type="date"
                  value={reportRange.start}
                  onChange={(e) => setReportRange({ ...reportRange, start: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
                />
              </div>
              <div>
                <label className="block text-slate-700 font-medium mb-1">结束日期</label>
                <input
                  type="date"
                  value={reportRange.end}
                  onChange={(e) => setReportRange({ ...reportRange, end: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
                />
              </div>
            </div>
            <button
              onClick={handleGenerateReport}
              disabled={reportState.loading}
              className="w-full py-2.5 btn-gradient rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>生成报告</span>
            </button>
          </div>
        }
      />
    </div>
  );
};
