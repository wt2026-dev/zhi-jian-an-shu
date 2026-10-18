import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Layers,
  X,
  Clock,
  ShieldAlert,
  FileText,
  Package,
  Plus,
  CheckCircle2,
  Star,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Navigation,
  Send,
  Check,
  Wrench,
} from 'lucide-react';
import {
  WorkOrder,
  Equipment,
  UserProfile,
  ComplianceCheck,
} from '../../types';
import {
  complianceApi,
  aiApi,
  request,
  AiRootCauseAnalysis,
  AiMaintenancePlan,
} from '../../api';
import { AiResultModal } from '../ai/AiResultModal';
import {
  WorkOrderStatusBadge,
  WorkOrderPriorityBadge,
} from './WorkOrderStatusBadge';
import { WorkOrderFieldLogPanel } from './WorkOrderFieldLogPanel';
import { can } from '../../utils/rbac';
import { hasExplodedView } from '../equipment3d/explodedViewFiles';

export interface WorkOrderDetailDrawerProps {
  order: WorkOrder | null;
  onClose: () => void;
  currentUser: UserProfile;
  equipments: Equipment[];
  orderSpareMovements: any[];
  onNavigateTo3D?: (workOrderId: string) => void;
  onNavigateDispatch?: (workOrderId: string) => void;
  openInExploded: (order: WorkOrder) => void;
  onOpenAiDiagnose: (equipment: Equipment) => void;
  onOpenDispatch: () => void;
  onAcceptOrder: () => void;
  onOpenRepairLog: () => void;
  onOpenAcceptance: () => void;
  onOpenConvertHazard: () => void;
  onOpenSpareModal: () => void;
}

