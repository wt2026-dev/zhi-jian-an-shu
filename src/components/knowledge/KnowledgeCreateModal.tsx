import React from 'react';
import { Plus, X } from 'lucide-react';
import { KnowledgeArticle } from '../../types';
import { KNOWLEDGE_CATEGORIES, NewArticleFormData } from './knowledgeTypes';

interface KnowledgeCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: NewArticleFormData;
  onChangeForm: (form: NewArticleFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

export const KnowledgeCreateModal: React.FC<KnowledgeCreateModalProps> = ({
  isOpen,
  onClose,
  form,
  onChangeForm,
  onSubmit,
  isSubmitting,
  errorMessage,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <form
        onSubmit={onSubmit}
        className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 card-industrial"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 flex items-center">
            <Plus className="w-4 h-4 mr-1.5 text-emerald-600" />
            录入新工业检修规程 / 案例知识
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-700 mb-1 font-medium">规程标题 *</label>
            <input
              type="text"
              required
              placeholder="例如: 离心压缩机干气密封系统检修与静压试验 SOP"
              value={form.title}
              onChange={(e) => onChangeForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 mb-1 font-medium">类目分类</label>
              <select
                value={form.category}
                onChange={(e) =>
                  onChangeForm({
                    ...form,
                    category: e.target.value as KnowledgeArticle['category'],
                  })
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-emerald-500 focus:bg-white"
              >
                {KNOWLEDGE_CATEGORIES.filter((c) => c !== 'all').map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-700 mb-1 font-medium">适用设备类型</label>
              <input
                type="text"
                placeholder="例如: 离心泵、压缩机、减速机"
                value={form.targetEquipment}
                onChange={(e) => onChangeForm({ ...form, targetEquipment: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">摘要简介</label>
            <input
              type="text"
              placeholder="简述规程核心作业目标与适用工况"
              value={form.summary}
              onChange={(e) => onChangeForm({ ...form, summary: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">
              规程正文与步骤详述 (支持格式排版) *
            </label>
            <textarea
              rows={6}
              required
              placeholder="详细撰写前期准备、安全措施、作业步骤、质检验收标准..."
              value={form.content}
              onChange={(e) => onChangeForm({ ...form, content: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:bg-white font-mono text-[11px]"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">标签分类 (逗号分隔)</label>
            <input
              type="text"
              placeholder="轴承, 振动, 规程, 减速机"
              value={form.tags}
              onChange={(e) => onChangeForm({ ...form, tags: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs hover:bg-slate-200 font-medium cursor-pointer"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {isSubmitting ? '发布中...' : '发布建档'}
          </button>
        </div>

        {errorMessage && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
            {errorMessage}
          </div>
        )}
      </form>
    </div>
  );
};
