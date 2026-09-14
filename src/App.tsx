/**
 * App.tsx — 应用根组件（组合层）
 *
 * 重构状态（2026-09）：
 *   原文件为 885 行"上帝组件"：equipments/workOrders/inspections/safetyPermits/
 *   articles/lotoLocks 等全局状态 + 全部 CRUD handler + UI 骨架全部堆在此处。
 *
 *   当前重构进度：
 *   ✅ 业务数据状态 → AppDataContext（src/context/AppDataContext.tsx）
 *   ✅ 认证/用户/通知状态 → AuthContext（src/context/AuthContext.tsx）
 *   ✅ AI 聊天状态 → AiChatContext（已有）
 *   🔄 子视图 props 替换为 useAppData()/useAuth() ← 渐进式迁移中
 *      （当前仍保留 props 透传作为过渡，不破坏功能）
 *
 * 目标架构（完成后）：
 *   App.tsx 只负责：Provider 组合 + 路由切换 + 全局 Modal
 *   预期行数：< 250 行（当前：885 行）
 */
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/Header';
import { authApi } from './api';
import { logger } from './utils/logger';
// ─── Context Providers（状态管理层，已从本文件拆出）────────────────────────────
import { AppDataProvider, useAppData } from './context/AppDataContext';
import { AuthProvider, useAuth } from './context/AuthContext';

// Lazy-loaded view components (code-split per route)
const DashboardView = React.lazy(() => import('./components/DashboardView').then(m => ({ default: m.DashboardView })));
const EquipmentArchivesView = React.lazy(() => import('./components/EquipmentArchivesView').then(m => ({ default: m.EquipmentArchivesView })));
const EquipmentHealthView = React.lazy(() => import('./components/EquipmentHealthView').then(m => ({ default: m.EquipmentHealthView })));
const WorkOrdersView = React.lazy(() => import('./components/WorkOrdersView').then(m => ({ default: m.WorkOrdersView })));
const InspectionView = React.lazy(() => import('./components/InspectionView').then(m => ({ default: m.InspectionView })));
const SafetyManagementView = React.lazy(() => import('./components/SafetyManagementView').then(m => ({ default: m.SafetyManagementView })));
const KnowledgeBaseView = React.lazy(() => import('./components/KnowledgeBaseView').then(m => ({ default: m.KnowledgeBaseView })));
const ProceduresView = React.lazy(() => import('./components/ProceduresView').then(m => ({ default: m.ProceduresView })));
const KnowledgeGraphView = React.lazy(() => import('./components/KnowledgeGraphView').then(m => ({ default: m.KnowledgeGraphView })));
const AiAssistantView = React.lazy(() => import('./components/AiAssistantView').then(m => ({ default: m.AiAssistantView })));
const UserManagementView = React.lazy(() => import('./components/UserManagementView').then(m => ({ default: m.UserManagementView })));
const LoginView = React.lazy(() => import('./components/LoginView').then(m => ({ default: m.LoginView })));
const CockpitDashboardView = React.lazy(() => import('./components/CockpitDashboardView').then(m => ({ default: m.CockpitDashboardView })));
const AiPipelineView = React.lazy(() => import('./components/AiPipelineView').then(m => ({ default: m.AiPipelineView })));
const AdminAiReviewsView = React.lazy(() => import('./components/AdminAiReviewsView').then(m => ({ default: m.AdminAiReviewsView })));
const AdminAiModelsView = React.lazy(() => import('./components/AdminAiModelsView').then(m => ({ default: m.AdminAiModelsView })));
const DispatchBoardView = React.lazy(() => import('./components/DispatchBoardView').then(m => ({ default: m.DispatchBoardView })));
const SparePartsView = React.lazy(() => import('./components/SparePartsView').then(m => ({ default: m.SparePartsView })));
const HazardsView = React.lazy(() => import('./components/HazardsView').then(m => ({ default: m.HazardsView })));

import {
  Equipment,
  WorkOrder,
  InspectionTask,
  InspectionItem,
  SafetyPermit,
  KnowledgeArticle,
  UserProfile,
  NotificationItem,
  LotoLock,
} from './types';
import { QrCode, X, Scan, Sparkles, Wrench, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SkeletonKpis, SkeletonCards, SkeletonBlock } from './components/Skeleton';
import { AiChatProvider, useAiChatContext } from './context/AiChatContext';
import { AiAssistantPanel } from './components/AiAssistantPanel';
import { OnboardingGuide } from './components/OnboardingGuide';

