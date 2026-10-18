import React from 'react';
import { Plus, X } from 'lucide-react';
import { NewPartFormData, DEFAULT_PART_CATEGORIES } from './sparePartTypes';

interface SparePartCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: NewPartFormData;
  onChangeForm: (form: NewPartFormData) => void;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

export const SparePartCreateModal: React.FC<SparePartCreateModalProps> = ({
  isOpen,
  onClose,
  form,
  onChangeForm,
  submitting,
  errorMessage,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900 flex items-center">
            <Plus className="w-5 h-5 mr-2 text-blue-600" />
            新增工业备件入库建档
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 mb-1 font-medium">备件编号 *</label>
              <input
                type="text"
                required
                placeholder="例: SP-BEAR-6208"
                value={form.code}
                onChange={(e) => onChangeForm({ ...form, code: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-700 mb-1 font-medium">备件名称 *</label>
              <input
                type="text"
                required
                placeholder="例: 深沟球轴承"
                value={form.name}
                onChange={(e) => onChangeForm({ ...form, name: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 mb-1 font-medium">规格型号</label>
              <input
                type="text"
                placeholder="例: 6208-2RS/C3"
                value={form.specification}
                onChange={(e) => onChangeForm({ ...form, specification: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-700 mb-1 font-medium">类别</label>
              <select
                value={form.category}
                onChange={(e) => onChangeForm({ ...form, category: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {DEFAULT_PART_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-700 mb-1 font-medium">初始库存</label>
              <input
                type="number"
                min="0"
                value={form.stock}
                onChange={(e) =>
                  onChangeForm({ ...form, stock: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-slate-700 mb-1 font-medium">安全红线库存</label>
              <input
                type="number"
                min="0"
                value={form.safe_stock}
                onChange={(e) =>
                  onChangeForm({ ...form, safe_stock: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-slate-700 mb-1 font-medium">单位</label>
              <input
                type="text"
                value={form.unit}
                onChange={(e) => onChangeForm({ ...form, unit: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 mb-1 font-medium">库位位置</label>
              <input
                type="text"
                placeholder="例: B区-03货架-02层"
                value={form.location}
                onChange={(e) => onChangeForm({ ...form, location: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-slate-700 mb-1 font-medium">单价 (元)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) =>
                  onChangeForm({ ...form, price: parseFloat(e.target.value) || 0 })
                }
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">适配机组型号</label>
            <input
              type="text"
              placeholder="例: ISG-100-200, DG85-67X8"
              value={form.compatible_models}
              onChange={(e) => onChangeForm({ ...form, compatible_models: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {errorMessage}
            </div>
          )}

          <div className="flex items-center justify-end space-x-3 pt-3">
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
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {submitting ? '保存中...' : '确认建档'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
