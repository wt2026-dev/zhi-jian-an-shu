import React from 'react';
import { X, Sparkles } from 'lucide-react';
import { KnowledgeArticle } from '../../types';

interface KnowledgeDetailModalProps {
  article: KnowledgeArticle | null;
  onClose: () => void;
  onAskAiWithContext: (query: string, contextArticle: KnowledgeArticle) => void;
}

export const KnowledgeDetailModal: React.FC<KnowledgeDetailModalProps> = ({
  article,
  onClose,
  onAskAiWithContext,
}) => {
  if (!article) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-5 card-industrial">
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                {article.category}
              </span>
              <span className="text-xs text-slate-500">适用: {article.targetEquipment}</span>
            </div>
            <h3 className="text-lg font-bold text-slate-800 mt-1">{article.title}</h3>
            <div className="text-xs text-slate-500 mt-0.5 flex items-center space-x-4">
              <span>编制人: {article.author}</span>
              <span>修订更新: {article.updatedAt}</span>
              <span>浏览: {article.viewCount} 次</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Article Content View */}
        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 text-xs text-slate-800 leading-relaxed font-sans whitespace-pre-wrap space-y-3">
          {article.content}
        </div>

        {/* Tags */}
        <div className="flex items-center space-x-2 text-xs text-slate-500">
          <span>检索关键词:</span>
          <div className="flex flex-wrap gap-1.5">
            {article.tags.map((t, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[11px] font-medium"
              >
                #{t}
              </span>
            ))}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <button
            onClick={() => {
              const target = article;
              onClose();
              onAskAiWithContext(
                `请根据规程《${target.title}》进一步解释作业中的关键控制要点与实操风险防范措施`,
                target
              );
            }}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>基于此篇规程发起 AI 深度问答</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs hover:bg-slate-200 font-medium cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
