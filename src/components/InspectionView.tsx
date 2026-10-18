import React, { useState, useEffect } from 'react';
import { InspectionTask, InspectionItem, UserProfile, Equipment, WorkOrder } from '../types';
import { AiWorkOrderDraftModal } from './ai/AiWorkOrderDraftModal';
import { AiResultModal } from './ai/AiResultModal';
import { InspectionHeaderKpi } from './inspection/InspectionHeaderKpi';
import { InspectionTaskSidebar } from './inspection/InspectionTaskSidebar';
import { InspectionPointsWorkbench } from './inspection/InspectionPointsWorkbench';
import { InspectionRecordModal } from './inspection/InspectionRecordModal';
import { InspectionQrModal } from './inspection/InspectionQrModal';
import { useInspectionQrScanner } from './inspection/useInspectionQrScanner';
import { useInspectionAi } from './inspection/useInspectionAi';
import { useInspectionRecord } from './inspection/useInspectionRecord';

interface InspectionViewProps {
  currentUser: UserProfile;
  inspections: InspectionTask[];
  equipments: Equipment[];
  targetEquipmentId?: string;
  onUpdateInspection: (task: InspectionTask) => void;
  onConvertAbnormalToWorkOrder: (point: InspectionItem, equipmentName: string) => void;
  onCreateWorkOrder?: (wo: WorkOrder) => void;
}

