import { useState } from 'react';
import { InspectionItem, InspectionTask, UserProfile, Hazard } from '../../types';
import { hazardsApi } from '../../api';
import { logger } from '../../utils/logger';

export function useInspectionRecord() {
  const [selectedPoint, setSelectedPoint] = useState<InspectionItem | null>(null);
  const [createHazardOnSave, setCreateHazardOnSave] = useState(false);
  const [hazardLevelOnSave, setHazardLevelOnSave] = useState<'general' | 'major'>('general');
  const [pointReading, setPointReading] = useState<{
    value: number;
    notes: string;
    isAbnormal: boolean;
  }>({
    value: 0,
    notes: '',
    isAbnormal: false,
  });

  const handleSelectPoint = (pt: InspectionItem) => {
    setSelectedPoint(pt);
    const minV = pt.minLimit ?? pt.minVal;
    const maxV = pt.maxLimit ?? pt.maxVal;
    const defaultValue =
      typeof pt.recordedValue === 'number'
        ? pt.recordedValue
        : minV !== undefined && maxV !== undefined
        ? (minV + maxV) / 2
        : 25;

    const isAbnormalInit = pt.isPass === false || pt.status === 'abnormal';
    setCreateHazardOnSave(isAbnormalInit);
    setHazardLevelOnSave('general');

    setPointReading({
      value: defaultValue,
      notes: pt.notes || '',
      isAbnormal: isAbnormalInit,
    });
  };

  const handleSavePointRecord = (
    activeTask: InspectionTask | null | undefined,
    currentUser: UserProfile,
    onUpdateInspection: (task: InspectionTask) => void,
    onHazardCreated?: (notice: string) => void
  ) => {
    if (!activeTask || !selectedPoint) return;

    const maxVal = selectedPoint.maxLimit ?? selectedPoint.maxVal;
    const minVal = selectedPoint.minLimit ?? selectedPoint.minVal;

    const isAbnormal =
      (maxVal !== undefined && pointReading.value > maxVal) ||
      (minVal !== undefined && pointReading.value < minVal) ||
      pointReading.isAbnormal;

    if (createHazardOnSave) {
      const hazardData: Partial<Hazard> = {
        code: `HAZ-INSP-${Date.now().toString().slice(-5)}`,
        title: `【巡检发现异常】${selectedPoint.equipmentName} ${selectedPoint.checkPoint || selectedPoint.checkItem}超标`,
        level: hazardLevelOnSave,
        category: '设备安全',
        equipment_id: selectedPoint.equipmentId,
        equipment_name: selectedPoint.equipmentName,
        location: '现场巡检位',
        description: `日常巡检测点实测超标/异常。标准要求「${selectedPoint.standard}」，现场实测「${pointReading.value} ${selectedPoint.unit || ''}」${pointReading.notes ? `，现场备注：${pointReading.notes}` : ''}。`,
        reported_by: currentUser.name,
      };
      hazardsApi
        .create(hazardData)
        .then(() => {
          onHazardCreated?.(`✅ 测点 [${selectedPoint.equipmentName} - ${selectedPoint.checkPoint || selectedPoint.checkItem}] 已同步登记为现场隐患并纳入闭环！`);
        })
        .catch((e) => logger.error('登记隐患失败:', e));
    }

    const currentItems: InspectionItem[] = activeTask.items || (activeTask as { points?: InspectionItem[] }).points || [];
    const updatedItems = currentItems.map((p: InspectionItem) => {
      if (p.id === selectedPoint.id) {
        return {
          ...p,
          status: (isAbnormal ? 'abnormal' : 'normal') as InspectionItem['status'],
          isPass: !isAbnormal,
          recordedValue: Number(pointReading.value),
          recordedTime: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          notes: pointReading.notes,
        };
      }
      return p;
    });

    const completedCount = updatedItems.filter(
      (p: InspectionItem) =>
        (p.status !== undefined && p.status !== 'pending') ||
        (p.recordedValue !== undefined && p.recordedValue !== '') ||
        p.isPass !== undefined
    ).length;
    const abnormalCount = updatedItems.filter(
      (p: InspectionItem) => p.isPass === false || p.status === 'abnormal'
    ).length;

    const updatedTask: InspectionTask = {
      ...activeTask,
      items: updatedItems,
      completedPoints: completedCount,
      abnormalCount: abnormalCount,
      status: completedCount === updatedItems.length ? 'completed' : 'in_progress',
    };

    onUpdateInspection(updatedTask);
    setSelectedPoint(null);
  };

  return {
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
  };
}
