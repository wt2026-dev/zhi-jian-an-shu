import React, { useState, useEffect, useRef } from 'react';
import {
  Wrench,
  Plus,
  Search,
  UserCheck,
  Download,
  Video,
} from 'lucide-react';
import {
  WorkOrder,
  WorkOrderPriority,
  Equipment,
  UserProfile,
  VideoAnalysisResult,
  WorkOrderCreatePrefill,
} from '../types';
import { workOrderApi } from '../api';
import { VideoAnalysisModal } from './VideoAnalysisModal';
import { VirtualList } from './VirtualList';
import {
  WorkOrderCreateModal,
  EvidenceFile,
  NewWorkOrderFormData,
} from './workorders/WorkOrderCreateModal';
import { WorkOrderDetailDrawer } from './workorders/WorkOrderDetailDrawer';
import { WorkOrderActionModals } from './workorders/WorkOrderActionModals';
import { WorkOrderKpiHeader } from './workorders/WorkOrderKpiHeader';
import { WorkOrderListItem } from './workorders/WorkOrderListItem';
import { useToast } from '../context/ToastContext';
import { can } from '../utils/rbac';

interface WorkOrdersViewProps {
  currentUser: UserProfile;
  workOrders: WorkOrder[];
  equipments: Equipment[];
  allUsers: UserProfile[];
  onCreateWorkOrder: (wo: WorkOrder) => void;
  onUpdateWorkOrder: (wo: WorkOrder) => void;
  onOpenAiDiagnose: (eq: Equipment) => void;
  /** 跳转调度大屏并预选该工单（就近派单） */
  onNavigateDispatch?: (workOrderId: string) => void;
  /** 跳转 3D 场景并自动聚焦对应设备 */
  onNavigateTo3D?: (workOrderId: string) => void;
  /** 深链：进来时自动展开这张工单的详情抽屉（从 3D 拆解视图「返回工单详情」跳回时用） */
  initialWorkOrderId?: string | null;
  initialCreateOpen?: boolean;
  /** 故障定位面板「创建维修工单」预填（真实遥测故障信息；消费后回调 App 清空） */
  initialCreatePrefill?: WorkOrderCreatePrefill | null;
  onCreatePrefillConsumed?: () => void;
}

