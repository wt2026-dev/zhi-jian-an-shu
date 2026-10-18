import React, { useState } from 'react';
import { Equipment, RiskLevel, SafetyPermit, UserProfile } from '../../types';
import { safetyPermitApi } from '../../api';
import { can, describeActionOwner } from '../../utils/rbac';
import { logger } from '../../utils/logger';

interface UseSafetyPermitActionsProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  activePermit: SafetyPermit | null;
  setActivePermit: React.Dispatch<React.SetStateAction<SafetyPermit | null>>;
  onAddSafetyPermit: (permit: SafetyPermit) => void;
  onUpdateSafetyPermit: (permit: SafetyPermit) => void;
  onDeleteSafetyPermit?: (id: string) => Promise<unknown> | void;
  setShowCreateModal: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useSafetyPermitActions({
  currentUser,
  equipments,
  activePermit,
  setActivePermit,
  onAddSafetyPermit,
  onUpdateSafetyPermit,
  onDeleteSafetyPermit,
  setShowCreateModal,
}: UseSafetyPermitActionsProps) {
  const canGuardianSign = can('safety:guardianConfirm', currentUser.role);
  const canFinalApprove = can('safety:finalApprove', currentUser.role);

  const [isSubmittingPermit, setIsSubmittingPermit] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    permitType: '动火作业票' as SafetyPermit['permitType'],
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
    validUntil: '',
  });

  const [rbacNotice, setRbacNotice] = useState<{ title: string; message: string; type: 'error' | 'success' } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPermit) return;
    const deadline = new Date(formData.validUntil);
    if (!formData.validUntil || !Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) {
      setSubmitError('请选择晚于当前时间的有效截止时限');
      return;
    }
    const targetEq = equipments.find((eq) => eq.id === formData.equipmentId);
    setIsSubmittingPermit(true);
    setSubmitError(null);
    try {
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
        validUntil: deadline.toISOString(),
      });
      onAddSafetyPermit(created);
      setShowCreateModal(false);
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
        validUntil: '',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交安全审批流失败，请稍后重试';
      setSubmitError(msg);
    } finally {
      setIsSubmittingPermit(false);
    }
  };

  const handleApprovalAction = async (approved: boolean) => {
    if (!activePermit) return;
    setIsSubmittingPermit(true);
    setSubmitError(null);
    try {
      const step = activePermit.guardianApproval?.signed ? 'supervisor' : 'guardian';
      const allowed = step === 'guardian' ? canGuardianSign : canFinalApprove;
      if (!allowed) {
        setSubmitError(
          step === 'guardian'
            ? `当前角色无权限执行现场监护确认，仅${describeActionOwner('safety:guardianConfirm')}可操作，请切换角色`
            : `当前角色无权限执行终审签发，仅${describeActionOwner('safety:finalApprove')}可操作，请切换角色`
        );
        return;
      }
      const updated = await safetyPermitApi.approve(activePermit.id, {
        step,
        pass: approved,
        comment: approved ? '现场安全条件核验合格，准予放行' : '安全条件不达标，驳回申请',
      });
      onUpdateSafetyPermit(updated);
      setActivePermit(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '审批操作失败，请稍后重试';
      setSubmitError(msg);
    } finally {
      setIsSubmittingPermit(false);
    }
  };

  const handleDeletePermit = async (permit: SafetyPermit, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    if (currentUser.role === 'user') {
      setRbacNotice({
        title: 'RBAC 细粒度权限拦截 (HTTP 403 Forbidden)',
        message: `权限拒绝：当前账号 [${currentUser.name} - ${currentUser.roleTitle}] 无权删除高危作业票 [${permit.permitNo}]！依照工业安全生产合规标准，普通用户严禁删除高危作业票，必须由车间安全主管(manager)或系统管理员(admin)审批执行。`,
        type: 'error',
      });
      try {
        await safetyPermitApi.delete(permit.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Backend RBAC response:', msg);
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '无权删除该高危作业票，必须由车间安全主管或系统管理员操作。';
      setRbacNotice({
        title: 'RBAC 权限拒绝',
        message: msg,
        type: 'error',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    canGuardianSign,
    canFinalApprove,
    isSubmittingPermit,
    submitError,
    setSubmitError,
    formData,
    setFormData,
    rbacNotice,
    setRbacNotice,
    isDeleting,
    handleCreateSubmit,
    handleApprovalAction,
    handleDeletePermit,
  };
}
