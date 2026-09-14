import React, { useState, useEffect } from 'react';
import {
  Navigation,
  Loader2,
  Sparkles,
  Wrench,
  Plus,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  FileText,
  Star,
  Camera,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  X,
  Send,
  Check,
  Package,
  Download,
  Video,
  ShieldCheck,
  Box,
  Layers,
  Activity,
  Flame,
  Zap,
  Droplets,
  Upload,
  ChevronLeft,
  Trash2,
  Eye,
  Info,
} from 'lucide-react';
import {
  WorkOrder,
  WorkOrderStatus,
  WorkOrderPriority,
  Equipment,
  UserProfile,
  SparePartUsage,
  ComplianceCheck,
  VideoAnalysisResult,
  SparePart,
  Hazard,
} from '../types';
import { workOrderApi, ApiError, aiApi, complianceApi, sparePartsApi, hazardsApi } from '../api';
import { request } from '../api';
import { AiResultModal } from './ai/AiResultModal';
import { VideoAnalysisModal } from './VideoAnalysisModal';
import { AiRootCauseAnalysis, AiMaintenancePlan, AiAssigneeRecommendation } from '../api';
import { VirtualList } from './VirtualList';
// ─── 提取的子组件（原内联于本文件，已拆分至独立模块）────────────────────────────
// 重构说明：状态/优先级的文案与配色原为本文件闭包内函数，无法跨视图复用
// （DashboardView 等处重复实现了相同逻辑）。现统一收敛至
// ./workorders/WorkOrderStatusBadge.tsx，通过 <WorkOrderStatusBadge> /
// <WorkOrderPriorityBadge> 组件渲染，保证全局状态映射单一数据源且可单独测试。
import {
  WorkOrderStatusBadge,
  WorkOrderPriorityBadge,
} from './workorders/WorkOrderStatusBadge';


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
  initialCreateOpen?: boolean;
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
  initialCreateOpen = false,
}) => {
  const [activeStatusTab, setActiveStatusTab] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyMyOrders, setOnlyMyOrders] = useState<boolean>(currentUser.role === 'operator' || currentUser.role === 'user');

  useEffect(() => {
    if (currentUser.role === 'operator' || currentUser.role === 'user') {
      setOnlyMyOrders(true);
    }
  }, [currentUser.id, currentUser.role]);

  // Selected Order for Detail Drawer
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(initialCreateOpen);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [showRepairLogModal, setShowRepairLogModal] = useState(false);
  const [showAcceptanceModal, setShowAcceptanceModal] = useState(false);
  const [createStep, setCreateStep] = useState<number>(1);
  const [evidenceFiles, setEvidenceFiles] = useState<Array<{ id: string; name: string; size: string; time: string; type: 'image' | 'video' }>>([
    { id: 'ev-1', name: '现场测振传感器安装位.jpg', size: '2.4 MB', time: '10分钟前', type: 'image' },
    { id: 'ev-2', name: '轴承箱红外测温热像.jpg', size: '1.8 MB', time: '8分钟前', type: 'image' },
  ]);

  // 生产级：防重复报单与状态互斥提示状态
  const [duplicateAlert, setDuplicateAlert] = useState<{ message: string; existingOrder?: any } | null>(null);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [mutexErrorToast, setMutexErrorToast] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  // 视频智能诊断模态框状态 (功能二)
  const [showVideoModal, setShowVideoModal] = useState(false);

  // 工单流转时间线状态
  const [logsState, setLogsState] = useState<{ loading: boolean; items: any[] }>({ loading: false, items: [] });

  // AI 作业合规审计报告 (功能三)
  const [complianceRecord, setComplianceRecord] = useState<ComplianceCheck | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);

  // 工单转安全隐患状态 (功能四：现场隐患闭环治理)
  const [convertHazardModalOpen, setConvertHazardModalOpen] = useState(false);
  const [convertHazardTitle, setConvertHazardTitle] = useState('');
  const [convertHazardLevel, setConvertHazardLevel] = useState<'general' | 'major'>('general');
  const [convertHazardNotice, setConvertHazardNotice] = useState<string | null>(null);
  const [convertHazardSubmitting, setConvertHazardSubmitting] = useState(false);

  // 现场备件领用状态 (功能三：工业备件库存全链路)
  const [showSpareModal, setShowSpareModal] = useState(false);
  const [availableSpareParts, setAvailableSpareParts] = useState<SparePart[]>([]);
  const [claimPartId, setClaimPartId] = useState('');
  const [claimQuantity, setClaimQuantity] = useState(1);
  const [claimNotes, setClaimNotes] = useState('');
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimNotice, setClaimNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [orderSpareMovements, setOrderSpareMovements] = useState<any[]>([]);

  useEffect(() => {
    if (selectedOrder) {
      setConvertHazardTitle(`[工单 ${selectedOrder.orderNo} 衍生隐患] ${selectedOrder.title}`);
      setConvertHazardLevel(selectedOrder.priority === 'urgent' ? 'major' : 'general');
      setConvertHazardNotice(null);
      sparePartsApi.list().then((parts) => {
        setAvailableSpareParts(parts);
        if (parts.length > 0 && !claimPartId) setClaimPartId(parts[0].id);
      }).catch(console.error);
    }
  }, [selectedOrder?.id]);

  const handleConvertToHazard = async () => {
    if (!selectedOrder || !convertHazardTitle) return;
    setConvertHazardSubmitting(true);
    setConvertHazardNotice(null);
    try {
      const created = await hazardsApi.create({
        code: `HAZ-WO-${Date.now().toString().slice(-5)}`,
        title: convertHazardTitle,
        level: convertHazardLevel,
        equipment_id: selectedOrder.equipmentId,
        equipment_name: selectedOrder.equipmentName,
        location: selectedOrder.workshop,
        description: `来源于工单【${selectedOrder.orderNo} - ${selectedOrder.title}】现场转报。现场情况描述：${selectedOrder.description}`,
        reported_by: currentUser.name,
        discoverer: currentUser.name,
        related_work_order_id: selectedOrder.id,
      } as any);
      setConvertHazardNotice(`✅ 成功立项安全隐患 ${created.hazardNo || created.code || created.id}，已纳入重大隐患闭环治理中枢！`);
      setTimeout(() => {
        setConvertHazardModalOpen(false);
        setConvertHazardNotice(null);
      }, 2000);
    } catch (err: any) {
      setConvertHazardNotice(`❌ 转报失败: ${err?.message || '网络或接口异常'}`);
    } finally {
      setConvertHazardSubmitting(false);
    }
  };

  const handleClaimSparePart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !claimPartId || claimQuantity <= 0) return;
    setClaimSubmitting(true);
    setClaimNotice(null);
    try {
      const part = availableSpareParts.find((p) => p.id === claimPartId);
      const res = await sparePartsApi.inOut(claimPartId, {
        type: 'out',
        quantity: claimQuantity,
        operatorName: currentUser.name,
        relatedWorkOrderId: selectedOrder.id,
        notes: claimNotes || `工单 ${selectedOrder.orderNo} 检修现场快速领用`,
      });
      if (res.success) {
        setClaimNotice({
          type: 'success',
          message: `备件【${part?.name || claimPartId}】${claimQuantity}件领用成功！实时库存已扣减至：${res.part.stockQuantity ?? res.part.stock} ${res.part.unit}`
        });
        setAvailableSpareParts((prev) => prev.map((p) => (p.id === claimPartId ? res.part : p)));
        setOrderSpareMovements((prev) => [
          {
            id: res.movement?.id || Date.now().toString(),
            partName: part?.name || '工业备件',
            spec: part?.spec || part?.specification || '标准件',
            quantity: claimQuantity,
            unit: part?.unit || '件',
            operator: currentUser.name,
            time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          },
          ...prev,
        ]);
        setTimeout(() => {
          setShowSpareModal(false);
          setClaimNotice(null);
          setClaimQuantity(1);
          setClaimNotes('');
        }, 1500);
      }
    } catch (err: any) {
      setClaimNotice({ type: 'error', message: err?.message || '备件领用扣减失败' });
    } finally {
      setClaimSubmitting(false);
    }
  };

  useEffect(() => {
    if (!selectedOrder) {
      setComplianceRecord(null);
      return;
    }
    setComplianceLoading(true);
    complianceApi
      .getByWorkOrderId(selectedOrder.id)
      .then((rec) => setComplianceRecord(rec))
      .catch(() => setComplianceRecord(null))
      .finally(() => setComplianceLoading(false));
  }, [selectedOrder?.id]);

  useEffect(() => {
    if (!selectedOrder) return;
    setLogsState({ loading: true, items: [] });
    request(`/api/v1/work-orders/${selectedOrder.id}/logs`)
      .then((logs: any) => setLogsState({ loading: false, items: Array.isArray(logs) ? logs : [] }))
      .catch(() => setLogsState({ loading: false, items: [] }));
  }, [selectedOrder?.id]);

  // AI 扩展功能状态 (功能 2：根因分析 / 功能 3：检修方案)
  const [rcaState, setRcaState] = useState<{ open: boolean; loading: boolean; error: string | null; degraded?: boolean; data?: AiRootCauseAnalysis | null }>({ open: false, loading: false, error: null });
  const [planState, setPlanState] = useState<{ open: boolean; loading: boolean; error: string | null; degraded?: boolean; reviewId?: string | null; data?: AiMaintenancePlan | null }>({ open: false, loading: false, error: null });

  // AI 辅助派单状态 (功能 9)
  const [recState, setRecState] = useState<{ loading: boolean; error: string | null; degraded?: boolean; data?: AiAssigneeRecommendation | null }>({ loading: false, error: null });

  const handleRecommendAssignee = async () => {
    if (!selectedOrder) return;
    setRecState({ loading: true, error: null });
    try {
      const res = await aiApi.recommendAssignee({
        equipmentId: selectedOrder.equipmentId,
        faultDescription: selectedOrder.description || selectedOrder.title,
        priority: selectedOrder.priority,
      });
      if (res.success && res.recommendation) {
        setRecState({ loading: false, error: null, data: res.recommendation });
      } else {
        setRecState({ loading: false, error: res.message || res.error || 'AI 推荐派单失败', degraded: res.degraded });
      }
    } catch (err: any) {
      setRecState({ loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  const applyRecommendation = () => {
    const rec = recState.data;
    if (!rec?.recommended?.id) return;
    setDispatchForm((prev) => ({
      ...prev,
      assigneeId: rec.recommended!.id,
      estimatedHours: rec.estimatedHours || prev.estimatedHours,
      dispatcherNote: `${prev.dispatcherNote ? prev.dispatcherNote + ' ' : ''}[AI推荐] ${rec.recommended!.reason}`.slice(0, 180),
    }));
  };

  const handleRootCauseAnalysis = async () => {
    if (!selectedOrder) return;
    setRcaState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.rootCauseAnalysis({ workOrderId: selectedOrder.id });
      if (res.success && res.analysis) {
        setRcaState({ open: true, loading: false, error: null, data: res.analysis });
      } else {
        setRcaState({ open: true, loading: false, error: res.message || res.error || 'AI 根因分析失败', degraded: res.degraded });
      }
    } catch (err: any) {
      setRcaState({ open: true, loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  const handleGenerateMaintenancePlan = async () => {
    if (!selectedOrder) return;
    setPlanState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.generateMaintenancePlan({
        equipmentId: selectedOrder.equipmentId,
        faultDescription: selectedOrder.description || selectedOrder.title,
        workOrderId: selectedOrder.id,
      });
      if (res.success && res.plan) {
        setPlanState({ open: true, loading: false, error: null, data: res.plan, reviewId: res.reviewId });
      } else {
        setPlanState({ open: true, loading: false, error: res.message || res.error || 'AI 检修方案生成失败', degraded: res.degraded });
      }
    } catch (err: any) {
      setPlanState({ open: true, loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  const handleExportOrders = async () => {
    setIsExporting(true);
    setExportSuccessMsg(null);
    try {
      await workOrderApi.exportExcel({
        status: activeStatusTab === 'all' ? undefined : activeStatusTab,
        priority: selectedPriority === 'all' ? undefined : selectedPriority,
      });
      setExportSuccessMsg('工单台账 Excel (CSV UTF-8 BOM) 导出成功，已下载本地！');
      setTimeout(() => setExportSuccessMsg(null), 3500);
    } catch (err: any) {
      alert(err.message || '导出工单失败');
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (initialCreateOpen) {
      setShowCreateModal(true);
    }
  }, [initialCreateOpen]);

  // Form States
  const [newOrderForm, setNewOrderForm] = useState({
    title: '',
    equipmentId: equipments[0]?.id || '',
    faultType: '机械振动' as any,
    priority: 'high' as WorkOrderPriority,
    description: '',
    safetyRequirements: ['穿戴劳保鞋与安全帽', '实施 LOTO 停电挂牌'],
  });

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

  const [dispatchForm, setDispatchForm] = useState({
    assigneeId: 'u-tech',
    estimatedHours: 3.5,
    dispatcherNote: '',
  });

  const [repairLogForm, setRepairLogForm] = useState({
    causeAnalysis: '',
    resolutionSteps: '',
    workHours: 3.0,
    parts: [
      { id: 'p1', name: '调心滚子轴承', code: 'SKF 22324', spec: '标准件', qty: 1, unit: '套', unitPrice: 2800 },
    ] as SparePartUsage[],
    remark: '',
  });

  const [acceptanceForm, setAcceptanceForm] = useState({
    score: 5,
    pass: true,
    comment: '检修质量合格，经空载与满载试车2小时，振动与温升均符合国家及企业标准。',
  });

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

  const statusTabs: { id: string; label: string; count: number }[] = [
    { id: 'all', label: onlyMyOrders ? '我的工单' : '全部工单', count: scopedOrders.length },
    { id: 'created', label: '待派单', count: scopedOrders.filter((w) => w.status === 'created').length },
    { id: 'dispatched', label: '待接单', count: scopedOrders.filter((w) => w.status === 'dispatched').length },
    { id: 'in_progress', label: '检修中', count: scopedOrders.filter((w) => w.status === 'in_progress').length },
    { id: 'pending_acceptance', label: '待验收', count: scopedOrders.filter((w) => w.status === 'pending_acceptance').length },
    { id: 'completed', label: '已归档', count: scopedOrders.filter((w) => w.status === 'completed').length },
  ];

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

  // ─── 状态/优先级映射 ────────────────────────────────────────────────────────
  // 状态与优先级的文案/配色已收敛至 ./workorders/WorkOrderStatusBadge.tsx（单一数据源），
  // 本文件统一使用 <WorkOrderStatusBadge> / <WorkOrderPriorityBadge> 渲染，不再本地映射。


  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: string[] = [];
    if (!newOrderForm.equipmentId) missing.push('请选择报修设备');
    if (!newOrderForm.description?.trim()) missing.push('请填写故障描述');
    if (missing.length > 0) {
      setCreateFormError(missing.join('；'));
      return;
    }
    const targetEq = equipments.find((e) => e.id === newOrderForm.equipmentId) || equipments[0];
    if (!targetEq) {
      setCreateFormError('请选择报修设备');
      return;
    }
    setIsSubmitting(true);
    setDuplicateAlert(null);
    setCreateFormError(null);

    try {
      const created = await workOrderApi.create({
        title: newOrderForm.title,
        equipmentId: targetEq.id,
        faultType: newOrderForm.faultType,
        priority: newOrderForm.priority,
        description: newOrderForm.description,
        safetyRequirements: newOrderForm.safetyRequirements,
        creator: `${currentUser.name} (${currentUser.roleTitle})`,
        forceSubmit: false,
      });

      onCreateWorkOrder(created);
      setShowCreateModal(false);
      setNewOrderForm({
        title: '',
        equipmentId: equipments[0]?.id || '',
        faultType: '机械振动',
        priority: 'high',
        description: '',
        safetyRequirements: ['穿戴劳保鞋与安全帽', '实施 LOTO 停电挂牌'],
      });
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.data.code === 'DUPLICATE_WORK_ORDER') {
        setDuplicateAlert({
          message: err.data.message || '检测到该设备在15分钟内已存在处理中的同类工单',
          existingOrder: err.data.existingOrder,
        });
      } else {
        alert(err.message || '创建工单失败，请检查网络或参数');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForceSubmit = async () => {
    const targetEq = equipments.find((e) => e.id === newOrderForm.equipmentId) || equipments[0];
    setIsSubmitting(true);
    try {
      const created = await workOrderApi.create({
        title: newOrderForm.title,
        equipmentId: targetEq.id,
        faultType: newOrderForm.faultType,
        priority: newOrderForm.priority,
        description: newOrderForm.description,
        safetyRequirements: newOrderForm.safetyRequirements,
        creator: `${currentUser.name} (${currentUser.roleTitle})`,
        forceSubmit: true,
      });
      onCreateWorkOrder(created);
      setShowCreateModal(false);
      setDuplicateAlert(null);
      setNewOrderForm({
        title: '',
        equipmentId: equipments[0]?.id || '',
        faultType: '机械振动',
        priority: 'high',
        description: '',
        safetyRequirements: ['穿戴劳保鞋与安全帽', '实施 LOTO 停电挂牌'],
      });
    } catch (err: any) {
      alert(err.message || '强制提交失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDispatchOrder = async () => {
    if (!selectedOrder) return;
    const targetTech = allUsers.find((u) => u.id === dispatchForm.assigneeId) || allUsers[1];
    try {
      const updated = await workOrderApi.dispatch(selectedOrder.id, {
        assigneeId: targetTech.id,
        assigneeName: targetTech.name,
        dispatcher: `${currentUser.name} (${currentUser.roleTitle})`,
        estimatedHours: dispatchForm.estimatedHours,
        version: selectedOrder.version,
      });
      onUpdateWorkOrder(updated);
      setSelectedOrder(updated);
      setShowDispatchModal(false);
    } catch (err: any) {
      const msg = err.data?.message || err.message || '派单失败';
      setMutexErrorToast(msg);
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
      setMutexErrorToast(msg);
    }
  };

  const handleSubmitRepairLog = async () => {
    if (!selectedOrder) return;
    try {
      const updated = await workOrderApi.complete(selectedOrder.id, {
        causeAnalysis: repairLogForm.causeAnalysis || '轴承疲劳微剥落并伴随同轴度偏差。',
        resolutionSteps: repairLogForm.resolutionSteps || '完成轴承更换、激光对中复测与新润滑脂加注。',
        partsUsed: repairLogForm.parts,
        workHours: repairLogForm.workHours,
        completionPhotos: [],
        remark: repairLogForm.remark,
        operatorName: `${currentUser.name} (${currentUser.roleTitle})`,
        version: selectedOrder.version,
      });
      onUpdateWorkOrder(updated);
      setSelectedOrder(updated);
      setShowRepairLogModal(false);
    } catch (err: any) {
      const msg = err.data?.message || err.message || '完工上报失败';
      setMutexErrorToast(msg);
    }
  };

  const handleAcceptanceSubmit = async () => {
    if (!selectedOrder) return;
    try {
      const updated = await workOrderApi.accept(selectedOrder.id, {
        inspectorName: `${currentUser.name} (${currentUser.roleTitle})`,
        pass: acceptanceForm.pass,
        score: acceptanceForm.score,
        comment: acceptanceForm.comment,
        version: selectedOrder.version,
      });
      onUpdateWorkOrder(updated);
      setSelectedOrder(updated);
      setShowAcceptanceModal(false);
    } catch (err: any) {
      const msg = err.data?.message || err.message || '验收归档失败';
      setMutexErrorToast(msg);
    }
  };

    const createdCount = (scopedOrders || []).filter((w) => w.status === 'created').length;
    const inProgressCount = (scopedOrders || []).filter((w) => w.status === 'in_progress').length;
    const pendingAcceptanceCount = (scopedOrders || []).filter((w) => w.status === 'pending_acceptance').length;
    const urgentSlaCount = (scopedOrders || []).filter((w) => w.priority === 'urgent' && w.status !== 'completed').length;

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

          <button
            id="btn-create-work-order"
            onClick={() => setShowCreateModal(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-lg transition-all flex items-center space-x-1.5 shadow-sm shadow-blue-500/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>快速创建检修单</span>
          </button>
        </div>
      </div>

      {/* 检修特色：顶部数据条 (Maintenance Pipeline Telemetry) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 border border-orange-200 flex items-center justify-center font-bold text-xs">
              待
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">待办派单</span>
              <span className="text-base font-bold text-slate-900 font-mono">{createdCount} <span className="text-xs text-slate-500 font-normal">单</span></span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-medium">调度中</span>
        </div>

        <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center font-bold text-xs">
              修
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">现场检修中</span>
              <span className="text-base font-bold text-blue-700 font-mono">{inProgressCount} <span className="text-xs text-slate-500 font-normal">单</span></span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium">处置中</span>
        </div>

        <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center font-bold text-xs">
              验
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">质检验收</span>
              <span className="text-base font-bold text-purple-700 font-mono">{pendingAcceptanceCount} <span className="text-xs text-slate-500 font-normal">单</span></span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-medium">待复核</span>
        </div>

        <div className="p-3 bg-white border border-rose-200 rounded-xl shadow-xs flex items-center justify-between relative overflow-hidden">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center font-bold text-xs animate-pulse">
              急
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">紧急 SLA 抢修</span>
              <span className="text-base font-bold text-rose-600 font-mono">{urgentSlaCount} <span className="text-xs text-slate-500 font-normal">单</span></span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 font-bold flex items-center gap-1 animate-pulse">
            <Clock className="w-3 h-3" /> SLA警戒
          </span>
        </div>
      </div>

      {/* 导出成功 Toast */}
      {exportSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-800 text-xs animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{exportSuccessMsg}</span>
          </div>
          <button
            onClick={() => setExportSuccessMsg(null)}
            className="text-emerald-600 hover:text-emerald-800 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 状态互斥拦截告警 Toast */}
      {mutexErrorToast && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-amber-800 text-xs animate-in fade-in">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
            <span><strong>状态互斥拦截：</strong>{mutexErrorToast}</span>
          </div>
          <button
            onClick={() => setMutexErrorToast(null)}
            className="text-amber-600 hover:text-amber-800 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 检修特色：工单状态流转管线 (待派单→待接单→检修中→待验收→已闭环 横排节点图) */}
      <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            工单全生命周期流转管线状态
          </span>
          <button
            type="button"
            onClick={() => setActiveStatusTab('all')}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
              activeStatusTab === 'all'
                ? 'bg-blue-600 text-white font-semibold border-blue-600 shadow-xs'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            全部工单 ({scopedOrders.length})
          </button>
        </div>

        <div className="flex items-center justify-between overflow-x-auto gap-2 py-1 scrollbar-none">
          {[
            { id: 'created', label: '1. 待派单', count: scopedOrders.filter((w) => w.status === 'created').length, color: 'text-orange-600', badge: 'bg-orange-50 border-orange-200' },
            { id: 'dispatched', label: '2. 待接单', count: scopedOrders.filter((w) => w.status === 'dispatched').length, color: 'text-blue-600', badge: 'bg-blue-50 border-blue-200' },
            { id: 'in_progress', label: '3. 检修中', count: scopedOrders.filter((w) => w.status === 'in_progress').length, color: 'text-indigo-600', badge: 'bg-indigo-50 border-indigo-200' },
            { id: 'pending_acceptance', label: '4. 待验收', count: scopedOrders.filter((w) => w.status === 'pending_acceptance').length, color: 'text-purple-600', badge: 'bg-purple-50 border-purple-200' },
            { id: 'completed', label: '5. 已闭环', count: scopedOrders.filter((w) => w.status === 'completed').length, color: 'text-emerald-600', badge: 'bg-emerald-50 border-emerald-200' },
          ].map((node, index, arr) => {
            const isSelected = activeStatusTab === node.id;
            return (
              <React.Fragment key={node.id}>
                <button
                  type="button"
                  onClick={() => setActiveStatusTab(node.id)}
                  className={`flex-1 min-w-[140px] p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-blue-50/80 border-blue-500 shadow-xs ring-2 ring-blue-500/20'
                      : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200/80'
                  }`}
                >
                  <div>
                    <span className={`text-xs font-bold block ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                      {node.label}
                    </span>
                    <span className="text-[10px] text-slate-500">管线处理节点</span>
                  </div>
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${node.badge} ${node.color}`}>
                    {node.count}
                  </span>
                </button>
                {index < arr.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-slate-300 shrink-0 hidden sm:block" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

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
        renderItem={(wo) => {
          const isUrgent = wo.priority === 'urgent';
          const isHigh = wo.priority === 'high';
          const isMedium = wo.priority === 'medium';

          const priorityBorder = isUrgent
            ? 'border-l-4 border-l-rose-500'
            : isHigh
            ? 'border-l-4 border-l-amber-500'
            : isMedium
            ? 'border-l-4 border-l-blue-500'
            : 'border-l-4 border-l-slate-400';

          return (
            <div
              key={wo.id}
              onClick={() => setSelectedOrder(wo)}
              className={`p-4 bg-white hover:bg-slate-50/90 border border-slate-200/80 rounded-xl shadow-xs transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3 ${priorityBorder} hover:shadow-md hover:border-slate-300`}
            >
              <div className="flex items-start space-x-3.5 flex-1 min-w-0">
                <div
                  className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                    isUrgent
                      ? 'bg-rose-50 text-rose-600 border border-rose-200'
                      : 'bg-blue-50 text-blue-600 border border-blue-200'
                  }`}
                >
                  <Wrench className="w-5 h-5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="font-mono text-xs font-bold text-blue-600">{wo.orderNo}</span>
                    <WorkOrderPriorityBadge priority={wo.priority} size="xs" />
                    <WorkOrderStatusBadge status={wo.status} size="xs" />
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                      {wo.faultType}
                    </span>
                    {isUrgent && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-300 font-semibold animate-pulse flex items-center gap-1">
                        <Clock className="w-3 h-3 text-rose-600" />
                        SLA抢修响应倒计时: 18m
                      </span>
                    )}
                  </div>

                  <h3 className="text-sm font-bold text-slate-800 group-hover:text-blue-600 transition-colors truncate">
                    {wo.title}
                  </h3>
                  <p className="text-xs text-slate-500 line-clamp-1 mt-1">{wo.description}</p>

                  <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-[11px] text-slate-500 mt-2">
                    <span>设备: <strong className="text-slate-700">{wo.equipmentName} ({wo.equipmentCode})</strong></span>
                    <span>车间: {wo.workshop}</span>
                    <span>报修人: {wo.creator}</span>
                    <span>主修技师: <strong className="text-blue-700 font-semibold">{wo.assignee || '待派发/未分配'}</strong></span>
                    <span>计划工时: <strong className="text-slate-700 font-mono font-medium">3.5h</strong></span>
                  </div>
                </div>
              </div>

              {/* Right Action & Timeline Status */}
              <div className="flex items-center justify-between md:justify-end space-x-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                <div className="text-right hidden sm:block">
                  <span className="text-[10px] text-slate-500 block">创建时间</span>
                  <span className="font-mono text-xs text-slate-600">{wo.createdAt}</span>
                </div>

                <button className="px-3.5 py-1.5 bg-blue-50 group-hover:bg-blue-600 text-blue-700 group-hover:text-white border border-blue-200 group-hover:border-blue-600 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1 cursor-pointer">
                  <span>处理/详情</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        }}
      />

      {/* Work Order Detail & Processing Drawer */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6">
            {/* Top Modal Bar */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                    {selectedOrder.orderNo}
                  </span>
                  <WorkOrderStatusBadge status={selectedOrder.status} />
                  <WorkOrderPriorityBadge priority={selectedOrder.priority} />
                </div>
                <h3 className="text-base font-bold text-slate-100 mt-1.5">{selectedOrder.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  目标设备: {selectedOrder.equipmentName} ({selectedOrder.equipmentCode}) · 所属: {selectedOrder.workshop}
                </p>
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Lifecycle Progress Bar */}
            <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60">
              <span className="text-xs font-semibold text-slate-300 block mb-3">工单闭环处理流水线</span>
              <div className="grid grid-cols-5 gap-2 text-center text-[10px]">
                <div className={`p-2 rounded-lg ${selectedOrder.status ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}>
                  <span className="block font-bold">1. 创建申报</span>
                  <span className="text-[9px] text-slate-500 truncate">{selectedOrder.creator.split(' ')[0]}</span>
                </div>
                <div className={`p-2 rounded-lg ${['dispatched', 'in_progress', 'pending_acceptance', 'completed'].includes(selectedOrder.status) ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}>
                  <span className="block font-bold">2. 派发分配</span>
                  <span className="text-[9px] text-slate-500 truncate">{selectedOrder.assignee || '待派发'}</span>
                </div>
                <div className={`p-2 rounded-lg ${['in_progress', 'pending_acceptance', 'completed'].includes(selectedOrder.status) ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}>
                  <span className="block font-bold">3. 技师接单</span>
                  <span className="text-[9px] text-slate-500 truncate">{selectedOrder.acceptedAt ? '已接单' : '等待接单'}</span>
                </div>
                <div className={`p-2 rounded-lg ${['pending_acceptance', 'completed'].includes(selectedOrder.status) ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}>
                  <span className="block font-bold">4. 检修完工</span>
                  <span className="text-[9px] text-slate-500 truncate">{selectedOrder.completedAt ? '已报完工' : '检修中'}</span>
                </div>
                <div className={`p-2 rounded-lg ${selectedOrder.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-500'}`}>
                  <span className="block font-bold">5. 验收归档</span>
                  <span className="text-[9px] text-slate-500 truncate">{selectedOrder.status === 'completed' ? '已验收' : '待验收'}</span>
                </div>
              </div>
            </div>

            {/* Description & Safety Precautions */}
            <div className="space-y-3 text-xs">
              <div className="bg-slate-900/60 border border-slate-700/80 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-semibold text-slate-200 flex items-center">
                  <Clock className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
                  工单流转时间线
                </h4>
                {logsState.loading && <p className="text-xs text-slate-500">时间线加载中...</p>}
                {!logsState.loading && logsState.items.length === 0 && (
                  <p className="text-xs text-slate-500">暂无流转记录</p>
                )}
                <div className="space-y-2.5">
                  {logsState.items.map((log) => (
                    <div key={log.id} className="flex items-start space-x-2.5 text-xs">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 shrink-0"></div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-200 font-medium">
                            {log.action} {log.previousStatus ? `(${log.previousStatus} → ${log.newStatus})` : ""}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">{log.createdAt}</span>
                        </div>
                        <p className="text-slate-500 mt-0.5">{log.operatorName}：{log.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-2">
                <span className="font-semibold text-slate-200">现场故障征兆与报修描述</span>
                <p className="text-slate-300 leading-relaxed">{selectedOrder.description}</p>
              </div>

              {selectedOrder.safetyRequirements.length > 0 && (
                <div className="bg-rose-950/30 p-4 rounded-xl border border-rose-500/30 space-y-2 text-rose-200">
                  <span className="font-semibold flex items-center">
                    <ShieldAlert className="w-4 h-4 mr-1.5 text-rose-400" />
                    强制性安全防护与隔离要求
                  </span>
                  <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
                    {selectedOrder.safetyRequirements.map((req, idx) => (
                      <li key={idx}>{req}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Repair Log Section (If Filled) */}
            {selectedOrder.repairLog && (
              <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-3 text-xs">
                <h4 className="font-semibold text-slate-200 flex items-center">
                  <FileText className="w-4 h-4 mr-1.5 text-cyan-400" />
                  技师检修处理日志与备件消耗清单 (实际耗时: {selectedOrder.repairLog.workHours}h)
                </h4>

                <div className="space-y-1 text-slate-300">
                  <p><strong className="text-slate-500">根本原因分析:</strong> {selectedOrder.repairLog.causeAnalysis}</p>
                  <p><strong className="text-slate-500">具体作业步骤:</strong> {selectedOrder.repairLog.resolutionSteps}</p>
                </div>

                {selectedOrder.repairLog.partsUsed.length > 0 && (
                  <div className="pt-2 border-t border-slate-700">
                    <span className="text-[11px] font-semibold text-slate-300 block mb-1.5">更换备件与耗材明细:</span>
                    <div className="space-y-1">
                      {selectedOrder.repairLog.partsUsed.map((part) => (
                        <div key={part.id} className="flex justify-between p-2 rounded bg-slate-900 border border-slate-800 text-[11px]">
                          <span className="font-medium text-slate-200">{part.name} ({part.spec})</span>
                          <span className="font-mono text-cyan-400">{part.qty} {part.unit} × ¥{part.unitPrice} = ¥{(part.qty * part.unitPrice).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 现场备件领用与库存扣减 (功能三：备件管理全链路) */}
            <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-200 flex items-center">
                  <Package className="w-4 h-4 mr-1.5 text-amber-400" />
                  现场备件出库领用与库存联动核销
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setShowSpareModal(true);
                    setClaimNotice(null);
                  }}
                  className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-medium flex items-center space-x-1 cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ 现场领用备件</span>
                </button>
              </div>

              {orderSpareMovements.length > 0 ? (
                <div className="space-y-1.5">
                  <span className="text-[11px] text-slate-500 block">本次工单现场已领用备件流水 (已实时扣减仓库库存):</span>
                  {orderSpareMovements.map((m) => (
                    <div key={m.id} className="flex justify-between items-center p-2 rounded bg-slate-900 border border-slate-800 text-[11px]">
                      <div>
                        <span className="font-medium text-slate-200">{m.partName}</span>
                        <span className="text-slate-500 ml-1.5">({m.spec})</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-amber-400 font-bold">-{m.quantity} {m.unit}</span>
                        <span className="text-[10px] text-slate-500">{m.operator} · {m.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 text-[11px]">
                  如需更换备品备件，可点击右上角「+ 现场领用备件」直接办理快速出库，将自动核减中央备件库库存。
                </p>
              )}
            </div>

            {/* Acceptance Report (If Accepted) */}
            {selectedOrder.acceptance && (
              <div className="bg-emerald-950/30 p-4 rounded-xl border border-emerald-500/30 space-y-2 text-xs text-emerald-200">
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center">
                    <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-400" />
                    质量验收评价报告 (验收人: {selectedOrder.acceptance.inspectorName})
                  </span>
                  <div className="flex items-center text-amber-400">
                    {Array.from({ length: selectedOrder.acceptance.score }).map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-current" />
                    ))}
                  </div>
                </div>
                <p className="text-slate-300 text-[11px]">{selectedOrder.acceptance.comment}</p>
                <div className="text-[10px] text-slate-500 font-mono">验收通过签署日期: {selectedOrder.acceptance.signatureDate}</div>
              </div>
            )}

            {/* AI 作业合规与失误审计报告 (功能三) */}
            {complianceLoading && (
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700 flex items-center justify-center space-x-2 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                <span>正在加载 AI 作业合规审计报告...</span>
              </div>
            )}

            {!complianceLoading && complianceRecord && (
              <div className="bg-slate-800/80 p-4 rounded-xl border border-indigo-500/40 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="font-semibold text-slate-100">通义千问 AI 作业合规审计报告</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${complianceRecord.isCompliant
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}
                    >
                      {complianceRecord.isCompliant ? '合规达标' : '存在违规/失误'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500">合规得分: </span>
                    <span
                      className={`text-base font-bold font-mono ${complianceRecord.score >= 85
                          ? 'text-emerald-400'
                          : complianceRecord.score >= 60
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }`}
                    >
                      {complianceRecord.score}
                    </span>
                    <span className="text-[10px] text-slate-500">/100</span>
                  </div>
                </div>

                {/* 违规列表 */}
                {complianceRecord.violations && complianceRecord.violations.length > 0 ? (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-semibold text-rose-300 flex items-center">
                      <AlertTriangle className="w-3.5 h-3.5 mr-1 text-rose-400" />
                      发现以下违规或失误项 ({complianceRecord.violations.length}项):
                    </span>
                    <div className="space-y-1">
                      {complianceRecord.violations.map((v, i) => (
                        <div
                          key={i}
                          className="p-2 rounded bg-rose-950/30 border border-rose-500/20 text-slate-300 text-[11px] flex justify-between items-center"
                        >
                          <span className="text-rose-200">
                            [{v.type}] {v.detail}
                          </span>
                          <span className="text-rose-400 font-mono text-[10px]">扣 {v.deduction} 分</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-emerald-300 flex items-center">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                    各检修关键动作与规范完全契合，无违章作业记录。
                  </div>
                )}

                {/* 改进建议 */}
                {complianceRecord.suggestions && (
                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-700 text-[11px] text-slate-300">
                    <strong className="text-cyan-400 block mb-1">AI 改善与防范建议:</strong>
                    {complianceRecord.suggestions}
                  </div>
                )}
              </div>
            )}

            {/* Role-Based Stage Operation Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => {
                  const eq = equipments.find((e) => e.id === selectedOrder.equipmentId);
                  if (eq) {
                    setSelectedOrder(null);
                    onOpenAiDiagnose(eq);
                  }
                }}
                className="px-3.5 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-lg flex items-center space-x-1.5 cursor-pointer"
              >
                <span>AI 诊断辅助</span>
              </button>

              {/* AI 根因分析 (功能 2) */}
              <button
                onClick={handleRootCauseAnalysis}
                className="px-3.5 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-purple-300 rounded-lg flex items-center space-x-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI 根因分析</span>
              </button>

              {/* AI 生成检修方案 (功能 3) */}
              <button
                onClick={handleGenerateMaintenancePlan}
                className="px-3.5 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-lg flex items-center space-x-1.5 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>AI 生成检修方案</span>
              </button>

              {/* 工单转安全隐患 (功能四：隐患闭环联动) */}
              <button
                onClick={() => setConvertHazardModalOpen(true)}
                className="px-3.5 py-2 text-xs bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-500/40 rounded-lg flex items-center space-x-1.5 cursor-pointer"
                title="发现重大风险或隐患，立即转入隐患排查治理中枢"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span>转为安全隐患</span>
              </button>

              <div className="flex items-center space-x-2">
                {/* Stage 1 -> 2: Dispatch (Admin/Dispatcher) */}
                {selectedOrder.status === 'created' && (currentUser.role === 'admin' || currentUser.role === 'manager') && onNavigateDispatch && (
                  <button
                    onClick={() => onNavigateDispatch(selectedOrder.id)}
                    className="px-4 py-2 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                    title="打开调度大屏，按距离/空闲/技能推荐在岗师傅"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>就近派单</span>
                  </button>
                )}
                {selectedOrder.status === 'created' && currentUser.role === 'admin' && (
                  <button
                    onClick={() => setShowDispatchModal(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>主管派发工单</span>
                  </button>
                )}

                {/* Stage 2 -> 3: Claim / Accept (Technician) */}
                {selectedOrder.status === 'dispatched' && (
                  <button
                    onClick={handleAcceptOrder}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>技师确认接单</span>
                  </button>
                )}

                {/* Stage 3 -> 4: Repair Log / Complete (Technician) */}
                {selectedOrder.status === 'in_progress' && (
                  <button
                    onClick={() => setShowRepairLogModal(true)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    <span>填写检修记录/申请完工</span>
                  </button>
                )}

                {/* Stage 4 -> 5: Acceptance (Inspector/Admin) */}
                {selectedOrder.status === 'pending_acceptance' && ['inspector', 'admin'].includes(currentUser.role) && (
                  <button
                    onClick={() => setShowAcceptanceModal(true)}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>质检复核与验收归档</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Work Order (快速报修大表单流向导) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-xs">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    创建设备检修与快速报修单
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-normal">
                      向导流式表单
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    标准化作业引导 · 智能防重复报单 · 动态 SLA 响应承诺联动
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateStep(1);
                  setDuplicateAlert(null);
                }}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 4-Step Wizard Indicator */}
            <div className="px-6 py-3 bg-slate-50/80 border-b border-slate-100">
              <div className="flex items-center justify-between">
                {[
                  { step: 1, title: '目标设备', desc: '设备与标题' },
                  { step: 2, title: '故障分类', desc: '现象与参数' },
                  { step: 3, title: '现场凭证', desc: '影像与防护' },
                  { step: 4, title: 'SLA承诺', desc: '流转与确认' },
                ].map((item, idx, arr) => {
                  const isActive = createStep === item.step;
                  const isDone = createStep > item.step;
                  return (
                    <React.Fragment key={item.step}>
                      <button
                        type="button"
                        onClick={() => setCreateStep(item.step)}
                        className="flex items-center gap-2 text-left cursor-pointer group transition-all"
                      >
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-500/20'
                              : isDone
                              ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                              : 'bg-slate-200 text-slate-600 group-hover:bg-slate-300'
                          }`}
                        >
                          {isDone ? <Check className="w-4 h-4" /> : item.step}
                        </div>
                        <div className="hidden sm:block">
                          <span
                            className={`text-xs font-bold block ${
                              isActive
                                ? 'text-blue-700'
                                : isDone
                                ? 'text-emerald-700'
                                : 'text-slate-600'
                            }`}
                          >
                            {item.title}
                          </span>
                          <span className="text-[10px] text-slate-500 block">{item.desc}</span>
                        </div>
                      </button>
                      {idx < arr.length - 1 && (
                        <div
                          className={`flex-1 h-[2px] mx-3 transition-colors ${
                            createStep > idx + 1 ? 'bg-emerald-400' : 'bg-slate-200'
                          }`}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Wizard Body (Scrollable) */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {/* 防重复报单智能拦截提示框 */}
              {duplicateAlert && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2 animate-in fade-in">
                  <div className="flex items-center space-x-2 text-rose-700 font-bold text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>防重复报单保护已触发 (15分钟互斥窗口)</span>
                  </div>
                  <p className="text-xs text-rose-600 leading-relaxed">
                    {duplicateAlert.message}
                  </p>
                  {duplicateAlert.existingOrder && (
                    <div className="bg-white/80 p-2.5 rounded-lg border border-rose-200 text-[11px] space-y-1">
                      <div className="flex justify-between text-slate-600">
                        <span>已有未闭环工单:</span>
                        <span className="font-mono text-blue-600 font-bold">{duplicateAlert.existingOrder.orderNo}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>当前处理状态:</span>
                        <span className="text-amber-600 font-semibold">{duplicateAlert.existingOrder.statusLabel || duplicateAlert.existingOrder.status}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>报单生成时间:</span>
                        <span className="text-slate-500">{duplicateAlert.existingOrder.createdAt}</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-end space-x-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateModal(false);
                        if (duplicateAlert.existingOrder) {
                          const found = workOrders.find((w) => w.id === duplicateAlert.existingOrder.id);
                          if (found) setSelectedOrder(found);
                        }
                        setDuplicateAlert(null);
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded text-xs cursor-pointer"
                    >
                      查看已有工单
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handleForceSubmit}
                      className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {isSubmitting ? '提交中...' : '确认忽略防重，强制提交'}
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 1: 选择目标设备与基本信息 */}
              {createStep === 1 && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl flex items-center space-x-2.5 text-xs text-blue-700">
                    <Info className="w-4 h-4 shrink-0 text-blue-600" />
                    <span>第 1 步：请指定发生异常的工业设备，系统将自动核查该设备的历史维保档案与当前工况。</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      选择报修工业设备 <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={newOrderForm.equipmentId}
                      onChange={(e) => {
                        setNewOrderForm({ ...newOrderForm, equipmentId: e.target.value });
                        setDuplicateAlert(null);
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">请选择设备</option>
                      {equipments.map((eq) => (
                        <option key={eq.id} value={eq.id}>
                          {eq.name} ({eq.code}) · {eq.workshop}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 选定设备信息卡片预览 */}
                  {(() => {
                    const currentEq = equipments.find((e) => e.id === newOrderForm.equipmentId) || equipments[0];
                    if (!currentEq) return null;
                    return (
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <Box className="w-4 h-4 text-blue-600" />
                            {currentEq.name}
                          </span>
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                            {currentEq.code}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-600 pt-1">
                          <div className="bg-white p-2 rounded-lg border border-slate-200">
                            <span className="text-slate-500 block text-[10px]">所属车间</span>
                            <span className="font-semibold text-slate-700">{currentEq.workshop}</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-slate-200">
                            <span className="text-slate-500 block text-[10px]">运行状态</span>
                            <span className="font-semibold text-emerald-600 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              {currentEq.status === 'running' ? '在网运行' : currentEq.status}
                            </span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-slate-200">
                            <span className="text-slate-500 block text-[10px]">健康度指数</span>
                            <span className="font-mono font-bold text-blue-600">
                              {currentEq.healthScore || 92}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      工单标题 / 故障主旨摘要 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="例如: 1#主驱动减速箱输出轴剧烈振动伴随异响紧急排查"
                      value={newOrderForm.title}
                      onChange={(e) => setNewOrderForm({ ...newOrderForm, title: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: 故障现象与图形化分类选择器 */}
              {createStep === 2 && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl flex items-center space-x-2.5 text-xs text-blue-700">
                    <Info className="w-4 h-4 shrink-0 text-blue-600" />
                    <span>第 2 步：点击下方 6 宫格卡片选择故障主分类，并填写现场异常征兆。</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      故障机理图形化分类选择器 <span className="text-rose-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {[
                        { type: '机械振动', icon: Activity, color: 'text-blue-600', desc: '动平衡失衡 / 联轴器不对中 / 松动' },
                        { type: '轴承过热', icon: Flame, color: 'text-rose-600', desc: '温升超标 >75℃ / 润滑失效' },
                        { type: '密封泄漏', icon: Droplets, color: 'text-cyan-600', desc: '机械密封渗漏 / 动静环磨损' },
                        { type: '电气短路', icon: Zap, color: 'text-amber-600', desc: '绝缘击穿 / 变频过流 / 接地异常' },
                        { type: '结构磨损', icon: Wrench, color: 'text-purple-600', desc: '齿轮点蚀剥落 / 壳体疲劳裂纹' },
                        { type: '定期润滑维保', icon: ShieldCheck, color: 'text-emerald-600', desc: '油脂加注置换 / 周期性预知维保' },
                      ].map((item) => {
                        const isSelected = newOrderForm.faultType === item.type;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.type}
                            type="button"
                            onClick={() => setNewOrderForm({ ...newOrderForm, faultType: item.type as any })}
                            className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                              isSelected
                                ? 'bg-blue-50/90 border-blue-500 ring-2 ring-blue-500/20 shadow-xs'
                                : 'bg-white hover:bg-slate-50 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className={`p-1.5 rounded-lg ${isSelected ? 'bg-white shadow-xs' : 'bg-slate-100'} ${item.color}`}>
                                <Icon className="w-4 h-4" />
                              </div>
                              {isSelected && (
                                <span className="w-2 h-2 rounded-full bg-blue-600" />
                              )}
                            </div>
                            <div>
                              <span className={`text-xs font-bold block ${isSelected ? 'text-blue-800' : 'text-slate-800'}`}>
                                {item.type}
                              </span>
                              <span className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{item.desc}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      优先级时效级别
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'urgent', label: '🔴 紧急抢修', sub: '15分钟响应', color: 'border-rose-300 bg-rose-50/60 text-rose-800' },
                        { id: 'high', label: '🟠 高优先级', sub: '2小时内响应', color: 'border-orange-300 bg-orange-50/60 text-orange-800' },
                        { id: 'medium', label: '🟡 中优先级', sub: '本日内处置', color: 'border-blue-300 bg-blue-50/60 text-blue-800' },
                        { id: 'low', label: '⚪ 常规维保', sub: '周期计划', color: 'border-slate-300 bg-slate-50 text-slate-700' },
                      ].map((p) => {
                        const isSelected = newOrderForm.priority === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setNewOrderForm({ ...newOrderForm, priority: p.id as any })}
                            className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                              isSelected
                                ? `${p.color} ring-2 ring-blue-500/30 font-bold shadow-xs`
                                : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-600'
                            }`}
                          >
                            <span className="text-xs block">{p.label}</span>
                            <span className="text-[10px] text-slate-500 block">{p.sub}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      现场故障现象与异常参数详细描述 <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      rows={3}
                      required
                      placeholder="详细记录异响、振动有效值(mm/s)、测温读数(℃)、漏油滴速等现场异常..."
                      value={newOrderForm.description}
                      onChange={(e) => setNewOrderForm({ ...newOrderForm, description: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: 现场影像凭证与安全要求 */}
              {createStep === 3 && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl flex items-center space-x-2.5 text-xs text-blue-700">
                    <Info className="w-4 h-4 shrink-0 text-blue-600" />
                    <span>第 3 步：上传现场照片或视频凭证，配置强制性安全与 LOTO 挂牌防护要求。</span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Camera className="w-4 h-4 text-blue-600" />
                        现场照片 / 影像证据清单
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowVideoModal(true)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer bg-blue-50 px-2 py-1 rounded-lg border border-blue-200"
                      >
                        <Video className="w-3.5 h-3.5" />
                        <span>AI 视频多模态智能分析诊断</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {evidenceFiles.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                        >
                          <div className="flex items-center space-x-2.5">
                            <div className="w-8 h-8 rounded-lg bg-blue-100/70 text-blue-700 flex items-center justify-center shrink-0">
                              {f.type === 'video' ? <Video className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800 block">{f.name}</span>
                              <span className="text-[10px] text-slate-500">{f.size} · {f.time} · 校验通过</span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <button
                              type="button"
                              onClick={() => alert(`查看凭证预览：${f.name}`)}
                              className="p-1 text-slate-500 hover:text-blue-600 cursor-pointer"
                              title="预览"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEvidenceFiles(evidenceFiles.filter((x) => x.id !== f.id))}
                              className="p-1 text-slate-500 hover:text-rose-600 cursor-pointer"
                              title="移除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() => {
                          const id = `ev-${Date.now()}`;
                          setEvidenceFiles([
                            ...evidenceFiles,
                            { id, name: `现场补充测点拍照_${evidenceFiles.length + 1}.jpg`, size: '2.1 MB', time: '刚刚', type: 'image' },
                          ]);
                        }}
                        className="w-full py-2.5 border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl text-xs text-slate-600 hover:text-blue-600 flex items-center justify-center gap-1.5 cursor-pointer bg-slate-50/50 hover:bg-blue-50/30 transition-colors"
                      >
                        <Upload className="w-4 h-4" />
                        <span>+ 点击或拖拽上传新现场凭证 (支持 JPEG / PNG / MP4)</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-amber-600" />
                      强制性安全与 LOTO 挂牌防护配置
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        '穿戴绝缘劳保鞋与安全帽',
                        '实施 LOTO 停电挂牌上锁',
                        '释放管路介质残余压力并戴护目镜',
                        '确认转动部件完全静止并挂隔离带',
                      ].map((item) => {
                        const checked = newOrderForm.safetyRequirements.includes(item);
                        return (
                          <label
                            key={item}
                            className={`p-2.5 rounded-xl border flex items-center space-x-2.5 text-xs cursor-pointer transition-all ${
                              checked
                                ? 'bg-blue-50/60 border-blue-300 text-blue-900 font-medium'
                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setNewOrderForm({
                                    ...newOrderForm,
                                    safetyRequirements: [...newOrderForm.safetyRequirements, item],
                                  });
                                } else {
                                  setNewOrderForm({
                                    ...newOrderForm,
                                    safetyRequirements: newOrderForm.safetyRequirements.filter((s) => s !== item),
                                  });
                                }
                              }}
                              className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span>{item}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4: 报修进度 SLA 时间线预览与确认提交 */}
              {createStep === 4 && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center space-x-2.5 text-xs text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                    <span>第 4 步：核对报修单摘要与动态 SLA 承诺时效，确认无误后提交派单池。</span>
                  </div>

                  {/* 工单核验摘要 */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="text-xs font-bold text-slate-800">工单预审核验卡片</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono font-bold border border-blue-200">
                        {newOrderForm.priority === 'urgent' ? '🔴 紧急抢修SLA' : '🟠 标准维保SLA'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-slate-500 block text-[10px]">工单标题</span>
                        <span className="font-semibold text-slate-800 line-clamp-1">{newOrderForm.title || '(未填写标题)'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">报修设备</span>
                        <span className="font-semibold text-slate-800">
                          {equipments.find((e) => e.id === newOrderForm.equipmentId)?.name || '未选设备'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">故障机理</span>
                        <span className="font-semibold text-blue-700">{newOrderForm.faultType}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">现场影像凭证</span>
                        <span className="font-semibold text-emerald-700">{evidenceFiles.length} 份影像证据就绪</span>
                      </div>
                    </div>
                  </div>

                  {/* 报修进度 SLA 时间线预览 */}
                  <div className="p-3.5 bg-white border border-blue-200 rounded-xl space-y-2.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-blue-600" />
                        全周期 SLA 时效承诺动态流转时间线
                      </span>
                      <span className="text-[10px] text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
                        工业服务标准协议
                      </span>
                    </div>

                    <div className="relative pl-6 space-y-3 pt-1">
                      {/* Timeline line */}
                      <div className="absolute left-2.5 top-2.5 bottom-2.5 w-[2px] bg-blue-200" />

                      {[
                        { time: 'T + 00m', title: '故障报单入库', desc: '系统防重校验通过，写入中心工单池与通知广播', state: 'current' },
                        {
                          time: newOrderForm.priority === 'urgent' ? 'T + 15m' : 'T + 30m',
                          title: '智能派单响应',
                          desc: '主管派工或 AI 技能负载推荐指派责任技师',
                          state: 'future',
                        },
                        {
                          time: newOrderForm.priority === 'urgent' ? 'T + 30m' : 'T + 60m',
                          title: '现场技师接单',
                          desc: '技师响应签到，领用备件与工具包，实施 LOTO 停电挂牌',
                          state: 'future',
                        },
                        {
                          time: newOrderForm.priority === 'urgent' ? 'T + 2h00m' : 'T + 4h00m',
                          title: '现场消缺处理',
                          desc: '故障排查与备品备件换装，记录检修日志',
                          state: 'future',
                        },
                        {
                          time: newOrderForm.priority === 'urgent' ? 'T + 3h00m' : 'T + 6h00m',
                          title: '质检动态验收',
                          desc: '满载运行测试、通义千问作业合规审计与验收归档',
                          state: 'future',
                        },
                      ].map((item, i) => (
                        <div key={i} className="relative flex items-start gap-2.5 text-xs">
                          <div
                            className={`w-3 h-3 rounded-full shrink-0 mt-0.5 border-2 ${
                              item.state === 'current'
                                ? 'bg-blue-600 border-white ring-2 ring-blue-500/30'
                                : 'bg-white border-blue-400'
                            }`}
                          />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-800">{item.title}</span>
                              <span className="font-mono text-[10px] text-blue-600 font-semibold bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                                {item.time}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer with Step Navigation */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/60 space-y-2">
              {createFormError && (
                <p role="alert" className="text-xs text-rose-600 font-medium">
                  {createFormError}
                </p>
              )}
              <div className="flex items-center justify-between">
              <div>
                {createStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setCreateStep(createStep - 1)}
                    className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center space-x-1 cursor-pointer transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>上一步</span>
                  </button>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateStep(1);
                    setDuplicateAlert(null);
                  }}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 rounded-lg text-xs cursor-pointer transition-colors"
                >
                  取消
                </button>

                {createStep < 4 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (createStep === 1 && !newOrderForm.title.trim()) {
                        alert('请先输入工单标题/摘要');
                        return;
                      }
                      setCreateStep(createStep + 1);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1 cursor-pointer transition-all shadow-xs"
                  >
                    <span>下一步</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 transition-all shadow-xs flex items-center space-x-1.5"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>提交中...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>确认提交派单池</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Dispatch Order */}
      {showDispatchModal && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-100">主管派发工单</h3>

            {/* AI 辅助派单 (功能 9) */}
            <div className="space-y-2">
              <button
                onClick={handleRecommendAssignee}
                disabled={recState.loading}
                className="w-full py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50 transition-all"
              >
                {recState.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                <span>{recState.loading ? 'AI 分析技师技能与负载中...' : 'AI 推荐派单 (技能/负载/历史经验)'}</span>
              </button>
              {recState.error && (
                <div className="p-2 rounded-lg bg-rose-950/50 border border-rose-500/40 text-[11px] text-rose-300">
                  {recState.degraded ? '⚠️ ' : ''}{recState.error}
                </div>
              )}
              {recState.data?.recommended && (
                <div className="p-3 rounded-lg bg-cyan-950/30 border border-cyan-500/40 space-y-1.5 text-[11px]">
                  <div className="text-cyan-200 font-semibold">
                    AI 推荐: {recState.data.recommended.name}
                    {recState.data.estimatedHours ? ` · 预估 ${recState.data.estimatedHours}h` : ''}
                    {recState.data.suggestedPriority ? ` · 建议优先级 ${recState.data.suggestedPriority}` : ''}
                  </div>
                  <p className="text-slate-300 leading-relaxed">{recState.data.recommended.reason}</p>
                  {recState.data.alternatives?.length > 0 && (
                    <p className="text-slate-500">
                      备选: {recState.data.alternatives.map((a: any) => `${a.name} (${a.reason})`).join('；')}
                    </p>
                  )}
                  <button
                    onClick={applyRecommendation}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[11px] font-semibold cursor-pointer"
                  >
                    采纳推荐 (自动填充主修人与工时)
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">指派负责维保技师</label>
                <select
                  value={dispatchForm.assigneeId}
                  onChange={(e) => setDispatchForm({ ...dispatchForm, assigneeId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  {allUsers.filter((u) => u.role === 'technician' || u.role === 'admin').map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} - {u.roleTitle}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 mb-1">预计检修工时 (小时)</label>
                <input
                  type="number"
                  step="0.5"
                  value={dispatchForm.estimatedHours}
                  onChange={(e) => setDispatchForm({ ...dispatchForm, estimatedHours: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowDispatchModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs"
              >
                取消
              </button>
              <button
                onClick={handleDispatchOrder}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                确认派单
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Submit Repair Log */}
      {showRepairLogModal && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-100">填写检修记录与备件耗用</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">根本原因排查分析 *</label>
                <textarea
                  rows={2}
                  placeholder="例如: 拆解发现轴承内圈滚道有点蚀剥落，联轴器对中偏差 0.08mm..."
                  value={repairLogForm.causeAnalysis}
                  onChange={(e) => setRepairLogForm({ ...repairLogForm, causeAnalysis: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                ></textarea>
              </div>

              <div>
                <label className="block text-slate-300 mb-1">具体采取的处理与纠正步骤 *</label>
                <textarea
                  rows={2}
                  placeholder="例如: 1. 更换高精度轴承；2. 激光精密对中；3. 注入 ISO VG 220 齿轮油..."
                  value={repairLogForm.resolutionSteps}
                  onChange={(e) => setRepairLogForm({ ...repairLogForm, resolutionSteps: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                ></textarea>
              </div>

              <div>
                <label className="block text-slate-300 mb-1">实际作业消耗工时 (小时)</label>
                <input
                  type="number"
                  step="0.5"
                  value={repairLogForm.workHours}
                  onChange={(e) => setRepairLogForm({ ...repairLogForm, workHours: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowRepairLogModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs"
              >
                取消
              </button>
              <button
                onClick={handleSubmitRepairLog}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                提交完工报告
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Acceptance */}
      {/* AI 根因分析结果弹窗 (功能 2) */}
      <AiResultModal
        open={rcaState.open}
        title="AI 根因分析报告 (RCA / 5Why / 故障树)"
        loading={rcaState.loading}
        error={rcaState.error}
        degraded={rcaState.degraded}
        data={rcaState.data}
        onClose={() => setRcaState((prev) => ({ ...prev, open: false }))}
      />

      {/* AI 检修方案结果弹窗 (功能 3) */}
      <AiResultModal
        open={planState.open}
        title="AI 检修方案 / 作业指导书"
        loading={planState.loading}
        error={planState.error}
        degraded={planState.degraded}
        pendingReview={!!planState.reviewId}
        data={planState.data}
        onClose={() => setPlanState((prev) => ({ ...prev, open: false }))}
      />

      {showAcceptanceModal && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-100">检修质量复核与验收归档</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">检修质量评分 (1 - 5 星)</label>
                <div className="flex items-center space-x-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setAcceptanceForm({ ...acceptanceForm, score: star })}
                      className="p-1 text-amber-400 hover:scale-110 transition-transform cursor-pointer"
                    >
                      <Star
                        className={`w-6 h-6 ${star <= acceptanceForm.score ? 'fill-current' : 'text-slate-600'}`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1">验收评语与试车结论 *</label>
                <textarea
                  rows={3}
                  value={acceptanceForm.comment}
                  onChange={(e) => setAcceptanceForm({ ...acceptanceForm, comment: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                ></textarea>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowAcceptanceModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs"
              >
                取消
              </button>
              <button
                onClick={handleAcceptanceSubmit}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                签署验收并归档
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 视频智能诊断模态框 (功能二) */}
      <VideoAnalysisModal
        isOpen={showVideoModal}
        onClose={() => setShowVideoModal(false)}
        equipments={equipments}
        onApplyToWorkOrder={handleApplyVideoResult}
      />

      {/* 工单转安全隐患模态框 (功能四) */}
      {convertHazardModalOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-slate-100 flex items-center">
                <AlertTriangle className="w-5 h-5 mr-2 text-rose-400" />
                转为现场安全隐患督办
              </h3>
              <button
                onClick={() => setConvertHazardModalOpen(false)}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">隐患标题 *</label>
                <input
                  type="text"
                  required
                  value={convertHazardTitle}
                  onChange={(e) => setConvertHazardTitle(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">隐患危害等级 *</label>
                <select
                  value={convertHazardLevel}
                  onChange={(e) => setConvertHazardLevel(e.target.value as any)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  <option value="general">一般隐患 (限期班组消缺)</option>
                  <option value="major">重大隐患 (厂级督办置顶)</option>
                </select>
              </div>

              <div className="p-3 bg-slate-800/80 rounded-xl space-y-1 text-slate-500">
                <div>关联设备: {selectedOrder.equipmentName} ({selectedOrder.equipmentCode})</div>
                <div>所属区域: {selectedOrder.workshop}</div>
                <div>来源于工单: {selectedOrder.orderNo}</div>
              </div>

              {convertHazardNotice && (
                <div className={`p-2 rounded-lg text-xs ${
                  convertHazardNotice.startsWith('✅') ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30' : 'bg-rose-950/60 text-rose-300 border border-rose-500/30'
                }`}>
                  {convertHazardNotice}
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setConvertHazardModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConvertToHazard}
                  disabled={convertHazardSubmitting}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {convertHazardSubmitting ? '正在提交...' : '确认立项督办'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 现场备件领用弹窗 (功能三：备件库存实时联动) */}
      {showSpareModal && selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleClaimSparePart}
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-slate-100 flex items-center">
                <Package className="w-5 h-5 mr-2 text-amber-400" />
                现场备件快速领用出库
              </h3>
              <button
                type="button"
                onClick={() => setShowSpareModal(false)}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">选择领用备件 *</label>
                <select
                  value={claimPartId}
                  onChange={(e) => setClaimPartId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 text-xs"
                >
                  {availableSpareParts.map((p) => {
                    const currentStock = p.stockQuantity ?? p.stock;
                    const safeStock = p.safeQuantity ?? p.safe_stock;
                    const isLow = currentStock <= safeStock;
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} [{p.code || p.spec || p.specification || '工业件'}] - 库存: {currentStock} {p.unit} {isLow ? '(低库存预警)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-medium">领用数量 *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={claimQuantity}
                    onChange={(e) => setClaimQuantity(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1 font-medium">领用责任人</label>
                  <input
                    type="text"
                    disabled
                    value={`${currentUser.name} (${currentUser.roleTitle})`}
                    className="w-full bg-slate-800/60 border border-slate-700 text-slate-500 rounded-lg px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">领用用途与位置备注</label>
                <input
                  type="text"
                  placeholder={`工单 ${selectedOrder.orderNo} 现场检修备件更换`}
                  value={claimNotes}
                  onChange={(e) => setClaimNotes(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 text-xs"
                />
              </div>

              <div className="p-3 bg-slate-800/80 rounded-xl space-y-1 text-slate-500 text-[11px]">
                <div>关联工单: <span className="text-cyan-400 font-mono font-bold">{selectedOrder.orderNo}</span></div>
                <div>目标设备: {selectedOrder.equipmentName} ({selectedOrder.equipmentCode})</div>
                <div className="text-amber-300/90 font-medium">提示：确认后将真实扣减仓库库存并生成出库台账流水。</div>
              </div>

              {claimNotice && (
                <div className={`p-2 rounded-lg text-xs ${
                  claimNotice.type === 'success'
                    ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-950/60 text-rose-300 border border-rose-500/30'
                }`}>
                  {claimNotice.message}
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSpareModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs hover:bg-slate-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={claimSubmitting}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {claimSubmitting ? '正在出库...' : '确认领用并核扣库存'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
