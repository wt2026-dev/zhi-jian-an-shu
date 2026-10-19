/**
 * TAB_FALLBACK: 无权限页面的兜底跳转目标（如驾驶舱默认送回 dashboard）。
 * App.tsx: 顶层根组件与组合层（状态已拆离至 AppDataContext / AuthContext / AppViewDispatcher / QrScannerModal，目标 < 250 行）。
 */
const TAB_FALLBACK: Record<string, string> = { cockpit: 'dashboard' };
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { authApi, type SpareProcurePrefill } from './api';
import { logger } from './utils/logger';
import { AppDataProvider, useAppData } from './context/AppDataContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AiChatProvider } from './context/AiChatContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { ToastContainer } from './components/ui/Toast';
import { PageHeader } from './components/layout/PageHeader';
import { getBreadcrumb } from './components/layout/navConfig';
import { isTabAllowed, getRoleHome } from './utils/rbac';
import { PermissionDenied } from './components/PermissionDenied';
import { AiAssistantPanel } from './components/AiAssistantPanel';
import { OnboardingGuide } from './components/OnboardingGuide';
import { AppLoadingScreen, AppLoadErrorScreen } from './components/layout/AppStatusScreens';
import { QrScannerModal } from './components/modals/QrScannerModal';
import { AppViewDispatcher } from './components/layout/AppViewDispatcher';
import type { LoopHeaderStats } from './components/hermes/types';
import type { Equipment, UserProfile, KnowledgeArticle, WorkOrderCreatePrefill } from './types';

const LoginView = React.lazy(() => import('./components/LoginView').then(m => ({ default: m.LoginView })));

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppDataBridge />
        <ToastContainer />
      </ToastProvider>
    </AuthProvider>
  );
}

function LoginScreen({ onLoginSuccess }: { onLoginSuccess: (user: UserProfile, token: string) => void }) {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">正在加载登录页...</div>}>
      <LoginView onLoginSuccess={onLoginSuccess} />
    </Suspense>
  );
}

function AppDataBridge() {
  const { authToken, setAuthToken, setCurrentUser, setAllUsers, refreshNotifications } = useAuth();

  const handleDataLoaded = useCallback((user: UserProfile | null, users: UserProfile[]) => {
    setCurrentUser(user);
    setAllUsers(users);
  }, [setCurrentUser, setAllUsers]);

  const handleRefreshNotifications = useCallback((userId?: string) => {
    void refreshNotifications(userId);
  }, [refreshNotifications]);

  if (!authToken) {
    return <LoginScreen onLoginSuccess={(_user, token) => setAuthToken(token)} />;
  }

  return (
    <AppDataProvider authToken={authToken} onDataLoaded={handleDataLoaded} onRefreshNotifications={handleRefreshNotifications}>
      <AppShell />
    </AppDataProvider>
  );
}

