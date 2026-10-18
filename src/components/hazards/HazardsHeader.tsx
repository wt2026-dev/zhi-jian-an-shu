import React from 'react';
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react';

interface HazardsHeaderProps {
  isLoading: boolean;
  canOperate: boolean;
  onRefresh: () => void;
  onOpenCreate: () => void;
}

export const HazardsHeader: React.FC<HazardsHeaderProps> = ({
  isLoading,
  canOperate,
  onRefresh,
  onOpenCreate,
}) => {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center">
          <AlertTriangle className="w-5 h-5 mr-2 text-rose-600" />
          现场安全隐患闭环治理中枢
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          双重预防机制：重大隐患强制挂牌督办置顶，实现「上报 → 派发整改工单 → 现场消缺 → 复核闭环」全生命周期管控
        </p>
      </div>

      <div className="flex items-center space-x-3">
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors shadow-xs cursor-pointer"
          title="刷新隐患清单"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
        </button>
        {canOperate ? (
          <button
            id="btn-create-hazard"
            onClick={onOpenCreate}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>现场上报新隐患</span>
          </button>
        ) : (
          <span className="text-xs px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg border border-slate-200">
            现场隐患只读查阅
          </span>
        )}
      </div>
    </div>
  );
};
