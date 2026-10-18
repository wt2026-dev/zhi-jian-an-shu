import React from 'react';
import { Equipment, UserProfile } from '../types';
import { useHazards } from './hazards/useHazards';
import { HazardsHeader } from './hazards/HazardsHeader';
import { HazardsKpiStats } from './hazards/HazardsKpiStats';
import { HazardsFilterTabs } from './hazards/HazardsFilterTabs';
import { HazardCardList } from './hazards/HazardCardList';
import { HazardDetailDrawer } from './hazards/HazardDetailDrawer';
import { HazardAssignModal } from './hazards/HazardAssignModal';
import { HazardVerifyModal } from './hazards/HazardVerifyModal';
import { HazardCreateModal } from './hazards/HazardCreateModal';

export interface HazardsViewProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  allUsers: UserProfile[];
  onNavigateToWorkOrders?: () => void;
}

export const HazardsView: React.FC<HazardsViewProps> = ({
  currentUser,
  equipments,
  allUsers,
}) => {
  const {
    hazards,
    metrics,
    isLoading,
    canOperate,
    activeStatusTab,
    setActiveStatusTab,
    selectedLevel,
    setSelectedLevel,
    searchQuery,
    setSearchQuery,
    filteredHazards,
    selectedHazard,
    setSelectedHazard,
    createModalOpen,
    setCreateModalOpen,
    openCreateModal,
    assignModalOpen,
    setAssignModalOpen,
    verifyModalOpen,
    setVerifyModalOpen,
    newHazard,
    setNewHazard,
    createSubmitting,
    createError,
    handleCreateHazard,
    assignForm,
    setAssignForm,
    assignSubmitting,
    assignError,
    handleAssignWorkOrder,
    verifyForm,
    setVerifyForm,
    verifySubmitting,
    verifyError,
    handleVerify,
    handleRequestVerify,
    openAssignModal,
    openVerifyModal,
    loadData,
  } = useHazards(currentUser, equipments, allUsers);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <HazardsHeader
        isLoading={isLoading}
        canOperate={canOperate}
        onRefresh={loadData}
        onOpenCreate={openCreateModal}
      />

      {/* KPI Stats */}
      <HazardsKpiStats metrics={metrics} hazards={hazards} />

      {/* Filter and State Machine Tabs */}
      <HazardsFilterTabs
        activeStatusTab={activeStatusTab}
        onChangeStatusTab={setActiveStatusTab}
        selectedLevel={selectedLevel}
        onChangeLevel={setSelectedLevel}
        searchQuery={searchQuery}
        onChangeSearch={setSearchQuery}
      />

      {/* Hazards List */}
      <HazardCardList
        hazards={filteredHazards}
        isLoading={isLoading}
        canOperate={canOperate}
        onSelectHazard={setSelectedHazard}
        onAssign={openAssignModal}
        onVerify={openVerifyModal}
      />

      {/* Hazard Detail Drawer / Modal */}
      <HazardDetailDrawer
        hazard={selectedHazard}
        canOperate={canOperate}
        onClose={() => setSelectedHazard(null)}
        onAssign={openAssignModal}
        onRequestVerify={handleRequestVerify}
        onVerify={openVerifyModal}
      />

      {/* Assign Work Order Modal */}
      <HazardAssignModal
        isOpen={assignModalOpen}
        hazard={selectedHazard}
        allUsers={allUsers}
        assignForm={assignForm}
        onChangeForm={setAssignForm}
        submitting={assignSubmitting}
        error={assignError}
        onClose={() => setAssignModalOpen(false)}
        onSubmit={handleAssignWorkOrder}
      />

      {/* Verify & Close Modal */}
      <HazardVerifyModal
        isOpen={verifyModalOpen}
        currentUser={currentUser}
        verifyForm={verifyForm}
        onChangeForm={setVerifyForm}
        submitting={verifySubmitting}
        error={verifyError}
        onClose={() => setVerifyModalOpen(false)}
        onSubmit={handleVerify}
      />

      {/* Create New Hazard Modal */}
      <HazardCreateModal
        isOpen={createModalOpen}
        equipments={equipments}
        newHazard={newHazard}
        onChangeHazard={setNewHazard}
        submitting={createSubmitting}
        error={createError}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleCreateHazard}
      />
    </div>
  );
};
