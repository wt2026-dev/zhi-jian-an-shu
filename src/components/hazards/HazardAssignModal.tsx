import React from 'react';
import { Send, X } from 'lucide-react';
import { Hazard, UserProfile } from '../../types';

interface HazardAssignModalProps {
  isOpen: boolean;
  hazard: Hazard | null;
  allUsers: UserProfile[];
  assignForm: {
    assignee_id: string;
    deadline: string;
    dispatch_note: string;
  };
  onChangeForm: (form: { assignee_id: string; deadline: string; dispatch_note: string }) => void;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const HazardAssignModal: React.FC<HazardAssignModalProps> = ({
  isOpen,
  hazard,
  allUsers,
  assignForm,
  onChangeForm,
  submitting,
  error,
  onClose,
  onSubmit,
}) => {
  if (!isOpen || !hazard) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900 flex items-center">
            <Send className="w-5 h-5 mr-2 text-blue-600" />
            派发隐患整改工单
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 text-xs">
          <div className="font-semibold text-slate-800">{hazard.title}</div>
          <div className="text-slate-500">
            设备: {hazard.equipment_name} · 等级: {hazard.level === 'major' ? '重大隐患' : '一般隐患'}
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-700 mb-1 font-medium">指派主修技师 *</label>
            <select
              value={assignForm.assignee_id}
              onChange={(e) => onChangeForm({ ...assignForm, assignee_id: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              required
            >
              {allUsers
                .filter((u) => u.role === 'technician' || u.role === 'admin')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.roleTitle || '维保技师'})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">整改截止时间 *</label>
            <input
              type="date"
              required
              value={assignForm.deadline}
              onChange={(e) => onChangeForm({ ...assignForm, deadline: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">整改调度说明 / 备件安全要求</label>
            <textarea
              rows={3}
              value={assignForm.dispatch_note}
              onChange={(e) => onChangeForm({ ...assignForm, dispatch_note: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {submitting ? '正在派单...' : '确认下发工单'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
