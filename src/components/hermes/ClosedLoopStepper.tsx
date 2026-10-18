import React from 'react';
import { 
  CheckCircle2, 
  Sparkles, 
  Wrench, 
  ShieldAlert, 
  Lock, 
  Hammer, 
  ClipboardCheck, 
  FileArchive,
  ChevronRight
} from 'lucide-react';
import type { StageStepMeta, StageId } from './types';

interface ClosedLoopStepperProps {
  stages: StageStepMeta[];
  selectedStageId: StageId | null;
  onSelectStage: (id: StageId) => void;
}

const STAGE_ICONS: Record<StageId, React.ComponentType<{ className?: string }>> = {
  stage_report: Wrench,
  stage_permit: ShieldAlert,
  stage_loto: Lock,
  stage_execution: Hammer,
  stage_completion: ClipboardCheck,
  stage_archive: FileArchive,
};

export const ClosedLoopStepper: React.FC<ClosedLoopStepperProps> = ({
  stages,
  selectedStageId,
  onSelectStage,
}) => {
  return (
    <div className="rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-3 sm:p-4 backdrop-blur-md">
      <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
          <h3 className="text-xs font-bold text-slate-800 tracking-tight">业务闭环全景路线（点击环节可切换查看工作台详情）</h3>
        </div>
        <div className="text-[11px] text-slate-500 hidden sm:flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> 已完成
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-600" /> 进行中
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-300" /> 待开始
          </span>
        </div>
      </div>

      {/* 六环节横向卡片网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5">
        {stages.map((stage, idx) => {
          const Icon = STAGE_ICONS[stage.id] || Wrench;
          const isSelected = selectedStageId === stage.id;
          const isCompleted = stage.status === 'completed';
          const isInProgress = stage.status === 'in_progress';

          return (
            <div
              key={stage.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectStage(stage.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectStage(stage.id);
                }
              }}
              className={`group relative text-left p-3 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-blue-50/80 border-blue-400 shadow-sm ring-2 ring-blue-500/20'
                  : isInProgress
                  ? 'bg-gradient-to-b from-white to-blue-50/30 border-blue-200 hover:border-blue-300 hover:shadow-2xs'
                  : isCompleted
                  ? 'bg-emerald-50/20 border-emerald-200/80 hover:border-emerald-300'
                  : 'bg-slate-50/60 border-slate-200/70 hover:bg-slate-50 hover:border-slate-300 opacity-90'
              }`}
            >
              {/* 环节头部：序号 + 状态 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 transition-transform ${
                        isCompleted
                          ? 'bg-emerald-500 text-white shadow-2xs'
                          : isInProgress
                          ? 'bg-blue-600 text-white shadow-xs scale-105'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <span>{stage.order}</span>
                      )}
                    </span>
                    <Icon 
                      className={`w-3.5 h-3.5 ${
                        isInProgress ? 'text-blue-600' : isCompleted ? 'text-emerald-600' : 'text-slate-400'
                      }`} 
                    />
                  </div>

                  {/* 状态徽章 */}
                  {isCompleted && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      已完成
                    </span>
                  )}
                  {isInProgress && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
                      进行中
                    </span>
                  )}
                  {stage.status === 'pending' && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                      待开始
                    </span>
                  )}
                </div>

                {/* 环节标题 */}
                <div className="font-bold text-xs text-slate-900 group-hover:text-blue-600 transition-colors flex items-center justify-between">
                  <span>{stage.title}</span>
                </div>

                {/* AI 参与徽章 */}
                <div className="mt-1.5">
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{
                      backgroundColor: 'rgba(232, 163, 61, 0.12)',
                      color: '#B8761F',
                      border: '1px solid rgba(232, 163, 61, 0.25)',
                    }}
                  >
                    <Sparkles className="w-2.5 h-2.5 text-[#E8A33D]" />
                    {stage.aiBadge}
                  </span>
                </div>
              </div>

              {/* 底部关键产出物小字 */}
              <div className="mt-2.5 pt-2 border-t border-slate-100/90 text-[11px] leading-tight">
                <div className="text-slate-500 line-clamp-1 font-normal" title={stage.outputSummary}>
                  {stage.outputSummary}
                </div>
                <div className="text-[10px] text-blue-600 font-medium mt-1 flex items-center justify-between">
                  <span>对应：{stage.targetPage}</span>
                  {idx < stages.length - 1 && (
                    <ChevronRight className="w-3 h-3 text-slate-300 hidden lg:block" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
