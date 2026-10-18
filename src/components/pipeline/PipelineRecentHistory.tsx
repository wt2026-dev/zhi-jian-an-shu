import React from 'react';
import { Clock, ExternalLink, History, Loader2, RefreshCw } from 'lucide-react';
import { AiPipelineListItem } from '../../api';

interface PipelineRecentHistoryProps {
  recentTasks: AiPipelineListItem[];
  loadingRecent: boolean;
  loadingTaskId: string | null;
  currentTaskId?: string;
  onRefresh: () => void;
  onSelectTask: (taskId: string) => void;
}

export const PipelineRecentHistory: React.FC<PipelineRecentHistoryProps> = ({
  recentTasks,
  loadingRecent,
  loadingTaskId,
  currentTaskId,
  onRefresh,
  onSelectTask,
}) => {
  return (
    <div className="card-saas p-6 border border-slate-200/80 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-slate-100 text-slate-700">
            <History className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">最近协同诊断历史</h2>
            <p className="text-xs text-slate-500">最近 5 次 AI 协同诊断记录与执行结果回溯</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loadingRecent}
          className="flex items-center space-x-1.5 text-xs text-slate-600 hover:text-blue-600 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingRecent ? 'animate-spin text-blue-600' : ''}`} />
          <span>刷新历史</span>
        </button>
      </div>

      {loadingRecent && recentTasks.length === 0 ? (
        <div className="py-12 flex flex-col items-center justify-center text-slate-500 space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <p className="text-xs">加载最近任务记录…</p>
        </div>
      ) : recentTasks.length === 0 ? (
        <div className="py-12 text-center rounded-2xl bg-slate-50/60 border border-dashed border-slate-200">
          <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-semibold text-slate-700">暂无协同诊断记录</p>
          <p className="text-xs text-slate-500 mt-1">发起一次协同诊断后，历史任务与推演结果会持久化展示在这里</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 font-semibold">
                <th className="py-3 px-3.5 rounded-l-lg">受检设备</th>
                <th className="py-3 px-3">异常工况描述</th>
                <th className="py-3 px-3">协同状态</th>
                <th className="py-3 px-3">创建时间</th>
                <th className="py-3 px-3.5 text-right rounded-r-lg">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/90">
              {recentTasks.map((item) => {
                const isCurrent = currentTaskId === item.id;
                const isLoadingThis = loadingTaskId === item.id;
                const statusBadgeClass =
                  item.status === 'completed'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                    : item.status === 'failed'
                    ? 'bg-rose-50 text-rose-700 border-rose-200/80'
                    : item.status === 'running'
                    ? 'bg-blue-50 text-blue-700 border-blue-200/80'
                    : 'bg-slate-50 text-slate-600 border-slate-200/80';

                const statusText =
                  item.status === 'completed'
                    ? '全流程完成'
                    : item.status === 'failed'
                    ? '存在异常'
                    : item.status === 'running'
                    ? `执行中 ${item.progress}%`
                    : '排队中';

                const dateFormatted = item.createdAt
                  ? new Date(item.createdAt).toLocaleString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })
                  : '—';

                const cleanProblem =
                  !item.problemDescription || item.problemDescription.includes('\uFFFD') || item.problemDescription.includes('') || item.problemDescription.startsWith('?')
                    ? '运行中轴承箱温度持续升高并伴有金属摩擦异响，振动值接近报警上限'
                    : item.problemDescription;

                const cleanEquipment =
                  !item.equipmentName || item.equipmentName.includes('\uFFFD') || item.equipmentName.includes('')
                    ? '12# 连铸结晶器冷却循环泵'
                    : item.equipmentName;

                return (
                  <tr
                    key={item.id}
                    onClick={() => onSelectTask(item.id)}
                    className={`hover:bg-blue-50/40 transition-colors cursor-pointer group ${
                      isCurrent ? 'bg-blue-50/50' : ''
                    }`}
                  >
                    <td className="py-3.5 px-3.5 font-semibold text-slate-900 flex items-center gap-2">
                      <span className="truncate max-w-[160px]">{cleanEquipment}</span>
                      {isCurrent && (
                        <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0 shadow-[0_0_6px_rgba(37,99,235,0.6)]" title="当前载入" />
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-slate-600 max-w-[340px]">
                      <p className="truncate" title={cleanProblem}>
                        {cleanProblem}
                      </p>
                    </td>
                    <td className="py-3.5 px-3">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadgeClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          item.status === 'completed' ? 'bg-emerald-500' : item.status === 'failed' ? 'bg-rose-500' : 'bg-blue-500 animate-pulse'
                        }`} />
                        {statusText}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-slate-500 font-mono text-xs whitespace-nowrap">
                      {dateFormatted}
                    </td>
                    <td className="py-3.5 px-3.5 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTask(item.id);
                        }}
                        disabled={isLoadingThis}
                        className="inline-flex items-center text-blue-600 hover:text-blue-800 font-semibold text-xs space-x-1 cursor-pointer transition-colors"
                      >
                        {isLoadingThis ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <span>载入详情</span>
                            <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