export const InspectionView: React.FC<InspectionViewProps> = ({
  currentUser,
  inspections = [],
  equipments = [],
  targetEquipmentId,
  onUpdateInspection,
  onConvertAbnormalToWorkOrder,
  onCreateWorkOrder,
}) => {
  const [activeTaskId, setActiveTaskId] = useState<string>(inspections[0]?.id || '');
  const [onlyMyTasks, setOnlyMyTasks] = useState<boolean>(currentUser.role === 'inspector');
  const [showQrModal, setShowQrModal] = useState(false);
  const [selectedQrEquipId, setSelectedQrEquipId] = useState<string>(equipments[0]?.id || 'EQ-001');
  const [qrScanSuccess, setQrScanSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser.role === 'inspector') {
      setOnlyMyTasks(true);
    }
  }, [currentUser.id, currentUser.role]);

  const myName = (currentUser.name || '').trim();
  const myId = (currentUser.id || '').trim();

  const isMyTask = (t: InspectionTask) => {
    const insp = (t as any).inspector || t.inspectorId || '';
    const ass = (t as any).assignee || '';
    return (
      Boolean(insp && (insp.includes(myName) || (myId && insp.includes(myId)))) ||
      Boolean(ass && (ass.includes(myName) || (myId && ass.includes(myId)))) ||
      Boolean((t as any).inspectorId && (t as any).inspectorId === myId)
    );
  };

  const displayInspections = onlyMyTasks ? (inspections || []).filter(isMyTask) : (inspections || []);

  useEffect(() => {
    if (displayInspections.length > 0) {
      if (!activeTaskId || !displayInspections.some((t) => t.id === activeTaskId)) {
        setActiveTaskId(displayInspections[0].id);
      }
    }
  }, [displayInspections, activeTaskId]);

  const activeTask =
    displayInspections.find((t) => t.id === activeTaskId) ||
    displayInspections[0] ||
    inspections.find((t) => t.id === activeTaskId) ||
    inspections[0];

  const itemsList: InspectionItem[] = activeTask
    ? activeTask.items || (activeTask as any).points || []
    : [];

  const {
    reportState,
    setReportState,
    aiDraftState,
    setAiDraftState,
    hazardNotice,
    setHazardNotice,
    handleConvertAbnormalToHazard,
    handleInspectionReport,
    handleAiGenerateWorkOrder,
  } = useInspectionAi();

  const {
    selectedPoint,
    setSelectedPoint,
    pointReading,
    setPointReading,
    createHazardOnSave,
    setCreateHazardOnSave,
    hazardLevelOnSave,
    setHazardLevelOnSave,
    handleSelectPoint,
    handleSavePointRecord,
  } = useInspectionRecord();

  const qrScanner = useInspectionQrScanner({
    equipments,
    isOpen: showQrModal,
    onMatched: (matched) => {
      setSelectedQrEquipId(matched.id);
      setQrScanSuccess(`已扫码识别设备: ${matched.name} (${matched.code || matched.id})`);
      const matchedTask = inspections.find(
        (t) => t.title.includes(matched.name) || (t.route && t.route.includes(matched.workshop))
      );
      if (matchedTask) setActiveTaskId(matchedTask.id);
      setTimeout(() => setShowQrModal(false), 1500);
    },
  });

  const openQrModal = () => {
    setShowQrModal(true);
    setQrScanSuccess(null);
    qrScanner.setCameraError(null);
    setTimeout(() => {
      qrScanner.startCamera();
    }, 150);
  };

  useEffect(() => {
    if (targetEquipmentId) {
      const eq = equipments.find((e) => e.id === targetEquipmentId || e.code === targetEquipmentId);
      if (eq) {
        setSelectedQrEquipId(eq.id);
        const matchedTask = inspections.find(
          (t) => t.title.includes(eq.name) || (t.route && t.route.includes(eq.workshop))
        );
        if (matchedTask) {
          setActiveTaskId(matchedTask.id);
        }
        setQrScanSuccess(`【手机扫码直达】已通过二维码电子铭牌精准核验设备：${eq.name} (${eq.code})，已载入巡检作业表单！`);
      }
    }
  }, [targetEquipmentId, equipments, inspections]);

  const totalPointsCount = (inspections || []).reduce((sum, t) => sum + (t.totalPoints || 0), 0) || 40;
  const completedPointsCount = (inspections || []).reduce((sum, t) => sum + (t.completedPoints || 0), 0) || 25;
  const totalAbnormalCount = (inspections || []).reduce((sum, t) => sum + (t.abnormalCount || 0), 0) || 14;
  const overallRate = totalPointsCount > 0 ? Math.round((completedPointsCount / totalPointsCount) * 100) : 63;

  return (
    <div className="space-y-6 pb-12">
      <InspectionHeaderKpi
        currentUser={currentUser}
        completedPointsCount={completedPointsCount}
        totalPointsCount={totalPointsCount}
        totalAbnormalCount={totalAbnormalCount}
        overallRate={overallRate}
        onOpenQrModal={openQrModal}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <InspectionTaskSidebar
          displayInspections={displayInspections}
          activeTaskId={activeTask?.id || activeTaskId}
          onlyMyTasks={onlyMyTasks}
          onToggleOnlyMyTasks={() => setOnlyMyTasks(!onlyMyTasks)}
          onSelectTask={(taskId) => {
            setActiveTaskId(taskId);
            setSelectedPoint(null);
          }}
        />

        <InspectionPointsWorkbench
          activeTask={activeTask}
          itemsList={itemsList}
          hazardNotice={hazardNotice}
          onCloseHazardNotice={() => setHazardNotice(null)}
          onInspectionReport={() => handleInspectionReport(activeTask?.workshop)}
          onSelectPoint={handleSelectPoint}
          onConvertAbnormalToWorkOrder={onConvertAbnormalToWorkOrder}
          onConvertAbnormalToHazard={(pt) => handleConvertAbnormalToHazard(pt, currentUser)}
          onAiGenerateWorkOrder={(pt) => handleAiGenerateWorkOrder(pt, equipments)}
        />
      </div>

      <AiWorkOrderDraftModal
        open={aiDraftState.open}
        title="AI 智能生成检修工单草稿"
        loading={aiDraftState.loading}
        error={aiDraftState.error}
        degraded={aiDraftState.degraded}
        draft={aiDraftState.draft || undefined}
        equipment={aiDraftState.equipment}
        operatorName={`${currentUser.name} (${currentUser.roleTitle})`}
        onClose={() => setAiDraftState((prev) => ({ ...prev, open: false }))}
        onCreated={(wo) => onCreateWorkOrder?.(wo)}
      />

      <AiResultModal
        open={reportState.open}
        title="AI 巡检报告（近 7 天真实数据聚合）"
        loading={reportState.loading}
        error={reportState.error}
        degraded={reportState.degraded}
        pendingReview={!!reportState.reviewId}
        data={reportState.data}
        onClose={() => setReportState((prev) => ({ ...prev, open: false }))}
      />

      <InspectionRecordModal
        selectedPoint={selectedPoint}
        pointReading={pointReading}
        createHazardOnSave={createHazardOnSave}
        hazardLevelOnSave={hazardLevelOnSave}
        onChangeReadingValue={(val) => setPointReading((prev) => ({ ...prev, value: val }))}
        onChangeReadingNotes={(notes) => setPointReading((prev) => ({ ...prev, notes }))}
        onChangeReadingIsAbnormal={(isAbnormal) => {
          setPointReading((prev) => ({ ...prev, isAbnormal }));
          if (isAbnormal) setCreateHazardOnSave(true);
        }}
        onChangeCreateHazard={setCreateHazardOnSave}
        onChangeHazardLevel={setHazardLevelOnSave}
        onClose={() => setSelectedPoint(null)}
        onSave={() =>
          handleSavePointRecord(activeTask, currentUser, onUpdateInspection, (notice) => {
            setHazardNotice(notice);
            setTimeout(() => setHazardNotice(null), 3500);
          })
        }
      />

      <InspectionQrModal
        open={showQrModal}
        equipments={equipments}
        selectedQrEquipId={selectedQrEquipId}
        qrScanSuccess={qrScanSuccess}
        cameraActive={qrScanner.cameraActive}
        cameraError={qrScanner.cameraError}
        scanning={qrScanner.scanning}
        videoRef={qrScanner.videoRef}
        canvasRef={qrScanner.canvasRef}
        onStartCamera={qrScanner.startCamera}
        onStopCamera={qrScanner.stopCamera}
        onChangeSelectedQrEquipId={(id) => {
          setSelectedQrEquipId(id);
          setQrScanSuccess(null);
        }}
        onSelectEquipmentForInspection={(curEq) => {
          setQrScanSuccess(`演示模式：已选择 ${curEq.name} (${curEq.code})，巡检表单已就绪。`);
          const matchedTask = inspections.find(
            (t) => t.title.includes(curEq.name) || (t.route && t.route.includes(curEq.workshop))
          );
          if (matchedTask) setActiveTaskId(matchedTask.id);
          setShowQrModal(false);
        }}
        onClose={() => setShowQrModal(false)}
      />
    </div>
  );
};
