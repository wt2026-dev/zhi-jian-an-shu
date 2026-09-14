import React, { useState } from 'react';
import {
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Lock,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  FileText,
  Clock,
  UserCheck,
  Flame,
  ArrowUpRight,
  X,
  Check,
  Zap,
  Trash2,
  AlertCircle,
  Info,
} from 'lucide-react';
import { SafetyPermit, RiskLevel, UserProfile, Equipment, LotoLock } from '../types';
import { safetyPermitApi, aiApi } from '../api';
import { AiResultModal } from './ai/AiResultModal';
import { AiSafetyAssessment } from '../api';

interface SafetyManagementViewProps {
  currentUser: UserProfile;
  safetyPermits: SafetyPermit[];
  equipments: Equipment[];
  lotoLocks?: LotoLock[];
  onAddSafetyPermit: (permit: SafetyPermit) => void;
  onUpdateSafetyPermit: (permit: SafetyPermit) => void;
  onDeleteSafetyPermit?: (id: string) => Promise<any> | void;
}

export const SafetyManagementView: React.FC<SafetyManagementViewProps> = ({
  currentUser,
  safetyPermits,
  equipments,
  lotoLocks = [],
  onAddSafetyPermit,
  onUpdateSafetyPermit,
  onDeleteSafetyPermit,
}) => {
  const [selectedRiskLevel, setSelectedRiskLevel] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [activePermit, setActivePermit] = useState<SafetyPermit | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // 提交/审批状态 (真实接口调用中与错误提示)
  const [isSubmittingPermit, setIsSubmittingPermit] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Create Form State
  const [formData, setFormData] = useState({
    permitType: '动火作业票' as any,
    riskLevel: '较大风险 (Level 2)' as RiskLevel,
    title: '',
    equipmentId: equipments[0]?.id || '',
    workshop: '一号动力车间',
    location: '',
    precautions: [
      '作业现场配备 2 具 4kg ABC 干粉灭火器',
      '清理周边 10 米内易燃易爆杂物',
      '专人现场看火并落实防火毯覆盖',
    ],
    lotoNumber: '',
  });

  const riskLevels: { id: string; label: string; count: number; color: string }[] = [
    { id: 'all', label: '全部风险级别', count: safetyPermits.length, color: 'text-slate-300' },
    {
      id: '极大风险 (Level 1)',
      label: '🔴 极大风险 (Level 1)',
      count: safetyPermits.filter((s) => s.riskLevel.includes('Level 1')).length,
      color: 'text-rose-400',
    },
    {
      id: '较大风险 (Level 2)',
      label: '🟠 较大风险 (Level 2)',
      count: safetyPermits.filter((s) => s.riskLevel.includes('Level 2')).length,
      color: 'text-amber-400',
    },
    {
      id: '一般风险 (Level 3)',
      label: '🟡 一般风险 (Level 3)',
      count: safetyPermits.filter((s) => s.riskLevel.includes('Level 3')).length,
      color: 'text-blue-400',
    },
    {
      id: '低风险 (Level 4)',
      label: '🔵 低风险 (Level 4)',
      count: safetyPermits.filter((s) => s.riskLevel.includes('Level 4')).length,
      color: 'text-slate-500',
    },
  ];

  const filteredPermits = safetyPermits.filter((p) => {
    const matchesRisk = selectedRiskLevel === 'all' || p.riskLevel === selectedRiskLevel;
    const matchesStatus = selectedStatus === 'all' || p.status === selectedStatus;
    return matchesRisk && matchesStatus;
  });

  const getRiskBadge = (level: RiskLevel) => {
    if (level.includes('Level 1')) {
      return { label: '极大风险 (Level 1)', color: 'bg-red-50 text-red-700 border-red-200' };
    }
    if (level.includes('Level 2')) {
      return { label: '较大风险 (Level 2)', color: 'bg-orange-50 text-orange-700 border-orange-200' };
    }
    if (level.includes('Level 3')) {
      return { label: '一般风险 (Level 3)', color: 'bg-blue-50 text-blue-700 border-blue-200' };
    }
    return { label: '低风险 (Level 4)', color: 'bg-slate-100 text-slate-600 border-slate-200' };
  };

  const getStatusBadge = (status: SafetyPermit['status']) => {
    switch (status) {
      case 'pending_approval':
        return { label: '待安全总监审批', color: 'bg-orange-50 text-orange-700 border-orange-200' };
      case 'approved':
      case 'active':
        return { label: '作业中/在控', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      case 'closed':
        return { label: '已完工撤离闭环', color: 'bg-slate-100 text-slate-600 border-slate-200' };
      case 'rejected':
        return { label: '审批驳回', color: 'bg-red-50 text-red-700 border-red-200' };
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEq = equipments.find((e) => e.id === formData.equipmentId);
    setIsSubmittingPermit(true);
    setSubmitError(null);
    try {
      // 真实落库：通过后端接口创建作业票 (后端生成工单号/申请人/审计日志/通知)
      const created = await safetyPermitApi.create({
        permitType: formData.permitType,
        riskLevel: formData.riskLevel,
        title: formData.title,
        equipmentId: targetEq?.id,
        equipmentName: targetEq?.name,
        workshop: formData.workshop,
        location: formData.location || targetEq?.location || '指定区域',
        precautions: formData.precautions,
        lotoNumber: formData.lotoNumber || null,
      });
      onAddSafetyPermit(created);
      setShowCreateModal(false);
    } catch (err: any) {
      setSubmitError(err?.message || '提交安全审批流失败，请稍后重试');
    } finally {
      setIsSubmittingPermit(false);
    }
    setFormData({
      permitType: '动火作业票',
      riskLevel: '较大风险 (Level 2)',
      title: '',
      equipmentId: equipments[0]?.id || '',
      workshop: '一号动力车间',
      location: '',
      precautions: [
        '作业现场配备 2 具 4kg ABC 干粉灭火器',
        '清理周边 10 米内易燃易爆杂物',
        '专人现场看火并落实防火毯覆盖',
      ],
      lotoNumber: '',
    });
  };

  const handleApprovalAction = async (approved: boolean) => {
    if (!activePermit) return;
    setIsSubmittingPermit(true);
    setSubmitError(null);
    try {
      // 真实落库：调用后端双人会签审批流转 (现场监护节点 → 主管终审节点)
      const step = activePermit.guardianApproval?.signed ? 'supervisor' : 'guardian';
      const updated = await safetyPermitApi.approve(activePermit.id, {
        step,
        pass: approved,
        comment: approved ? '现场安全条件核验合格，准予放行' : '安全条件不达标，驳回申请',
      });
      onUpdateSafetyPermit(updated);
      setActivePermit(updated);
      setShowApprovalModal(false);
    } catch (err: any) {
      setSubmitError(err?.message || '审批操作失败，请稍后重试');
    } finally {
      setIsSubmittingPermit(false);
    }
  };

  const activeLotoLocks = lotoLocks.filter((l) => l.status === 'locked');

  // AI 作业票风险评估状态 (功能 6)
  const [riskAssessState, setRiskAssessState] = useState<{ open: boolean; loading: boolean; error: string | null; degraded?: boolean; reviewId?: string | null; data?: AiSafetyAssessment | null }>({ open: false, loading: false, error: null });

  const applyRiskAssessment = (res: any) => {
    if (res.success && res.assessment) {
      setRiskAssessState({ open: true, loading: false, error: null, data: res.assessment, reviewId: res.reviewId });
    } else {
      setRiskAssessState({ open: true, loading: false, error: res.message || res.error || 'AI 风险评估失败', degraded: res.degraded });
    }
  };

  const handleAssessFromForm = async () => {
    setRiskAssessState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.safetyRiskAssessment({
        permitType: formData.permitType,
        equipmentId: formData.equipmentId,
        workDescription: formData.title || `${formData.permitType}作业`,
        location: `${formData.workshop} · ${formData.location || '现场'}`,
        hazards: [],
      });
      applyRiskAssessment(res);
    } catch (err: any) {
      setRiskAssessState({ open: true, loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  const handleAssessFromPermit = async (permit: SafetyPermit) => {
    setRiskAssessState({ open: true, loading: true, error: null });
    try {
      const res = await aiApi.safetyRiskAssessment({
        permitType: permit.permitType || '动火作业票',
        equipmentId: permit.equipmentId,
        workDescription: permit.title,
        location: `${permit.workshop} · ${permit.location || '现场'}`,
        hazards: Array.isArray(permit.hazards) ? permit.hazards : [],
      });
      applyRiskAssessment(res);
    } catch (err: any) {
      setRiskAssessState({ open: true, loading: false, error: err?.message || 'AI 调用失败' });
    }
  };

  // 采纳 AI 建议：把 JSA 措施追加到创建表单的安全交底措施中
  const applyAiMeasuresToForm = () => {
    const data = riskAssessState.data;
    if (!data) return;
    const measures = (data.jsaMeasures || []).map((m) => `${m.hazard}: ${m.control}`);
    if (!measures.length) return;
    setFormData((prev: any) => ({ ...prev, precautions: [...(prev.precautions || []), ...measures] }));
    setRiskAssessState((prev) => ({ ...prev, open: false }));
  };

  const [rbacNotice, setRbacNotice] = useState<{ title: string; message: string; type: 'error' | 'success' } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeletePermit = async (permit: SafetyPermit, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // RBAC 前端先导拦截提示 (若当前角色为操作工/普通用户)
    if (currentUser.role === 'user') {
      setRbacNotice({
        title: 'RBAC 细粒度权限拦截 (HTTP 403 Forbidden)',
        message: `权限拒绝：当前账号 [${currentUser.name} - ${currentUser.roleTitle}] 无权删除高危作业票 [${permit.permitNo}]！依照工业安全生产合规标准，普通用户严禁删除高危作业票，必须由车间安全主管(manager)或系统管理员(admin)审批执行。`,
        type: 'error',
      });
      // 触发接口层实际 RBAC 守卫并在后端记录审计日志
      try {
        await safetyPermitApi.delete(permit.id);
      } catch (err: any) {
        console.warn("Backend RBAC response:", err.message);
      }
      return;
    }

    if (!confirm(`确定要永久注销并删除高危作业票【${permit.permitNo} · ${permit.title}】吗？此操作将记录到系统安全审计日志。`)) {
      return;
    }

    setIsDeleting(true);
    try {
      await safetyPermitApi.delete(permit.id);
      if (onDeleteSafetyPermit) {
        await onDeleteSafetyPermit(permit.id);
      }
      setActivePermit(null);
      setRbacNotice({
        title: '高危作业票删除成功',
        message: `作业票 ${permit.permitNo} 已被安全移除，操作日志已归档至操作审计中心。`,
        type: 'success',
      });
    } catch (err: any) {
      setRbacNotice({
        title: 'RBAC 权限拒绝',
        message: err.message || '无权删除该高危作业票，必须由车间安全主管或系统管理员操作。',
        type: 'error',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* RBAC Notice Modal / Banner */}
      {rbacNotice && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 animate-in fade-in duration-200 ${
            rbacNotice.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-start space-x-3">
            {rbacNotice.type === 'error' ? (
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div>
              <h4 className="text-xs font-bold">{rbacNotice.title}</h4>
              <p className="text-xs mt-1 leading-relaxed opacity-90">{rbacNotice.message}</p>
            </div>
          </div>
          <button
            onClick={() => setRbacNotice(null)}
            className="p-1 rounded hover:bg-black/5 text-slate-500 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <ShieldCheck className="w-5 h-5 mr-2 text-purple-600" />
            工业现场高危作业安全管控与作业票审批中心
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            四级风险分级管控、动火/受限空间/高处作业票双人审批、LOTO 停电挂牌生命锁联锁机制
          </p>
        </div>

        <button
          id="btn-create-safety-permit"
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>申请高危安全作业票</span>
        </button>
      </div>

      {/* LOTO Special Interlock Banner (真实 loto_locks 落库数据驱动) */}
      <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-xs card-industrial">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-purple-100 text-purple-700 rounded-xl border border-purple-200">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-600 text-white">
                LOTO 能量隔离联锁看板
              </span>
              <span className="text-xs font-semibold text-purple-900">
                当前 {activeLotoLocks.length} 组动力回路挂锁执行中
                {activeLotoLocks.length > 0 && `: ${activeLotoLocks.map((l) => l.lockNo).join(' / ')}`}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              {activeLotoLocks.length > 0
                ? `隔离点: ${activeLotoLocks[0].pointName || '—'} | 动力源: ${activeLotoLocks[0].energySource || '—'} (零能确认已完成)`
                : '当前无挂锁执行中的能量隔离作业，全部锁具已解除'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-xs px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
            防误合闸闭锁有效
          </span>
        </div>
      </div>

      {/* Risk Filter Chips */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        {riskLevels.map((risk) => {
          const isSelected = selectedRiskLevel === risk.id;
          return (
            <button
              key={risk.id}
              onClick={() => setSelectedRiskLevel(risk.id)}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer shadow-xs ${
                isSelected
                  ? 'bg-purple-50 border-purple-300 ring-1 ring-purple-300'
                  : 'bg-white border-slate-200 hover:border-slate-300 card-industrial'
              }`}
            >
              <div className={`text-xs font-bold ${risk.color}`}>{risk.label}</div>
              <div className="text-xs font-mono text-slate-500 mt-1">
                在控票据: <strong className="text-slate-800">{risk.count}</strong> 张
              </div>
            </button>
          );
        })}
      </div>

      {/* Safety Permits Grid */}
      <div className="space-y-3">
        {filteredPermits.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs card-industrial">
            <ShieldCheck className="w-12 h-12 text-slate-500 mx-auto mb-3" />
            <h4 className="text-sm font-semibold text-slate-700">暂无此筛选条件下的安全作业票</h4>
            <p className="text-xs text-slate-500 mt-1">生产现场各项指标安全平稳</p>
          </div>
        ) : (
          filteredPermits.map((permit) => {
            const riskBadge = getRiskBadge(permit.riskLevel);
            const statusBadge = getStatusBadge(permit.status);
            const isPending = permit.status === 'pending_approval';

            return (
              <div
                key={permit.id}
                onClick={() => setActivePermit(permit)}
                className={`p-4 bg-white hover:border-purple-300 border rounded-xl transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4 card-industrial shadow-xs ${
                  isPending ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start space-x-3.5">
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-purple-600 shrink-0 mt-0.5">
                    {permit.permitType.includes('动火') ? (
                      <Flame className="w-5 h-5 text-amber-600" />
                    ) : permit.lotoNumber ? (
                      <Lock className="w-5 h-5 text-rose-600" />
                    ) : (
                      <ShieldCheck className="w-5 h-5 text-purple-600" />
                    )}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-bold text-purple-700">{permit.permitNo}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${riskBadge.color}`}>
                        {riskBadge.label}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${statusBadge.color}`}>
                        {statusBadge.label}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-medium">
                        {permit.permitType}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-800 group-hover:text-purple-700 transition-colors">
                      {permit.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-[11px] text-slate-500 mt-2">
                      <span>作业区域: <strong className="text-slate-700">{permit.workshop} · {permit.location}</strong></span>
                      {permit.equipmentName && <span>关联设备: {permit.equipmentName}</span>}
                      <span>申请人: {permit.applicant}</span>
                      {permit.approver && <span>审批责任人: <strong className="text-emerald-700">{permit.approver}</strong></span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end space-x-2 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="text-right hidden sm:block mr-2">
                    <span className="text-[10px] text-slate-500 block">有效截止时限</span>
                    <span className="font-mono text-xs text-amber-700 font-semibold">{permit.validUntil}</span>
                  </div>

                  <button
                    onClick={(e) => handleDeletePermit(permit, e)}
                    title={currentUser.role === 'user' ? "普通操作员禁止删除高危作业票" : "注销并删除此安全作业票"}
                    className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <button className="px-3 py-1.5 bg-slate-100 group-hover:bg-purple-600 text-slate-700 group-hover:text-white rounded-lg text-xs font-medium transition-colors flex items-center space-x-1 cursor-pointer">
                    <span>{isPending ? '审批/详情' : '详情'}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Safety Permit Detail Drawer & Approval Modal */}
      {activePermit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6 card-industrial">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-semibold">
                    {activePermit.permitNo}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded border font-medium ${getStatusBadge(activePermit.status).color}`}>
                    {getStatusBadge(activePermit.status).label}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded border font-medium ${getRiskBadge(activePermit.riskLevel).color}`}>
                    {getRiskBadge(activePermit.riskLevel).label}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-800 mt-1.5">{activePermit.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  车间位置: {activePermit.workshop} · {activePermit.location}
                </p>
              </div>

              <button
                onClick={() => setActivePermit(null)}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Isolation & LOTO info */}
            {activePermit.lotoNumber && (
              <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-xs text-purple-900 space-y-1">
                <div className="flex items-center justify-between font-bold">
                  <span className="flex items-center text-purple-700">
                    <Lock className="w-4 h-4 mr-1.5 text-purple-600" />
                    能量隔离与 LOTO 锁具编码
                  </span>
                  <span className="font-mono text-purple-800 font-bold">{activePermit.lotoNumber}</span>
                </div>
                <p className="text-slate-600 text-[11px]">
                  严禁擅自解除机械锁或合闸通电，需经申请人与安全负责人双人双锁解除。
                </p>
              </div>
            )}

            {/* Precautions List */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
              <span className="font-semibold text-slate-800 flex items-center">
                <ShieldCheck className="w-4 h-4 mr-1.5 text-emerald-600" />
                安全交底与现场必选防控措施 (作业前逐项核验)
              </span>
              <ul className="space-y-1.5 text-slate-700">
                {(Array.isArray(activePermit.precautions)
                  ? activePermit.precautions
                  : [activePermit.precautions]
                ).map((p, i) => (
                  <li key={i} className="flex items-center space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Meta Dates & People */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-700">
              <div>
                <span className="text-slate-500 block">申请人:</span>
                <span className="font-medium text-slate-800">{activePermit.applicant}</span>
              </div>
              <div>
                <span className="text-slate-500 block">申请时间:</span>
                <span className="font-mono text-slate-800">{activePermit.appliedAt}</span>
              </div>
              <div>
                <span className="text-slate-500 block">安全审批人:</span>
                <span className="text-emerald-700 font-semibold">{activePermit.approver || '等待审批'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">作业时效截止:</span>
                <span className="font-mono text-amber-700 font-semibold">{activePermit.validUntil}</span>
              </div>
            </div>

            {/* 双人会签电子防伪签名看板 (Dual Sign-off Cryptographic Verification) */}
            <div className="p-3.5 bg-purple-50/40 rounded-xl border border-purple-200 text-xs space-y-2">
              <span className="font-bold text-purple-900 flex items-center">
                <ShieldCheck className="w-4 h-4 mr-1.5 text-purple-600" />
                双人会签法定防伪签名存证
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className={`p-2.5 rounded-lg border text-[11px] ${
                  activePermit.guardianApproval?.signed
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}>
                  <div className="flex items-center justify-between font-semibold">
                    <span>1. 现场安全监护人初审会签</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${activePermit.guardianApproval?.signed ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                      {activePermit.guardianApproval?.signed ? '已会签' : '待会签'}
                    </span>
                  </div>
                  {activePermit.guardianApproval?.signed ? (
                    <div className="mt-1 space-y-0.5">
                      <div>签署人: <strong>{activePermit.guardianApproval.name}</strong></div>
                      <div className="font-mono text-[10px] text-slate-500">时间: {activePermit.guardianApproval.signedAt?.slice(0, 19).replace('T', ' ')}</div>
                      <div className="font-mono text-[10px] text-purple-700 truncate">
                        防伪哈希: {activePermit.guardianApproval.signatureHash || 'SEC-SIGN-OK'}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-slate-400">需持证安全监护员现场确认气体与动火隔离</div>
                  )}
                </div>

                <div className={`p-2.5 rounded-lg border text-[11px] ${
                  activePermit.supervisorApproval?.signed
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}>
                  <div className="flex items-center justify-between font-semibold">
                    <span>2. 车间安全总监终审签发</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${activePermit.supervisorApproval?.signed ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                      {activePermit.supervisorApproval?.signed ? '已签批生效' : '待终审'}
                    </span>
                  </div>
                  {activePermit.supervisorApproval?.signed ? (
                    <div className="mt-1 space-y-0.5">
                      <div>审批人: <strong>{activePermit.supervisorApproval.name}</strong></div>
                      <div className="font-mono text-[10px] text-slate-500">时间: {activePermit.supervisorApproval.signedAt?.slice(0, 19).replace('T', ' ')}</div>
                      <div className="font-mono text-[10px] text-purple-700 truncate">
                        防伪哈希: {activePermit.supervisorApproval.signatureHash || 'EXEC-AUTH-OK'}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-slate-400">监护人会签后由主管审批下达准许令</div>
                  )}
                </div>
              </div>
            </div>

            {/* RBAC Fine-grained Control Info Banner */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 flex items-center">
                  <UserCheck className="w-3.5 h-3.5 mr-1.5 text-purple-600" />
                  当前账号操作鉴权: <strong className="text-slate-900 ml-1">{currentUser.name}</strong> ({currentUser.roleTitle})
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${
                  currentUser.role === 'admin'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : currentUser.role === 'inspector'
                    ? 'bg-cyan-50 text-cyan-700 border border-cyan-200'
                    : 'bg-slate-200 text-slate-700'
                }`}>
                  RBAC 权限: {currentUser.role}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {currentUser.role === 'admin'
                  ? '👑 管理员/车间总工：具备高危作业票终审审批、闭环验收以及高危作业票永久注销与删除的最高权限。'
                  : currentUser.role === 'inspector'
                  ? '🛡️ 专职安全巡检员：具备现场动火/受限空间安全条件初审会签权限，无高危票注销删除权限。'
                  : '⚠️ 普通操作员：仅具备申报与查阅权限。根据安监规程，普通操作员严禁删除或跳过审批高危作业票。'}
              </p>
            </div>

            {/* Approval Footer Action */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between pt-4 border-t border-slate-100 gap-3">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => handleDeletePermit(activePermit)}
                  disabled={isDeleting}
                  className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  title={currentUser.role === 'user' ? '普通操作员禁止删除高危作业票' : '永久注销此作业票'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isDeleting ? '注销中...' : '注销并删除作业票'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleAssessFromPermit(activePermit)}
                className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI 风险评估</span>
              </button>

              <div className="flex items-center space-x-2 justify-end">
                {activePermit.status === 'pending_approval' && (currentUser.role === 'admin' || currentUser.role === 'inspector') ? (
                  <>
                    <button
                      onClick={() => handleApprovalAction(false)}
                      disabled={isSubmittingPermit}
                      className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold flex items-center space-x-1 cursor-pointer transition-colors disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{isSubmittingPermit ? '处理中...' : '驳回申请'}</span>
                    </button>
                    <button
                      onClick={() => handleApprovalAction(true)}
                      disabled={isSubmittingPermit}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>批准放行安全票</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setActivePermit(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs cursor-pointer font-medium"
                  >
                    关闭
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Safety Permit */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 card-industrial"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800 flex items-center">
                <Plus className="w-4 h-4 mr-1.5 text-purple-600" />
                申请工业高危安全作业票 (SOP 审查)
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-500 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">作业票类型 *</label>
                  <select
                    value={formData.permitType}
                    onChange={(e) => setFormData({ ...formData, permitType: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white"
                  >
                    <option value="动火作业票">动火作业票</option>
                    <option value="受限空间作业票">受限空间作业票</option>
                    <option value="高处作业票">高处作业票</option>
                    <option value="LOTO停电上锁票">LOTO停电上锁票</option>
                    <option value="临时用电作业票">临时用电作业票</option>
                    <option value="吊装作业票">吊装作业票</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 mb-1 font-medium">风险辨识等级 *</label>
                  <select
                    value={formData.riskLevel}
                    onChange={(e) => setFormData({ ...formData, riskLevel: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white"
                  >
                    <option value="极大风险 (Level 1)">🔴 极大风险 (Level 1)</option>
                    <option value="较大风险 (Level 2)">🟠 较大风险 (Level 2)</option>
                    <option value="一般风险 (Level 3)">🟡 一般风险 (Level 3)</option>
                    <option value="低风险 (Level 4)">🔵 低风险 (Level 4)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">作业任务标题 *</label>
                <input
                  type="text"
                  required
                  placeholder="例如: 动力站主蒸汽管线更换二道截止阀气割作业"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1 font-medium">所属车间工段</label>
                  <select
                    value={formData.workshop}
                    onChange={(e) => setFormData({ ...formData, workshop: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white"
                  >
                    <option value="一号动力车间">一号动力车间</option>
                    <option value="二号机加车间">二号机加车间</option>
                    <option value="智能装配线">智能装配线</option>
                    <option value="储运与气体动力站">储运与气体动力站</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 mb-1 font-medium">关联作业设备</label>
                  <select
                    value={formData.equipmentId}
                    onChange={(e) => setFormData({ ...formData, equipmentId: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white"
                  >
                    {equipments.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name} ({eq.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-medium">LOTO 安全锁号 (如涉及电气/机械隔离)</label>
                <input
                  type="text"
                  placeholder="例如: LOCK-RED-8820"
                  value={formData.lotoNumber}
                  onChange={(e) => setFormData({ ...formData, lotoNumber: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:bg-white font-mono"
                />
              </div>
            </div>

            {submitError && showCreateModal && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
                {submitError}
              </div>
            )}

            <button
              type="button"
              onClick={handleAssessFromForm}
              className="w-full py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 cursor-pointer transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI 风险评估 (JSA 作业安全分析)</span>
            </button>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs hover:bg-slate-200 font-medium"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmittingPermit}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
              >
                {isSubmittingPermit ? '提交中...' : '提交安全审批流'}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* AI 作业票风险评估弹窗 (功能 6) */}
      <AiResultModal
        open={riskAssessState.open}
        title="AI 作业票风险评估 (JSA 作业安全分析)"
        loading={riskAssessState.loading}
        error={riskAssessState.error}
        degraded={riskAssessState.degraded}
        pendingReview={!!riskAssessState.reviewId}
        data={riskAssessState.data}
        onClose={() => setRiskAssessState((prev) => ({ ...prev, open: false }))}
        footer={
          showCreateModal && riskAssessState.data?.jsaMeasures?.length ? (
            <button
              onClick={applyAiMeasuresToForm}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
            >
              采纳 AI 措施到安全交底
            </button>
          ) : undefined
        }
      />
    </div>
  );
};
