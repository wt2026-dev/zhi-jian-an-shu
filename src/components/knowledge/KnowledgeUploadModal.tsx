import React from 'react';
import { Upload, X, CheckCircle2, FileUp, Cpu, Layers } from 'lucide-react';
import { KNOWLEDGE_CATEGORIES } from './knowledgeTypes';

interface KnowledgeUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadFile: File | null;
  onSelectFile: (file: File | null) => void;
  uploadCategory: string;
  onCategoryChange: (cat: string) => void;
  uploadTargetEquipment: string;
  onTargetEquipmentChange: (eq: string) => void;
  uploadTags: string;
  onTagsChange: (tags: string) => void;
  isUploading: boolean;
  uploadSuccessMsg: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

export const KnowledgeUploadModal: React.FC<KnowledgeUploadModalProps> = ({
  isOpen,
  onClose,
  fileInputRef,
  uploadFile,
  onSelectFile,
  uploadCategory,
  onCategoryChange,
  uploadTargetEquipment,
  onTargetEquipmentChange,
  uploadTags,
  onTagsChange,
  isUploading,
  uploadSuccessMsg,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <form
        onSubmit={onSubmit}
        className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto card-industrial"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 flex items-center">
            <Upload className="w-4 h-4 mr-1.5 text-cyan-600" />
            规程文档上传与 Chroma 向量分块存储
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {uploadSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs flex items-center space-x-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{uploadSuccessMsg}</span>
          </div>
        )}

        <div className="space-y-3 text-xs">
          {/* File Dropzone */}
          <div>
            <label className="block text-slate-700 mb-1 font-medium">
              选择规程文档 (支持 PDF, Word .docx, TXT, Markdown) *
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 hover:border-cyan-500 rounded-xl p-5 text-center cursor-pointer bg-slate-50 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onSelectFile(file);
                }}
              />
              {uploadFile ? (
                <div className="flex items-center justify-center space-x-2 text-cyan-700 font-medium">
                  <FileUp className="w-5 h-5 text-cyan-600" />
                  <span>
                    {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
              ) : (
                <div className="space-y-1">
                  <Upload className="w-6 h-6 text-slate-500 mx-auto" />
                  <p className="text-slate-700 font-medium">点击浏览或拖拽文件至此区域</p>
                  <p className="text-slate-500 text-[11px]">系统将自动调用分词与切片管道，生成高维向量嵌入</p>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 mb-1 font-medium">规程分类</label>
              <select
                value={uploadCategory}
                onChange={(e) => onCategoryChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white"
              >
                {KNOWLEDGE_CATEGORIES.filter((c) => c !== 'all').map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-700 mb-1 font-medium">适用机型</label>
              <input
                type="text"
                value={uploadTargetEquipment}
                onChange={(e) => onTargetEquipmentChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">标签分类</label>
            <input
              type="text"
              value={uploadTags}
              onChange={(e) => onTagsChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white"
            />
          </div>

          {/* RAG Pipeline Specs */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-[11px] text-slate-600">
            <div className="font-semibold text-slate-800 flex items-center space-x-1.5">
              <Cpu className="w-3.5 h-3.5 text-cyan-600" />
              <span>RAG 向量流水线配置:</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-slate-600">
              <div>• 文本分块策略: 500字滑动窗口</div>
              <div>• 重叠保留窗口: 50字 (Overlap)</div>
              <div>• 向量存储引擎: ChromaDB Persistent</div>
              <div>• 检索算法: 余弦相似度 (Cosine Top-K)</div>
            </div>
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
            disabled={!uploadFile || isUploading}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-1.5 ${
              !uploadFile || isUploading
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer shadow-xs'
            }`}
          >
            {isUploading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>切片向量化中...</span>
              </>
            ) : (
              <>
                <Layers className="w-3.5 h-3.5" />
                <span>解析并注入向量库</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
