import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Equipment } from '../../types';

export interface NewHazardFormState {
  code: string;
  title: string;
  level: 'major' | 'general';
  category: string;
  equipment_id: string;
  equipment_name: string;
  location: string;
  description: string;
  reported_by: string;
  deadline: string;
}

interface HazardCreateModalProps {
  isOpen: boolean;
  equipments: Equipment[];
  newHazard: NewHazardFormState;
  onChangeHazard: (hazard: NewHazardFormState) => void;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const HazardCreateModal: React.FC<HazardCreateModalProps> = ({
  isOpen,
  equipments,
  newHazard,
  onChangeHazard,
  submitting,
  error,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 text-rose-600" />
            现场安全隐患实时上报建档
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
              <label className="block text-slate-700 mb-1 font-medium">隐患评定等级 *</label>
              <select
                value={newHazard.level}
                onChange={(e) => onChangeHazard({ ...newHazard, level: e.target.value as 'major' | 'general' })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="general">一般隐患 (班组限期排查)</option>
                <option value="major">重大隐患 (厂级督办置顶)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-700 mb-1 font-medium">专业分类</label>
              <select
                value={newHazard.category}
                onChange={(e) => onChangeHazard({ ...newHazard, category: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="机械安全">机械安全</option>
                <option value="电气安全">电气安全</option>
                <option value="压力容器">压力容器</option>
                <option value="腐蚀渗漏">腐蚀渗漏</option>
                <option value="消防安全">消防安全</option>
                <option value="高空作业">高空作业</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">隐患标题 *</label>
            <input
              type="text"
              required
              placeholder="例: 2号给水泵盘根填料严重滴漏伴随轴温异常"
              value={newHazard.title}
              onChange={(e) => onChangeHazard({ ...newHazard, title: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 mb-1 font-medium">关联机组设备</label>
              <select
                value={newHazard.equipment_id}
                onChange={(e) => onChangeHazard({ ...newHazard, equipment_id: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {equipments.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name} ({eq.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-700 mb-1 font-medium">整改截止期限</label>
              <input
                type="date"
                value={newHazard.deadline}
                onChange={(e) => onChangeHazard({ ...newHazard, deadline: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">现场隐患征兆与危害详细描述 *</label>
            <textarea
              rows={3}
              required
              placeholder="详细描述现场安全隐患位置、可能造成的设备停机、火灾或人身电击次生灾害风险..."
              value={newHazard.description}
              onChange={(e) => onChangeHazard({ ...newHazard, description: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
              className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {submitting ? '上报中...' : '提交建档督办'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
