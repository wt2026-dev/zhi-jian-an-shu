import React from 'react';
import { GitBranch, ArrowRight } from 'lucide-react';
import { REVIEW_PROCESS_STEPS } from './adminReviewTypes';

export const AdminReviewsProcessFlow: React.FC = () => {
  return (
    <div className="glass-card p-4 shadow-sm mb-4 border border-blue-100/70 bg-gradient-to-r from-blue-50/20 via-white/50 to-indigo-50/20">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded-md bg-blue-100 text-blue-700">
            <GitBranch className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-xs font-bold text-slate-800">AI 生成内容全生命周期审核流程</h2>
        </div>
        <span className="text-[10px] text-slate-500 font-medium">人机协同 · 双重核验 · 知识库溯源</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 relative">
        {REVIEW_PROCESS_STEPS.map((step, idx) => {
          const Icon = step.icon;
          return (
            <div
              key={step.step}
              className="p-3 rounded-xl border border-slate-200 bg-white/90 relative flex flex-col justify-between shadow-xs"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                    步骤 {step.step}
                  </span>
                  <div className={`p-1 rounded-md ${step.bg}`}>
                    <Icon className={`w-3.5 h-3.5 ${step.color}`} />
                  </div>
                </div>
                <div className="font-bold text-xs text-slate-800">{step.title}</div>
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{step.desc}</p>
              </div>
              {idx < REVIEW_PROCESS_STEPS.length - 1 && (
                <div className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-white border border-slate-200 shadow-xs items-center justify-center text-slate-500">
                  <ArrowRight className="w-2.5 h-2.5" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
