import React from 'react';
import { UserCheck, X } from 'lucide-react';
import {
  Equipment,
  WorkOrder,
  InspectionTask,
  SafetyPermit,
  UserProfile,
  LotoLock,
  Hazard,
} from '../../types';
import {
  AdminPanels,
  ManagerPanels,
  TechnicianPanels,
  InspectorPanels,
  OperatorPanels,
  ArchivistPanels,
  UserPanels,
} from './rolePanels';
import { AiReport } from '../../api';

export interface RoleWorkstationSectionProps {
  currentUser: UserProfile;
  workOrders: WorkOrder[];
  activeWorkOrders: WorkOrder[];
  urgentOrders: WorkOrder[];
  equipments: Equipment[];
  inspections: InspectionTask[];
  pendingSafetyApprovals: SafetyPermit[];
  pendingHazardsList: Hazard[];
  recentAuditLogs: any[];
  activeLotoLocks: LotoLock[];
  hazardsLoadFailed: boolean;
  auditLogsLoadFailed: boolean;
  recommendProcedures: any[];
  proceduresLoadFailed: boolean;
  pendingReviewArticles: any[];
  pendingReviewLoadFailed: boolean;
  knowledgeStats: any;
  knowledgeLoadFailed: boolean;
  graphStats: { nodes: number; edges: number };
  graphLoadFailed: boolean;
  isExtractingGraph: boolean;
  extractFeedback: string | null;
  setExtractFeedback: (val: string | null) => void;
  handleApproveKnowledge: (id: string) => Promise<void>;
  handleRejectKnowledge: (id: string) => Promise<void>;
  handleExtractGraph: () => Promise<void>;
  reportModalOpen: boolean;
  reportType: 'inspection' | 'maintenance' | 'monthly';
  reportRange: { start: string; end: string };
  reportState: {
    loading: boolean;
    error: string | null;
    degraded?: boolean;
    reviewId?: string | null;
    data?: AiReport | null;
  };
  setReportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReportType: React.Dispatch<React.SetStateAction<'inspection' | 'maintenance' | 'monthly'>>;
  setReportRange: React.Dispatch<React.SetStateAction<{ start: string; end: string }>>;
  handleGenerateReport: () => Promise<void>;
  onOpenCreateWorkOrder?: () => void;
  onSelectWorkOrder?: (order: WorkOrder) => void;
  onNavigate?: (tab: string) => void;
}

export const RoleWorkstationSection: React.FC<RoleWorkstationSectionProps> = ({
  currentUser,
  workOrders,
  activeWorkOrders,
  urgentOrders,
  equipments,
  inspections,
  pendingSafetyApprovals,
  pendingHazardsList,
  recentAuditLogs,
  activeLotoLocks,
  hazardsLoadFailed,
  auditLogsLoadFailed,
  recommendProcedures,
  proceduresLoadFailed,
  pendingReviewArticles,
  pendingReviewLoadFailed,
  knowledgeStats,
  knowledgeLoadFailed,
  graphStats,
  graphLoadFailed,
  isExtractingGraph,
  extractFeedback,
  setExtractFeedback,
  handleApproveKnowledge,
  handleRejectKnowledge,
  handleExtractGraph,
  reportModalOpen,
  reportType,
  reportRange,
  reportState,
  setReportModalOpen,
  setReportType,
  setReportRange,
  handleGenerateReport,
  onOpenCreateWorkOrder,
  onSelectWorkOrder,
  onNavigate,
}) => {
  return (
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
          <button
            onClick={() => setExtractFeedback(null)}
            className="text-slate-500 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 1. admin（机电部长）：全局待审批 + 最近审计日志 + 隐患未闭环 */}
      {currentUser.role === 'admin' && (
        <AdminPanels
          currentUser={currentUser}
          workOrders={workOrders}
          pendingSafetyApprovals={pendingSafetyApprovals}
          pendingHazardsList={pendingHazardsList}
          recentAuditLogs={recentAuditLogs}
          activeLotoLocks={activeLotoLocks}
          hazardsLoadFailed={hazardsLoadFailed}
          auditLogsLoadFailed={auditLogsLoadFailed}
          onNavigate={onNavigate}
        />
      )}

      {/* 2. manager（车间主管）：团队工单完成率 + 待我审批列表 + 预警设备 */}
      {currentUser.role === 'manager' && (
        <ManagerPanels
          currentUser={currentUser}
          equipments={equipments}
          workOrders={workOrders}
          activeWorkOrders={activeWorkOrders}
          urgentOrders={urgentOrders}
          pendingSafetyApprovals={pendingSafetyApprovals}
          onNavigate={onNavigate}
        />
      )}

      {/* 3. technician（机电技师）：分配给我的工单 + 设备健康度预警 + 常用作业指引 */}
      {currentUser.role === 'technician' && (
        <TechnicianPanels
          currentUser={currentUser}
          equipments={equipments}
          workOrders={workOrders}
          recommendProcedures={recommendProcedures}
          proceduresLoadFailed={proceduresLoadFailed}
          onSelectWorkOrder={onSelectWorkOrder}
          onNavigate={onNavigate}
        />
      )}

      {/* 4. inspector（点检工程师）：我的今日巡检任务 + 安全监护待办 + 隐患上报入口 */}
      {currentUser.role === 'inspector' && (
        <InspectorPanels currentUser={currentUser} inspections={inspections} onNavigate={onNavigate} />
      )}

      {/* 5. operator（操作工）：我创建的/派给我的工单 + 我的作业指引 + 今日安全须知 */}
      {currentUser.role === 'operator' && (
        <OperatorPanels
          currentUser={currentUser}
          workOrders={workOrders}
          onOpenCreateWorkOrder={onOpenCreateWorkOrder}
          onSelectWorkOrder={onSelectWorkOrder}
          onNavigate={onNavigate}
        />
      )}

      {/* 6. archivist（档案管理员）：待审核知识条目 + 知识库统计 + 图谱更新 */}
      {currentUser.role === 'archivist' && (
        <ArchivistPanels
          currentUser={currentUser}
          pendingReviewArticles={pendingReviewArticles}
          pendingReviewLoadFailed={pendingReviewLoadFailed}
          knowledgeStats={knowledgeStats}
          knowledgeLoadFailed={knowledgeLoadFailed}
          graphStats={graphStats}
          graphLoadFailed={graphLoadFailed}
          isExtractingGraph={isExtractingGraph}
          handleApproveKnowledge={handleApproveKnowledge}
          handleRejectKnowledge={handleRejectKnowledge}
          handleExtractGraph={handleExtractGraph}
          onNavigate={onNavigate}
        />
      )}

      {/* 7. user（吊装司机等）：我的作业票 + 安全交底指引 + 我的待办 */}
      {currentUser.role === 'user' && (
        <UserPanels
          currentUser={currentUser}
          inspections={inspections}
          reportModalOpen={reportModalOpen}
          reportType={reportType}
          reportRange={reportRange}
          reportState={reportState}
          setReportModalOpen={setReportModalOpen}
          setReportType={setReportType}
          setReportRange={setReportRange}
          handleGenerateReport={handleGenerateReport}
          onNavigate={onNavigate || (() => {})}
        />
      )}
    </div>
  );
};
