import React from 'react';
import { Route, RefreshCw, Plus } from 'lucide-react';

interface AiModelsHeaderProps {
  loading: boolean;
  onRefresh: () => void;
  onAddNew: () => void;
}

export const AiModelsHeader: React.FC<AiModelsHeaderProps> = ({
  loading,
  onRefresh,
  onAddNew,
}) => {
  return (
    <div className="glass-card p-5 shadow-sm mb-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center">
            <Route className="w-5 h-5 mr-2 text-blue-600" />
            AI 模型路由
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            多模型接入与降级顺序管理：按优先级依次尝试，失败（超时/5xx/鉴权失败）自动切换下一候选，全链路审计可查
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onRefresh}
            className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
            title="刷新"
            aria-label="刷新模型列表"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onAddNew}
            className="px-3.5 py-1.5 rounded-lg btn-gradient text-xs font-medium flex items-center space-x-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新增模型</span>
          </button>
        </div>
      </div>
    </div>
  );
};
