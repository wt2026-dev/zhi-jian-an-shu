import React from 'react';
import { Clock, CheckCircle2 } from 'lucide-react';
import { KnowledgeReviewItem } from './knowledgeTypes';

interface KnowledgeReviewQueueProps {
  reviewItems: KnowledgeReviewItem[];
  onRefresh: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
}

export const KnowledgeReviewQueue: React.FC<KnowledgeReviewQueueProps> = ({
  reviewItems,
  onRefresh,
  onApprove,
  onReject,
}) => {
  const handlePromptReject = (id: string) => {
    const reason = window.prompt('请输入驳回修改原因:');
    if (reason !== null) {
      onReject(id, reason || undefined);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs card-industrial">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-800 flex items-center">
          <Clock className="w-4 h-4 mr-1.5 text-amber-600" />
          知识沉淀与规程更新审核队列 ({reviewItems.length})
        </h3>
        <button
          onClick={onRefresh}
          className="text-xs text-cyan-600 hover:text-cyan-700 font-medium transition-colors cursor-pointer"
        >
          刷新待审列表
        </button>
      </div>

      {reviewItems.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          当前暂无待审核的知识文档，所有知识规程均已闭环
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {reviewItems.map((a) => (
            <div
              key={a.id}
              className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-800 text-sm">{a.title}</div>
                <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200">
                    {a.category}
                  </span>
                  <span>
                    作者: <strong className="text-slate-700">{a.author}</strong>
                  </span>
                  <span className="text-slate-300">|</span>
                  <span>
                    提交时间:{' '}
                    <strong className="text-slate-700">
                      {a.createdAt ? new Date(a.createdAt).toLocaleString('zh-CN') : '—'}
                    </strong>
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => onApprove(a.id)}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors font-medium cursor-pointer"
                >
                  审核通过并入库
                </button>
                <button
                  onClick={() => handlePromptReject(a.id)}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition-colors font-medium cursor-pointer"
                >
                  驳回修改
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
