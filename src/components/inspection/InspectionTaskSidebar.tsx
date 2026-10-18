import React from 'react';
import { ClipboardCheck, MapPin, AlertTriangle } from 'lucide-react';
import { InspectionTask } from '../../types';

interface InspectionTaskSidebarProps {
  displayInspections: InspectionTask[];
  activeTaskId: string;
  onlyMyTasks: boolean;
  onToggleOnlyMyTasks: () => void;
  onSelectTask: (taskId: string) => void;
}

export const InspectionTaskSidebar: React.FC<InspectionTaskSidebarProps> = ({
  displayInspections,
  activeTaskId,
  onlyMyTasks,
  onToggleOnlyMyTasks,
  onSelectTask,
}) => {
  return (
    <div className="lg:col-span-5 space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-bold text-slate-800 flex items-center">
          <ClipboardCheck className="w-4 h-4 mr-1.5 text-blue-600" />
          点巡检路线与任务 ({displayInspections.length})
        </h3>
        <button
          id="btn-toggle-my-tasks"
          type="button"
          onClick={onToggleOnlyMyTasks}
          className={`text-xs px-2.5 py-1 rounded-md border flex items-center space-x-1.5 cursor-pointer transition-colors ${
            onlyMyTasks
              ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold'
              : 'bg-white text-slate-500 border-slate-200 hover:text-slate-800'
          }`}
          title="切换仅看与我相关的巡检任务"
        >
          <span>只看我的任务</span>
          {onlyMyTasks && <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
        </button>
      </div>

      <div className="space-y-3 max-h-[720px] overflow-y-auto pr-1">
        {displayInspections.length === 0 ? (
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500 text-sm shadow-xs">
            {onlyMyTasks ? '暂无与我相关的巡检任务' : '暂无巡检任务'}
          </div>
        ) : (
          displayInspections.map((task) => {
            const isActive = task.id === activeTaskId;
            const isComplete = task.status === 'completed';
            const progress = Math.round((task.completedPoints / (task.totalPoints || 1)) * 100);

            return (
              <div
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className={`p-4 rounded-lg border transition-all cursor-pointer flex flex-col justify-between ${
                  isActive
                    ? 'bg-blue-50/70 border-blue-500 shadow-sm ring-1 ring-blue-500/40'
                    : 'card-industrial bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-semibold">
                      {task.taskNo}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                        isComplete
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : task.status === 'in_progress'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {isComplete ? '已巡检完毕' : task.status === 'in_progress' ? '巡检执行中' : '未开始'}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">{task.title}</h3>
                  <div className="text-xs text-slate-500 mt-1 flex items-center space-x-2">
                    <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span className="truncate">{task.route}</span>
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-100">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-500">
                      测点进度: <strong className="text-slate-800">{task.completedPoints}/{task.totalPoints}</strong> ({progress}%)
                    </span>
                    {task.abnormalCount > 0 ? (
                      <span className="text-rose-600 font-bold flex items-center">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        发现 {task.abnormalCount} 处异常
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-medium">无异常</span>
                    )}
                  </div>

                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        task.abnormalCount > 0 ? 'bg-orange-500' : 'bg-blue-600'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
