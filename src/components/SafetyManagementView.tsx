import React, { useState } from 'react';
import { ShieldAlert, CheckCircle2, X } from 'lucide-react';
import { SafetyPermit, UserProfile, Equipment, LotoLock } from '../types';
import { AiResultModal } from './ai/AiResultModal';
import { SafetyHeaderAndFilter } from './safety/SafetyHeaderAndFilter';
import { SafetyPermitList } from './safety/SafetyPermitList';
import { SafetyPermitDetailModal } from './safety/SafetyPermitDetailModal';
import { SafetyPermitCreateModal } from './safety/SafetyPermitCreateModal';
import { useLotoManagement } from './safety/useLotoManagement';
import { useSafetyAi } from './safety/useSafetyAi';
import { useSafetyPermitActions } from './safety/useSafetyPermitActions';

interface SafetyManagementViewProps {
  currentUser: UserProfile;
  safetyPermits: SafetyPermit[];
  equipments: Equipment[];
  lotoLocks?: LotoLock[];
  onAddSafetyPermit: (permit: SafetyPermit) => void;
  onUpdateSafetyPermit: (permit: SafetyPermit) => void;
  onDeleteSafetyPermit?: (id: string) => Promise<unknown> | void;
}

export const SafetyManagementView: React.FC<SafetyManagementViewProps> = ({
  currentUser,
  safetyPermits,
  equipments,
  lotoLocks,
  onAddSafetyPermit,
  onUpdateSafetyPermit,
  onDeleteSafetyPermit,
}) => {
  const [selectedRiskLevel, setSelectedRiskLevel] = useState<string>('all');
  const [selectedStatus] = useState<string>('all');
  const [activePermit, setActivePermit] = useState<SafetyPermit | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const {
    activeLotoLocks,
    relatedLotoLocks,
    lockForm,
    setLockForm,
    releaseRemarks,
    setReleaseRemarks,
    lotoBusy,
    lotoError,
    lotoNeedsRefresh,
    canWriteLoto,
    handleLotoSubmit,
    handleRefreshLoto,
  } = useLotoManagement({ currentUser, lotoLocks, activePermit });

  const {
    riskAssessState,
    setRiskAssessState,
    handleAssessFromForm,
    handleAssessFromPermit,
    applyAiMeasuresToForm,
  } = useSafetyAi();

  const {
    canGuardianSign,
    canFinalApprove,
    isSubmittingPermit,
    submitError,
    formData,
    setFormData,
    rbacNotice,
    setRbacNotice,
    isDeleting,
    handleCreateSubmit,
    handleApprovalAction,
    handleDeletePermit,
  } = useSafetyPermitActions({
    currentUser,
    equipments,
    activePermit,
    setActivePermit,
    onAddSafetyPermit,
    onUpdateSafetyPermit,
    onDeleteSafetyPermit,
    setShowCreateModal,
  });

  const filteredPermits = safetyPermits.filter((p) => {
    const matchesRisk = selectedRiskLevel === 'all' || p.riskLevel === selectedRiskLevel;
    const matchesStatus = selectedStatus === 'all' || p.status === selectedStatus;
    return matchesRisk && matchesStatus;
  });

  return (
    <div className="space-y-6 pb-12">
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

      <SafetyHeaderAndFilter
        safetyPermits={safetyPermits}
        activeLotoLocks={activeLotoLocks}
        selectedRiskLevel={selectedRiskLevel}
        onSelectRiskLevel={setSelectedRiskLevel}
        onOpenCreateModal={() => setShowCreateModal(true)}
      />

      <SafetyPermitList
        filteredPermits={filteredPermits}
        currentUser={currentUser}
        onSelectPermit={setActivePermit}
        onDeletePermit={handleDeletePermit}
      />

      <SafetyPermitDetailModal
        activePermit={activePermit}
        currentUser={currentUser}
        relatedLotoLocks={relatedLotoLocks}
        canWriteLoto={canWriteLoto}
        canGuardianSign={canGuardianSign}
        canFinalApprove={canFinalApprove}
        lotoBusy={lotoBusy}
        lotoError={lotoError}
        lotoNeedsRefresh={lotoNeedsRefresh}
        lockForm={lockForm}
        releaseRemarks={releaseRemarks}
        isDeleting={isDeleting}
        isSubmittingPermit={isSubmittingPermit}
        onChangeLockForm={setLockForm}
        onChangeReleaseRemarks={setReleaseRemarks}
        onRefreshLoto={handleRefreshLoto}
        onLotoSubmit={handleLotoSubmit}
        onDeletePermit={handleDeletePermit}
        onAssessPermit={handleAssessFromPermit}
        onApprovalAction={handleApprovalAction}
        onClose={() => setActivePermit(null)}
      />

      <SafetyPermitCreateModal
        open={showCreateModal}
        equipments={equipments}
        formData={formData}
        isSubmittingPermit={isSubmittingPermit}
        submitError={submitError}
        onChangeFormData={setFormData}
        onSubmit={handleCreateSubmit}
        onAssessFromForm={() =>
          handleAssessFromForm({
            permitType: formData.permitType,
            equipmentId: formData.equipmentId,
            title: formData.title,
            workshop: formData.workshop,
            location: formData.location,
          })
        }
        onClose={() => setShowCreateModal(false)}
      />

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
              onClick={() => applyAiMeasuresToForm(setFormData)}
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
