import React from 'react';
import { Box, X, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { SparePart, UserProfile } from '../../types';

interface SparePartInOutModalProps {
  part: SparePart | null;
  onClose: () => void;
  type: 'in' | 'out';
  onTypeChange: (type: 'in' | 'out') => void;
  quantity: number;
  onQuantityChange: (qty: number) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  currentUser: UserProfile;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

export const SparePartInOutModal: React.FC<SparePartInOutModalProps> = ({
  part,
  onClose,
  type,
  onTypeChange,
  quantity,
  onQuantityChange,
  reason,
  onReasonChange,
  currentUser,
  submitting,
  errorMessage,
  onSubmit,
}) => {
  if (!part) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900 flex items-center">
            <Box className="w-5 h-5 mr-2 text-blue-600" />
            备件出入库操作
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 text-xs">
          <div className="font-semibold text-slate-800">
            {part.name} ({part.code})
          </div>
          <div className="text-slate-500">
            规格: {part.specification} · 库位: {part.location}
          </div>
          <div className="flex items-center space-x-2 text-blue-700 font-mono font-medium">
            <span>
              当前库存: {part.stock} {part.unit}
            </span>
            <span>(安全库存: {part.safe_stock})</span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 text-xs">
          {/* Type Switcher */}
          <div>
            <label className="block text-slate-700 mb-1.5 font-medium">变动类型</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onTypeChange('out')}
                className={`py-2 px-3 rounded-lg border font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all ${
                  type === 'out'
                    ? 'bg-orange-600 border-orange-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ArrowDownRight className="w-4 h-4" />
                <span>出库领用 (现场检修)</span>
              </button>
              <button
                type="button"
                onClick={() => onTypeChange('in')}
                className={`py-2 px-3 rounded-lg border font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all ${
                  type === 'in'
                    ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>到货入库 / 采购</span>
              </button>
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-slate-700 mb-1 font-medium">
              {type === 'out' ? '领用出库数量' : '到货入库数量'} ({part.unit}) *
            </label>
            <input
              type="number"
              min="1"
              max={type === 'out' ? part.stock : 9999}
              value={quantity}
              onChange={(e) => onQuantityChange(parseInt(e.target.value) || 1)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-slate-700 mb-1 font-medium">事由 / 领用说明</label>
            <input
              type="text"
              placeholder={type === 'out' ? '例: 2号离心泵故障轴承更换' : '例: 批量采购补充安全库存'}
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Operator */}
          <div>
            <label className="block text-slate-700 mb-1 font-medium">经办人</label>
            <input
              type="text"
              disabled
              value={`${currentUser.name} (${currentUser.roleTitle || '工程师'})`}
              className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 cursor-not-allowed"
            />
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {errorMessage}
            </div>
          )}

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 cursor-pointer shadow-xs font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
            >
              {submitting ? '正在提交...' : '确认核销'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
