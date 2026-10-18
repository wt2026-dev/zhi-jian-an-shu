import React from 'react';
import { Zap } from 'lucide-react';
import {
  DispatchBoardHeader,
  DispatchStatsBar,
  DispatchMapContainer,
  DispatchRecommendPanel,
  DispatchToast,
  useDispatchBoard,
} from './dispatch-board';

interface DispatchBoardViewProps {
  /** 从工单页 / AI 协同页跳转时预选的工单或设备 */
  presetWorkOrderId?: string | null;
  presetEquipmentId?: string | null;
  /** 返回检修工单页（派单成功后引导） */
  onNavigateWorkOrders?: () => void;
}

export const DispatchBoardView: React.FC<DispatchBoardViewProps> = ({
  presetWorkOrderId,
  presetEquipmentId,
  onNavigateWorkOrders,
}) => {
  const hasAmapKey = Boolean((import.meta.env.VITE_AMAP_KEY as string) || '');
  const {
    equipmentPoints,
    pendingOrders,
    technicians,
    selectedOrderId,
    handleSelectOrder,
    recommendations,
    recommendMeta,
    boardLoading,
    recLoading,
    assigningId,
    error,
    toast,
    amapFailed,
    setAmapFailed,
    hoverTech,
    setHoverTech,
    hoverEq,
    setHoverEq,
    mocking,
    stats,
    regions,
    selectedEqPoint,
    refresh,
    handleAssign,
    handleMock,
  } = useDispatchBoard({ presetWorkOrderId, presetEquipmentId });

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      {/* 页头 */}
      <DispatchBoardHeader
        loading={boardLoading}
        mocking={mocking}
        onRefresh={refresh}
        onMock={handleMock}
      />

      {error && (
        <p className="mb-3 text-xs text-rose-600 flex items-center">
          <Zap className="w-3.5 h-3.5 mr-1" />
          {error}
        </p>
      )}

      {/* 顶部统计条 */}
      <DispatchStatsBar stats={stats} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 厂区地图 / 平面图 */}
        <div className="lg:col-span-7">
          <DispatchMapContainer
            boardLoading={boardLoading}
            hasAmapKey={hasAmapKey}
            amapFailed={amapFailed}
            regions={regions}
            equipmentPoints={equipmentPoints}
            technicians={technicians}
            selectedEqPoint={selectedEqPoint}
            recommendations={recommendations}
            hoverTech={hoverTech}
            hoverEq={hoverEq}
            onFailAmap={() => setAmapFailed(true)}
            onHoverTech={setHoverTech}
            onHoverEq={setHoverEq}
          />
        </div>

        {/* 右列：工单选择 + 推荐列表 */}
        <div className="lg:col-span-5">
          <DispatchRecommendPanel
            pendingOrders={pendingOrders}
            selectedOrderId={selectedOrderId}
            recommendations={recommendations}
            recommendMeta={recommendMeta}
            recLoading={recLoading}
            assigningId={assigningId}
            onSelectOrder={handleSelectOrder}
            onAssign={handleAssign}
            onNavigateWorkOrders={onNavigateWorkOrders}
          />
        </div>
      </div>

      {/* 全局轻提示 */}
      <DispatchToast toast={toast} />
    </div>
  );
};
