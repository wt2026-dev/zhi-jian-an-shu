import React from 'react';
import { ChevronRight } from 'lucide-react';
import { MaintenanceProcedure } from '../../types';

interface ProcedureListSidebarProps {
  procedures: MaintenanceProcedure[];
  activeProcedureId: string;
  completedSteps: Record<string, number[]>;
  onSelectProcedureId: (id: string) => void;
}

export const ProcedureListSidebar: React.FC<ProcedureListSidebarProps> = ({
  procedures,
  activeProcedureId,
  completedSteps,
  onSelectProcedureId,
}) => {
  return (
    <div className="lg:col-span-4 space-y-2.5 lg:sticky lg:top-2 lg:self-start lg:flex lg:flex-col lg:min-h-0 lg:max-h-[calc(100vh-210px)]">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1 lg:shrink-0">
        匹配指引 ({procedures.length})
      </h3>
      <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1 lg:max-h-none lg:flex-1 lg:min-h-0">
        {procedures.map((proc) => {
          const isSelected = proc.id === activeProcedureId;
          const doneCount = (completedSteps[proc.id] || []).length;
          const total = proc.steps?.length || 0;
          const isDone = total > 0 && doneCount === total;

          return (
            <div
              key={proc.id}
              onClick={() => onSelectProcedureId(proc.id)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer card-industrial shadow-xs ${
                isSelected
                  ? 'bg-blue-50/70 border-blue-400 ring-1 ring-blue-300'
                  : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-bold text-slate-800 line-clamp-1 flex-1">{proc.title}</span>
                <ChevronRight
                  className={`w-4 h-4 shrink-0 transition-transform ${
                    isSelected ? 'text-blue-600 translate-x-0.5' : 'text-slate-400'
                  }`}
                />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                  {proc.equipmentType}
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                  {proc.maintenanceLevel}
                </span>
                <span className="ml-auto font-mono">{proc.estimatedMinutes || 60}m</span>
                <span className={`font-mono ${isDone ? 'text-emerald-600 font-semibold' : ''}`}>
                  {doneCount}/{total}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
