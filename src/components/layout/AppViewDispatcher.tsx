import React, { Suspense } from 'react';
import type {
  Equipment,
  WorkOrder,
  InspectionTask,
  InspectionItem,
  SafetyPermit,
  KnowledgeArticle,
  UserProfile,
  LotoLock,
  WorkOrderCreatePrefill,
} from '../../types';
import type { SpareProcurePrefill } from '../../api';
import { logger } from '../../utils/logger';
import { ErrorBoundary } from '../ErrorBoundary';
import { useAiChatContext } from '../../context/AiChatContext';

import { useAppData } from '../../context/AppDataContext';

// Lazy-loaded view components (code-split per route)
const DashboardView = React.lazy(() => import('../DashboardView').then(m => ({ default: m.DashboardView })));
const EquipmentArchivesView = React.lazy(() => import('../EquipmentArchivesView').then(m => ({ default: m.EquipmentArchivesView })));
const EquipmentHealthView = React.lazy(() => import('../EquipmentHealthView').then(m => ({ default: m.EquipmentHealthView })));
const WorkOrdersView = React.lazy(() => import('../WorkOrdersView').then(m => ({ default: m.WorkOrdersView })));
const InspectionView = React.lazy(() => import('../InspectionView').then(m => ({ default: m.InspectionView })));
const SafetyManagementView = React.lazy(() => import('../SafetyManagementView').then(m => ({ default: m.SafetyManagementView })));
const KnowledgeBaseView = React.lazy(() => import('../KnowledgeBaseView').then(m => ({ default: m.KnowledgeBaseView })));
const ProceduresView = React.lazy(() => import('../ProceduresView').then(m => ({ default: m.ProceduresView })));
const KnowledgeGraphView = React.lazy(() => import('../KnowledgeGraphView').then(m => ({ default: m.KnowledgeGraphView })));
const AiAssistantView = React.lazy(() => import('../AiAssistantView').then(m => ({ default: m.AiAssistantView })));
const UserManagementView = React.lazy(() => import('../UserManagementView').then(m => ({ default: m.UserManagementView })));
const CockpitDashboardView = React.lazy(() => import('../CockpitDashboardView').then(m => ({ default: m.CockpitDashboardView })));
const AiPipelineView = React.lazy(() => import('../AiPipelineView').then(m => ({ default: m.AiPipelineView })));
const AdminAiReviewsView = React.lazy(() => import('../AdminAiReviewsView').then(m => ({ default: m.AdminAiReviewsView })));
const AdminAiModelsView = React.lazy(() => import('../AdminAiModelsView').then(m => ({ default: m.AdminAiModelsView })));
const DispatchBoardView = React.lazy(() => import('../DispatchBoardView').then(m => ({ default: m.DispatchBoardView })));
const SparePartsView = React.lazy(() => import('../SparePartsView').then(m => ({ default: m.SparePartsView })));
const HazardsView = React.lazy(() => import('../HazardsView').then(m => ({ default: m.HazardsView })));
const Equipment3DView = React.lazy(() => import('../equipment3d/DrilldownShell').then(m => ({ default: m.Equipment3DShell })));
const MazeGameView = React.lazy(() => import('../game/MazeGameView').then(m => ({ default: m.MazeGameView })));
const HermesWorkbenchView = React.lazy(() => import('../hermes/HermesWorkbenchView').then(m => ({ default: m.HermesWorkbenchView })));

