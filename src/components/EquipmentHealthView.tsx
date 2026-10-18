import React from 'react';
import { EquipmentHealthViewProps } from './equipment-health/healthTypes';
import { useEquipmentHealth } from './equipment-health/useEquipmentHealth';
import { EquipmentHealthHeader } from './equipment-health/EquipmentHealthHeader';
import { EquipmentSelectorBar } from './equipment-health/EquipmentSelectorBar';
import { HealthScoreCard } from './equipment-health/HealthScoreCard';
import { RealtimeMetersCard } from './equipment-health/RealtimeMetersCard';
import { TelemetryChartsPanel } from './equipment-health/TelemetryChartsPanel';
import { HealthAiModals } from './equipment-health/HealthAiModals';

export type { EquipmentHealthViewProps } from './equipment-health/healthTypes';

export const EquipmentHealthView: React.FC<EquipmentHealthViewProps> = (props) => {
  const {
    equipments,
    onOpenWorkOrder,
    onNavigateTo3D,
    currentUser,
  } = props;

  const {
    activeEqId,
    currentEquipment,
    isSimulating,
    setIsSimulating,
    sampleSpeed,
    setSampleSpeed,
    historyData,
    loadingTelemetry,
    latest,
    isVibAlert,
    isTempAlert,
    aiAnalyzing,
    aiSafetyNotice,
    aiDiagTraceability,
    aiAnalysisResult,
    selectedChartPoint,
    setSelectedChartPoint,
    forecastState,
    setForecastState,
    draftState,
    setDraftState,
    summaryState,
    setSummaryState,
    corrState,
    setCorrState,
    demo,
    fetchTelemetryHistory,
    handleSelectEquipment,
    handleEquipmentSummary,
    handleAlarmCorrelation,
    handleHealthForecast,
    handleAiDraftWorkOrder,
    runAiAnalysis,
    handleCreatedWorkOrder,
  } = useEquipmentHealth(props);

  const alarmEquipmentsCount = equipments.filter(
    (e) => e.status === 'warning' || e.status === 'fault'
  ).length;

  return (
    <div className="space-y-6 pb-12">
      {/* 顶部标题与时序刷新/模拟控制栏 */}
      <EquipmentHealthHeader
        isSimulating={isSimulating}
        setIsSimulating={setIsSimulating}
        sampleSpeed={sampleSpeed}
        setSampleSpeed={setSampleSpeed}
        loadingTelemetry={loadingTelemetry}
        onRefreshTelemetry={() => fetchTelemetryHistory(activeEqId)}
        demo={demo}
      />

      {/* 设备选择胶囊导航 */}
      <EquipmentSelectorBar
        equipments={equipments}
        activeEqId={activeEqId}
        onSelectEquipment={handleSelectEquipment}
      />

      {/* 核心监控栅格 */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧：综合健康分与实时仪表读数 */}
        <div className="space-y-4">
          <HealthScoreCard
            currentEquipment={currentEquipment}
            isVibAlert={isVibAlert}
            isTempAlert={isTempAlert}
            aiAnalyzing={aiAnalyzing}
            alarmEquipmentsCount={alarmEquipmentsCount}
            onRunAiAnalysis={runAiAnalysis}
            onHealthForecast={handleHealthForecast}
            onAiDraftWorkOrder={handleAiDraftWorkOrder}
            onEquipmentSummary={handleEquipmentSummary}
            onAlarmCorrelation={handleAlarmCorrelation}
            onNavigateTo3D={onNavigateTo3D}
            onOpenWorkOrder={onOpenWorkOrder}
          />

          <RealtimeMetersCard
            latest={latest}
            isTempAlert={isTempAlert}
            isVibAlert={isVibAlert}
          />
        </div>

        {/* 右侧：遥测双曲线与 AI 即时研判面板 */}
        <TelemetryChartsPanel
          historyData={historyData}
          isSimulating={isSimulating}
          onStartSimulating={() => setIsSimulating(true)}
          demo={demo}
          aiAnalysisResult={aiAnalysisResult}
          aiSafetyNotice={aiSafetyNotice}
          aiDiagTraceability={aiDiagTraceability}
          selectedChartPoint={selectedChartPoint}
          onSelectChartPoint={setSelectedChartPoint}
        />
      </div>

      {/* AI 诊断、预警、画像与工单草稿弹窗 */}
      <HealthAiModals
        forecastState={forecastState}
        onCloseForecast={() => setForecastState((prev) => ({ ...prev, open: false }))}
        summaryState={summaryState}
        onCloseSummary={() => setSummaryState((prev) => ({ ...prev, open: false }))}
        corrState={corrState}
        onCloseCorr={() => setCorrState((prev) => ({ ...prev, open: false }))}
        draftState={draftState}
        onCloseDraft={() => setDraftState((prev) => ({ ...prev, open: false }))}
        onCreatedWorkOrder={handleCreatedWorkOrder}
        currentUser={currentUser}
      />
    </div>
  );
};
