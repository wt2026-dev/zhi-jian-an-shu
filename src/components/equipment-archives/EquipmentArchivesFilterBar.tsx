import React from 'react';
import { Activity, MapPin, Search, Tag, X } from 'lucide-react';
import { CATEGORIES, STATUSES, WORKSHOPS } from './equipmentArchiveTypes';

interface EquipmentArchivesFilterBarProps {
  searchQuery: string;
  onChangeSearch: (val: string) => void;
  selectedWorkshop: string;
  onChangeWorkshop: (val: string) => void;
  selectedCategory: string;
  onChangeCategory: (val: string) => void;
  selectedStatus: string;
  onChangeStatus: (val: string) => void;
}

export const EquipmentArchivesFilterBar: React.FC<EquipmentArchivesFilterBarProps> = ({
  searchQuery,
  onChangeSearch,
  selectedWorkshop,
  onChangeWorkshop,
  selectedCategory,
  onChangeCategory,
  selectedStatus,
  onChangeStatus,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3 shadow-xs card-industrial">
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索设备名称、位号编码、型号规格、制造厂商..."
            value={searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white"
          />
          {searchQuery && (
            <button
              onClick={() => onChangeSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Workshop Filter */}
        <div className="flex items-center space-x-1.5 text-xs text-slate-600 shrink-0">
          <MapPin className="w-3.5 h-3.5 text-cyan-600" />
          <select
            value={selectedWorkshop}
            onChange={(e) => onChangeWorkshop(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white cursor-pointer"
          >
            <option value="all">全部车间工段</option>
            {WORKSHOPS.filter((w) => w !== 'all').map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        {/* Category Filter */}
        <div className="flex items-center space-x-1.5 text-xs text-slate-600 shrink-0">
          <Tag className="w-3.5 h-3.5 text-blue-600" />
          <select
            value={selectedCategory}
            onChange={(e) => onChangeCategory(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white cursor-pointer"
          >
            <option value="all">全部分类</option>
            {CATEGORIES.filter((c) => c !== 'all').map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex items-center space-x-1.5 text-xs text-slate-600 shrink-0">
          <Activity className="w-3.5 h-3.5 text-emerald-600" />
          <select
            value={selectedStatus}
            onChange={(e) => onChangeStatus(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white cursor-pointer"
          >
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