export interface AppViewDispatcherProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: UserProfile;
  allUsers: UserProfile[];
  equipments?: Equipment[];
  workOrders?: WorkOrder[];
  inspections?: InspectionTask[];
  safetyPermits?: SafetyPermit[];
  articles?: KnowledgeArticle[];
  lotoLocks?: LotoLock[];
  dispatchPreset: { workOrderId?: string | null; equipmentId?: string | null };
  navigateToDispatch: (preset: { workOrderId?: string | null; equipmentId?: string | null }) => void;
  targetWorkOrderIdFor3D: string | null;
  targetWorkOrderIdForDetail: string | null;
  openWorkOrderDetail: (workOrderId: string) => void;
  navigateTo3D: (preset: { workOrderId?: string | null; equipmentId?: string | null }) => void;
  mobileScanEquipmentId: string | null;
  selectedEquipmentForHealth: Equipment | null;
  handleSelectEquipmentForHealth: (eq: Equipment) => void;
  handleOpenWorkOrderForEquipment: (eq: Equipment) => void;
  handleOpenAiDiagnoseForEquipment: (eq: Equipment) => void;
  handleAskAiWithContext: (query: string, contextArticle: KnowledgeArticle) => void;
  aiTargetEquipment: Equipment | null;
  aiPrefilledQuery: string | null;
  showGlobalCreateWorkOrder: boolean;
  workOrderCreatePrefill: WorkOrderCreatePrefill | null;
  setWorkOrderCreatePrefill: (prefill: WorkOrderCreatePrefill | null) => void;
  spareProcurePrefill: SpareProcurePrefill | null;
  setSpareProcurePrefill: (prefill: SpareProcurePrefill | null) => void;
  handleAddEquipment?: (eq: Equipment) => void | Promise<any>;
  handleUpdateEquipment?: (eq: Equipment) => void | Promise<any>;
  handleDeleteEquipment?: (id: string) => void | Promise<any>;
  handleAddWorkOrder?: (wo: WorkOrder) => void | Promise<any>;
  handleUpdateWorkOrder?: (wo: WorkOrder) => void | Promise<any>;
  handleUpdateInspection?: (insp: InspectionTask) => Promise<any> | void;
  handleConvertAbnormalToWorkOrder?: (point: InspectionItem, equipmentName: string) => Promise<any> | void;
  handleAddSafetyPermit?: (permit: SafetyPermit) => void | Promise<any>;
  handleUpdateSafetyPermit?: (permit: SafetyPermit) => void | Promise<any>;
  handleDeleteSafetyPermit?: (id: string) => void | Promise<any>;
  handleAddArticle?: (article: KnowledgeArticle) => void | Promise<any>;
  handleCreateWorkOrderFromAi?: (title: string, equipmentName: string, description: string, currentUser: UserProfile, onSuccess: () => void) => Promise<any> | void;
  handleAddUser?: (user: UserProfile) => void | Promise<any>;
  handleSwitchUserWithHome: (user: UserProfile) => void;
}

/**
 * 驾驶舱 AI 联动桥接组件：
 * 在 Provider 内部读取 askAi，注入给驾驶舱，用于"AI 解读"与图表"问 AI 深入分析"。
 */
const CockpitWithAiBridge: React.FC<{
  onNavigateTab: (tab: string) => void;
  onSelectEquipment: (eq: Equipment) => void;
}> = ({ onNavigateTab, onSelectEquipment }) => {
  const chat = useAiChatContext();
  return (
    <CockpitDashboardView
      onNavigateTab={onNavigateTab}
      onSelectEquipment={onSelectEquipment}
      onAskAi={(text: string) => chat.askAi(text)}
    />
  );
};

/**
 * 顶层视图分发器：负责根据 activeTab 懒加载并渲染对应业务视图。
 */
