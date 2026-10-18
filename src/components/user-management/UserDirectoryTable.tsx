import React from 'react';
import { Users, Search } from 'lucide-react';
import { UserProfile } from '../../types';
import { UserAvatar } from '../UserAvatar';

interface UserDirectoryTableProps {
  currentUser: UserProfile;
  users: UserProfile[];
  totalCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedRoleFilter: string;
  onRoleFilterChange: (role: string) => void;
  statusUpdatingId: string | null;
  onToggleUserStatus: (user: UserProfile) => void;
  onSwitchUser: (user: UserProfile) => void;
}

export const UserDirectoryTable: React.FC<UserDirectoryTableProps> = ({
  currentUser,
  users,
  totalCount,
  searchQuery,
  onSearchChange,
  selectedRoleFilter,
  onRoleFilterChange,
  statusUpdatingId,
  onToggleUserStatus,
  onSwitchUser,
}) => {
  return (
    <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900 flex items-center">
          <Users className="w-4 h-4 mr-2 text-blue-600" />
          企业注册运维人员花名册 ({totalCount} 人)
        </h3>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索姓名、部门、工号..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:bg-white"
            />
          </div>

          <select
            value={selectedRoleFilter}
            onChange={(e) => onRoleFilterChange(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-blue-500"
          >
            <option value="all">全部岗位角色</option>
            <option value="admin">系统管理员</option>
            <option value="technician">检修工程师</option>
            <option value="inspector">点巡检员</option>
            <option value="operator">普通操作员</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-50 text-[11px] text-slate-600 border-b border-slate-200 font-semibold">
            <tr>
              <th className="px-4 py-3">头像</th>
              <th className="px-4 py-3">人员姓名 / 登录名</th>
              <th className="px-4 py-3">所属部门 / 车间</th>
              <th className="px-4 py-3">岗位角色</th>
              <th className="px-4 py-3">账号状态</th>
              <th className="px-4 py-3">联系电话 / 邮箱</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {users.map((u) => {
              const isCurrent = u.id === currentUser.id;
              return (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <UserAvatar user={u} size={32} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900 flex items-center space-x-1.5">
                      <span>{u.name}</span>
                      {isCurrent && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-bold">
                          当前身份
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">@{u.username}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{u.department}</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-semibold text-blue-700">{u.roleTitle}</span>
                  </td>
                  <td className="px-4 py-3">
                    {u.status === 'disabled' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                        已停用
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                        正常
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                    <div>{u.phone}</div>
                    <div className="text-[10px] text-slate-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      {currentUser.role === 'admin' && !isCurrent && (
                        <button
                          type="button"
                          onClick={() => onToggleUserStatus(u)}
                          disabled={statusUpdatingId === u.id}
                          className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer border shadow-xs ${
                            u.status === 'disabled'
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                          }`}
                        >
                          {statusUpdatingId === u.id
                            ? '处理中...'
                            : u.status === 'disabled'
                            ? '启用账号'
                            : '停用账号'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onSwitchUser(u)}
                        disabled={u.status === 'disabled'}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-slate-100 text-slate-500 cursor-default'
                            : u.status === 'disabled'
                            ? 'bg-slate-100 text-slate-500 cursor-not-allowed border border-slate-200'
                            : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-xs'
                        }`}
                      >
                        {isCurrent
                          ? '正在使用'
                          : u.status === 'disabled'
                          ? '已停用'
                          : '以此身份登录'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
