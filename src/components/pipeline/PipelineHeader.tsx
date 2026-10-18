import React from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';

export const PipelineHeader: React.FC = () => {
  return (
    <div className="card-saas p-6 border border-slate-200/80">
      <div className="flex items-start justify-between gap-4 flex-col lg:flex-row lg:items-center">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              AI 协同诊断与自动编排
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/70">
              工业多智能体协同
            </span>
          </div>
          <p className="text-xs text-slate-500 pl-10 max-w-2xl leading-relaxed">
            融合工程机理推演与工业知识库 SOP，将 4 项专业 AI 决策编排为全生命周期闭环流水线，全过程可解释、可审核
          </p>
        </div>

        {/* Stepper Pill Indicator */}
        <div className="flex items-center text-xs text-slate-600 bg-slate-50/90 border border-slate-200/80 rounded-xl px-3.5 py-2 shadow-2xs">
          <span className="flex items-center gap-1.5 font-semibold text-blue-700">
            <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">1</span>
            故障诊断
          </span>
          <ChevronRight className="w-3.5 h-3.5 mx-2 text-slate-300 shrink-0" />
          <span className="flex items-center gap-1.5 font-semibold text-indigo-700">
            <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold">2</span>
            检修方案
          </span>
          <ChevronRight className="w-3.5 h-3.5 mx-2 text-slate-300 shrink-0" />
          <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
            <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">3</span>
            安全 ∥ 派单
          </span>
        </div>
      </div>
    </div>
  );
};
