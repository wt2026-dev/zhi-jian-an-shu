import React from 'react';
import {
  Activity,
  Radio,
  Clock,
  Sparkles,
  Pause,
  Play,
  RefreshCw,
  Minimize2,
  Maximize2,
  ArrowLeft,
} from 'lucide-react';
import { LiveClock } from './LiveClock';

export interface CockpitHeaderProps {
  isFullscreen: boolean;
  isAutoRefresh: boolean;
  countdown: number;
  isLoading: boolean;
  onNavigateTab?: (tab: string) => void;
  onAskAi?: (prompt: string) => void;
  handleAiInterpret: () => void;
  setIsAutoRefresh: React.Dispatch<React.SetStateAction<boolean>>;
  fetchData: () => void;
  toggleFullscreen: () => void;
}

export const CockpitHeader: React.FC<CockpitHeaderProps> = ({
  isFullscreen,
  isAutoRefresh,
  countdown,
  isLoading,
  onNavigateTab,
  onAskAi,
  handleAiInterpret,
  setIsAutoRefresh,
  fetchData,
  toggleFullscreen,
}) => {
  return (
    <div className="relative border-b border-slate-200 pb-4 mb-4 flex flex-col md:flex-row items-center justify-between gap-4 bg-gradient-to-r from-blue-50/70 via-white to-cyan-50/50 rounded-xl px-4 -mx-2">
      <div className="flex items-center space-x-3">
        {/* 返回工作台 */}
        {onNavigateTab && (
          <button
            onClick={() => onNavigateTab('dashboard')}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-blue-600 flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回工作台</span>
          </button>
        )}
        <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
          <Activity className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
              生产检修数据驾驶舱
            </h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-600 font-mono font-medium">
              实时大屏
            </span>
          </div>
          <p className="text-[11px] text-slate-500 tracking-wide mt-0.5 flex items-center space-x-2">
            <span>中国软件杯 A1 赛题多模态工业诊断与知识协同驾驶大屏</span>
            <span className="text-slate-300">|</span>
            <span className="flex items-center text-emerald-600 font-mono">
              <Radio className="w-3 h-3 mr-1" />
              遥测中枢正常连接
            </span>
          </p>
        </div>
      </div>

      {/* Center Clock */}
      <div className="hidden lg:flex flex-col items-center justify-center px-5 py-1.5 rounded-lg bg-white border border-slate-200 shadow-sm">
        <div className="text-base font-mono font-bold text-slate-800 tracking-wider flex items-center space-x-2">
          <Clock className="w-4 h-4 text-blue-500" />
          <LiveClock showDate={false} />
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          <LiveClock showTime={false} />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center space-x-2.5">
        {/* AI 解读：唤起全局悬浮 AI 面板并预填驾驶舱摘要 */}
        {onAskAi && (
          <button
            onClick={handleAiInterpret}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium btn-gradient flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI 解读</span>
          </button>
        )}

        <button
          onClick={() => setIsAutoRefresh(!isAutoRefresh)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center space-x-1.5 transition-colors cursor-pointer ${
            isAutoRefresh
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
          }`}
        >
          {isAutoRefresh ? <Pause className="w-3.5 h-3.5 text-blue-600" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isAutoRefresh ? `${countdown}s 自动刷新` : '已暂停自动'}</span>
        </button>

        <button
          onClick={fetchData}
          disabled={isLoading}
          className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
          title="立即手动刷新数据"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
        </button>

        <button
          onClick={toggleFullscreen}
          className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-blue-600 text-xs font-medium flex items-center space-x-1.5 cursor-pointer transition-colors shadow-sm"
          title={isFullscreen ? '退出全屏' : '全屏投影'}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          <span>{isFullscreen ? '退出全屏' : '全屏投影'}</span>
        </button>
      </div>
    </div>
  );
};
