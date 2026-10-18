import React from 'react';
import { Search, X, AlertTriangle } from 'lucide-react';

interface SparePartsFilterBarProps {
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  categories: string[];
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  onlyLowStock: boolean;
  onToggleLowStock: () => void;
  lowStockCount: number;
}

export const SparePartsFilterBar: React.FC<SparePartsFilterBarProps> = ({
  searchTerm,
  onSearchTermChange,
  categories,
  selectedCategory,
  onSelectCategory,
  onlyLowStock,
  onToggleLowStock,
  lowStockCount,
}) => {
  return (
    <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xs">
      {/* Search */}
      <div className="relative flex-1 w-full">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="搜索备件编号、名称、规格型号、货架库位或适配设备..."
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
        />
        {searchTerm && (
          <button
            onClick={() => onSearchTermChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
        <button
          onClick={() => onSelectCategory('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          全部类别
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => onSelectCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              selectedCategory === cat
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {cat}
          </button>
        ))}

        {/* Low Stock Toggle Button */}
        <button
          onClick={onToggleLowStock}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer ${
            onlyLowStock
              ? 'bg-rose-600 text-white shadow-xs'
              : 'bg-white text-rose-600 hover:bg-rose-50 border border-rose-200'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>仅看低库存 ({lowStockCount})</span>
        </button>
      </div>
    </div>
  );
};
