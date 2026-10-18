import React from 'react';
import { BookOpen, Eye, ChevronRight } from 'lucide-react';
import { KnowledgeArticle } from '../../types';

interface KnowledgeArticleGridProps {
  articles: KnowledgeArticle[];
  onSelectArticle: (article: KnowledgeArticle) => void;
}

export const KnowledgeArticleGrid: React.FC<KnowledgeArticleGridProps> = ({
  articles,
  onSelectArticle,
}) => {
  if (articles.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs card-industrial">
        <BookOpen className="w-12 h-12 text-slate-500 mx-auto mb-3" />
        <h4 className="text-sm font-semibold text-slate-700">暂无匹配的检修规程文章</h4>
        <p className="text-xs text-slate-500 mt-1">请尝试更换检索关键词或切换所属分类</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {articles.map((art) => (
        <div
          key={art.id}
          onClick={() => onSelectArticle(art)}
          className="bg-white hover:border-emerald-400 border border-slate-200 rounded-xl p-4.5 transition-all hover:shadow-md cursor-pointer group flex flex-col justify-between card-industrial shadow-xs"
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                {art.category}
              </span>
              <span className="text-[10px] text-slate-500 flex items-center">
                <Eye className="w-3 h-3 mr-1" />
                {art.viewCount} 次查阅
              </span>
            </div>
            <h3 className="text-sm font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">
              {art.title}
            </h3>
            <p className="text-xs text-slate-600 mt-1.5 line-clamp-2 leading-relaxed">
              {art.summary}
            </p>
            <div className="flex flex-wrap gap-1 mt-3">
              {art.tags.map((tag, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-medium"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>
              适用: <strong className="text-slate-700">{art.targetEquipment}</strong>
            </span>
            <span className="text-emerald-600 font-semibold flex items-center group-hover:translate-x-0.5 transition-transform">
              查看规程
              <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};