/**
 * 根组件：只负责 Provider 组合，不持有任何业务状态。
 *
 * 状态分层（重构前 App.tsx 为 885 行上帝组件，状态/逻辑/UI 三类职责混杂）：
 *   - 认证与通知 → AuthContext（src/context/AuthContext.tsx）
 *   - 业务数据   → AppDataContext（src/context/AppDataContext.tsx）
 *   - UI 骨架    → 本文件 AppShell（导航/侧边栏/模态框等纯视图状态）
 */
export default function App() {
  return (
    <AuthProvider>
      <AppDataBridge />
    </AuthProvider>
  );
}

/**
 * 登录页挂载点。
 * LoginView 是 React.lazy 懒加载组件，必须置于 Suspense 边界内，
 * 否则首次挂起时会被 RootErrorBoundary 误判为渲染异常。
 */
function LoginScreen({ onLoginSuccess }: { onLoginSuccess: (user: UserProfile, token: string) => void }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
          正在加载登录页...
        </div>
      }
    >
      <LoginView onLoginSuccess={onLoginSuccess} />
    </Suspense>
  );
}

/**
 * 认证守卫 + 业务数据 Provider 桥接层。
 * 未登录时不挂载 AppDataProvider，因此不会发起任何业务数据请求。
 */
function AppDataBridge() {
  const { authToken, setAuthToken, setCurrentUser, setAllUsers, refreshNotifications } = useAuth();

  // 数据加载完成后回填认证态（currentUser / allUsers 归 AuthContext 单一数据源）
  const handleDataLoaded = useCallback(
    (user: UserProfile | null, users: UserProfile[]) => {
      setCurrentUser(user);
      setAllUsers(users);
    },
    [setCurrentUser, setAllUsers]
  );

  const handleRefreshNotifications = useCallback(
    (userId?: string) => {
      void refreshNotifications(userId);
    },
    [refreshNotifications]
  );

  // 全局路由守卫：未登录直接拦截并跳转至统一登录页，严禁直接访问系统内部页面
  if (!authToken) {
    return (
      <LoginScreen
        onLoginSuccess={(_user, token) => {
          setAuthToken(token);
        }}
      />
    );
  }

  return (
    <AppDataProvider
      authToken={authToken}
      onDataLoaded={handleDataLoaded}
      onRefreshNotifications={handleRefreshNotifications}
    >
      <AppShell />
    </AppDataProvider>
  );
}

/**
 * 应用外壳：只保留 UI 骨架状态与视图编排。
 * 业务数据/认证状态一律从 Context 读取，不再逐层 useState + prop-drilling。
 */
