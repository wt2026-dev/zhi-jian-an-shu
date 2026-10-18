import React from 'react';
import { CAPABILITY_CARDS } from './pipelineConfig';

export const PipelineCapabilityCards: React.FC = () => {
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {CAPABILITY_CARDS.map((cap) => {
          const Icon = cap.icon;
          return (
            <div
              key={cap.name}
              className="card-saas p-4 border border-slate-200/80 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <div className={`p-2 rounded-xl ${cap.iconStyle} border border-slate-200/60`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${cap.badgeStyle}`}>
                    {cap.stageBadge}
                  </span>
                </div>
                <h3 className="text-xs font-bold text-slate-900 mb-1.5">{cap.name}</h3>
                <p className="text-[11px] text-slate-500 mb-3 min-h-[32px] line-clamp-2 leading-relaxed">
                  {cap.desc}
                </p>
              </div>
              <div className="space-y-1 pt-2.5 border-t border-slate-100 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">输入契约</span>
                  <span className="font-mono text-slate-600 truncate max-w-[120px] text-right">{cap.input}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">核心产出</span>
                  <span className="font-semibold text-blue-700 bg-blue-50/80 px-2 py-0.5 rounded-md border border-blue-100/80 text-[10px]">
                    {cap.output}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
