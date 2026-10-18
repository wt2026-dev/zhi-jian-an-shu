import React from 'react';
import { ScanSearch, ShieldCheck, Database } from 'lucide-react';

interface AdminReviewsHeaderProps {
  mainTab: 'reviews' | 'traceability';
  onMainTabChange: (tab: 'reviews' | 'traceability') => void;
  pendingCount: number;
  statusFilter: 'pending' | 'approved' | 'rejected' | 'all';
  onStatusFilterChange: (status: 'pending' | 'approved' | 'rejected' | 'all') => void;
}

export const AdminReviewsHeader: React.FC<AdminReviewsHeaderProps> = ({
  mainTab,
  onMainTabChange,
  pendingCount,
  statusFilter,
  onStatusFilterChange,
}) => {
  return (
    <div className="glass-card p-5 shadow-sm mb-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center">
            <ScanSearch className="w-5 h-5 mr-2 text-blue-600" />
            AI 生成内容审核与追溯台
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            AI 检修方案/风险评估审核准入 · 全链路模型版本、提示词版本与输入摘要追溯
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => onMainTabChange('reviews')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                mainTab === 'reviews'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              <span>生成审核准入</span>
              {pendingCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px]">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => onMainTabChange('traceability')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                mainTab === 'traceability'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-indigo-600" />
              <span>版本与输入追溯日志</span>
            </button>
          </div>

          {mainTab === 'reviews' && (
            <div className="flex items-center space-x-1.5 border-l border-slate-200 pl-2">
              {(['pending', 'approved', 'rejected', 'all'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => onStatusFilterChange(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    statusFilter === s
                      ? 'bg-blue-50 border-blue-300 text-blue-700 font-semibold'
                      : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s === 'pending'
                    ? '待审核'
                    : s === 'approved'
                    ? '已通过'
                    : s === 'rejected'
                    ? '已驳回'
                    : '全部'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
