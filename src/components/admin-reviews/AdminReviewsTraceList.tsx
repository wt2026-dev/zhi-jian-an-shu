import React from 'react';
import { Loader2, Database, AlertTriangle } from 'lucide-react';
import { AiAnalysisTraceLog } from '../../api';

interface AdminReviewsTraceListProps {
  loading: boolean;
  traceLogs: AiAnalysisTraceLog[];
  onSelectTrace: (log: AiAnalysisTraceLog) => void;
}

export const AdminReviewsTraceList: React.FC<AdminReviewsTraceListProps> = ({
  loading,
  traceLogs,
  onSelectTrace,
}) => {
  return (
    <div className="glass-card p-4 shadow-sm">
      {loading ? (
        <div className="py-12 flex flex-col items-center text-slate-500 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
          加载追溯审计记录…
        </div>
      ) : traceLogs.length === 0 ? (
        <div className="py-10 px-4 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <Database className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 mb-1">暂无追溯审计日志</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            当调用故障诊断向导、检修方案或作业票风险评估时，系统会自动在此沉淀包含模型版本、提示词版本与输入摘要的追溯日志。
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 pb-1">
            <span>共记录 {traceLogs.length} 次 AI 调用</span>
            <span>包含提示词版本与入参摘要</span>
          </div>
          {traceLogs.map((log) => (
            <div
              key={log.id}
              onClick={() => onSelectTrace(log)}
              className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-mono font-bold">
                      {log.model || 'legacy'}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 text-[10px] font-mono font-bold">
                      Prompt: {log.promptVersion || 'legacy'}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-mono">
                      审核: {log.reviewStatus || 'legacy'}
                    </span>
                    {log.safetyNotice?.required && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold flex items-center">
                        <AlertTriangle className="w-3 h-3 mr-1 text-rose-500" />
                        高危复核要求
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-slate-800 font-medium">
                    <span className="text-slate-500 mr-1.5 font-normal">输入摘要:</span>
                    {log.inputDigest || log.question || '无输入摘要'}
                  </div>

                  <div className="text-[10px] text-slate-500 font-mono flex items-center gap-3">
                    <span>设备/对象: {log.deviceModel || '未指定'}</span>
                    <span>{new Date(log.createdAt).toLocaleString('zh-CN')}</span>
                    <span>ID: {log.id}</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="px-2.5 py-1 text-[11px] text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg shrink-0 font-medium cursor-pointer"
                >
                  查看明细
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
