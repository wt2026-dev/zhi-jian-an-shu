import React from 'react';
import { Sparkles, X, BookOpen } from 'lucide-react';
import { KnowledgeArticle } from '../../types';
import { RagAnswerData } from './knowledgeTypes';

interface KnowledgeRagResultCardProps {
  ragAnswer: RagAnswerData;
  articles: KnowledgeArticle[];
  onClose: () => void;
  onSelectArticle: (article: KnowledgeArticle) => void;
}

export const KnowledgeRagResultCard: React.FC<KnowledgeRagResultCardProps> = ({
  ragAnswer,
  articles,
  onClose,
  onSelectArticle,
}) => {
  return (
    <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-5 space-y-3 shadow-xs animate-in fade-in duration-200 card-industrial">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs font-bold text-emerald-900">RAG 知识图谱与规程综合研判回复</span>
            <p className="text-[11px] text-slate-500">基于规程语义相似度计算与知识增强生成</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-600 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3.5 bg-white rounded-xl border border-emerald-200 text-xs text-slate-800 leading-relaxed whitespace-pre-wrap font-sans shadow-xs">
        {ragAnswer.answer}
      </div>

      {ragAnswer.sources && ragAnswer.sources.length > 0 && (
        <div className="pt-2">
          <span className="text-[11px] text-slate-600 font-semibold block mb-1.5">
            引用的参考规程来源:
          </span>
          <div className="flex flex-wrap gap-2">
            {ragAnswer.sources.map((src, idx) => (
              <div
                key={src.id || idx}
                onClick={() => {
                  const matched = articles.find((a) => a.id === src.id || a.title === src.title);
                  if (matched) onSelectArticle(matched);
                }}
                className="p-2 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 hover:text-emerald-900 cursor-pointer flex items-center space-x-1.5 shadow-xs transition-colors"
              >
                <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                <span>{src.title}</span>
                <span className="font-mono text-[10px] text-slate-500">
                  (相似度:{' '}
                  {src.similarityScore
                    ? (src.similarityScore * 100).toFixed(0) + '%'
                    : src.similarity
                    ? (src.similarity * 100).toFixed(0) + '%'
                    : '92%'}
                  )
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