export const AppViewDispatcher: React.FC<AppViewDispatcherProps> = (props) => {
  const appData = useAppData();
  const {
    activeTab,
    setActiveTab,
    currentUser,
    allUsers,
    dispatchPreset,
    navigateToDispatch,
    targetWorkOrderIdFor3D,
    targetWorkOrderIdForDetail,
    openWorkOrderDetail,
    navigateTo3D,
    mobileScanEquipmentId,
    selectedEquipmentForHealth,
    handleSelectEquipmentForHealth,
    handleOpenWorkOrderForEquipment,
    handleOpenAiDiagnoseForEquipment,
    handleAskAiWithContext,
    aiTargetEquipment,
    aiPrefilledQuery,
    showGlobalCreateWorkOrder,
    workOrderCreatePrefill,
    setWorkOrderCreatePrefill,
    spareProcurePrefill,
    setSpareProcurePrefill,
    handleAddUser,
    handleSwitchUserWithHome,
  } = props;

  const equipments = props.equipments ?? appData.equipments;
  const workOrders = props.workOrders ?? appData.workOrders;
  const inspections = props.inspections ?? appData.inspections;
  const safetyPermits = props.safetyPermits ?? appData.safetyPermits;
  const articles = props.articles ?? appData.articles;
  const lotoLocks = props.lotoLocks ?? appData.lotoLocks;

  const handleAddEquipment = props.handleAddEquipment ?? appData.handleAddEquipment;
  const handleUpdateEquipment = props.handleUpdateEquipment ?? appData.handleUpdateEquipment;
  const handleDeleteEquipment = props.handleDeleteEquipment ?? appData.handleDeleteEquipment;
  const handleAddWorkOrder = props.handleAddWorkOrder ?? appData.handleAddWorkOrder;
  const handleUpdateWorkOrder = props.handleUpdateWorkOrder ?? appData.handleUpdateWorkOrder;
  const handleUpdateInspection = props.handleUpdateInspection ?? appData.handleUpdateInspection;
  const handleConvertAbnormalToWorkOrder = props.handleConvertAbnormalToWorkOrder ?? appData.handleConvertAbnormalToWorkOrder;
  const handleAddSafetyPermit = props.handleAddSafetyPermit ?? appData.handleAddSafetyPermit;
  const handleUpdateSafetyPermit = props.handleUpdateSafetyPermit ?? appData.handleUpdateSafetyPermit;
  const handleDeleteSafetyPermit = props.handleDeleteSafetyPermit ?? appData.handleDeleteSafetyPermit;
  const handleAddArticle = props.handleAddArticle ?? appData.handleAddArticle;
  const handleCreateWorkOrderFromAi = props.handleCreateWorkOrderFromAi ?? appData.handleCreateWorkOrderFromAi;
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-400 text-sm">页面加载中...</div>}>
        {activeTab === 'dashboard' && (
          <DashboardView
            currentUser={currentUser}
            equipments={equipments}
            workOrders={workOrders}
            inspections={inspections}
            safetyPermits={safetyPermits}
            lotoLocks={lotoLocks}
            onNavigate={setActiveTab}
            onSelectEquipment={handleSelectEquipmentForHealth}
            onSelectWorkOrder={() => {
              setActiveTab('work_orders');
            }}
            onOpenCreateWorkOrder={() => setActiveTab('work_orders')}
            onOpenCreateSafetyPermit={() => setActiveTab('safety')}
          />
        )}

        {activeTab === 'cockpit' && (
          <CockpitWithAiBridge
            onNavigateTab={setActiveTab}
            onSelectEquipment={handleSelectEquipmentForHealth}
          />
        )}

        {activeTab === 'spare_parts' && (
          <SparePartsView
            currentUser={currentUser}
            onNavigateToWorkOrders={() => setActiveTab('work_orders')}
            initialProcurePrefill={spareProcurePrefill}
            onProcurePrefillConsumed={() => setSpareProcurePrefill(null)}
          />
        )}

        {activeTab === 'hazards' && (
          <HazardsView
            currentUser={currentUser}
            equipments={equipments}
            allUsers={allUsers}
            onNavigateToWorkOrders={() => setActiveTab('work_orders')}
          />
        )}

        {(activeTab === 'equipments' || activeTab === 'archives') && (
          <EquipmentArchivesView
            currentUser={currentUser}
            equipments={equipments}
            onAddEquipment={handleAddEquipment}
            onUpdateEquipment={handleUpdateEquipment}
            onDeleteEquipment={handleDeleteEquipment}
            onOpenWorkOrderForEquipment={handleOpenWorkOrderForEquipment}
            onOpenAiDiagnoseForEquipment={handleOpenAiDiagnoseForEquipment}
          />
        )}

        {activeTab === 'health' && (
          <EquipmentHealthView
            equipments={equipments}
            selectedEquipmentId={selectedEquipmentForHealth?.id}
            onOpenWorkOrder={handleOpenWorkOrderForEquipment}
            onOpenAiDiagnose={handleOpenAiDiagnoseForEquipment}
            onCreateWorkOrder={handleAddWorkOrder}
            onNavigateTo3D={(equipmentId) => navigateTo3D({ equipmentId })}
            currentUser={currentUser}
          />
        )}

        {activeTab === 'equipment_3d' && (
          <Equipment3DView
            initialWorkOrderId={targetWorkOrderIdFor3D}
            onOpenWorkOrderDetail={openWorkOrderDetail}
            onNavigateToWorkOrderCreate={(prefill) => {
              setActiveTab('work_orders');
              setWorkOrderCreatePrefill(prefill);
            }}
            onNavigateToSpareProcure={(prefill) => {
              setActiveTab('spare_parts');
              setSpareProcurePrefill(prefill);
            }}
          />
        )}

        {activeTab === 'work_orders' && (
          <WorkOrdersView
            currentUser={currentUser}
            workOrders={workOrders}
            equipments={equipments}
            allUsers={allUsers}
            onCreateWorkOrder={handleAddWorkOrder}
            onUpdateWorkOrder={handleUpdateWorkOrder}
            onOpenAiDiagnose={handleOpenAiDiagnoseForEquipment}
            onNavigateDispatch={(workOrderId) => navigateToDispatch({ workOrderId })}
            onNavigateTo3D={(workOrderId) => navigateTo3D({ workOrderId })}
            initialWorkOrderId={targetWorkOrderIdForDetail}
            initialCreateOpen={showGlobalCreateWorkOrder}
            initialCreatePrefill={workOrderCreatePrefill}
            onCreatePrefillConsumed={() => setWorkOrderCreatePrefill(null)}
          />
        )}

        {activeTab === 'inspections' && (
          <InspectionView
            currentUser={currentUser}
            inspections={inspections}
            equipments={equipments}
            targetEquipmentId={mobileScanEquipmentId || undefined}
            onUpdateInspection={handleUpdateInspection}
            onConvertAbnormalToWorkOrder={async (point, equipmentName) => {
              try {
                await handleConvertAbnormalToWorkOrder(point, equipmentName);
                setActiveTab('work_orders');
              } catch {
                /* 错误提示已在 AppDataContext 内完成 */
              }
            }}
            onCreateWorkOrder={handleAddWorkOrder}
          />
        )}

        {activeTab === 'procedures' && (
          <ProceduresView
            currentUser={currentUser}
            onSelectProcedure={(proc) => {
              logger.log('Selected procedure:', proc);
            }}
          />
        )}

        {activeTab === 'safety' && (
          <SafetyManagementView
            currentUser={currentUser}
            safetyPermits={safetyPermits}
            equipments={equipments}
            lotoLocks={lotoLocks}
            onAddSafetyPermit={handleAddSafetyPermit}
            onUpdateSafetyPermit={handleUpdateSafetyPermit}
            onDeleteSafetyPermit={handleDeleteSafetyPermit}
          />
        )}

        {activeTab === 'knowledge' && (
          <KnowledgeBaseView
            currentUser={currentUser}
            articles={articles}
            onAddArticle={handleAddArticle}
            onAskAiWithContext={handleAskAiWithContext}
          />
        )}

        {activeTab === 'knowledge_graph' && (
          <KnowledgeGraphView
            currentUser={currentUser}
          />
        )}

        {activeTab === 'ai_assistant' && (
          <AiAssistantView
            currentUser={currentUser}
            equipments={equipments}
            prefilledEquipment={aiTargetEquipment}
            prefilledQuery={aiPrefilledQuery}
            onCreateWorkOrderFromAi={(title, equipmentName, description) =>
              handleCreateWorkOrderFromAi(
                title,
                equipmentName,
                description,
                currentUser,
                () => setActiveTab('work_orders')
              )
            }
          />
        )}

        {activeTab === 'ai_pipeline' && <AiPipelineView onGoDispatch={navigateToDispatch} />}

        {activeTab === 'ai_business_butler' && (
          <HermesWorkbenchView onNavigateTab={setActiveTab} />
        )}

        {activeTab === 'dispatch' && (
          <DispatchBoardView
            presetWorkOrderId={dispatchPreset.workOrderId}
            presetEquipmentId={dispatchPreset.equipmentId}
            onNavigateWorkOrders={() => setActiveTab('work_orders')}
          />
        )}

        {activeTab === 'ai_reviews' && <AdminAiReviewsView onNavigate={setActiveTab} />}

        {activeTab === 'maintenance_maze' && (
          <MazeGameView currentUser={currentUser} />
        )}

        {activeTab === 'ai_models' && <AdminAiModelsView />}

        {activeTab === 'users' && (
          <UserManagementView
            currentUser={currentUser}
            allUsers={allUsers}
            onAddUser={handleAddUser}
            onSwitchUser={handleSwitchUserWithHome}
          />
        )}
      </Suspense>
    </ErrorBoundary>
  );
};
