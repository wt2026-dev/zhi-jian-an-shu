import React from 'react';
import { Search, X, Camera, Sparkles } from 'lucide-react';
import { KNOWLEDGE_CATEGORIES } from './knowledgeTypes';

interface KnowledgeSearchBarProps {
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  searchImageBase64: string | null;
  searchImageName: string | null;
  searchImageInputRef: React.RefObject<HTMLInputElement | null>;
  onImageSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearSearchImage: () => void;
  isRagSearching: boolean;
  onRagSearch: () => void;
  onClearSearch: () => void;
}

export const KnowledgeSearchBar: React.FC<KnowledgeSearchBarProps> = ({
  searchQuery,
  onSearchQueryChange,
  selectedCategory,
  onSelectCategory,
  searchImageBase64,
  searchImageName,
  searchImageInputRef,
  onImageSelected,
  onClearSearchImage,
  isRagSearching,
  onRagSearch,
  onClearSearch,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-xs card-industrial">
      <input
        type="file"
        ref={searchImageInputRef}
        accept="image/*"
        className="hidden"
        onChange={onImageSelected}
      />
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="输入故障症状、设备型号或规范，如：离心泵振动超标对中标准、罗茨风机润滑油牌号..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onRagSearch()}
            className="w-full pl-10 pr-12 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:bg-white"
          />
          {searchQuery && (
            <button
              onClick={onClearSearch}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            type="button"
            onClick={() => searchImageInputRef.current?.click()}
            title="上传设备铭牌/故障照片跨模态检索规程"
            className={`p-2.5 rounded-xl border transition-colors cursor-pointer flex items-center space-x-1.5 ${
              searchImageBase64
                ? 'bg-cyan-50 text-cyan-700 border-cyan-300'
                : 'bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-800 border-slate-200 shadow-xs'
            }`}
          >
            <Camera className="w-4 h-4 text-slate-500" />
            <span className="text-xs hidden md:inline">以图搜规程</span>
          </button>

          <button
            onClick={onRagSearch}
            disabled={isRagSearching || (!searchQuery.trim() && !searchImageBase64)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isRagSearching ? 'DashScope 检索中...' : 'RAG 语义规程检索'}</span>
          </button>
        </div>
      </div>

      {searchImageBase64 && (
        <div className="flex items-center space-x-2 p-1.5 px-3 rounded-lg bg-cyan-50 border border-cyan-200 text-xs text-cyan-700 w-fit animate-in fade-in">
          <img src={searchImageBase64} alt="检索图片" className="w-6 h-6 rounded object-cover border border-cyan-300" />
          <span className="truncate max-w-[200px] text-[11px]">{searchImageName || '已选设备照片'}</span>
          <button onClick={onClearSearchImage} className="text-slate-500 hover:text-rose-500 p-0.5 transition-colors cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none pt-1">
        {KNOWLEDGE_CATEGORIES.map((cat) => {
          const isSelected = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => onSelectCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                isSelected
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-xs'
                  : 'bg-white text-slate-600 hover:text-slate-800 border border-slate-200'
              }`}
            >
              {cat === 'all' ? '全部类目' : cat}
            </button>
          );
        })}
      </div>
    </div>
  );
};
