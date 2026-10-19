import React, { useState } from 'react';
import {
  Wrench,
  X,
  Check,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Camera,
  Video,
  ShieldAlert,
  ShieldCheck,
  Box,
  Activity,
  Flame,
  Zap,
  Droplets,
  Upload,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Eye,
  Info,
  Loader2,
} from 'lucide-react';
import {
  WorkOrder,
  WorkOrderPriority,
  Equipment,
  UserProfile,
} from '../../types';
import { workOrderApi, ApiError } from '../../api';
import { useToast } from '../../context/ToastContext';

export interface EvidenceFile {
  id: string;
  name: string;
  size: string;
  time: string;
  type: 'image' | 'video';
}

export interface NewWorkOrderFormData {
  title: string;
  equipmentId: string;
  faultType: any;
  priority: WorkOrderPriority;
  description: string;
  safetyRequirements: string[];
}

export interface WorkOrderCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  equipments: Equipment[];
  workOrders: WorkOrder[];
  onCreateWorkOrder: (wo: WorkOrder) => void;
  onSelectExistingOrder?: (order: WorkOrder) => void;
  onOpenVideoModal: () => void;
  step: number;
  onStepChange: (step: number) => void;
  formData: NewWorkOrderFormData;
  onFormDataChange: React.Dispatch<React.SetStateAction<NewWorkOrderFormData>>;
  evidenceFiles: EvidenceFile[];
  onEvidenceFilesChange: React.Dispatch<React.SetStateAction<EvidenceFile[]>>;
}