function AppShell() {
  const {
    currentUser,
    allUsers,
    notifications,
    handleLogout,
    handleSwitchUser,
    handleMarkNotificationRead,
    handleMarkAllNotificationsRead,
    handleAddUser,
    setAuthToken,
    setCurrentUser,
    setAllUsers,
  } = useAuth();

  const {
    equipments,
    workOrders,
    inspections,
    safetyPermits,
    articles,
    lotoLocks,
    isInitialLoading,
    loadError,
    loadAllBackendData,
    handleAddEquipment,
    handleUpdateEquipment,
    handleDeleteEquipment,
    handleAddWorkOrder,
    handleUpdateWorkOrder,
    handleUpdateInspection,
    handleConvertAbnormalToWorkOrder,
    handleAddSafetyPermit,
    handleUpdateSafetyPermit,
    handleDeleteSafetyPermit,
    handleAddArticle,
    handleCreateWorkOrderFromAi,
  } = useAppData();

  // ── 纯 UI 状态（导航 / 跨模块跳转 / 模态框，不属于业务数据）──────────────────
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  // 调度大屏预选：从检修工单「就近派单」或 AI 协同「前往调度」跳入时携带
  const [dispatchPreset, setDispatchPreset] = useState<{ workOrderId?: string | null; equipmentId?: string | null }>({});
  const navigateToDispatch = useCallback((preset: { workOrderId?: string | null; equipmentId?: string | null }) => {
    setDispatchPreset(preset);
    setActiveTab('dispatch');
  }, []);

  // 手机扫码直达巡检目标设备 ID
  const [mobileScanEquipmentId, setMobileScanEquipmentId] = useState<string | null>(null);

  // Cross-module states
  const [selectedEquipmentForHealth, setSelectedEquipmentForHealth] = useState<Equipment | null>(null);
  const [aiTargetEquipment, setAiTargetEquipment] = useState<Equipment | null>(null);
  const [aiPrefilledQuery, setAiPrefilledQuery] = useState<string | null>(null);

  // Quick Action Modals Trigger Flag
  const [showGlobalCreateWorkOrder, setShowGlobalCreateWorkOrder] = useState(false);
  const [showGlobalCreateSafetyPermit, setShowGlobalCreateSafetyPermit] = useState(false);
  const [showQrScannerModal, setShowQrScannerModal] = useState(false);
  const [qrModalTab, setQrModalTab] = useState<'simulate' | 'real_qrcode'>('simulate');
  const [selectedQrEquipId, setSelectedQrEquipId] = useState<string>('');

  // 侧边栏折叠状态：<1024px 默认折叠为 64px 图标栏；移动端开启汉堡抽屉
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024;
    }
    return false;
  });
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);

  // 监听窗口尺寸自动适配折叠
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 检查手机扫码 URL 深度链接 (?view=inspections&equipmentId=eq-001)
  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const targetView = searchParams.get('view');
      const targetEquipmentId = searchParams.get('equipmentId');

      if (targetView === 'inspections' || targetView === 'inspection') {
        setActiveTab('inspections');
        if (targetEquipmentId) {
          setMobileScanEquipmentId(targetEquipmentId);
        }
      } else if (targetView && ['dashboard', 'cockpit', 'spare_parts', 'hazards', 'equipment', 'equipments', 'work_orders', 'health', 'safety', 'knowledge', 'ai_assistant', 'users', 'procedures', 'knowledge_graph', 'ai_pipeline', 'ai_reviews', 'ai_models', 'dispatch'].includes(targetView)) {
        setActiveTab(targetView === 'equipment' ? 'equipments' : targetView);
      }
    } catch (e) {
      logger.warn('URL search parse fallback:', e);
    }
  }, []);

  // Cross-Navigation Shortcuts
  const handleSelectEquipmentForHealth = (eq: Equipment) => {
    setSelectedEquipmentForHealth(eq);
    setActiveTab('health');
  };

  const handleOpenWorkOrderForEquipment = (eq: Equipment) => {
    setActiveTab('work_orders');
  };

  const handleOpenAiDiagnoseForEquipment = (eq: Equipment) => {
    setAiTargetEquipment(eq);
    setAiPrefilledQuery(`请对 ${eq.name} (${eq.code}) 当前轴温 ${eq.telemetry.temperature}°C 与振动 ${eq.telemetry.vibration}mm/s 进行故障树分析与处置建议`);
    setActiveTab('ai_assistant');
  };

  const handleAskAiWithContext = (query: string, contextArticle: KnowledgeArticle) => {
    setAiPrefilledQuery(query);
    setActiveTab('ai_assistant');
  };

  // 首屏数据加载中：仪表盘骨架屏（非转圈 loading），绝不展示任何 mock 假数据
  if (isInitialLoading) {
    return (
      <div className="min-h-screen bg-[var(--page-bg)] text-[var(--text-body)]">
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
          <div className="flex items-center justify-center space-x-3 py-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <div className="text-sm font-semibold text-slate-700">正在连接后端服务并加载真实业务数据...</div>
          </div>
          <SkeletonKpis count={6} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-sm">
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonCards count={4} />
              </div>
            </div>
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-sm">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonCards count={3} />
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-sm">
                <SkeletonBlock className="h-4 w-28" />
                <SkeletonCards count={2} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 接口加载失败：展示错误提示与重试按钮，绝不使用 mock 数据兜底
  if (loadError) {
    return (
      <div className="min-h-screen bg-[var(--page-bg)] text-[var(--text-body)] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-lg p-6 shadow-sm space-y-4 text-center">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-lg w-fit mx-auto border border-rose-100">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-base font-bold text-slate-900">后端数据加载失败</h2>
          <p className="text-xs text-slate-600 leading-relaxed break-all">{loadError}</p>
          <p className="text-[11px] text-slate-500">
            系统已禁止使用本地模拟数据兜底，请确认后端服务与数据库正常后重试。
          </p>
          <button
            onClick={loadAllBackendData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 mx-auto cursor-pointer transition-colors shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>重新加载数据</span>
          </button>
          <button
            onClick={() => {
              authApi.logout();
              setAuthToken(null);
            }}
            className="block mx-auto text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
          >
            返回重新登录
          </button>
        </div>
      </div>
    );
  }

  // 后端返回当前用户为空（Token 失效）时回登录页
  if (!currentUser) {
    return (
      <LoginScreen
        onLoginSuccess={(_user, token) => {
          // 仅更新 token；用户态与业务数据由 AppDataBridge / AppDataProvider 重新拉取
          setAuthToken(token);
        }}
      />
    );
  }

  return (
    <AiChatProvider userRoleTitle={currentUser.roleTitle}>
    <div className="h-screen bg-[#f8fafc] text-slate-800 flex flex-col overflow-hidden font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Top 56px Navbar */}
      <Navbar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setAiPrefilledQuery(null);
          setShowGlobalCreateWorkOrder(false);
        }}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        currentUser={currentUser}
        onSwitchUser={handleSwitchUser}
        onUpdateCurrentUser={(updated) => {
          setCurrentUser(updated);
          setAllUsers(allUsers.map((u) => (u.id === updated.id ? updated : u)));
        }}
        allUsers={allUsers}
        onLogout={handleLogout}
        onOpenQuickWorkOrder={() => {
          setActiveTab('work_orders');
          setShowGlobalCreateWorkOrder(true);
        }}
        onOpenQrScanner={() => {
          setShowQrScannerModal(true);
        }}
        unreadCount={notifications.filter((n) => !n.read).length}
        notifications={notifications}
        onMarkNotificationRead={handleMarkNotificationRead}
        onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
      />

      {/* Horizontal Split: Fixed Left Sidebar + Right Responsive Content */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          role={currentUser?.role}
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            setAiPrefilledQuery(null);
            setShowGlobalCreateWorkOrder(false);
          }}
          isCollapsed={isSidebarCollapsed}
          isMobileOpen={isMobileDrawerOpen}
          onCloseMobile={() => setIsMobileDrawerOpen(false)}
        />

        {/* Right Content Area */}
        <main className="flex-1 overflow-y-auto bg-[#f8fafc] p-4 sm:p-5 lg:p-6 transition-all duration-200 flex flex-col">
          <div
            key={activeTab}
            className={`mx-auto w-full flex-1 flex flex-col min-h-0 transition-opacity duration-200 animate-in fade-in duration-200 ${
              activeTab === 'cockpit' ? 'max-w-[1920px]' : 'max-w-[1440px]'
            }`}
          >
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
              onSelectWorkOrder={(wo) => {
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

          {activeTab === 'spare_parts' && currentUser && (
            <SparePartsView
              currentUser={currentUser}
              onNavigateToWorkOrders={() => setActiveTab('work_orders')}
            />
          )}

          {activeTab === 'hazards' && currentUser && (
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
              currentUser={currentUser}
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
              initialCreateOpen={showGlobalCreateWorkOrder}
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
                // 转单成功后才跳转工单页；失败时 Context 内已 alert 提示，保持停留当前页
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
          {activeTab === 'dispatch' && (
            <DispatchBoardView
              presetWorkOrderId={dispatchPreset.workOrderId}
              presetEquipmentId={dispatchPreset.equipmentId}
              onNavigateWorkOrders={() => setActiveTab('work_orders')}
            />
          )}
          {activeTab === 'ai_reviews' && <AdminAiReviewsView onNavigate={setActiveTab} />}
          {activeTab === 'ai_models' && <AdminAiModelsView />}

          {activeTab === 'users' && (
            <UserManagementView
              currentUser={currentUser}
              allUsers={allUsers}
              onAddUser={handleAddUser}
              onSwitchUser={handleSwitchUser}
            />
          )}
          </Suspense>
        </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* 全局设备扫码巡检 / 电子铭牌真机二维码 Modal */}
      {showQrScannerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 card-industrial">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                  <Scan className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">工业设备电子铭牌与扫码中心</h3>
                  <p className="text-[11px] text-slate-500">桌面端快捷核验模拟 · 手机端微信真机扫码直达</p>
                </div>
              </div>
              <button
                onClick={() => setShowQrScannerModal(false)}
                className="text-slate-500 hover:text-slate-600 p-1.5 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 模式切换 Tab */}
            <div className="flex rounded-lg bg-slate-100 p-1 text-xs">
              <button
                type="button"
                onClick={() => setQrModalTab('simulate')}
                className={`flex-1 py-1.5 rounded-md font-medium text-center transition-all cursor-pointer ${
                  qrModalTab === 'simulate'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                桌面虚拟扫码模拟
              </button>
              <button
                type="button"
                onClick={() => {
                  setQrModalTab('real_qrcode');
                  if (!selectedQrEquipId && equipments.length > 0) {
                    setSelectedQrEquipId(equipments[0].id);
                  }
                }}
                className={`flex-1 py-1.5 rounded-md font-medium text-center transition-all cursor-pointer ${
                  qrModalTab === 'real_qrcode'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                真机电子铭牌二维码
              </button>
            </div>

            {qrModalTab === 'simulate' ? (
              <>
                {/* 模拟摄像头取景器 */}
                <div className="relative h-40 bg-slate-50 rounded-lg border border-slate-200 flex flex-col items-center justify-center overflow-hidden">
                  <div className="w-32 h-32 border-2 border-dashed border-blue-400/80 rounded-lg relative flex items-center justify-center bg-white/80">
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent absolute top-1/2 -translate-y-1/2 animate-pulse" />
                    <QrCode className="w-14 h-14 text-blue-500/30" />
                  </div>
                  <span className="text-[11px] text-blue-600 font-mono mt-2 z-10 font-medium">
                    摄像头取景中 · 请在下方点击设备模拟扫码识别
                  </span>
                </div>

                {/* 快捷识别模拟列表 */}
                <div className="space-y-2 text-xs">
                  <span className="text-slate-500 font-medium block">点击机组立即模拟识别入单：</span>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                    {equipments.map((eq) => (
                      <button
                        key={eq.id}
                        onClick={() => {
                          setShowQrScannerModal(false);
                          setMobileScanEquipmentId(eq.id);
                          setActiveTab('inspections');
                        }}
                        className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 text-left transition-colors cursor-pointer group"
                      >
                        <div>
                          <div className="font-semibold text-slate-700 group-hover:text-blue-600">{eq.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {eq.code} | {eq.workshop} · {eq.location}
                          </div>
                        </div>
                        <span className="text-[11px] px-2 py-1 bg-blue-50 text-blue-600 rounded font-medium group-hover:bg-blue-600 group-hover:text-white transition-colors border border-blue-100">
                          识别入单
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              /* 真机扫码与电子铭牌二维码视图 */
              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-600 font-medium block mb-1.5">选择目标机组以生成现场二维码：</label>
                  <select
                    value={selectedQrEquipId || (equipments[0]?.id ?? '')}
                    onChange={(e) => setSelectedQrEquipId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    {equipments.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name}（{eq.code}）- {eq.workshop}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 动态二维码展示区 */}
                {(() => {
                  const currId = selectedQrEquipId || equipments[0]?.id;
                  const currEq = equipments.find((e) => e.id === currId) || equipments[0];
                  if (!currEq) return null;
                  return (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row items-center gap-3.5">
                      <div className="w-32 h-32 bg-white p-2 border border-slate-200 rounded-lg shrink-0 shadow-xs flex items-center justify-center">
                        <img
                          src={`/api/v1/equipments/${currEq.id}/qrcode`}
                          alt={`${currEq.name} 专属二维码`}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="font-bold text-slate-900 text-sm truncate">{currEq.name}</div>
                        <div className="text-[11px] font-mono text-blue-600 font-semibold">{currEq.code}</div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          ✅ 真实工业二维码：手机微信或工业 PDA 扫码直达现场巡检或报修工单。
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setShowQrScannerModal(false);
                            setActiveTab('equipments');
                          }}
                          className="text-[11px] text-blue-600 hover:underline font-medium cursor-pointer block mt-1"
                        >
                          前往设备档案查看高清打印铭牌 →
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 全局悬浮 AI 助手：渲染在根层级，所有页面（含数据驾驶舱）之上 */}
      <AiAssistantPanel />

      {/* 新用户首次引导 */}
      <OnboardingGuide />
    </div>
    </AiChatProvider>
  );
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
