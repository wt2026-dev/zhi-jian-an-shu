import React from 'react';
import { Plus, X } from 'lucide-react';
import { Equipment } from '../../types';
import { CATEGORIES, WORKSHOPS } from './equipmentArchiveTypes';

interface EquipmentCreateModalProps {
  isOpen: boolean;
  formData: Partial<Equipment>;
  onChangeForm: (data: Partial<Equipment>) => void;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const EquipmentCreateModal: React.FC<EquipmentCreateModalProps> = ({
  isOpen,
  formData,
  onChangeForm,
  submitting,
  error,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <form
        onSubmit={onSubmit}
        className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 card-industrial"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 flex items-center">
            <Plus className="w-4 h-4 mr-1.5 text-cyan-600" />
            录入新工业设备资产档案
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-slate-700 mb-1 font-medium">设备名称 *</label>
            <input
              type="text"
              required
              placeholder="例如: 2#循环水冷却泵"
              value={formData.name || ''}
              onChange={(e) => onChangeForm({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">位号编码 (KKS/Tag) *</label>
            <input
              type="text"
              required
              placeholder="例如: PUMP-B202"
              value={formData.code || ''}
              onChange={(e) => onChangeForm({ ...formData, code: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">设备类别</label>
            <select
              value={formData.category}
              onChange={(e) => onChangeForm({ ...formData, category: e.target.value as Equipment['category'] })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white"
            >
              {CATEGORIES.filter((c) => c !== 'all').map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">规格型号</label>
            <input
              type="text"
              placeholder="例如: ISG 150-315A"
              value={formData.model || ''}
              onChange={(e) => onChangeForm({ ...formData, model: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">所属车间工段</label>
            <select
              value={formData.workshop}
              onChange={(e) => onChangeForm({ ...formData, workshop: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white"
            >
              {WORKSHOPS.filter((w) => w !== 'all').map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">详细机位安装位置</label>
            <input
              type="text"
              placeholder="例如: B区-02号机位"
              value={formData.location || ''}
              onChange={(e) => onChangeForm({ ...formData, location: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-slate-700 mb-1 font-medium">制造厂家</label>
            <input
              type="text"
              placeholder="例如: 凯泉泵业集团有限公司"
              value={formData.manufacturer || ''}
              onChange={(e) => onChangeForm({ ...formData, manufacturer: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:bg-white"
            />
          </div>
        </div>

        {error && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
            {error}
          </div>
        )}

        <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium cursor-pointer"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {submitting ? '保存中...' : '保存建档'}
          </button>
        </div>
      </form>
    </div>
  );
};
