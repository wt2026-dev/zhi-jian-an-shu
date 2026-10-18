import React from 'react';
import { UserProfile } from '../../types';
import { AiResultModal } from '../ai/AiResultModal';
import { AiWorkOrderDraftModal } from '../ai/AiWorkOrderDraftModal';
import {
  ForecastModalState,
  DraftModalState,
  SummaryModalState,
  AlarmCorrelationModalState,
} from './healthTypes';

interface HealthAiModalsProps {
  forecastState: ForecastModalState;
  onCloseForecast: () => void;
  summaryState: SummaryModalState;
  onCloseSummary: () => void;
  corrState: AlarmCorrelationModalState;
  onCloseCorr: () => void;
  draftState: DraftModalState;
  onCloseDraft: () => void;
  onCreatedWorkOrder: (wo: unknown) => void;
  currentUser?: UserProfile;
}

export const HealthAiModals: React.FC<HealthAiModalsProps> = ({
  forecastState,
  onCloseForecast,
  summaryState,
  onCloseSummary,
  corrState,
  onCloseCorr,
  draftState,
  onCloseDraft,
  onCreatedWorkOrder,
  currentUser,
}) => {
  return (
    <>
      {/* AI 劣化趋势预警弹窗 */}
      <AiResultModal
        open={forecastState.open}
        title="AI 设备劣化趋势预警"
        loading={forecastState.loading}
        error={forecastState.error}
        degraded={forecastState.degraded}
        data={forecastState.data}
        onClose={onCloseForecast}
      />

      {/* AI 设备健康画像弹窗 */}
      <AiResultModal
        open={summaryState.open}
        title="AI 设备健康画像 (档案 + 遥测 + 工单 + 巡检综合摘要)"
        loading={summaryState.loading}
        error={summaryState.error}
        degraded={summaryState.degraded}
        data={summaryState.data}
        onClose={onCloseSummary}
      />

      {/* AI 报警关联分析弹窗 */}
      <AiResultModal
        open={corrState.open}
        title="AI 报警关联分析 (根因识别 / 因果图谱 / 处置建议)"
        loading={corrState.loading}
        error={corrState.error}
        degraded={corrState.degraded}
        data={corrState.data}
        onClose={onCloseCorr}
      />

      {/* AI 生成检修工单草稿弹窗 */}
      <AiWorkOrderDraftModal
        open={draftState.open}
        title="AI 智能生成检修工单草稿"
        loading={draftState.loading}
        error={draftState.error}
        degraded={draftState.degraded}
        draft={draftState.draft || undefined}
        equipment={draftState.equipment}
        operatorName={currentUser ? `${currentUser.name} (${currentUser.roleTitle})` : '健康监测转单'}
        onClose={onCloseDraft}
        onCreated={onCreatedWorkOrder}
      />
    </>
  );
};
