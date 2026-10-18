import React from 'react';
import { Check, X } from 'lucide-react';
import { UserProfile } from '../../types';

interface HazardVerifyModalProps {
  isOpen: boolean;
  currentUser: UserProfile;
  verifyForm: {
    passed: boolean;
    comment: string;
  };
  onChangeForm: (form: { passed: boolean; comment: string }) => void;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const HazardVerifyModal: React.FC<HazardVerifyModalProps> = ({
  isOpen,
  currentUser,
  verifyForm,
  onChangeForm,
  submitting,
  error,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900 flex items-center">
            <Check className="w-5 h-5 mr-2 text-emerald-600" />
            复核验收与隐患销号
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-700 mb-1 font-medium">复核验收人</label>
            <input
              type="text"
              disabled
              value={`${currentUser.name} (${currentUser.roleTitle || '安全总监/技术主管'})`}
              className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-600"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">验收结论 *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangeForm({ ...verifyForm, passed: true })}
                className={`py-2 px-3 rounded-lg border font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all ${
                  verifyForm.passed
                    ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Check className="w-4 h-4" />
                <span>合格准予销号</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeForm({ ...verifyForm, passed: false })}
                className={`py-2 px-3 rounded-lg border font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all ${
                  !verifyForm.passed
                    ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <X className="w-4 h-4" />
                <span>不合格退回重整</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">复核评价意见与试机证明 *</label>
            <textarea
              rows={3}
              required
              value={verifyForm.comment}
              onChange={(e) => onChangeForm({ ...verifyForm, comment: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {error}
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
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {submitting ? '提交中...' : '确认复核归档'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
