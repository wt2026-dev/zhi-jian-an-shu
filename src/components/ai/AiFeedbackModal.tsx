import React from 'react';
import { Sparkles, X, Star, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ChatMessage } from '../../hooks/useAiChat';

export interface FeedbackModalState {
  isOpen: boolean;
  message: ChatMessage | null;
  userQuery: string;
  correction: string;
  rating: number;
  submitting: boolean;
  error: string | null;
}

interface AiFeedbackModalProps {
  state: FeedbackModalState;
  onClose: () => void;
  onRatingChange: (rating: number) => void;
  onCorrectionChange: (correction: string) => void;
  onSubmit: () => void;
}

export const AiFeedbackModal: React.FC<AiFeedbackModalProps> = ({
  state,
  onClose,
  onRatingChange,
  onCorrectionChange,
  onSubmit,
}) => {
  if (!state.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-lg max-w-xl w-full p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg border border-amber-200">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">AI 回答专家纠错与知识沉淀标注</h3>
              <p className="text-[11px] text-slate-500">纠错审核通过后将沉淀更新入知识库向量索引</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 p-1 rounded-md cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 原问题与原回复预览 */}
        <div className="space-y-2 text-xs">
          {state.userQuery && (
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] text-slate-500 font-medium block mb-0.5">用户原始提问:</span>
              <p className="text-slate-800 line-clamp-2">{state.userQuery}</p>
            </div>
          )}
          {state.message && (
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] text-slate-500 font-medium block mb-0.5">AI 原始回答摘要:</span>
              <p className="text-slate-600 text-[11px] line-clamp-3 font-mono">{state.message.text}</p>
            </div>
          )}
        </div>

        {/* 质量评分 */}
        <div>
          <label className="block text-xs text-slate-700 mb-1.5 font-medium">
            回复质量评分:
          </label>
          <div className="flex items-center space-x-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => onRatingChange(star)}
                className="p-1 cursor-pointer hover:scale-110 transition-transform"
              >
                <Star
                  className={`w-5 h-5 ${
                    star <= state.rating ? 'fill-amber-500 text-amber-500' : 'text-slate-300'
                  }`}
                />
              </button>
            ))}
            <span className="text-xs text-slate-600 ml-2">
              {state.rating === 1
                ? '严重错误 / 存在安全隐患'
                : state.rating === 2
                ? '部分内容不准确'
                : state.rating === 3
                ? '答案合格但不够完整'
                : state.rating === 4
                ? '良好，仅需微调'
                : '完全准确'}
            </span>
          </div>
        </div>

        {/* 专家修正内容 */}
        <div>
          <label className="block text-xs text-slate-700 mb-1.5 font-medium">
            专家正确答案 / 规程修正意见 *
          </label>
          <textarea
            rows={4}
            value={state.correction}
            onChange={(e) => onCorrectionChange(e.target.value)}
            placeholder="例如：关于离心泵同轴度径向偏差，国家标准 GB 50275 要求控制在 ≤ 0.05mm 以内，而不是 0.15mm..."
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-sans"
          />
        </div>

        {state.error && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{state.error}</span>
          </div>
        )}

        <div className="flex justify-end space-x-2.5 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={state.submitting}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            {state.submitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>提交中...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>提交专家纠错标注</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
