import React from 'react';
import { Equipment, UserProfile } from '../types';
import { AiResultModal } from './ai/AiResultModal';
import { useEquipmentArchives } from './equipment-archives/useEquipmentArchives';
import { EquipmentArchivesHeader } from './equipment-archives/EquipmentArchivesHeader';
import { EquipmentArchivesFilterBar } from './equipment-archives/EquipmentArchivesFilterBar';
import { EquipmentGridView } from './equipment-archives/EquipmentGridView';
import { EquipmentTableView } from './equipment-archives/EquipmentTableView';
import { EquipmentDetailDrawer } from './equipment-archives/EquipmentDetailDrawer';
import { EquipmentQrModal } from './equipment-archives/EquipmentQrModal';
import { EquipmentCreateModal } from './equipment-archives/EquipmentCreateModal';

export interface EquipmentArchivesViewProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  onAddEquipment: (eq: Equipment) => void;
  onUpdateEquipment: (eq: Equipment) => void;
  onDeleteEquipment: (id: string) => void;
  onOpenWorkOrderForEquipment: (eq: Equipment) => void;
  onOpenAiDiagnoseForEquipment: (eq: Equipment) => void;
}

export const EquipmentArchivesView: React.FC<EquipmentArchivesViewProps> = ({
  currentUser,
  equipments,
  onAddEquipment,
  onOpenWorkOrderForEquipment,
  onOpenAiDiagnoseForEquipment,
}) => {
  const {
    searchQuery,
    setSearchQuery,
    selectedWorkshop,
    setSelectedWorkshop,
    selectedCategory,
    setSelectedCategory,
    selectedStatus,
    setSelectedStatus,
    viewMode,
    setViewMode,
    activeEquipment,
    setActiveEquipment,
    showAddModal,
    setShowAddModal,
    showQrModal,
    setShowQrModal,
    wechatQrFailedMap,
    setWechatQrFailedMap,
    isWeChatConfigured,
    formData,
    setFormData,
    summaryState,
    setSummaryState,
    handleEquipmentSummary,
    isCreatingEquipment,
    createError,
    filteredEquipments,
    handleCreateEquipment,
  } = useEquipmentArchives(equipments, onAddEquipment);

  const handleSetWechatQrFailed = (id: string) => {
    setWechatQrFailedMap((prev) => ({ ...prev, [id]: true }));
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Search Tools */}
      <EquipmentArchivesHeader
        totalCount={equipments.length}
        isAdmin={currentUser.role === 'admin'}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        onOpenAdd={() => setShowAddModal(true)}
      />

      {/* Filter and Search Bar */}
      <EquipmentArchivesFilterBar
        searchQuery={searchQuery}
        onChangeSearch={setSearchQuery}
        selectedWorkshop={selectedWorkshop}
        onChangeWorkshop={setSelectedWorkshop}
        selectedCategory={selectedCategory}
        onChangeCategory={setSelectedCategory}
        selectedStatus={selectedStatus}
        onChangeStatus={setSelectedStatus}
      />

      {/* Equipment View: Grid vs Table */}
      {viewMode === 'grid' ? (
        <EquipmentGridView
          equipments={filteredEquipments}
          onSelectEquipment={setActiveEquipment}
          onOpenAiDiagnose={onOpenAiDiagnoseForEquipment}
          onOpenWorkOrder={onOpenWorkOrderForEquipment}
        />
      ) : (
        <EquipmentTableView
          equipments={filteredEquipments}
          onSelectEquipment={setActiveEquipment}
          onOpenWorkOrder={onOpenWorkOrderForEquipment}
        />
      )}

      {/* Equipment Detailed Drawer Modal */}
      <EquipmentDetailDrawer
        activeEquipment={activeEquipment}
        isWeChatConfigured={isWeChatConfigured}
        wechatQrFailedMap={wechatQrFailedMap}
        onSetWechatQrFailed={handleSetWechatQrFailed}
        onClose={() => setActiveEquipment(null)}
        onOpenQrModal={() => setShowQrModal(true)}
        onOpenAiSummary={handleEquipmentSummary}
        onOpenAiDiagnose={onOpenAiDiagnoseForEquipment}
        onOpenWorkOrder={onOpenWorkOrderForEquipment}
      />

      {/* QR Code Printable Badge & Mini-program Repair Modal */}
      <EquipmentQrModal
        isOpen={showQrModal}
        activeEquipment={activeEquipment}
        isWeChatConfigured={isWeChatConfigured}
        wechatQrFailedMap={wechatQrFailedMap}
        onSetWechatQrFailed={handleSetWechatQrFailed}
        onClose={() => setShowQrModal(false)}
      />

      {/* Add Equipment Modal */}
      <EquipmentCreateModal
        isOpen={showAddModal}
        formData={formData}
        onChangeForm={setFormData}
        submitting={isCreatingEquipment}
        error={createError}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleCreateEquipment}
      />

      {/* AI 设备健康画像弹窗 */}
      <AiResultModal
        open={summaryState.open}
        title="AI 设备健康画像 (档案 + 遥测 + 工单 + 巡检综合摘要)"
        loading={summaryState.loading}
        error={summaryState.error}
        degraded={summaryState.degraded}
        data={summaryState.data}
        onClose={() => setSummaryState((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
};
