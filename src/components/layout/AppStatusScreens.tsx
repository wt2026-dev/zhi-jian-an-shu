import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { SkeletonKpis, SkeletonCards, SkeletonBlock } from '../Skeleton';

/**
 * 全局首次业务数据加载中的骨架屏
 */
export const AppLoadingScreen: React.FC = () => {
  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--text-body)]">
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        <div className="flex items-center justify-center space-x-3 py-2">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <div className="text-sm font-semibold text-slate-700">正在连接后端服务并加载真实业务数据...</div>
        </div>
        <SkeletonKpis count={6} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-sm">
              <SkeletonBlock className="h-4 w-40" />
              <SkeletonCards count={4} />
            </div>
          </div>
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-sm">
              <SkeletonBlock className="h-4 w-32" />
              <SkeletonCards count={3} />
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-sm">
              <SkeletonBlock className="h-4 w-28" />
              <SkeletonCards count={2} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export interface AppLoadErrorScreenProps {
  loadError: string;
  onRetry: () => void;
  onLogout: () => void;
}

/**
 * 全局后端数据拉取失败时的阻断提示屏
 */
export const AppLoadErrorScreen: React.FC<AppLoadErrorScreenProps> = ({
  loadError,
  onRetry,
  onLogout,
}) => {
  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--text-body)] flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-rose-200 rounded-lg p-6 shadow-sm space-y-4 text-center">
        <div className="p-3 bg-rose-50 text-rose-600 rounded-lg w-fit mx-auto border border-rose-100">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-base font-bold text-slate-900">后端数据加载失败</h2>
        <p className="text-xs text-slate-600 leading-relaxed break-all">{loadError}</p>
        <p className="text-[11px] text-slate-500">系统已禁止使用本地模拟数据兜底，请确认后端服务与数据库正常后重试。</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 mx-auto cursor-pointer transition-colors shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>重新加载数据</span>
        </button>
        <button
          onClick={onLogout}
          className="block mx-auto text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
        >
          返回重新登录
        </button>
      </div>
    </div>
  );
};
