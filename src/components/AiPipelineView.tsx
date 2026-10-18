import React from 'react';
import { useAiPipeline } from './pipeline/useAiPipeline';
import { PipelineHeader } from './pipeline/PipelineHeader';
import { PipelineTopologyCard } from './pipeline/PipelineTopologyCard';
import { PipelineCapabilityCards } from './pipeline/PipelineCapabilityCards';
import { PipelineTriggerConsole } from './pipeline/PipelineTriggerConsole';
import { PipelineExecutionFlow } from './pipeline/PipelineExecutionFlow';
import { PipelineSummaryReport } from './pipeline/PipelineSummaryReport';
import { PipelineRecentHistory } from './pipeline/PipelineRecentHistory';

export interface AiPipelineViewProps {
  /** 携带任务设备跳转调度大屏（派单推荐卡片「前往调度」） */
  onGoDispatch?: (preset: { workOrderId?: string | null; equipmentId?: string | null }) => void;
}

export const AiPipelineView: React.FC<AiPipelineViewProps> = ({ onGoDispatch }) => {
  const {
    equipments,
    equipmentId,
    setEquipmentId,
    problem,
    setProblem,
    starting,
    error,
    task,
    recentTasks,
    loadingRecent,
    loadingTaskId,
    taskSectionRef,
    isTerminal,
    loadRecentTasks,
    handleStart,
    handleSelectRecentTask,
  } = useAiPipeline();

  return (
    <div className="p-4 md:p-6 max-w-[1140px] mx-auto space-y-5">
      {/* 1. 页头：工业 SaaS 控制台风格顶栏 */}
      <PipelineHeader />

      {/* 2. 编排拓扑架构：DAG 异步并发流水线 */}
      <PipelineTopologyCard />

      {/* 3. 协同能力说明（4 张能力卡） */}
      <PipelineCapabilityCards />

      {/* 4. 协同诊断发起控制台 */}
      <PipelineTriggerConsole
        equipments={equipments}
        equipmentId={equipmentId}
        onSelectEquipment={setEquipmentId}
        problem={problem}
        onChangeProblem={setProblem}
        starting={starting}
        error={error}
        onStart={handleStart}
      />

      {/* 5. 步骤执行状态 */}
      {task && (
        <PipelineExecutionFlow
          task={task}
          taskSectionRef={taskSectionRef}
        />
      )}

      {/* 6. 协同检修报告（完成后汇总） */}
      {isTerminal && task && (
        <PipelineSummaryReport
          task={task}
          onGoDispatch={onGoDispatch}
        />
      )}

      {/* 7. 最近协同任务列表 */}
      <PipelineRecentHistory
        recentTasks={recentTasks}
        loadingRecent={loadingRecent}
        loadingTaskId={loadingTaskId}
        currentTaskId={task?.id}
        onRefresh={loadRecentTasks}
        onSelectTask={handleSelectRecentTask}
      />
    </div>
  );
};
