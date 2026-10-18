import React from 'react';
import { Plus, X } from 'lucide-react';
import { UserRole } from '../../types';
import { NewUserFormState } from './userManagementTypes';

interface AddUserModalProps {
  isOpen: boolean;
  form: NewUserFormState;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onChangeField: <K extends keyof NewUserFormState>(
    field: K,
    val: NewUserFormState[K]
  ) => void;
}

export const AddUserModal: React.FC<AddUserModalProps> = ({
  isOpen,
  form,
  isSubmitting,
  error,
  onClose,
  onSubmit,
  onChangeField,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <form
        onSubmit={onSubmit}
        className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900 flex items-center">
            <Plus className="w-4 h-4 mr-1.5 text-blue-600" />
            新增运维成员与权限授权
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
            aria-label="关闭弹窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-700 mb-1">人员姓名 *</label>
            <input
              type="text"
              required
              placeholder="例如: 赵明远"
              value={form.name}
              onChange={(e) => onChangeField('name', e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1">系统登录用户名 (工号) *</label>
            <input
              type="text"
              required
              placeholder="例如: tech_zhao"
              value={form.username}
              onChange={(e) => onChangeField('username', e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1">系统角色权限 *</label>
            <select
              value={form.role}
              onChange={(e) => onChangeField('role', e.target.value as UserRole)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="admin">系统管理员 / 车间总工 (全部权限)</option>
              <option value="technician">检修工程师 / 维修技师 (维修接单)</option>
              <option value="inspector">现场点巡检员 / 质检员 (巡检查验)</option>
              <option value="operator">车间操作员 / 普通用户 (日常报修)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-700 mb-1">所属车间工段 / 部门</label>
            <input
              type="text"
              placeholder="例如: 一号动力车间电气维保组"
              value={form.department}
              onChange={(e) => onChangeField('department', e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1">手机号码 (接收紧急抢修短信)</label>
            <input
              type="text"
              placeholder="13800138000"
              value={form.phone}
              onChange={(e) => onChangeField('phone', e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
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
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium cursor-pointer shadow-xs"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {isSubmitting ? '保存中...' : '保存授权'}
          </button>
        </div>
      </form>
    </div>
  );
};