export const WorkOrderDetailDrawer: React.FC<WorkOrderDetailDrawerProps> = ({
  order,
  onClose,
  currentUser,
  equipments,
  orderSpareMovements,
  onNavigateTo3D,
  onNavigateDispatch,
  openInExploded,
  onOpenAiDiagnose,
  onOpenDispatch,
  onAcceptOrder,
  onOpenRepairLog,
  onOpenAcceptance,
  onOpenConvertHazard,
  onOpenSpareModal,
}) => {
  const canClaim = can('workOrder:claim', currentUser.role);
  const canComplete = can('workOrder:complete', currentUser.role);
  const canApprove = can('workOrder:approve', currentUser.role);

  // 工单流转时间线状态
  const [logsState, setLogsState] = useState<{ loading: boolean; items: any[] }>({ loading: false, items: [] });

  // AI 作业合规审计报告 (功能三)
  const [complianceRecord, setComplianceRecord] = useState<ComplianceCheck | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);

  // AI 扩展功能状态 (功能 2：根因分析 / 功能 3：检修方案)
  const [rcaState, setRcaState] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    degraded?: boolean;
    data?: AiRootCauseAnalysis | null;
  }>({ open: false, loading: false, error: null });

  const [planState, setPlanState] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    degraded?: boolean;
    reviewId?: string | null;
    data?: AiMaintenancePlan | null;
  }>({ open: false, loading: false, error: null });

  useEffect(() => {
    if (!order) {
      setComplianceRecord(null);
      return;
    }
    setComplianceLoading(true);
    complianceApi
      .getByWorkOrderId(order.id)
      .then((rec) => setComplianceRecord(rec))
      .catch(() => setComplianceRecord(null))
      .finally(() => setComplianceLoading(false));
  }, [order?.id]);

  useEffect(() => {
    if (!order) return;
    setLogsState({ loading: true, items: [] });
    request(`/api/v1/work-orders/${order.id}/logs`)
      .then((logs: any) => setLogsState({ loading: false, items: Array.isArray(logs) ? logs : [] }))
      .catch(() => setLogsState({ loading: false, items: [] }));
  }, [order?.id]);

  const handleRootCauseAnalysis = async () => {
    if (!order) return;
    setRcaState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.rootCauseAnalysis({ workOrderId: order.id });
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
    if (!order) return;
    setPlanState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.generateMaintenancePlan({
        equipmentId: order.equipmentId,
        faultDescription: order.description || order.title,
        workOrderId: order.id,
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

  if (!order) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6">
          {/* Top Modal Bar */}
          <div className="flex items-start justify-between pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  {order.orderNo}
                </span>
                <WorkOrderStatusBadge status={order.status} />
                <WorkOrderPriorityBadge priority={order.priority} />
              </div>
              <h3 className="text-base font-bold text-slate-100 mt-1.5">{order.title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                目标设备: {order.equipmentName} ({order.equipmentCode}) · 所属: {order.workshop}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="workorder-drawer-3d-view"
                onClick={() => {
                  if (onNavigateTo3D) {
                    onNavigateTo3D(order.id);
                  } else {
                    const url = new URL(window.location.href);
                    url.searchParams.set('view', 'equipment_3d');
                    url.searchParams.set('workOrderId', order.id);
                    window.location.href = url.toString();
                  }
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                title="跳转 3D 场景并自动聚焦设备"
              >
                <Boxes className="w-3.5 h-3.5 text-cyan-400" />
                <span>3D 场景查看</span>
              </button>
              {hasExplodedView(order.equipmentId) && (
                <button
                  type="button"
                  data-testid="workorder-drawer-exploded-view"
                  onClick={() => openInExploded(order)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  title="打开该设备的拆解视图，自动定位维修目标零件"
                >
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  <span>拆解视图</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Lifecycle Progress Bar */}
          <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60">
            <span className="text-xs font-semibold text-slate-300 block mb-3">工单闭环处理流水线</span>
            <div className="grid grid-cols-5 gap-2 text-center text-[10px]">
              <div className={`p-2 rounded-lg ${order.status ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}>
                <span className="block font-bold">1. 创建申报</span>
                <span className="text-[9px] text-slate-500 truncate">{order.creator.split(' ')[0]}</span>
              </div>
              <div className={`p-2 rounded-lg ${['dispatched', 'in_progress', 'pending_acceptance', 'completed'].includes(order.status) ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}>
                <span className="block font-bold">2. 派发分配</span>
                <span className="text-[9px] text-slate-500 truncate">{order.assignee || '待派发'}</span>
              </div>
              <div className={`p-2 rounded-lg ${['in_progress', 'pending_acceptance', 'completed'].includes(order.status) ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}>
                <span className="block font-bold">3. 技师接单</span>
                <span className="text-[9px] text-slate-500 truncate">{order.acceptedAt ? '已接单' : '等待接单'}</span>
              </div>
              <div className={`p-2 rounded-lg ${['pending_acceptance', 'completed'].includes(order.status) ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}>
                <span className="block font-bold">4. 检修完工</span>
                <span className="text-[9px] text-slate-500 truncate">{order.completedAt ? '已报完工' : '检修中'}</span>
              </div>
              <div className={`p-2 rounded-lg ${order.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-500'}`}>
                <span className="block font-bold">5. 验收归档</span>
                <span className="text-[9px] text-slate-500 truncate">{order.status === 'completed' ? '已验收' : '待验收'}</span>
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
                          {log.action} {log.previousStatus ? `(${log.previousStatus} → ${log.newStatus})` : ''}
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
              <p className="text-slate-300 leading-relaxed">{order.description}</p>
            </div>

            {order.safetyRequirements && order.safetyRequirements.length > 0 && (
              <div className="bg-rose-950/30 p-4 rounded-xl border border-rose-500/30 space-y-2 text-rose-200">
                <span className="font-semibold flex items-center">
                  <ShieldAlert className="w-4 h-4 mr-1.5 text-rose-400" />
                  强制性安全防护与隔离要求
                </span>
                <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
                  {order.safetyRequirements.map((req, idx) => (
                    <li key={idx}>{req}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 拆解作业终端现场留痕：LOTO / 逐步 / 测量 / 照片 / 自动完工（只读档案回看） */}
          <WorkOrderFieldLogPanel log={order.repairLog?.fieldLog} />

          {/* Repair Log Section (If Filled) */}
          {order.repairLog && (
            <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-3 text-xs">
              <h4 className="font-semibold text-slate-200 flex items-center">
                <FileText className="w-4 h-4 mr-1.5 text-cyan-400" />
                技师检修处理日志与备件消耗清单 (实际耗时: {order.repairLog.workHours}h)
              </h4>

              <div className="space-y-1 text-slate-300">
                <p><strong className="text-slate-500">根本原因分析:</strong> {order.repairLog.causeAnalysis}</p>
                <p><strong className="text-slate-500">具体作业步骤:</strong> {order.repairLog.resolutionSteps}</p>
              </div>

              {order.repairLog.partsUsed && order.repairLog.partsUsed.length > 0 && (
                <div className="pt-2 border-t border-slate-700">
                  <span className="text-[11px] font-semibold text-slate-300 block mb-1.5">更换备件与耗材明细:</span>
                  <div className="space-y-1">
                    {order.repairLog.partsUsed.map((part) => (
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
                onClick={onOpenSpareModal}
                className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-medium flex items-center space-x-1 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ 现场领用备件</span>
              </button>
            </div>

            {orderSpareMovements && orderSpareMovements.length > 0 ? (
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
          {order.acceptance && (
            <div className="bg-emerald-950/30 p-4 rounded-xl border border-emerald-500/30 space-y-2 text-xs text-emerald-200">
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-400" />
                  质量验收评价报告 (验收人: {order.acceptance.inspectorName})
                </span>
                <div className="flex items-center text-amber-400">
                  {Array.from({ length: order.acceptance.score }).map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-current" />
                  ))}
                </div>
              </div>
              <p className="text-slate-300 text-[11px]">{order.acceptance.comment}</p>
              <div className="text-[10px] text-slate-500 font-mono">验收通过签署日期: {order.acceptance.signatureDate}</div>
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
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                      complianceRecord.isCompliant
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
                    className={`text-base font-bold font-mono ${
                      complianceRecord.score >= 85
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
                const eq = equipments.find((e) => e.id === order.equipmentId);
                if (eq) {
                  onClose();
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
              onClick={onOpenConvertHazard}
              className="px-3.5 py-2 text-xs bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-500/40 rounded-lg flex items-center space-x-1.5 cursor-pointer"
              title="发现重大风险或隐患，立即转入隐患排查治理中枢"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <span>转为安全隐患</span>
            </button>

            <div className="flex items-center space-x-2">
              {/* Stage 1 -> 2: Dispatch (Admin/Dispatcher) */}
              {order.status === 'created' && canApprove && onNavigateDispatch && (
                <button
                  onClick={() => onNavigateDispatch(order.id)}
                  className="px-4 py-2 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                  title="打开调度大屏，按距离/空闲/技能推荐在岗师傅"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>就近派单</span>
                </button>
              )}
              {order.status === 'created' && canApprove && (
                <button
                  onClick={onOpenDispatch}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>主管派发工单</span>
                </button>
              )}

              {/* Stage 2 -> 3: Claim / Accept (Technician) */}
              {order.status === 'dispatched' && canClaim && (
                <button
                  onClick={onAcceptOrder}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>技师确认接单</span>
                </button>
              )}

              {/* Stage 3 -> 4: Repair Log / Complete (Technician) */}
              {order.status === 'in_progress' && canComplete && (
                <button
                  onClick={onOpenRepairLog}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>填写检修记录/申请完工</span>
                </button>
              )}

              {/* Stage 4 -> 5: Acceptance (Inspector/Admin) */}
              {order.status === 'pending_acceptance' && canApprove && (
                <button
                  onClick={onOpenAcceptance}
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
    </>
  );
};
