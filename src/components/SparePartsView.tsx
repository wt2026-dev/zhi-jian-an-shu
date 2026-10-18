import React, { useRef, useEffect } from 'react';
import { UserProfile } from '../types';
import { type SpareProcurePrefill } from '../api';
import { useSpareParts } from './spare-parts/useSpareParts';
import { SparePartsHeader } from './spare-parts/SparePartsHeader';
import { SparePartsKpiCards } from './spare-parts/SparePartsKpiCards';
import { SparePartsFilterBar } from './spare-parts/SparePartsFilterBar';
import { SparePartsTable } from './spare-parts/SparePartsTable';
import { SparePartInOutModal } from './spare-parts/SparePartInOutModal';
import { SparePartMovementsModal } from './spare-parts/SparePartMovementsModal';
import { SparePartCreateModal } from './spare-parts/SparePartCreateModal';

export interface SparePartsViewProps {
  currentUser: UserProfile;
  onNavigateToWorkOrders?: () => void;
  /**
   * 拆解视图库存联动 → 采购申请预填（F6）：真实备件台账命中的零件与缺口信息。
   * 本页消费后把「采购入库」弹窗按缺口预填，提交即生成真实出入库流水。
   */
  initialProcurePrefill?: SpareProcurePrefill | null;
  onProcurePrefillConsumed?: () => void;
}

export const SparePartsView: React.FC<SparePartsViewProps> = ({
  currentUser,
  onNavigateToWorkOrders: _onNavigateToWorkOrders,
  initialProcurePrefill = null,
  onProcurePrefillConsumed,
}) => {
  const sp = useSpareParts({ currentUser });

  /**
   * 库存联动（F6）：消费「一键生成采购申请」预填 → 预填采购入库弹窗。
   */
  const appliedProcurePrefillRef = useRef<SpareProcurePrefill | null>(null);
  useEffect(() => {
    let prefill = initialProcurePrefill;
    if (!prefill) {
      try {
        const raw = window.sessionStorage.getItem('spare-procure-prefill');
        if (raw) {
          prefill = JSON.parse(raw) as SpareProcurePrefill;
          window.sessionStorage.removeItem('spare-procure-prefill');
        }
      } catch {
        /* ignore */
      }
    }
    if (!prefill || sp.isLoading || sp.parts.length === 0) return;
    if (appliedProcurePrefillRef.current?.partId === prefill.partId) return;
    appliedProcurePrefillRef.current = prefill;

    void Promise.resolve().then(() => {
      const target = sp.parts.find((p) => p.id === prefill?.partId);
      if (!target) {
        onProcurePrefillConsumed?.();
        return;
      }
      sp.setInOutPart(target);
      sp.setInOutType('in');
      const shortage = Math.max(1, (target.safe_stock ?? 0) - (target.stock ?? 0));
      sp.setInOutQuantity(prefill?.qty && prefill.qty > 0 ? prefill.qty : shortage);
      sp.setInOutReason(prefill?.note || '拆解视图库存预警采购');
      onProcurePrefillConsumed?.();
    });
  }, [initialProcurePrefill, sp.isLoading, sp.parts, onProcurePrefillConsumed, sp]);

  return (
    <div className="space-y-6 pb-12">
      <SparePartsHeader
        isLoading={sp.isLoading}
        canOperate={sp.canOperate}
        onRefresh={sp.loadParts}
        onOpenCreate={() => sp.setCreateModalOpen(true)}
      />

      <SparePartsKpiCards
        totalKinds={sp.totalKinds}
        totalStockCount={sp.totalStockCount}
        lowStockCount={sp.lowStockCount}
        onlyLowStock={sp.onlyLowStock}
        onToggleLowStock={() => sp.setOnlyLowStock(!sp.onlyLowStock)}
      />

      <SparePartsFilterBar
        searchTerm={sp.searchTerm}
        onSearchTermChange={sp.setSearchTerm}
        categories={sp.categories}
        selectedCategory={sp.selectedCategory}
        onSelectCategory={sp.setSelectedCategory}
        onlyLowStock={sp.onlyLowStock}
        onToggleLowStock={() => sp.setOnlyLowStock(!sp.onlyLowStock)}
        lowStockCount={sp.lowStockCount}
      />

      <SparePartsTable
        filteredParts={sp.filteredParts}
        isLoading={sp.isLoading}
        canOperate={sp.canOperate}
        onOpenInOut={(part) => {
          sp.setInOutPart(part);
          sp.setInOutType('out');
          sp.setInOutQuantity(1);
          sp.setInOutReason('');
        }}
        onOpenMovements={sp.handleOpenMovements}
      />

      <SparePartInOutModal
        part={sp.inOutPart}
        onClose={() => sp.setInOutPart(null)}
        type={sp.inOutType}
        onTypeChange={sp.setInOutType}
        quantity={sp.inOutQuantity}
        onQuantityChange={sp.setInOutQuantity}
        reason={sp.inOutReason}
        onReasonChange={sp.setInOutReason}
        currentUser={currentUser}
        submitting={sp.inOutSubmitting}
        errorMessage={sp.inOutError}
        onSubmit={sp.handleSubmitInOut}
      />

      <SparePartMovementsModal
        part={sp.historyPart}
        onClose={() => sp.setHistoryPart(null)}
        loading={sp.loadingMovements}
        movements={sp.movements}
      />

      <SparePartCreateModal
        isOpen={sp.createModalOpen}
        onClose={() => sp.setCreateModalOpen(false)}
        form={sp.newPart}
        onChangeForm={sp.setNewPart}
        submitting={sp.createSubmitting}
        errorMessage={sp.createError}
        onSubmit={sp.handleCreatePart}
      />
    </div>
  );
};
