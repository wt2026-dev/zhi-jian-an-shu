import React from 'react';
import { AlertTriangle, Search, X } from 'lucide-react';
import { HAZARD_STATUS_TABS } from './hazardTypes';

interface HazardsFilterTabsProps {
  activeStatusTab: string;
  onChangeStatusTab: (tab: string) => void;
  selectedLevel: string;
  onChangeLevel: (level: string) => void;
  searchQuery: string;
  onChangeSearch: (query: string) => void;
}

export const HazardsFilterTabs: React.FC<HazardsFilterTabsProps> = ({
  activeStatusTab,
  onChangeStatusTab,
  selectedLevel,
  onChangeLevel,
  searchQuery,
  onChangeSearch,
}) => {
  return (
    <div className="card-industrial bg-white border border-slate-200 rounded-lg p-3 space-y-3 shadow-xs">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
          {HAZARD_STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onChangeStatusTab(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                activeStatusTab === tab.id
                  ? 'bg-white text-blue-600 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Level Filter */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onChangeLevel('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              selectedLevel === 'all'
                ? 'bg-slate-800 text-white font-medium'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            全部等级
          </button>
          <button
            onClick={() => onChangeLevel('major')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center space-x-1 cursor-pointer transition-colors ${
              selectedLevel === 'major'
                ? 'bg-rose-50 border-rose-300 text-rose-700 font-medium'
                : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50/50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>重大隐患</span>
          </button>
          <button
            onClick={() => onChangeLevel('general')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              selectedLevel === 'general'
                ? 'bg-slate-800 text-white font-medium'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            一般隐患
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="搜索隐患编号、隐患标题、具体风险征兆、设备位号或整改负责人..."
          value={searchQuery}
          onChange={(e) => onChangeSearch(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
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
    </div>
  );
};
