import React from 'react';
import { Database, XCircle, AlertTriangle } from 'lucide-react';
import { AiAnalysisTraceLog } from '../../api';
import { renderContent } from './adminReviewTypes';

interface AdminTraceDetailDrawerProps {
  traceDetail: AiAnalysisTraceLog | null;
  onClose: () => void;
}

export const AdminTraceDetailDrawer: React.FC<AdminTraceDetailDrawerProps> = ({
  traceDetail,
  onClose,
}) => {
  if (!traceDetail) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-lg bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center">
              <Database className="w-4 h-4 mr-1.5 text-indigo-600" />
              AI 调用追溯明细
            </h3>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">{traceDetail.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 四要素卡片 */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] text-slate-500 block font-medium">调用模型 (model)</span>
              <span className="font-bold text-slate-800 font-mono mt-0.5 block">{traceDetail.model}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] text-slate-500 block font-medium">提示词版本 (promptVersion)</span>
              <span className="font-bold text-purple-700 font-mono mt-0.5 block">{traceDetail.promptVersion}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] text-slate-500 block font-medium">审核状态 (reviewStatus)</span>
              <span className="font-bold text-indigo-700 font-mono mt-0.5 block">{traceDetail.reviewStatus}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] text-slate-500 block font-medium">调用时间 (createdAt)</span>
              <span className="font-mono text-slate-700 text-[11px] mt-0.5 block">
                {new Date(traceDetail.createdAt).toLocaleString('zh-CN')}
              </span>
            </div>
          </div>

          {/* 高危安全边界 */}
          {traceDetail.safetyNotice?.required && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs space-y-1">
              <div className="flex items-center text-rose-700 font-bold">
                <AlertTriangle className="w-4 h-4 mr-1 text-rose-600" />
                <span>工业安全警示 (safetyNotice)</span>
              </div>
              <p className="text-rose-700 leading-relaxed">{traceDetail.safetyNotice.reason}</p>
              <p className="text-[10px] text-rose-500">
                要求强制确认: {traceDetail.safetyNotice.requiresConfirmation ? '是 (需持证复核并勾选承诺)' : '否'}
              </p>
            </div>
          )}

          {/* 输入摘要 */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              输入摘要 (inputDigest)
            </p>
            <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 leading-relaxed">
              {traceDetail.inputDigest || traceDetail.question || '无'}
            </div>
          </div>

          {/* 原始结果快照 */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              返回结果与元数据 (result)
            </p>
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70">
              {renderContent(traceDetail.result)}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