export const WorkOrderCreateModal: React.FC<WorkOrderCreateModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  equipments,
  workOrders,
  onCreateWorkOrder,
  onSelectExistingOrder,
  onOpenVideoModal,
  step,
  onStepChange,
  formData,
  onFormDataChange,
  evidenceFiles,
  onEvidenceFilesChange,
}) => {
  const { show: showToast } = useToast();
  const [duplicateAlert, setDuplicateAlert] = useState<{ message: string; existingOrder?: any } | null>(null);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const resetForm = () => {
    onStepChange(1);
    setDuplicateAlert(null);
    setCreateFormError(null);
    onFormDataChange({
      title: '',
      equipmentId: equipments[0]?.id || '',
      faultType: '机械振动',
      priority: 'high',
      description: '',
      safetyRequirements: ['穿戴劳保鞋与安全帽', '实施 LOTO 停电挂牌'],
    });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: string[] = [];
    if (!formData.equipmentId) missing.push('请选择报修设备');
    if (!formData.description?.trim()) missing.push('请填写故障描述');
    if (missing.length > 0) {
      setCreateFormError(missing.join('；'));
      return;
    }
    const targetEq = equipments.find((eq) => eq.id === formData.equipmentId) || equipments[0];
    if (!targetEq) {
      setCreateFormError('请选择报修设备');
      return;
    }
    setIsSubmitting(true);
    setDuplicateAlert(null);
    setCreateFormError(null);

    try {
      const created = await workOrderApi.create({
        title: formData.title,
        equipmentId: targetEq.id,
        faultType: formData.faultType,
        priority: formData.priority,
        description: formData.description,
        safetyRequirements: formData.safetyRequirements,
        creator: `${currentUser.name} (${currentUser.roleTitle})`,
        forceSubmit: false,
      });

      onCreateWorkOrder(created);
      onClose();
      resetForm();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.data.code === 'DUPLICATE_WORK_ORDER') {
        setDuplicateAlert({
          message: err.data.message || '检测到该设备在15分钟内已存在处理中的同类工单',
          existingOrder: err.data.existingOrder,
        });
      } else {
        showToast({ type: 'error', title: '创建工单失败', message: err.message || '请检查网络或参数' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForceSubmit = async () => {
    const targetEq = equipments.find((eq) => eq.id === formData.equipmentId) || equipments[0];
    setIsSubmitting(true);
    try {
      const created = await workOrderApi.create({
        title: formData.title,
        equipmentId: targetEq.id,
        faultType: formData.faultType,
        priority: formData.priority,
        description: formData.description,
        safetyRequirements: formData.safetyRequirements,
        creator: `${currentUser.name} (${currentUser.roleTitle})`,
        forceSubmit: true,
      });
      onCreateWorkOrder(created);
      onClose();
      setDuplicateAlert(null);
      resetForm();
    } catch (err: any) {
      showToast({ type: 'error', title: '强制提交失败', message: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
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
              onClose();
              onStepChange(1);
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
              const isActive = step === item.step;
              const isDone = step > item.step;
              return (
                <React.Fragment key={item.step}>
                  <button
                    type="button"
                    onClick={() => onStepChange(item.step)}
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
                        step > idx + 1 ? 'bg-emerald-400' : 'bg-slate-200'
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
                    onClose();
                    if (duplicateAlert.existingOrder && onSelectExistingOrder) {
                      const found = workOrders.find((w) => w.id === duplicateAlert.existingOrder.id);
                      if (found) onSelectExistingOrder(found);
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
          {step === 1 && (
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
                  value={formData.equipmentId}
                  onChange={(e) => {
                    onFormDataChange({ ...formData, equipmentId: e.target.value });
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
                const currentEq = equipments.find((e) => e.id === formData.equipmentId) || equipments[0];
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
                          {typeof currentEq.healthScore === 'number' ? `${currentEq.healthScore}%` : '—'}
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
                  value={formData.title}
                  onChange={(e) => onFormDataChange({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* STEP 2: 故障现象与图形化分类选择器 */}
          {step === 2 && (
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
                    const isSelected = formData.faultType === item.type;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => onFormDataChange({ ...formData, faultType: item.type as any })}
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
                    const isSelected = formData.priority === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onFormDataChange({ ...formData, priority: p.id as any })}
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
                  value={formData.description}
                  onChange={(e) => onFormDataChange({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* STEP 3: 现场影像凭证与安全要求 */}
          {step === 3 && (
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
                    onClick={onOpenVideoModal}
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
                          onClick={() => showToast({ type: 'info', title: '凭证预览', message: f.name })}
                          className="p-1 text-slate-500 hover:text-blue-600 cursor-pointer"
                          title="预览"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEvidenceFilesChange(evidenceFiles.filter((x) => x.id !== f.id))}
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
                      onEvidenceFilesChange([
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
                    const checked = formData.safetyRequirements.includes(item);
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
                              onFormDataChange({
                                ...formData,
                                safetyRequirements: [...formData.safetyRequirements, item],
                              });
                            } else {
                              onFormDataChange({
                                ...formData,
                                safetyRequirements: formData.safetyRequirements.filter((s) => s !== item),
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
          {step === 4 && (
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
                    {formData.priority === 'urgent' ? '🔴 紧急抢修SLA' : '🟠 标准维保SLA'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500 block text-[10px]">工单标题</span>
                    <span className="font-semibold text-slate-800 line-clamp-1">{formData.title || '(未填写标题)'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">报修设备</span>
                    <span className="font-semibold text-slate-800">
                      {equipments.find((e) => e.id === formData.equipmentId)?.name || '未选设备'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">故障机理</span>
                    <span className="font-semibold text-blue-700">{formData.faultType}</span>
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
                  <div className="absolute left-2.5 top-2.5 bottom-2.5 w-[2px] bg-blue-200" />

                  {[
                    { time: 'T + 00m', title: '故障报单入库', desc: '系统防重校验通过，写入中心工单池与通知广播', state: 'current' },
                    {
                      time: formData.priority === 'urgent' ? 'T + 15m' : 'T + 30m',
                      title: '智能派单响应',
                      desc: '主管派工或 AI 技能负载推荐指派责任技师',
                      state: 'future',
                    },
                    {
                      time: formData.priority === 'urgent' ? 'T + 30m' : 'T + 60m',
                      title: '现场技师接单',
                      desc: '技师响应签到，领用备件与工具包，实施 LOTO 停电挂牌',
                      state: 'future',
                    },
                    {
                      time: formData.priority === 'urgent' ? 'T + 2h00m' : 'T + 4h00m',
                      title: '现场消缺处理',
                      desc: '故障排查与备品备件换装，记录检修日志',
                      state: 'future',
                    },
                    {
                      time: formData.priority === 'urgent' ? 'T + 3h00m' : 'T + 6h00m',
                      title: '质检动态验收',
                      desc: '满载运行测试、AI 作业合规审计与验收归档',
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
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => onStepChange(step - 1)}
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
                  onClose();
                  onStepChange(1);
                  setDuplicateAlert(null);
                }}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 rounded-lg text-xs cursor-pointer transition-colors"
              >
                取消
              </button>

              {step < 4 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (step === 1 && !formData.title.trim()) {
                      showToast({ type: 'warning', title: '请先输入工单标题/摘要' });
                      return;
                    }
                    onStepChange(step + 1);
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
  );
};
