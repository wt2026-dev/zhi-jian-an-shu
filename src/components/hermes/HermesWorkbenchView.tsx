import React, { useState } from 'react';
import { 
  INITIAL_HERMES_LOOP_DATA, 
  type BusinessClosedLoopData, 
  type StageId,
  type LotoConfirmationItem
} from './demoData';
import { BusinessOverviewCard } from './BusinessOverviewCard';
import { ClosedLoopStepper } from './ClosedLoopStepper';
import { StageWorkbench } from './StageWorkbench';
import { AiContextRail } from './AiContextRail';
import { ArtifactArchive } from './ArtifactArchive';
import { AiButlerSuggestions } from './AiButlerSuggestions';
import { HistoryLoops } from './HistoryLoops';
import { GoalInputHero } from './GoalInputHero';
import { useToast } from '../../context/ToastContext';
import { Sparkles, CheckCircle2, Archive, X } from 'lucide-react';

interface HermesWorkbenchViewProps {
  onNavigateTab?: (tabKey: string) => void;
}

export const HermesWorkbenchView: React.FC<HermesWorkbenchViewProps> = ({
  onNavigateTab,
}) => {
  const { show: showToast } = useToast();
  const [isGoalInputMode, setIsGoalInputMode] = useState(false);
  const [loopData, setLoopData] = useState<BusinessClosedLoopData>(INITIAL_HERMES_LOOP_DATA);
  const [selectedStageId, setSelectedStageId] = useState<StageId>('stage_loto');
  const [showArchiveSuccessModal, setShowArchiveSuccessModal] = useState(false);

  // 切换 LOTO 项确认状态
  const handleToggleLotoItem = (itemId: string) => {
    setLoopData((prev) => {
      const nextLoto = prev.lotoItems.map((item) => {
        if (item.id === itemId) {
          const nextConfirmed = !item.confirmed;
          return {
            ...item,
            confirmed: nextConfirmed,
            confirmTime: nextConfirmed ? '刚刚' : undefined,
            operator: nextConfirmed ? '陈主管 (当前用户)' : '待现场确认',
          };
        }
        return item;
      });
      return {
        ...prev,
        lotoItems: nextLoto,
      };
    });
  };

  // 环节流转推进
  const handleAdvanceStage = (fromStageId: StageId) => {
    const stageSequence: StageId[] = [
      'stage_report',
      'stage_permit',
      'stage_loto',
      'stage_execution',
      'stage_completion',
      'stage_archive',
    ];

    const currentIndex = stageSequence.indexOf(fromStageId);
    const nextIndex = currentIndex + 1;

    // TODO: 调用后端业务接口
    // - 环节 1: POST /api/ai/generate-work-order
    // - 环节 2: POST /api/ai/safety-risk-assessment
    // - 环节 3: GET /api/loto-locks & POST /api/ai/safety-risk-assessment
    // - 环节 4: POST /api/ai/generate-maintenance-plan
    // - 环节 5: POST /api/ai/generate-report
    // - 环节 6: POST /api/ai/suggest-contribution & POST /api/knowledge/contributions

    setLoopData((prev) => {
      const updatedStages = prev.stages.map((stage) => {
        if (stage.id === fromStageId) {
          return {
            ...stage,
            status: 'completed' as const,
            completedTime: '刚刚',
          };
        }
        if (nextIndex < stageSequence.length && stage.id === stageSequence[nextIndex]) {
          return {
            ...stage,
            status: 'in_progress' as const,
          };
        }
        return stage;
      });

      // 同步更新产出物状态
      const updatedArtifacts = prev.artifacts.map((art) => {
        if (art.stageId === fromStageId) {
          return { ...art, status: 'ready' as const };
        }
        return art;
      });

      const completedCount = updatedStages.filter((s) => s.status === 'completed').length;
      const percent = Math.round((completedCount / updatedStages.length) * 100);

      return {
        ...prev,
        progress: {
          ...prev.progress,
          currentStageOrder: Math.min(nextIndex + 1, stageSequence.length),
          percent,
        },
        stages: updatedStages,
        artifacts: updatedArtifacts,
      };
    });

    if (nextIndex < stageSequence.length) {
      const nextStageId = stageSequence[nextIndex];
      setSelectedStageId(nextStageId);
      const nextStageMeta = loopData.stages.find((s) => s.id === nextStageId);
      showToast({
        type: 'success',
        title: '环节推进成功',
        message: `已自动推进至「${nextStageMeta?.title || '下一环节'}」，AI 正在预填相关参数`,
        duration: 3500,
      });
    } else {
      setShowArchiveSuccessModal(true);
      showToast({
        type: 'success',
        title: '🎉 业务全闭环达成！',
        message: '6大环节已全部核准完成，全套档案已生成并沉淀至企业知识库',
        duration: 5000,
      });
    }
  };

  // 归档操作
  const handleArchive = () => {
    const isAllDone = loopData.stages.every((s) => s.status === 'completed');
    if (isAllDone) {
      setShowArchiveSuccessModal(true);
    } else {
      showToast({
        type: 'info',
        title: '当前业务进行中',
        message: `当前已推进至第 ${loopData.progress.currentStageOrder}/6 环节，系统已自动暂存当前闭环全部快照`,
        duration: 3500,
      });
    }
  };

  // 生成新路线
  const handleGeneratePlan = (goalText: string) => {
    // TODO: 调用 POST /api/ai/generate-work-order 与 POST /api/ai/safety-risk-assessment
    setLoopData((prev) => ({
      ...prev,
      businessGoal: goalText,
      loopCode: `PL-20250618-${Math.floor(Math.random() * 900 + 100)}`,
    }));
    setIsGoalInputMode(false);
    setSelectedStageId('stage_loto');
  };

  return (
    <div className="space-y-4 pb-8">
      {/* 意图输入与路线规划模式 */}
      {isGoalInputMode ? (
        <GoalInputHero
          onGeneratePlan={handleGeneratePlan}
          onCancel={() => setIsGoalInputMode(false)}
        />
      ) : (
        <>
          {/* 1. 当前业务总览横幅卡 */}
          <BusinessOverviewCard
            data={loopData}
            onNewGoal={() => setIsGoalInputMode(true)}
            onArchive={handleArchive}
            onSelectStage={(idx) => {
              if (loopData.stages[idx]) {
                setSelectedStageId(loopData.stages[idx].id);
              }
            }}
          />

          {/* 2. 业务闭环六环节横向步骤条 */}
          <ClosedLoopStepper
            stages={loopData.stages}
            selectedStageId={selectedStageId}
            onSelectStage={(id) => setSelectedStageId(id)}
          />

          {/* 3 & 4. 主工作区与 AI 上下文贯穿条 (2/3 与 1/3) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* 左侧 2/3：当前环节工作台 */}
            <div className="lg:col-span-8 min-h-[460px] flex flex-col">
              <StageWorkbench
                currentStageId={selectedStageId}
                stages={loopData.stages}
                lotoItems={loopData.lotoItems}
                loopData={loopData}
                onToggleLotoItem={handleToggleLotoItem}
                onAdvanceStage={handleAdvanceStage}
                onNavigateToTab={onNavigateTab}
              />
            </div>

            {/* 右侧 1/3：AI 上下文贯穿条 */}
            <div className="lg:col-span-4">
              <AiContextRail data={loopData} />
            </div>
          </div>

          {/* 5. 底部三区 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 产出物档案 */}
            <ArtifactArchive artifacts={loopData.artifacts} />

            {/* AI 管家建议 */}
            <AiButlerSuggestions
              suggestions={loopData.suggestions}
              onActionClick={(sugId) => {
                if (sugId === 'sug-1') {
                  setSelectedStageId('stage_loto');
                }
              }}
            />

            {/* 历史闭环记录 */}
            <HistoryLoops historyLoops={loopData.historyLoops} />
          </div>
        </>
      )}

      {/* 归档达成弹窗 */}
      {showArchiveSuccessModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">
                🎉 恭喜！业务闭环已完整达成
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                闭环编号 <strong className="text-slate-700 font-mono">{loopData.loopCode}</strong> 已完成全部 6 环节推进，产出 8 项标准业务资料，并已沉淀至知识中心。
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1 text-left">
              <div className="flex justify-between">
                <span>总用时：</span>
                <span className="font-mono font-bold text-slate-800">2.6 小时</span>
              </div>
              <div className="flex justify-between">
                <span>知识条目采纳：</span>
                <span className="font-bold text-emerald-600">已入库 RAG 知识图谱</span>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2 justify-center">
              <button
                type="button"
                onClick={() => setShowArchiveSuccessModal(false)}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
              >
                好的，完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