export const WorkOrdersView: React.FC<WorkOrdersViewProps> = ({
  currentUser,
  workOrders,
  equipments,
  allUsers,
  onCreateWorkOrder,
  onUpdateWorkOrder,
  onOpenAiDiagnose,
  onNavigateDispatch,
  onNavigateTo3D,
  initialWorkOrderId = null,
  initialCreateOpen = false,
  initialCreatePrefill = null,
  onCreatePrefillConsumed,
}) => {
  const { show: showToast } = useToast();
  const [activeStatusTab, setActiveStatusTab] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyMyOrders, setOnlyMyOrders] = useState<boolean>(
    currentUser.role === 'operator' || currentUser.role === 'user'
  );

  // ── 细粒度操作权限（口径统一在 utils/rbac，避免每处各写一遍 role === 'xxx'）──────
  const canCreate = can('workOrder:create', currentUser.role);

  useEffect(() => {
    if (currentUser.role === 'operator' || currentUser.role === 'user') {
      setOnlyMyOrders(true);
    }
  }, [currentUser.id, currentUser.role]);

  // Selected Order for Detail Drawer
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);

  // ── 拆解视图 ↔ 检修业务联动 ───────────────────────────────────────────
  const autoOpenedOrderRef = useRef<string | null>(null);
  /** F4 建单预填去重：同一 prefill 对象只应用一次（App 状态未清空时防重复弹窗） */
  const appliedCreatePrefillRef = useRef<WorkOrderCreatePrefill | null>(null);

  useEffect(() => {
    if (!initialWorkOrderId) return;
    if (autoOpenedOrderRef.current === initialWorkOrderId) return;
    const wo = workOrders.find((o) => o.id === initialWorkOrderId);
    if (wo) {
      autoOpenedOrderRef.current = initialWorkOrderId;
      setSelectedOrder(wo);
    }
  }, [initialWorkOrderId, workOrders]);

  /** F1：打开该工单对应设备的拆解视图 */
  const openInExploded = (order: WorkOrder) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('showExplodedView', '1');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      /* ignore */
    }
    if (onNavigateTo3D) {
      onNavigateTo3D(order.id);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'equipment_3d');
      url.searchParams.set('workOrderId', order.id);
      window.location.href = url.toString();
    }
  };

  // Modals visibility
  const [showCreateModal, setShowCreateModal] = useState(initialCreateOpen && canCreate);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [showRepairLogModal, setShowRepairLogModal] = useState(false);
  const [showAcceptanceModal, setShowAcceptanceModal] = useState(false);
  const [convertHazardModalOpen, setConvertHazardModalOpen] = useState(false);
  const [showSpareModal, setShowSpareModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Create wizard states
  const [createStep, setCreateStep] = useState<number>(1);
  const [newOrderForm, setNewOrderForm] = useState<NewWorkOrderFormData>({
    title: '',
    equipmentId: equipments[0]?.id || '',
    faultType: '机械振动' as any,
    priority: 'high' as WorkOrderPriority,
    description: '',
    safetyRequirements: ['穿戴劳保鞋与安全帽', '实施 LOTO 停电挂牌'],
  });
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([
    { id: 'ev-1', name: '现场测振传感器安装位.jpg', size: '2.4 MB', time: '10分钟前', type: 'image' },
    { id: 'ev-2', name: '轴承箱红外测温热像.jpg', size: '1.8 MB', time: '8分钟前', type: 'image' },
  ]);

  // Spare movements log
  const [orderSpareMovements, setOrderSpareMovements] = useState<any[]>([]);

  useEffect(() => {
    if (initialCreateOpen) {
      setShowCreateModal(true);
    }
  }, [initialCreateOpen]);

  /**
   * 故障定位 → 建单预填（F4）：优先消费父层传入的 prefill（真实遥测故障详情），
   * 直接深链进来（无父层）时兜底读同源 sessionStorage（3D 无宿主回调时写入）。
   * 应用一次后回调清空父层状态 / 清 sessionStorage，避免回到本页再次弹建单窗。
   */
  useEffect(() => {
    let prefill = initialCreatePrefill;
    if (!prefill) {
      try {
        const raw = window.sessionStorage.getItem('wo-create-prefill');
        if (raw) prefill = JSON.parse(raw) as WorkOrderCreatePrefill;
      } catch {
        prefill = null;
      }
    }
    if (!prefill || !prefill.equipmentId) return;
    if (appliedCreatePrefillRef.current === prefill) return;
    appliedCreatePrefillRef.current = prefill;
    setNewOrderForm((prev) => ({
      ...prev,
      equipmentId: prefill.equipmentId,
      title: prefill.title || prev.title,
      faultType: prefill.faultType || prev.faultType,
      priority: prefill.priority || prev.priority,
      description: prefill.description || prev.description,
    }));
    if (canCreate) {
      setShowCreateModal(true);
      setCreateStep(2);
    }
    try {
      window.sessionStorage.removeItem('wo-create-prefill');
    } catch {
      /* ignore */
    }
    onCreatePrefillConsumed?.();
    // 触发依赖只有 prefill 本体；新建表单其余字段走函数式更新，不进依赖
  }, [initialCreatePrefill, canCreate]);

  const handleApplyVideoResult = (result: VideoAnalysisResult) => {
    const matchedEq =
      equipments.find((e) =>
        result.equipmentType ? e.type?.includes(result.equipmentType) || e.name?.includes(result.equipmentType) : false
      ) || equipments[0];

    setNewOrderForm({
      title: `[视频智能诊断] ${result.faultType || '异常故障'} - ${matchedEq?.name || '生产设备'}`,
      equipmentId: matchedEq?.id || equipments[0]?.id || '',
      faultType: (result.faultType as any) || '机械振动',
      priority: result.severity === 'critical' || result.severity === 'high' ? 'urgent' : 'high',
      description: `【视频多模态分析结论】\n${result.diagnosis}\n\n【疑似根因排查】\n${(result.possibleCauses || []).map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n【处置应对建议】\n${(result.recommendations || []).map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
      safetyRequirements: ['穿戴劳保鞋与安全帽', '实施 LOTO 停电挂牌', '确认视频所示风险区域已设置警戒'],
    });
    setShowVideoModal(false);
    setCreateStep(2);
    setEvidenceFiles((prev) => [
      ...prev,
      { id: `ev-${Date.now()}`, name: '现场短视频智能多模态抽帧.mp4', size: '14.2 MB', time: '刚刚', type: 'video' },
    ]);
    setShowCreateModal(true);
  };

  const handleExportOrders = async () => {
    setIsExporting(true);
    try {
      await workOrderApi.exportExcel({
        status: activeStatusTab === 'all' ? undefined : activeStatusTab,
        priority: selectedPriority === 'all' ? undefined : selectedPriority,
      });
      showToast({ type: 'success', title: '导出成功', message: '工单台账 Excel (CSV UTF-8 BOM) 已下载本地！' });
    } catch (err: any) {
      showToast({ type: 'error', title: '导出工单失败', message: err.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleAcceptOrder = async () => {
    if (!selectedOrder) return;
    try {
      const updated = await workOrderApi.claim(selectedOrder.id, {
        operatorName: `${currentUser.name} (${currentUser.roleTitle})`,
        version: selectedOrder.version,
      });
      onUpdateWorkOrder(updated);
      setSelectedOrder(updated);
    } catch (err: any) {
      const msg = err.data?.message || err.message || '接单失败';
      showToast({ type: 'warning', title: '状态互斥拦截', message: msg });
    }
  };

  const myName = (currentUser.name || '').trim();
  const myId = (currentUser.id || '').trim();

  const isMyOrder = (wo: WorkOrder) => {
    return (
      Boolean(wo.creator && (wo.creator.includes(myName) || (myId && wo.creator.includes(myId)))) ||
      Boolean(wo.assignee && (wo.assignee.includes(myName) || (myId && wo.assignee.includes(myId)))) ||
      Boolean(wo.assigneeId && wo.assigneeId === myId)
    );
  };

  const scopedOrders = onlyMyOrders ? (workOrders || []).filter(isMyOrder) : (workOrders || []);

  const filteredOrders = scopedOrders.filter((wo) => {
    const q = (searchQuery || '').toLowerCase();
    const matchesStatus = activeStatusTab === 'all' || wo.status === activeStatusTab;
    const matchesPriority = selectedPriority === 'all' || wo.priority === selectedPriority;
    const matchesSearch =
      (wo.orderNo || '').toLowerCase().includes(q) ||
      (wo.title || '').toLowerCase().includes(q) ||
      (wo.equipmentName || '').toLowerCase().includes(q) ||
      Boolean(wo.assignee && wo.assignee.toLowerCase().includes(q));

    return matchesStatus && matchesPriority && matchesSearch;
  });

  return (
    <div className="space-y-4 pb-12">
      {/* Header and Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <Wrench className="w-5 h-5 mr-2 text-blue-600" />
            工业设备检修工单闭环全生命周期管理
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            严格标准作业流程: <strong>创建报修</strong> → <strong>主管派单</strong> → <strong>技师接单</strong> → <strong>检修处理与备件BOM</strong> → <strong>质检验收归档</strong>
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            id="btn-export-work-orders"
            type="button"
            onClick={handleExportOrders}
            disabled={isExporting}
            className="px-3 py-2 text-xs font-medium bg-white hover:bg-slate-50 text-emerald-700 border border-slate-200 rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                <span>生成Excel中...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 text-emerald-600" />
                <span>导出台账 (Excel)</span>
              </>
            )}
          </button>

          <button
            id="btn-video-diagnose"
            type="button"
            onClick={() => setShowVideoModal(true)}
            className="px-3 py-2 text-xs font-medium bg-white hover:bg-purple-50 text-purple-700 border border-purple-200 rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
          >
            <Video className="w-4 h-4 text-purple-600" />
            <span>视频智能诊断</span>
          </button>

          {/* 报修入口：仅操作工（+总工）可创建工单，演示流程的第一步 */}
          {canCreate && (
            <button
              id="btn-create-work-order"
              onClick={() => setShowCreateModal(true)}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-lg transition-all flex items-center space-x-1.5 shadow-sm shadow-blue-500/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>快速创建检修单</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI 卡片与流转管线状态 */}
      <WorkOrderKpiHeader
        scopedOrders={scopedOrders}
        activeStatusTab={activeStatusTab}
        onSelectStatusTab={setActiveStatusTab}
      />

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索工单号、故障标题、设备名称、责任技师..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-blue-500"
          >
            <option value="all">全部优先级</option>
            <option value="urgent">紧急抢修</option>
            <option value="high">高优先级</option>
            <option value="medium">中优先级</option>
            <option value="low">常规维保</option>
          </select>

          <button
            id="btn-toggle-my-orders"
            type="button"
            onClick={() => setOnlyMyOrders(!onlyMyOrders)}
            className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors flex items-center space-x-1.5 cursor-pointer ${
              onlyMyOrders
                ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold shadow-xs'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
            }`}
            title="切换仅看与我相关的检修工单"
          >
            <UserCheck className="w-3.5 h-3.5 text-blue-600" />
            <span>只看我的工单</span>
            {onlyMyOrders && <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
          </button>
        </div>
      </div>

      {/* Work Orders List */}
      <VirtualList
        items={filteredOrders}
        maxHeight={600}
        estimateItemHeight={140}
        emptyText="暂无此状态下的检修工单"
        renderItem={(wo) => (
          <WorkOrderListItem
            key={wo.id}
            order={wo}
            onSelect={() => setSelectedOrder(wo)}
            onNavigateTo3D={onNavigateTo3D}
            openInExploded={openInExploded}
          />
        )}
      />

      {/* Work Order Detail & Processing Drawer */}
      <WorkOrderDetailDrawer
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        currentUser={currentUser}
        equipments={equipments}
        orderSpareMovements={orderSpareMovements}
        onNavigateTo3D={onNavigateTo3D}
        onNavigateDispatch={onNavigateDispatch}
        openInExploded={openInExploded}
        onOpenAiDiagnose={onOpenAiDiagnose}
        onOpenDispatch={() => setShowDispatchModal(true)}
        onAcceptOrder={handleAcceptOrder}
        onOpenRepairLog={() => setShowRepairLogModal(true)}
        onOpenAcceptance={() => setShowAcceptanceModal(true)}
        onOpenConvertHazard={() => setConvertHazardModalOpen(true)}
        onOpenSpareModal={() => setShowSpareModal(true)}
      />

      {/* Modal: Create Work Order (向导流式表单) */}
      <WorkOrderCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        currentUser={currentUser}
        equipments={equipments}
        workOrders={workOrders}
        onCreateWorkOrder={onCreateWorkOrder}
        onSelectExistingOrder={(order) => setSelectedOrder(order)}
        onOpenVideoModal={() => setShowVideoModal(true)}
        step={createStep}
        onStepChange={setCreateStep}
        formData={newOrderForm}
        onFormDataChange={setNewOrderForm}
        evidenceFiles={evidenceFiles}
        onEvidenceFilesChange={setEvidenceFiles}
      />

      {/* Action Modals (Dispatch, Repair Log, Acceptance, Hazard, Spare Part Claim) */}
      <WorkOrderActionModals
        order={selectedOrder}
        currentUser={currentUser}
        allUsers={allUsers}
        onOrderUpdated={(updated) => {
          onUpdateWorkOrder(updated);
          setSelectedOrder(updated);
        }}
        showDispatchModal={showDispatchModal}
        onCloseDispatch={() => setShowDispatchModal(false)}
        showRepairLogModal={showRepairLogModal}
        onCloseRepairLog={() => setShowRepairLogModal(false)}
        showAcceptanceModal={showAcceptanceModal}
        onCloseAcceptance={() => setShowAcceptanceModal(false)}
        convertHazardModalOpen={convertHazardModalOpen}
        onCloseConvertHazard={() => setConvertHazardModalOpen(false)}
        showSpareModal={showSpareModal}
        onCloseSpareModal={() => setShowSpareModal(false)}
        onSpareMovementAdded={(movement) => setOrderSpareMovements((prev) => [movement, ...prev])}
      />

      {/* 视频智能诊断模态框 (功能二) */}
      <VideoAnalysisModal
        isOpen={showVideoModal}
        onClose={() => setShowVideoModal(false)}
        equipments={equipments}
        onApplyToWorkOrder={handleApplyVideoResult}
      />
    </div>
  );
};
