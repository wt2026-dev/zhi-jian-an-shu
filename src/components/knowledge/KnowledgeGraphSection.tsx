import React from 'react';
import { KnowledgeArticle } from '../../types';
import { KnowledgeGraphData } from './knowledgeTypes';

interface KnowledgeGraphSectionProps {
  isEditorOrArchivist: boolean;
  graphData: KnowledgeGraphData;
  graphMessage: string;
  onExtractGraph: () => void;
  onSelectArticle: (article: KnowledgeArticle) => void;
}

export const KnowledgeGraphSection: React.FC<KnowledgeGraphSectionProps> = ({
  isEditorOrArchivist,
  graphData,
  graphMessage,
  onExtractGraph,
  onSelectArticle,
}) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs card-industrial">
      <div className="flex justify-between mb-3">
        <h3 className="text-sm text-slate-800 font-semibold">知识图谱（快速实体检索）</h3>
        {isEditorOrArchivist && (
          <button
            onClick={onExtractGraph}
            className="text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
          >
            抽取未处理文章
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {graphData.nodes.map((n) => (
          <button
            key={n.id}
            onClick={() =>
              onSelectArticle({
                id: n.article_id,
                title: n.article_title,
                content: n.article_content,
                category: '图谱关联',
                tags: [],
                summary: '',
                author: '',
                updatedAt: '',
              })
            }
            className={`px-2.5 py-1 rounded-md text-xs font-medium ${
              n.entity_type === '设备'
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : n.entity_type === '故障'
                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                : n.entity_type === '方法'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            } hover:opacity-80 transition-opacity cursor-pointer`}
          >
            {n.entity_name}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-3">
        {graphData.edges.length} 条关系 · {graphMessage}
      </p>
    </div>
  );
};
