import React from 'react';
import { FileSearch, XCircle, Sparkles, BookOpen, Loader2, CheckCircle2 } from 'lucide-react';
import { AiGenerationReview } from '../../api';
import { renderContent } from './adminReviewTypes';

interface AdminReviewDetailDrawerProps {
  detail: AiGenerationReview | null;
  onClose: () => void;
  rejectOpen: boolean;
  onOpenReject: () => void;
  rejectNote: string;
  onRejectNoteChange: (note: string) => void;
  acting: boolean;
  onApprove: (id: string) => void;
  onReject: () => void;
}

export const AdminReviewDetailDrawer: React.FC<AdminReviewDetailDrawerProps> = ({
  detail,
  onClose,
  rejectOpen,
  onOpenReject,
  rejectNote,
  onRejectNoteChange,
  acting,
  onApprove,
  onReject,
}) => {
  if (!detail) return null;

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
              <FileSearch className="w-4 h-4 mr-1.5 text-blue-600" />
              生成内容详情
            </h3>
            <p className="text-[10px] text-slate-500 font-mono mt-1">
              {detail.aiEndpoint} · {new Date(detail.createdAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 生成内容全文 */}
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center">
              <Sparkles className="w-3 h-3 mr-1 text-blue-500" />
              AI 生成内容全文
            </p>
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
              {renderContent(detail.content)}
            </div>
          </div>

          {/* 知识库引用片段 */}
          {(detail.knowledgeRefs || []).length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center">
                <BookOpen className="w-3 h-3 mr-1 text-blue-500" />
                知识库溯源（检索命中 {detail.knowledgeRefs.length} 篇）
              </p>
              <div className="space-y-2">
                {detail.knowledgeRefs.map((k) => (
                  <div key={k.id} className="p-2.5 rounded-lg bg-blue-50/50 border border-blue-100 text-xs">
                    <p className="font-semibold text-blue-900">《{k.title}》</p>
                    <p className="text-[10px] text-slate-500">{k.category}</p>
                    {k.excerpt && <p className="mt-1 text-[11px] text-slate-600">{k.excerpt}…</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 审核信息 */}
          {detail.status !== 'pending' && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs">
              <p className="font-bold text-slate-600">
                {detail.status === 'approved' ? '已通过' : '已驳回'} · 审核人 {detail.reviewer || '—'}
              </p>
              {detail.reviewNote && <p className="text-slate-500 mt-1">审核意见：{detail.reviewNote}</p>}
              {detail.reviewedAt && (
                <p className="text-[10px] text-slate-500 font-mono mt-1">
                  {new Date(detail.reviewedAt).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
          )}

          {/* 驳回原因输入 */}
          {rejectOpen && detail.status === 'pending' && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50/60">
              <p className="text-xs font-bold text-rose-700 mb-2">驳回原因（必填）</p>
              <textarea
                value={rejectNote}
                onChange={(e) => onRejectNoteChange(e.target.value)}
                rows={3}
                placeholder="例：检修步骤与设备实际工况不符，缺少验电环节"
                className="w-full px-3 py-2 rounded-lg border border-rose-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-200 resize-none"
              />
              <button
                onClick={onReject}
                disabled={acting || !rejectNote.trim()}
                className="mt-2 w-full py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center"
              >
                {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <XCircle className="w-3.5 h-3.5 mr-1" />}
                确认驳回
              </button>
            </div>
          )}
        </div>

        {/* 抽屉底：待审核操作 */}
        {detail.status === 'pending' && !rejectOpen && (
          <div className="p-3 border-t border-slate-200 flex gap-2">
            <button
              onClick={() => onApprove(detail.id)}
              disabled={acting}
              className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center"
            >
              {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              审核通过（内容可正式使用）
            </button>
            <button
              onClick={onOpenReject}
              disabled={acting}
              className="flex-1 py-2.5 rounded-lg bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center"
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              驳回
            </button>
          </div>
        )}
      </aside>
    </div>
  );
};
