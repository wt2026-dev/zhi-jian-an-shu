import React, { useState, useEffect } from 'react';
import {
  Wrench,
  ShieldCheck,
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
import { RoleWorkstationSection } from './dashboard/RoleWorkstationSection';
import {
  aiApi,
  complianceApi,
  sparePartsApi,
  hazardsApi,
  auditLogApi,
  knowledgeApi,
  procedureApi,
  AiReport,
} from '../api';
import { DashboardHero } from './dashboard/DashboardHero';
import { DashboardKpiHeader } from './dashboard/DashboardKpiHeader';
import { OperationsSection } from './dashboard/OperationsSection';
import { TelemetryAndInspectionSection } from './dashboard/TelemetryAndInspectionSection';
import { ComplianceAuditSection } from './dashboard/ComplianceAuditSection';
import { AiReportModal } from './dashboard/AiReportModal';

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

  // 接口加载失败状态记录（带安全语义：失败不等于空）
  const [sparePartsLoadFailed, setSparePartsLoadFailed] = useState(false);
  const [hazardsLoadFailed, setHazardsLoadFailed] = useState(false);
  const [complianceLoadFailed, setComplianceLoadFailed] = useState(false);
  const [auditLogsLoadFailed, setAuditLogsLoadFailed] = useState(false);
  const [pendingReviewLoadFailed, setPendingReviewLoadFailed] = useState(false);
  const [knowledgeLoadFailed, setKnowledgeLoadFailed] = useState(false);
  const [graphLoadFailed, setGraphLoadFailed] = useState(false);
  const [proceduresLoadFailed, setProceduresLoadFailed] = useState(false);

  // 角色专属工作台模块扩展状态
  const [recentAuditLogs, setRecentAuditLogs] = useState<any[]>([]);
  const [pendingReviewArticles, setPendingReviewArticles] = useState<any[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<{ total: number; categories: Record<string, number> } | null>(null);
  const [graphStats, setGraphStats] = useState<{ nodes: number; edges: number } | null>(null);
  const [recommendProcedures, setRecommendProcedures] = useState<any[]>([]);
  const [isExtractingGraph, setIsExtractingGraph] = useState(false);
  const [extractFeedback, setExtractFeedback] = useState<string | null>(null);

  useEffect(() => {
    complianceApi
      .getStats()
      .then((s) => {
        setComplianceStats(s);
        setComplianceLoadFailed(false);
      })
      .catch((e) => {
        console.warn('合规统计加载失败:', e);
        setComplianceLoadFailed(true);
      });
    auditLogApi
      .list({ limit: 4 })
      .then((res) => {
        setRecentAuditLogs(Array.isArray(res) ? res : []);
        setAuditLogsLoadFailed(false);
      })
      .catch((e) => {
        console.warn('审计日志加载失败:', e);
        setAuditLogsLoadFailed(true);
      });
    sparePartsApi
      .getLowStock()
      .then((res) => {
        setLowStockParts(Array.isArray(res) ? res : []);
        setSparePartsLoadFailed(false);
      })
      .catch((e) => {
        console.warn('低库存备件加载失败:', e);
        setSparePartsLoadFailed(true);
      });
    hazardsApi
      .list({ status: 'all' })
      .then((res) => {
        if (Array.isArray(res)) {
          setPendingHazardsList(res.filter((h) => h.status !== 'closed'));
        }
        setHazardsLoadFailed(false);
      })
      .catch((e) => {
        console.warn('隐患列表加载失败:', e);
        setHazardsLoadFailed(true);
      });
  }, []);

  // 专属模块异步数据拉取 (随 currentUser.role 切换即时更新)
  useEffect(() => {
    if (currentUser.role === 'admin') {
      auditLogApi
        .list({ limit: 4 })
        .then((res) => {
          setRecentAuditLogs(Array.isArray(res) ? res : []);
          setAuditLogsLoadFailed(false);
        })
        .catch((e) => {
          console.warn('审计日志加载失败:', e);
          setAuditLogsLoadFailed(true);
        });
    }
    if (currentUser.role === 'archivist' || currentUser.role === 'admin') {
      knowledgeApi
        .reviewList('pending')
        .then((res) => {
          setPendingReviewArticles(Array.isArray(res) ? res : []);
          setPendingReviewLoadFailed(false);
        })
        .catch((e) => {
          console.warn('待审知识条目加载失败:', e);
          setPendingReviewLoadFailed(true);
        });
      knowledgeApi
        .list()
        .then((list) => {
          if (Array.isArray(list)) {
            const cats: Record<string, number> = {};
            list.forEach((item: any) => { cats[item.category] = (cats[item.category] || 0) + 1; });
            setKnowledgeStats({ total: list.length, categories: cats });
          }
          setKnowledgeLoadFailed(false);
        })
        .catch((e) => {
          console.warn('知识库列表加载失败:', e);
          setKnowledgeLoadFailed(true);
        });
      knowledgeApi
        .graph()
        .then((g) => {
          setGraphStats({ nodes: g?.nodes?.length ?? 0, edges: g?.edges?.length ?? 0 });
          setGraphLoadFailed(false);
        })
        .catch((e) => {
          console.warn('知识图谱加载失败:', e);
          setGraphLoadFailed(true);
        });
    }
    if (['technician', 'operator', 'user'].includes(currentUser.role)) {
      procedureApi
        .list()
        .then((res) => {
          setRecommendProcedures(Array.isArray(res) ? res.slice(0, 4) : []);
          setProceduresLoadFailed(false);
        })
        .catch((e) => {
          console.warn('推荐规程加载失败:', e);
          setProceduresLoadFailed(true);
        });
    }
  }, [currentUser.id, currentUser.role]);

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
      setGraphStats({ nodes: g?.nodes?.length ?? 0, edges: g?.edges?.length ?? 0 });
      setGraphLoadFailed(false);
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

  const ACTIVE_WORK_ORDER_STATUSES = ['created', 'dispatched', 'in_progress', 'pending_acceptance'];
  const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

  const activeWorkOrders = workOrders
    .filter((w) => ACTIVE_WORK_ORDER_STATUSES.includes(w.status))
    .sort((a, b) => {
      const byPriority = (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
      if (byPriority !== 0) return byPriority;
      return (b.createdTimestamp || 0) - (a.createdTimestamp || 0);
    });

  const dashboardWorkOrders = activeWorkOrders.slice(0, 6);

  const activeSafetyPermits = safetyPermits.filter(
    (s) => s.status === 'active' || s.status === 'approved'
  );
  const pendingSafetyApprovals = safetyPermits.filter((s) => s.status === 'pending_approval');

  const lotoPermitCount = activeSafetyPermits.filter(
    (s) => (s.permitType || '').includes('LOTO') || !!s.lotoNumber
  ).length;
  const hotWorkPermitCount = activeSafetyPermits.filter((s) => (s.permitType || '').includes('动火')).length;
  const heightWorkPermitCount = activeSafetyPermits.filter((s) => (s.permitType || '').includes('高处')).length;

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
  const [reportState, setReportState] = useState<{
    loading: boolean;
    error: string | null;
    degraded?: boolean;
    reviewId?: string | null;
    data?: AiReport | null;
  }>({ loading: false, error: null });

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

  return (
    <div className="space-y-6 pb-12 bg-gradient-to-b from-slate-50 via-white to-slate-100 min-h-[calc(100vh-100px)]">
      {/* L1 Hero & 紧急告警横幅 */}
      <DashboardHero
        currentUser={currentUser}
        avgHealthScore={avgHealthScore}
        pendingWorkOrdersCount={pendingWorkOrders.length}
        urgentOrdersCount={urgentOrders.length}
        urgentOrder={urgentOrders[0]}
        onSelectWorkOrder={onSelectWorkOrder}
      />

      {/* L2 KPI 核心态势网格与紧凑警报条 */}
      <DashboardKpiHeader
        totalEquipments={totalEquipments}
        runningEquipments={runningEquipments}
        warningEquipments={warningEquipments}
        faultEquipments={faultEquipments}
        pendingWorkOrdersCount={pendingWorkOrders.length}
        urgentOrdersCount={urgentOrders.length}
        inProgressOrdersCount={workOrders.filter((w) => w.status === 'in_progress').length}
        pendingAcceptanceOrdersCount={workOrders.filter((w) => w.status === 'pending_acceptance').length}
        completedInspectionPoints={inspections.reduce((s, i) => s + i.completedPoints, 0)}
        totalInspectionPoints={inspections.reduce((s, i) => s + i.totalPoints, 0)}
        inspectionAbnormalCount={inspections.reduce((s, i) => s + i.abnormalCount, 0)}
        activeSafetyPermitsCount={activeSafetyPermits.length}
        pendingSafetyApprovalsCount={pendingSafetyApprovals.length}
        lotoPermitCount={lotoPermitCount}
        hotWorkPermitCount={hotWorkPermitCount}
        heightWorkPermitCount={heightWorkPermitCount}
        sparePartsLoadFailed={sparePartsLoadFailed}
        lowStockParts={lowStockParts}
        hazardsLoadFailed={hazardsLoadFailed}
        pendingHazardsList={pendingHazardsList}
        onNavigate={onNavigate}
      />

      {/* ============ 分区② 作业执行（emerald）：快捷通道 + 工单动态 + 执行看板 ============ */}
      <SectionTitle
        color="emerald"
        icon={<Wrench className="w-4 h-4 text-emerald-500" />}
        title="作业执行"
        hint="快捷作业通道 · 工单动态 · 执行与巡检看板"
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 -mt-2">
        {/* Left 2 Cols: Operations Hub */}
        <div className="lg:col-span-2">
          <OperationsSection
            currentUser={currentUser}
            dashboardWorkOrders={dashboardWorkOrders}
            activeWorkOrders={activeWorkOrders}
            urgentOrders={urgentOrders}
            totalWorkOrdersCount={workOrders.length}
            onSelectWorkOrder={onSelectWorkOrder}
            onOpenCreateWorkOrder={onOpenCreateWorkOrder}
            onOpenCreateSafetyPermit={onOpenCreateSafetyPermit}
            onNavigate={onNavigate}
            onOpenAiReport={() => setReportModalOpen(true)}
          />
        </div>

        {/* Right 1 Col: Telemetry & Inspections */}
        <div>
          <TelemetryAndInspectionSection
            equipments={equipments}
            inspections={inspections}
            activeLotoLocks={activeLotoLocks}
            onSelectEquipment={onSelectEquipment}
            onNavigate={onNavigate}
          />
        </div>
      </div>

      {/* ============ 分区③ 安全合规（amber）：作业合规审计 + 岗位专属工作台 ============ */}
      <SectionTitle
        color="amber"
        icon={<ShieldCheck className="w-4 h-4 text-amber-500" />}
        title="安全合规"
        hint="AI 实时作业审计 · 岗位专属待办与督办"
      />
      <ComplianceAuditSection
        complianceStats={complianceStats}
        complianceLoadFailed={complianceLoadFailed}
        auditLogsLoadFailed={auditLogsLoadFailed}
        recentAuditLogs={recentAuditLogs}
        onNavigate={onNavigate}
      />

      {/* ========================================================================= */}
      {/* 岗位专属协同中枢 (每角色 2-3 个专属模块卡片，由 currentUser.role 条件渲染) */}
      {/* ========================================================================= */}
      <RoleWorkstationSection
        currentUser={currentUser}
        workOrders={workOrders}
        activeWorkOrders={activeWorkOrders}
        urgentOrders={urgentOrders}
        equipments={equipments}
        inspections={inspections}
        pendingSafetyApprovals={pendingSafetyApprovals}
        pendingHazardsList={pendingHazardsList}
        recentAuditLogs={recentAuditLogs}
        activeLotoLocks={activeLotoLocks}
        hazardsLoadFailed={hazardsLoadFailed}
        auditLogsLoadFailed={auditLogsLoadFailed}
        recommendProcedures={recommendProcedures}
        proceduresLoadFailed={proceduresLoadFailed}
        pendingReviewArticles={pendingReviewArticles}
        pendingReviewLoadFailed={pendingReviewLoadFailed}
        knowledgeStats={knowledgeStats}
        knowledgeLoadFailed={knowledgeLoadFailed}
        graphStats={graphStats}
        graphLoadFailed={graphLoadFailed}
        isExtractingGraph={isExtractingGraph}
        extractFeedback={extractFeedback}
        setExtractFeedback={setExtractFeedback}
        handleApproveKnowledge={handleApproveKnowledge}
        handleRejectKnowledge={handleRejectKnowledge}
        handleExtractGraph={handleExtractGraph}
        reportModalOpen={reportModalOpen}
        reportType={reportType}
        reportRange={reportRange}
        reportState={reportState}
        setReportModalOpen={setReportModalOpen}
        setReportType={setReportType}
        setReportRange={setReportRange}
        handleGenerateReport={handleGenerateReport}
        onOpenCreateWorkOrder={onOpenCreateWorkOrder}
        onSelectWorkOrder={onSelectWorkOrder}
        onNavigate={onNavigate}
      />

      {/* AI 智能报告生成弹窗 (功能 5) */}
      <AiReportModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        reportType={reportType}
        setReportType={setReportType}
        reportRange={reportRange}
        setReportRange={setReportRange}
        reportState={reportState}
        onGenerateReport={handleGenerateReport}
      />
    </div>
  );
};
