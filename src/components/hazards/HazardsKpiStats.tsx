import React from 'react';
import { Clock, Layers, ShieldAlert, Wrench } from 'lucide-react';
import { Hazard } from '../../types';
import { HazardMetrics } from './useHazards';

interface HazardsKpiStatsProps {
  metrics: HazardMetrics | null;
  hazards: Hazard[];
}

export const HazardsKpiStats: React.FC<HazardsKpiStatsProps> = ({ metrics, hazards }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Pending */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
        <div>
          <div className="text-xs text-slate-500 font-medium">在控隐患总数</div>
          <div className="text-2xl font-bold text-slate-900 font-mono mt-1">
            {metrics?.total || hazards.length} 项
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            已闭环 {metrics?.closed || hazards.filter((h) => h.status === 'closed').length} 项
          </div>
        </div>
        <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
          <Layers className="w-5 h-5" />
        </div>
      </div>

      {/* Major Hazards - Red Alert Card */}
      <div className="card-industrial bg-rose-50/40 border border-rose-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
        <div>
          <div className="text-xs text-rose-700 font-medium flex items-center">
            <span>重大安全隐患</span>
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping ml-2" />
          </div>
          <div className="text-2xl font-bold text-rose-700 font-mono mt-1">
            {metrics?.major || hazards.filter((h) => h.level === 'major' && h.status !== 'closed').length} 项
          </div>
          <div className="text-[11px] text-rose-600 mt-1">厂级领导督办清单 (置顶)</div>
        </div>
        <div className="w-11 h-11 rounded-lg bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600">
          <ShieldAlert className="w-5 h-5" />
        </div>
      </div>

      {/* Pending Rectification */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
        <div>
          <div className="text-xs text-orange-700 font-medium">待派单 / 待整改</div>
          <div className="text-2xl font-bold text-orange-600 font-mono mt-1">
            {metrics?.pending || hazards.filter((h) => h.status === 'pending').length} 项
          </div>
          <div className="text-[11px] text-slate-500 mt-1">急需下发检修工单消缺</div>
        </div>
        <div className="w-11 h-11 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
          <Clock className="w-5 h-5" />
        </div>
      </div>

      {/* Rectification In Progress */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
        <div>
          <div className="text-xs text-blue-700 font-medium">正在作业整改中</div>
          <div className="text-2xl font-bold text-blue-600 font-mono mt-1">
            {metrics?.rectifying || hazards.filter((h) => h.status === 'rectifying').length} 项
          </div>
          <div className="text-[11px] text-slate-500 mt-1">已挂牌关联检修工单</div>
        </div>
        <div className="w-11 h-11 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
          <Wrench className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};
