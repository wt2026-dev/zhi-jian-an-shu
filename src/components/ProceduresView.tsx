import React, { useState, useEffect } from 'react';
import { procedureApi } from '../api';
import { useToast } from '../context/ToastContext';
import { MaintenanceProcedure, UserProfile } from '../types';
import { ProceduresHeader } from './procedures/ProceduresHeader';
import { ProcedureListSidebar } from './procedures/ProcedureListSidebar';
import { ProcedureVideoSection } from './procedures/ProcedureVideoSection';
import { ProcedureStepsSection } from './procedures/ProcedureStepsSection';
import { ProcedureScriptModal } from './procedures/ProcedureScriptModal';
import { useProcedureScript } from './procedures/useProcedureScript';
import { useProcedureVideos } from './procedures/useProcedureVideos';

export interface ProceduresViewProps {
  currentUser: UserProfile;
  preselectedEquipmentType?: string;
  preselectedLevel?: string;
  onSelectProcedure?: (proc: MaintenanceProcedure) => void;
}

export const ProceduresView: React.FC<ProceduresViewProps> = ({
  currentUser,
  preselectedEquipmentType,
  preselectedLevel,
  onSelectProcedure,
}) => {
  const { show: showToast } = useToast();
  const [procedures, setProcedures] = useState<MaintenanceProcedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选状态
  const [selectedType, setSelectedType] = useState<string>(preselectedEquipmentType || 'all');
  const [selectedLevel, setSelectedLevel] = useState<string>(preselectedLevel || 'all');
  const [activeProcedureId, setActiveProcedureId] = useState<string>('');

  // 步骤勾选状态 (规程ID -> Set of completed step numbers)
  const [completedSteps, setCompletedSteps] = useState<Record<string, number[]>>({});

  // 加载规程列表
  const loadProcedures = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await procedureApi.list({
        equipmentType: selectedType !== 'all' ? selectedType : undefined,
        maintenanceLevel: selectedLevel !== 'all' ? selectedLevel : undefined,
      });
      setProcedures(data);
      if (data.length > 0 && (!activeProcedureId || !data.some((p: MaintenanceProcedure) => p.id === activeProcedureId))) {
        setActiveProcedureId(data[0].id);
      }
    } catch (err: unknown) {
      setError((err as Error)?.message || '规程加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProcedures();
  }, [selectedType, selectedLevel]);

  const activeProcedure = procedures.find((p) => p.id === activeProcedureId) || procedures[0];

  useEffect(() => {
    if (activeProcedure && onSelectProcedure) {
      onSelectProcedure(activeProcedure);
    }
  }, [activeProcedure, onSelectProcedure]);

  // 仿真文字分镜脚本 Hook
  const script = useProcedureScript({
    activeProcedure,
    showToast,
  });

  // Agnes AI 真实视频生成与轮询 Hook
  const video = useProcedureVideos({
    activeProcedure,
    showToast,
  });

  const checkedStepsForActive = activeProcedure ? completedSteps[activeProcedure.id] || [] : [];
  const isAllStepsCompleted =
    Boolean(activeProcedure?.steps?.length &&
    checkedStepsForActive.length === activeProcedure.steps.length);

  // 勾选处理 (顺序门禁机制：必须完成上一步才能进入下一步)
  const handleToggleStep = (stepNo: number) => {
    if (!activeProcedure) return;
    const currentList = [...checkedStepsForActive];
    const isChecked = currentList.includes(stepNo);

    if (isChecked) {
      // 取消勾选时，取消该步及之后所有步骤
      const filtered = currentList.filter((n) => n < stepNo);
      setCompletedSteps({ ...completedSteps, [activeProcedure.id]: filtered });
    } else {
      // 必须先勾选前面的所有步骤
      const prevSteps = Array.from({ length: stepNo - 1 }, (_, i) => i + 1);
      const allPrevChecked = prevSteps.every((n) => currentList.includes(n));
      if (!allPrevChecked) {
        showToast({
          type: 'warning',
          title: '合规互锁警告',
          message: `必须先逐项确认完成第 1 至第 ${stepNo - 1} 步的作业与安全验收，方可进行第 ${stepNo} 步！`,
        });
        return;
      }
      setCompletedSteps({
        ...completedSteps,
        [activeProcedure.id]: [...currentList, stepNo].sort((a, b) => a - b),
      });
    }
  };

  const canDeleteVideo = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部固定容器：标题区 + 操作栏 + 筛选过滤 */}
      <ProceduresHeader
        activeProcedure={activeProcedure}
        generatingScript={script.generatingScript}
        generatingVideo={video.generatingVideo}
        videoDuration={video.videoDuration}
        selectedType={selectedType}
        selectedLevel={selectedLevel}
        onSelectType={setSelectedType}
        onSelectLevel={setSelectedLevel}
        onSetVideoDuration={video.setVideoDuration}
        onOpenScriptModal={script.handleOpenVideo}
        onGenerateRealVideo={video.handleGenerateRealVideo}
        onGenerateFullVideo={video.handleGenerateFullVideo}
      />

      {/* 下方指引列表/卡片区：单独滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-6">
        {loading ? (
          <div className="card-industrial bg-white border border-slate-200 p-12 text-center text-slate-500 text-sm shadow-xs">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            正在加载标准化作业指引库...
          </div>
        ) : error ? (
          <div className="card-industrial bg-white border border-slate-200 p-8 text-center text-rose-600 text-sm shadow-xs">
            {error}
          </div>
        ) : procedures.length === 0 ? (
          <div className="card-industrial bg-white border border-slate-200 p-12 text-center text-slate-500 text-sm shadow-xs">
            暂无符合条件的作业指引
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* 左侧规程清单 */}
            <ProcedureListSidebar
              procedures={procedures}
              activeProcedureId={activeProcedure?.id || ''}
              completedSteps={completedSteps}
              onSelectProcedureId={setActiveProcedureId}
            />

            {/* 右侧步骤卡片流与合规校验 */}
            <div className="lg:col-span-8 space-y-5">
              {activeProcedure && (
                <>
                  <ProcedureStepsSection
                    activeProcedure={activeProcedure}
                    checkedSteps={checkedStepsForActive}
                    isAllStepsCompleted={isAllStepsCompleted}
                    onToggleStep={handleToggleStep}
                  />

                  <ProcedureVideoSection
                    generatingVideo={video.generatingVideo}
                    videoStatusText={video.videoStatusText}
                    videoError={video.videoError}
                    videoSuccessNotice={video.videoSuccessNotice}
                    currentTaskId={video.currentTaskId}
                    currentActiveVideoUrl={video.currentActiveVideoUrl}
                    historyVideos={video.historyVideos}
                    loadingVideos={video.loadingVideos}
                    internalStatus={video.internalStatus}
                    elapsedSec={video.elapsedSec}
                    progressPct={video.progressPct}
                    canDeleteVideo={canDeleteVideo}
                    onRefreshVideos={() => video.loadProcedureVideos(activeProcedure.id)}
                    onCancelVideoTask={video.handleCancelVideoTask}
                    onDismissSuccessNotice={() => video.setVideoSuccessNotice(null)}
                    onRetryGenerate={
                      video.currentTaskId?.startsWith('full-')
                        ? video.handleGenerateFullVideo
                        : video.handleGenerateRealVideo
                    }
                    onSelectVideoUrl={video.setCurrentActiveVideoUrl}
                    onDeleteVideo={video.handleDeleteVideo}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 仿真视频分镜播放器弹窗 */}
      {script.showVideoModal && activeProcedure && script.videoScript && (
        <ProcedureScriptModal
          isOpen={script.showVideoModal}
          activeProcedure={activeProcedure}
          videoScript={script.videoScript}
          currentStepIndex={script.currentStepIndex}
          isPlaying={script.isPlaying}
          isMuted={script.isMuted}
          isFullscreen={script.isFullscreen}
          onClose={script.handleCloseVideo}
          onToggleFullscreen={() => script.setIsFullscreen(!script.isFullscreen)}
          onToggleMute={() => script.setIsMuted(!script.isMuted)}
          onPlayPause={script.handlePlayPause}
          onNextStep={script.handleNextStep}
          onPrevStep={script.handlePrevStep}
          onReplay={script.handleReplay}
          onSelectStepIndex={(idx) => {
            script.setCurrentStepIndex(idx);
            if (script.isPlaying) script.handlePlayPause();
          }}
        />
      )}
    </div>
  );
};
