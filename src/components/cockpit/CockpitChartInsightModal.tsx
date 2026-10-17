import React from 'react';
import { BarChart3, X, Sparkles } from 'lucide-react';

export interface CockpitChartInsightModalProps {
  chartInsight: {
    title: string;
    items: { label: string; value: string }[];
    prompt: string;
  } | null;
  onClose: () => void;
  onAskAi?: (prompt: string) => void;
}

export const CockpitChartInsightModal: React.FC<CockpitChartInsightModalProps> = ({
  chartInsight,
  onClose,
  onAskAi,
}) => {
  if (!chartInsight) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm glass-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
          <h4 className="text-sm font-bold text-slate-800 flex items-center">
            <BarChart3 className="w-4 h-4 mr-1.5 text-blue-500" />
            {chartInsight.title}
          </h4>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5 text-xs">
          {chartInsight.items.map((it, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50/80 border border-slate-100"
            >
              <span className="text-slate-500">{it.label}</span>
              <span className="font-mono font-bold text-blue-600">{it.value}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => {
            onAskAi?.(chartInsight.prompt);
            onClose();
          }}
          className="mt-3 w-full py-2.5 rounded-lg btn-gradient text-xs font-medium flex items-center justify-center space-x-1.5 cursor-pointer shadow-sm transition-all"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>问 AI 深入分析</span>
        </button>
      </div>
    </div>
  );
};
