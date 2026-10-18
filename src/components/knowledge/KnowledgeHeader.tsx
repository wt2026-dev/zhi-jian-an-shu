import React from 'react';
import { BookOpen, Upload, Plus } from 'lucide-react';
import { KnowledgeTab } from './knowledgeTypes';

interface KnowledgeHeaderProps {
  isEditorOrArchivist: boolean;
  managementTab: KnowledgeTab;
  onTabChange: (tab: KnowledgeTab) => void;
  onOpenUploadModal: () => void;
  onOpenAddModal: () => void;
}

export const KnowledgeHeader: React.FC<KnowledgeHeaderProps> = ({
  isEditorOrArchivist,
  managementTab,
  onTabChange,
  onOpenUploadModal,
  onOpenAddModal,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <BookOpen className="w-5 h-5 mr-2 text-emerald-600" />
            工业设备检修知识库与 RAG 语义搜索中心
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            收录企业标准 SOP、故障根因树、典型事故案例与国家特种设备检修技术规程
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          {isEditorOrArchivist ? (
            <>
              <button
                id="btn-upload-doc"
                onClick={onOpenUploadModal}
                className="px-3.5 py-2 text-xs font-medium bg-white hover:bg-cyan-50 text-cyan-700 border border-cyan-300 rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                <Upload className="w-4 h-4 text-cyan-600" />
                <span>导入规程文档与向量切片 (PDF/Word/TXT)</span>
              </button>

              <button
                id="btn-create-article"
                onClick={onOpenAddModal}
                className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>发布新检修知识文档</span>
              </button>
            </>
          ) : (
            <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>知识库只读查阅模式（全量检索 / SOP / 图谱）</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 w-fit">
        <button
          onClick={() => onTabChange('knowledge')}
          className={`px-3.5 py-1.5 text-xs rounded-lg font-medium transition-all ${
            managementTab === 'knowledge' ? 'bg-white text-cyan-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          知识库
        </button>
        {isEditorOrArchivist && (
          <button
            id="tab-review-queue"
            onClick={() => onTabChange('review')}
            className={`px-3.5 py-1.5 text-xs rounded-lg font-medium transition-all ${
              managementTab === 'review' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            审核队列
          </button>
        )}
        <button
          onClick={() => onTabChange('graph')}
          className={`px-3.5 py-1.5 text-xs rounded-lg font-medium transition-all ${
            managementTab === 'graph' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          知识图谱
        </button>
      </div>
    </div>
  );
};
