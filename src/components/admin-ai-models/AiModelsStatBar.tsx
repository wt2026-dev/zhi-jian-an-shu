import React from 'react';
import { Layers } from 'lucide-react';

interface AiModelsStatBarProps {
  totalCount: number;
  enabledCount: number;
  healthyCount: number;
  unhealthyCount: number;
  unknownCount: number;
}

export const AiModelsStatBar: React.FC<AiModelsStatBarProps> = ({
  totalCount,
  enabledCount,
  healthyCount,
  unhealthyCount,
  unknownCount,
}) => {
  return (
    <div className="glass-card p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2 text-xs font-bold text-slate-800">
          <Layers className="w-4 h-4 text-blue-600" />
          <span>模型池状态统计</span>
          <span className="text-[10px] text-slate-500 font-normal">（自动计算，操作后实时同步）</span>
        </div>
        <div className="flex items-center flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 font-medium">
            模型总数 <strong className="ml-1.5 font-bold font-mono text-slate-900">{totalCount}</strong>
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 font-medium">
            已启用 <strong className="ml-1.5 font-bold font-mono text-blue-800">{enabledCount}</strong>
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
            健康 <strong className="ml-1.5 font-bold font-mono text-emerald-800">{healthyCount}</strong>
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-medium">
            异常 <strong className="ml-1.5 font-bold font-mono text-rose-800">{unhealthyCount}</strong>
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 font-medium">
            未检测 <strong className="ml-1.5 font-bold font-mono text-slate-600">{unknownCount}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
