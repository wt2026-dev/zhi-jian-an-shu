import React from 'react';
import { STAT_CARDS } from './adminReviewTypes';

interface AdminReviewsStatCardsProps {
  statusFilter: 'pending' | 'approved' | 'rejected' | 'all';
  onStatusFilterChange: (status: 'pending' | 'approved' | 'rejected' | 'all') => void;
  counts: {
    pending: number;
    approved: number;
    rejected: number;
    all: number;
  };
}

export const AdminReviewsStatCards: React.FC<AdminReviewsStatCardsProps> = ({
  statusFilter,
  onStatusFilterChange,
  counts,
}) => {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {STAT_CARDS.map((card) => {
        const Icon = card.icon;
        const isSelected = statusFilter === card.key;
        const count = counts[card.key];
        return (
          <div
            key={card.key}
            onClick={() => onStatusFilterChange(card.key)}
            className={`glass-card p-4 shadow-xs border transition-all cursor-pointer select-none relative overflow-hidden ${
              isSelected
                ? card.activeCls
                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg ${card.iconBg}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${card.badgeCls}`}>
                {count} 条
              </span>
            </div>
            <div className="mt-1">
              <span className="text-xs font-bold text-slate-700">{card.label}</span>
              <div className={`text-2xl font-extrabold font-mono tracking-tight mt-0.5 ${card.countCls}`}>
                {count}
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
              <span>{card.desc}</span>
              {isSelected && (
                <span className="font-semibold text-blue-600">当前筛选</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
