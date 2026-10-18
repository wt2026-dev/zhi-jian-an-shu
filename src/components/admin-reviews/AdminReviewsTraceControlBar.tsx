import React from 'react';
import { History } from 'lucide-react';

interface AdminReviewsTraceControlBarProps {
  modelFilter: string;
  onModelFilterChange: (model: string) => void;
  onRefresh: () => void;
}

export const AdminReviewsTraceControlBar: React.FC<AdminReviewsTraceControlBarProps> = ({
  modelFilter,
  onModelFilterChange,
  onRefresh,
}) => {
  return (
    <div className="glass-card p-4 shadow-sm mb-4 border border-indigo-100 bg-gradient-to-r from-indigo-50/20 via-white/50 to-purple-50/20">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700">
            <History className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800">全链路 AI 调用追溯审计 (ai_analysis_log)</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              精确定位每次调用所用的模型名称、提示词版本 (PROMPT_VERSIONS)、输入摘要及审核流转状态
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-500 font-medium">模型过滤:</span>
          <select
            value={modelFilter}
            onChange={(e) => onModelFilterChange(e.target.value)}
            className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="all">全部模型 / 降级</option>
            <option value="qwen-plus">qwen-plus</option>
            <option value="qwen-turbo">qwen-turbo</option>
            <option value="qwen-vl-plus">qwen-vl-plus</option>
            <option value="legacy">legacy (历史记录)</option>
          </select>
          <button
            onClick={onRefresh}
            className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-semibold rounded-lg cursor-pointer transition-colors"
          >
            刷新日志
          </button>
        </div>
      </div>
    </div>
  );
};
