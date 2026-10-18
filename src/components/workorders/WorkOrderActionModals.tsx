import React, { useState, useEffect } from 'react';
import {
  Loader2,
  UserCheck,
  AlertTriangle,
  Package,
  X,
} from 'lucide-react';
import { AcceptancePanel } from './AcceptancePanel';
import {
  WorkOrder,
  UserProfile,
  SparePart,
  SparePartUsage,
} from '../../types';
import {
  workOrderApi,
  aiApi,
  hazardsApi,
  sparePartsApi,
  AiAssigneeRecommendation,
} from '../../api';
import { useToast } from '../../context/ToastContext';

// ── 1. Dispatch Modal ────────────────────────────────────────────────────────
interface DispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: WorkOrder | null;
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onSuccess: (updated: WorkOrder) => void;
}

export const DispatchModal: React.FC<DispatchModalProps> = ({
  isOpen,
  onClose,
  order,
  currentUser,
  allUsers,
  onSuccess,
}) => {
  const { show: showToast } = useToast();
  const [dispatchForm, setDispatchForm] = useState({
    assigneeId: 'u-tech',
    estimatedHours: 3.5,
    dispatcherNote: '',
  });
  const [recState, setRecState] = useState<{
    loading: boolean;
    error: string | null;
    degraded?: boolean;
    data?: AiAssigneeRecommendation | null;
  }>({ loading: false, error: null });

  if (!isOpen || !order) return null;

  const handleRecommendAssignee = async () => {
    setRecState({ loading: true, error: null });
    try {
      const res = await aiApi.recommendAssignee({
        equipmentId: order.equipmentId,
        faultDescription: order.description || order.title,
        priority: order.priority,
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

  const handleDispatchOrder = async () => {
    const targetTech = allUsers.find((u) => u.id === dispatchForm.assigneeId) || allUsers[1];
    try {
      const updated = await workOrderApi.dispatch(order.id, {
        assigneeId: targetTech.id,
        assigneeName: targetTech.name,
        dispatcher: `${currentUser.name} (${currentUser.roleTitle})`,
        estimatedHours: dispatchForm.estimatedHours,
        version: order.version,
      });
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      const msg = err.data?.message || err.message || '派单失败';
      showToast({ type: 'warning', title: '状态互斥拦截', message: msg });
    }
  };

  return (
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
              {recState.data.alternatives && recState.data.alternatives.length > 0 && (
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
            onClick={onClose}
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
  );
};

// ── 2. Repair Log Modal ───────────────────────────────────────────────────────
interface RepairLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: WorkOrder | null;
  currentUser: UserProfile;
  onSuccess: (updated: WorkOrder) => void;
}

export const RepairLogModal: React.FC<RepairLogModalProps> = ({
  isOpen,
  onClose,
  order,
  currentUser,
  onSuccess,
}) => {
  const { show: showToast } = useToast();
  const [repairLogForm, setRepairLogForm] = useState({
    causeAnalysis: '',
    resolutionSteps: '',
    workHours: 3.0,
    parts: [
      { id: 'p1', name: '调心滚子轴承', code: 'SKF 22324', spec: '标准件', qty: 1, unit: '套', unitPrice: 2800 },
    ] as SparePartUsage[],
    remark: '',
  });

  if (!isOpen || !order) return null;

  const handleSubmitRepairLog = async () => {
    try {
      const updated = await workOrderApi.complete(order.id, {
        causeAnalysis: repairLogForm.causeAnalysis || '轴承疲劳微剥落并伴随同轴度偏差。',
        resolutionSteps: repairLogForm.resolutionSteps || '完成轴承更换、激光对中复测与新润滑脂加注。',
        partsUsed: repairLogForm.parts,
        workHours: repairLogForm.workHours,
        completionPhotos: [],
        remark: repairLogForm.remark,
        operatorName: `${currentUser.name} (${currentUser.roleTitle})`,
        version: order.version,
      });
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      const msg = err.data?.message || err.message || '完工上报失败';
      showToast({ type: 'warning', title: '状态互斥拦截', message: msg });
    }
  };

  return (
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
            />
          </div>

          <div>
            <label className="block text-slate-300 mb-1">具体采取的处理与纠正步骤 *</label>
            <textarea
              rows={2}
              placeholder="例如: 1. 更换高精度轴承；2. 激光精密对中；3. 注入 ISO VG 220 齿轮油..."
              value={repairLogForm.resolutionSteps}
              onChange={(e) => setRepairLogForm({ ...repairLogForm, resolutionSteps: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
            />
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
            onClick={onClose}
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
  );
};

// ── 3. Acceptance Modal ───────────────────────────────────────────────────────
// 修后验收已升级为完整闭环（验收清单 / 修前修后对比 / 双签字关单 / 维修总结沉淀），
// 由 AcceptancePanel 承载。旧的"打星 + 评语"表单只写 acceptance 字段、不推进状态，
// 会让工单停在「待验收」却显示已签评语，因此整体替换而不是并存。
interface AcceptanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: WorkOrder | null;
  currentUser: UserProfile;
  onSuccess: (updated: WorkOrder) => void;
}

export const AcceptanceModal: React.FC<AcceptanceModalProps> = ({
  isOpen,
  onClose,
  order,
  currentUser,
  onSuccess,
}) => {
  if (!isOpen || !order) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">修后验收与效果验证</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
              {order.orderNo} · {order.equipmentName} · {order.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 h-11 min-h-[44px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
          >
            关闭
          </button>
        </div>
        <div className="px-4 py-4">
          <AcceptancePanel
            orderId={order.id}
            currentUser={currentUser}
            onClosed={async () => {
              // 关单后回读真实工单，把 completed 状态同步回列表/抽屉（不本地猜状态）
              try {
                const fresh = await workOrderApi.getById(order.id);
                onSuccess(fresh);
              } catch {
                /* 回读失败不影响关单本身，父级刷新时会再取 */
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};

// ── 4. Convert Hazard Modal ───────────────────────────────────────────────────
interface ConvertHazardModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: WorkOrder | null;
  currentUser: UserProfile;
}

export const ConvertHazardModal: React.FC<ConvertHazardModalProps> = ({
  isOpen,
  onClose,
  order,
  currentUser,
}) => {
  const [convertHazardTitle, setConvertHazardTitle] = useState('');
  const [convertHazardLevel, setConvertHazardLevel] = useState<'general' | 'major'>('general');
  const [convertHazardNotice, setConvertHazardNotice] = useState<string | null>(null);
  const [convertHazardSubmitting, setConvertHazardSubmitting] = useState(false);

  useEffect(() => {
    if (order) {
      setConvertHazardTitle(`[工单 ${order.orderNo} 衍生隐患] ${order.title}`);
      setConvertHazardLevel(order.priority === 'urgent' ? 'major' : 'general');
      setConvertHazardNotice(null);
    }
  }, [order?.id]);

  if (!isOpen || !order) return null;

  const handleConvertToHazard = async () => {
    if (!convertHazardTitle) return;
    setConvertHazardSubmitting(true);
    setConvertHazardNotice(null);
    try {
      const created = await hazardsApi.create({
        code: `HAZ-WO-${Date.now().toString().slice(-5)}`,
        title: convertHazardTitle,
        level: convertHazardLevel,
        equipment_id: order.equipmentId,
        equipment_name: order.equipmentName,
        location: order.workshop,
        description: `来源于工单【${order.orderNo} - ${order.title}】现场转报。现场情况描述：${order.description}`,
        reported_by: currentUser.name,
        discoverer: currentUser.name,
        related_work_order_id: order.id,
      } as any);
      setConvertHazardNotice(`✅ 成功立项安全隐患 ${created.hazardNo || created.code || created.id}，已纳入重大隐患闭环治理中枢！`);
      setTimeout(() => {
        onClose();
        setConvertHazardNotice(null);
      }, 2000);
    } catch (err: any) {
      setConvertHazardNotice(`❌ 转报失败: ${err?.message || '网络或接口异常'}`);
    } finally {
      setConvertHazardSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-base font-bold text-slate-100 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 text-rose-400" />
            转为现场安全隐患督办
          </h3>
          <button
            onClick={onClose}
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
            <div>关联设备: {order.equipmentName} ({order.equipmentCode})</div>
            <div>所属区域: {order.workshop}</div>
            <div>来源于工单: {order.orderNo}</div>
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
              onClick={onClose}
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
  );
};

// ── 5. Claim Spare Part Modal ─────────────────────────────────────────────────
interface ClaimSparePartModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: WorkOrder | null;
  currentUser: UserProfile;
  onMovementAdded: (movement: any) => void;
}

export const ClaimSparePartModal: React.FC<ClaimSparePartModalProps> = ({
  isOpen,
  onClose,
  order,
  currentUser,
  onMovementAdded,
}) => {
  const [availableSpareParts, setAvailableSpareParts] = useState<SparePart[]>([]);
  const [claimPartId, setClaimPartId] = useState('');
  const [claimQuantity, setClaimQuantity] = useState(1);
  const [claimNotes, setClaimNotes] = useState('');
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimNotice, setClaimNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (order) {
      setClaimNotice(null);
      sparePartsApi
        .list()
        .then((parts) => {
          setAvailableSpareParts(parts);
          if (parts.length > 0 && !claimPartId) setClaimPartId(parts[0].id);
        })
        .catch(console.error);
    }
  }, [order?.id]);

  if (!isOpen || !order) return null;

  const handleClaimSparePart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimPartId || claimQuantity <= 0) return;
    setClaimSubmitting(true);
    setClaimNotice(null);
    try {
      const part = availableSpareParts.find((p) => p.id === claimPartId);
      const res = await sparePartsApi.inOut(claimPartId, {
        type: 'out',
        quantity: claimQuantity,
        operatorName: currentUser.name,
        relatedWorkOrderId: order.id,
        notes: claimNotes || `工单 ${order.orderNo} 检修现场快速领用`,
      });
      if (res.success) {
        setClaimNotice({
          type: 'success',
          message: `备件【${part?.name || claimPartId}】${claimQuantity}件领用成功！实时库存已扣减至：${res.part.stockQuantity ?? res.part.stock} ${res.part.unit}`,
        });
        setAvailableSpareParts((prev) => prev.map((p) => (p.id === claimPartId ? res.part : p)));
        onMovementAdded({
          id: res.movement?.id || Date.now().toString(),
          partName: part?.name || '工业备件',
          spec: part?.spec || part?.specification || '标准件',
          quantity: claimQuantity,
          unit: part?.unit || '件',
          operator: currentUser.name,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        });
        setTimeout(() => {
          onClose();
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

  return (
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
            onClick={onClose}
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
              placeholder={`工单 ${order.orderNo} 现场检修备件更换`}
              value={claimNotes}
              onChange={(e) => setClaimNotes(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 text-xs"
            />
          </div>

          <div className="p-3 bg-slate-800/80 rounded-xl space-y-1 text-slate-500 text-[11px]">
            <div>关联工单: <span className="text-cyan-400 font-mono font-bold">{order.orderNo}</span></div>
            <div>目标设备: {order.equipmentName} ({order.equipmentCode})</div>
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
              onClick={onClose}
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
  );
};

// ── Composite Container Component ─────────────────────────────────────────────
export interface WorkOrderActionModalsProps {
  order: WorkOrder | null;
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onOrderUpdated: (updated: WorkOrder) => void;
  // Modal visibility controls
  showDispatchModal: boolean;
  onCloseDispatch: () => void;
  showRepairLogModal: boolean;
  onCloseRepairLog: () => void;
  showAcceptanceModal: boolean;
  onCloseAcceptance: () => void;
  convertHazardModalOpen: boolean;
  onCloseConvertHazard: () => void;
  showSpareModal: boolean;
  onCloseSpareModal: () => void;
  onSpareMovementAdded: (movement: any) => void;
}

export const WorkOrderActionModals: React.FC<WorkOrderActionModalsProps> = ({
  order,
  currentUser,
  allUsers,
  onOrderUpdated,
  showDispatchModal,
  onCloseDispatch,
  showRepairLogModal,
  onCloseRepairLog,
  showAcceptanceModal,
  onCloseAcceptance,
  convertHazardModalOpen,
  onCloseConvertHazard,
  showSpareModal,
  onCloseSpareModal,
  onSpareMovementAdded,
}) => {
  return (
    <>
      <DispatchModal
        isOpen={showDispatchModal}
        onClose={onCloseDispatch}
        order={order}
        currentUser={currentUser}
        allUsers={allUsers}
        onSuccess={onOrderUpdated}
      />
      <RepairLogModal
        isOpen={showRepairLogModal}
        onClose={onCloseRepairLog}
        order={order}
        currentUser={currentUser}
        onSuccess={onOrderUpdated}
      />
      <AcceptanceModal
        isOpen={showAcceptanceModal}
        onClose={onCloseAcceptance}
        order={order}
        currentUser={currentUser}
        onSuccess={onOrderUpdated}
      />
      <ConvertHazardModal
        isOpen={convertHazardModalOpen}
        onClose={onCloseConvertHazard}
        order={order}
        currentUser={currentUser}
      />
      <ClaimSparePartModal
        isOpen={showSpareModal}
        onClose={onCloseSpareModal}
        order={order}
        currentUser={currentUser}
        onMovementAdded={onSpareMovementAdded}
      />
    </>
  );
};
