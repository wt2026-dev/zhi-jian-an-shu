import React from 'react';
import { Route, Crosshair, Loader2, RefreshCw } from 'lucide-react';
import { isDemoMode } from '../../utils/demoMode';

interface DispatchBoardHeaderProps {
  loading: boolean;
  mocking: boolean;
  onRefresh: () => void;
  onMock: () => void;
}

export const DispatchBoardHeader: React.FC<DispatchBoardHeaderProps> = ({
  loading,
  mocking,
  onRefresh,
  onMock,
}) => {
  return (
    <div className="glass-card p-5 shadow-sm mb-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center">
            <Route className="w-5 h-5 mr-2 text-blue-600" />
            内部检修调度大屏
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            师傅在岗位置上报 → 新工单就近推荐（距离 40% · 空闲 30% · 技能 30%）→ 一键派单，全流程仅面向内部工区调度
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {isDemoMode() && (
            <button
              type="button"
              onClick={onMock}
              disabled={mocking}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 flex items-center space-x-1.5 cursor-pointer disabled:opacity-60 shadow-xs"
              title="演示模式：在厂区真实经纬度范围内随机扰动在岗师傅位置（仅参赛演示使用）"
            >
              {mocking ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Crosshair className="w-3.5 h-3.5" />
              )}
              <span>演示模拟定位</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
            title="刷新调度数据"
            aria-label="刷新调度数据"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
};
