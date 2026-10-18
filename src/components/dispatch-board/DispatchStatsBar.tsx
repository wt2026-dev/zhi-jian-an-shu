import React from 'react';
import { Users, CheckCircle2, Gauge, ClipboardList } from 'lucide-react';
import { DispatchStats } from './dispatchTypes';

interface DispatchStatsBarProps {
  stats: DispatchStats;
}

export const DispatchStatsBar: React.FC<DispatchStatsBarProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div className="glass-card p-3.5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>在岗师傅</span>
          <Users className="w-4 h-4 text-blue-500" />
        </div>
        <div className="mt-1.5 data-number text-lg">
          {stats.onlineCount}
          <span className="text-xs text-slate-500 font-sans"> 人</span>
        </div>
      </div>
      <div className="glass-card p-3.5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>当前空闲</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        </div>
        <div className="mt-1.5 data-number text-lg text-emerald-700">
          {stats.idleCount}
          <span className="text-xs text-slate-500 font-sans"> 人</span>
        </div>
      </div>
      <div className="glass-card p-3.5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>待派工单</span>
          <ClipboardList className="w-4 h-4 text-amber-500" />
        </div>
        <div className="mt-1.5 data-number text-lg text-amber-700">
          {stats.pendingCount}
          <span className="text-xs text-slate-500 font-sans"> 单</span>
        </div>
      </div>
      <div className="glass-card p-3.5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>平均响应距离估算</span>
          <Gauge className="w-4 h-4 text-cyan-500" />
        </div>
        <div className="mt-1.5 data-number text-lg text-cyan-700">
          {stats.avgDistance != null ? `约 ${stats.avgDistance}m` : '—'}
        </div>
      </div>
    </div>
  );
};