function AppShell() {
  const { show: showToast } = useToast();
  const {
    currentUser, allUsers, notifications,
    handleLogout, handleSwitchUser, handleMarkNotificationRead,
    handleMarkAllNotificationsRead, handleAddUser, setAuthToken, setCurrentUser, setAllUsers,
  } = useAuth();
  const { isInitialLoading, loadError, loadAllBackendData, equipments } = useAppData();

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [dispatchPreset, setDispatchPreset] = useState<{ workOrderId?: string | null; equipmentId?: string | null }>({});
  const navigateToDispatch = useCallback((preset: { workOrderId?: string | null; equipmentId?: string | null }) => {
    setDispatchPreset(preset);
    setActiveTab('dispatch');
  }, []);

  const [targetWorkOrderIdFor3D, setTargetWorkOrderIdFor3D] = useState<string | null>(null);
  const [targetWorkOrderIdForDetail, setTargetWorkOrderIdForDetail] = useState<string | null>(null);
  const openWorkOrderDetail = useCallback((workOrderId: string) => {
    setTargetWorkOrderIdForDetail(workOrderId);
    setActiveTab('work_orders');
  }, []);
  const navigateTo3D = useCallback((preset: { workOrderId?: string | null; equipmentId?: string | null }) => {
    if (preset.workOrderId) setTargetWorkOrderIdFor3D(preset.workOrderId);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'equipment_3d');
      if (preset.workOrderId) url.searchParams.set('workOrderId', preset.workOrderId);
      if (preset.equipmentId) url.searchParams.set('equipmentId', preset.equipmentId);
      window.history.pushState({}, '', url.toString());
    } catch { /* ignore */ }
    setActiveTab('equipment_3d');
  }, []);

  const [mobileScanEquipmentId, setMobileScanEquipmentId] = useState<string | null>(null);
  const [selectedEquipmentForHealth, setSelectedEquipmentForHealth] = useState<Equipment | null>(null);
  const [aiTargetEquipment, setAiTargetEquipment] = useState<Equipment | null>(null);
  const [aiPrefilledQuery, setAiPrefilledQuery] = useState<string | null>(null);
  const [showGlobalCreateWorkOrder, setShowGlobalCreateWorkOrder] = useState(false);
  const [workOrderCreatePrefill, setWorkOrderCreatePrefill] = useState<WorkOrderCreatePrefill | null>(null);
  const [spareProcurePrefill, setSpareProcurePrefill] = useState<SpareProcurePrefill | null>(null);
  const [showQrScannerModal, setShowQrScannerModal] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);
  // Hermes 页头指标：由闭环视图用接口数据回传，null 表示尚未取到（显示「—」，不编数）
  const [hermesStats, setHermesStats] = useState<LoopHeaderStats | null>(null);

  useEffect(() => {
    const handleResize = () => { if (window.innerWidth < 1024) setIsSidebarCollapsed(true); };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const targetView = searchParams.get('view');
      const targetEquipmentId = searchParams.get('equipmentId');
      const targetWorkOrderId = searchParams.get('workOrderId');

      if (targetWorkOrderId) {
        if (targetView === 'work_orders') {
          setTargetWorkOrderIdForDetail(targetWorkOrderId);
        } else {
          setTargetWorkOrderIdFor3D(targetWorkOrderId);
          showToast({ type: 'info', title: '已定位至工单', message: `工单 #${targetWorkOrderId}，点击 3D 场景中红色脉冲设备查看详情`, duration: 5000 });
        }
      }
      if (targetView === 'inspections' || targetView === 'inspection') {
        setActiveTab('inspections');
        if (targetEquipmentId) {
          setMobileScanEquipmentId(targetEquipmentId);
          showToast({ type: 'info', title: '已定位至设备', message: `设备 ${targetEquipmentId}，点击 3D 场景中红色脉冲设备查看详情`, duration: 5000 });
        }
      } else if (targetView && ['dashboard', 'cockpit', 'spare_parts', 'hazards', 'equipment', 'equipments', 'work_orders', 'health', 'safety', 'knowledge', 'ai_assistant', 'users', 'procedures', 'knowledge_graph', 'ai_pipeline', 'ai_reviews', 'ai_models', 'dispatch', 'equipment_3d', 'maintenance_maze', 'ai_business_butler'].includes(targetView)) {
        setActiveTab(targetView === 'equipment' ? 'equipments' : targetView);
      }
    } catch (e) {
      logger.warn('URL search parse fallback:', e);
    }
  }, [showToast]);

  useEffect(() => {
    if (!currentUser || isTabAllowed(activeTab, currentUser.role)) return;
    const fallback = TAB_FALLBACK[activeTab];
    if (fallback) {
      const target = isTabAllowed(fallback, currentUser.role) ? fallback : getRoleHome(currentUser.role);
      if (target !== activeTab) {
        setActiveTab(target);
        showToast({ type: 'info', title: '已返回有权限的页面', message: `当前角色（${currentUser.roleTitle}）无权限访问该页面，已切换至可访问页面`, duration: 4000 });
      }
    }
  }, [activeTab, currentUser?.role, currentUser?.roleTitle, showToast]);

  const handleSwitchUserWithHome = useCallback((user: UserProfile) => {
    handleSwitchUser(user);
    setActiveTab(getRoleHome(user?.role));
  }, [handleSwitchUser]);

  const handleSelectEquipmentForHealth = (eq: Equipment) => { setSelectedEquipmentForHealth(eq); setActiveTab('health'); };
  const handleOpenWorkOrderForEquipment = () => { setActiveTab('work_orders'); };
  const handleOpenAiDiagnoseForEquipment = (eq: Equipment) => {
    setAiTargetEquipment(eq);
    // 缺测时不在提问里塞 "undefined°C"：把"有何异常、请排查"交给模型，而不是编一个读数当证据。
    const tel = eq.telemetry;
    const symptom = tel
      ? `当前轴温 ${tel.temperature}°C 与振动 ${tel.vibration}mm/s`
      : '台账状态异常，但遥测未接入有效读数';
    setAiPrefilledQuery(`请对 ${eq.name} (${eq.code}) ${symptom} 进行故障树分析与处置建议`);
    setActiveTab('ai_assistant');
  };
  const handleAskAiWithContext = (query: string) => { setAiPrefilledQuery(query); setActiveTab('ai_assistant'); };

  if (isInitialLoading) return <AppLoadingScreen />;
  if (loadError) return <AppLoadErrorScreen loadError={loadError} onRetry={loadAllBackendData} onLogout={() => { authApi.logout(); setAuthToken(null); }} />;
  if (!currentUser) return <LoginScreen onLoginSuccess={(_user, token) => setAuthToken(token)} />;

  const tabAllowed = isTabAllowed(activeTab, currentUser?.role);

  return (
    <AiChatProvider userRoleTitle={currentUser.roleTitle}>
      <div className="h-screen bg-[#f8fafc] text-slate-800 flex flex-col overflow-hidden font-sans selection:bg-blue-100 selection:text-blue-900">
        <Navbar
          activeTab={activeTab} onTabChange={(tab) => { setActiveTab(tab); setAiPrefilledQuery(null); setShowGlobalCreateWorkOrder(false); }}
          isSidebarCollapsed={isSidebarCollapsed} onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)} currentUser={currentUser} onSwitchUser={handleSwitchUserWithHome}
          onUpdateCurrentUser={(updated) => { setCurrentUser(updated); setAllUsers(allUsers.map((u) => (u.id === updated.id ? updated : u))); }}
          allUsers={allUsers} onLogout={handleLogout}
          onOpenQuickWorkOrder={() => { setActiveTab('work_orders'); setShowGlobalCreateWorkOrder(true); }}
          onOpenQrScanner={() => setShowQrScannerModal(true)} unreadCount={notifications.filter((n) => !n.read).length}
          notifications={notifications} onMarkNotificationRead={handleMarkNotificationRead} onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
        />

        <div className="flex-1 flex overflow-hidden">
          <Sidebar
            role={currentUser?.role} activeTab={activeTab}
            onTabChange={(tab) => { setActiveTab(tab); setAiPrefilledQuery(null); setShowGlobalCreateWorkOrder(false); }}
            isCollapsed={isSidebarCollapsed} isMobileOpen={isMobileDrawerOpen} onCloseMobile={() => setIsMobileDrawerOpen(false)}
          />

          <main className="flex-1 overflow-y-auto bg-[#f8fafc] p-4 sm:p-5 lg:p-6 transition-all duration-200 flex flex-col">
            <div key={activeTab} className={`mx-auto w-full flex-1 flex flex-col min-h-0 transition-opacity duration-200 animate-in fade-in duration-200 ${activeTab === 'cockpit' ? 'max-w-[1920px]' : 'max-w-[1440px]'}`}>
              {!tabAllowed && <PermissionDenied tabId={activeTab} role={currentUser?.role} userName={currentUser?.name} onBackHome={() => setActiveTab(getRoleHome(currentUser?.role))} />}
              {tabAllowed && activeTab !== 'dashboard' && (
                <PageHeader
                  group={activeTab === 'ai_business_butler' ? '智能AI·业务管家' : getBreadcrumb(activeTab).group}
                  title={activeTab === 'ai_business_butler' ? 'Hermes 智能业务管家' : getBreadcrumb(activeTab).label}
                  subtitle={
                    activeTab === 'ai_business_butler' ? '全链路业务闭环编排 · AI自主规划与自动预填 · 人工确认安全闸门' :
                    activeTab === 'work_orders' ? '检修工单全生命周期管理与工单闭查跟踪' :
                    activeTab === 'health' ? '采集温度、振动加速度(RMS)、三相电流、电压与工况负荷率' :
                    activeTab === 'procedures' ? '标准化检修作业指导书与合规执行' : undefined
                  }
                  metrics={
                    activeTab === 'ai_business_butler' ? [
                      { label: '在办业务', value: hermesStats ? String(hermesStats.runningCount) : '—', tone: 'warning' },
                      { label: '本周闭环', value: hermesStats ? String(hermesStats.archivedThisWeek) : '—', tone: 'success' },
                      { label: '平均闭环', value: hermesStats && hermesStats.avgDurationHours != null ? `${hermesStats.avgDurationHours}h` : '—', tone: 'default' },
                    ] : undefined
                  }
                />
              )}
              {tabAllowed && (
                <AppViewDispatcher
                  activeTab={activeTab} setActiveTab={setActiveTab}
                  currentUser={currentUser} allUsers={allUsers}
                  dispatchPreset={dispatchPreset} navigateToDispatch={navigateToDispatch}
                  targetWorkOrderIdFor3D={targetWorkOrderIdFor3D}
                  targetWorkOrderIdForDetail={targetWorkOrderIdForDetail} openWorkOrderDetail={openWorkOrderDetail}
                  navigateTo3D={navigateTo3D} mobileScanEquipmentId={mobileScanEquipmentId}
                  selectedEquipmentForHealth={selectedEquipmentForHealth} handleSelectEquipmentForHealth={handleSelectEquipmentForHealth}
                  handleOpenWorkOrderForEquipment={handleOpenWorkOrderForEquipment} handleOpenAiDiagnoseForEquipment={handleOpenAiDiagnoseForEquipment}
                  handleAskAiWithContext={handleAskAiWithContext} aiTargetEquipment={aiTargetEquipment} aiPrefilledQuery={aiPrefilledQuery}
                  showGlobalCreateWorkOrder={showGlobalCreateWorkOrder} workOrderCreatePrefill={workOrderCreatePrefill} setWorkOrderCreatePrefill={setWorkOrderCreatePrefill}
                  spareProcurePrefill={spareProcurePrefill} setSpareProcurePrefill={setSpareProcurePrefill}
                  handleAddUser={handleAddUser} handleSwitchUserWithHome={handleSwitchUserWithHome}
                  handleHermesStatsChange={setHermesStats}
                />
              )}
            </div>
          </main>
        </div>

        <QrScannerModal
          isOpen={showQrScannerModal}
          onClose={() => setShowQrScannerModal(false)}
          equipments={equipments}
          onSelectEquipmentForInspection={(eqId) => { setMobileScanEquipmentId(eqId); setActiveTab('inspections'); }}
          onNavigateToEquipments={() => setActiveTab('equipments')}
        />

        <AiAssistantPanel />
        <OnboardingGuide />
      </div>
    </AiChatProvider>
  );
}
