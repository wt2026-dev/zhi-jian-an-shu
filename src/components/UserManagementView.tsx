import React, { useState } from 'react';
import {
  Users,
  Shield,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Lock,
  UserCheck,
  Check,
  Edit2,
  Trash2,
  X,
  Smartphone,
  Mail,
  Building,
} from 'lucide-react';
import { UserProfile, UserRole } from '../types';
import { authApi } from '../api';
import { UserAvatar } from './UserAvatar';

interface UserManagementViewProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onAddUser: (user: UserProfile) => void;
  onSwitchUser: (user: UserProfile) => void;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentUser,
  allUsers,
  onAddUser,
  onSwitchUser,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  // Form State
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    username: '',
    role: 'technician' as UserRole,
    department: '动力机电维保车间',
    phone: '',
    email: '',
  });

  // 创建用户提交状态与错误提示 (真实接口调用)
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);

  const rolesList: { role: UserRole; title: string; desc: string; badgeColor: string }[] = [
    {
      role: 'admin',
      title: '系统管理员 / 车间总工',
      desc: '具备全系统最高控制权，包含工单派发、安全作业票终审放行、设备建档与用户授权',
      badgeColor: 'bg-red-50 text-red-700 border-red-200',
    },
    {
      role: 'technician',
      title: '设备检修工程师 / 技师',
      desc: '负责工单接单响应、现场故障拆检修复、备件领用耗用填报与安全作业票申请',
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      role: 'inspector',
      title: '现场点巡检员 / 质检员',
      desc: '负责日常巡检路线打卡、多参数现场抄表、设备异常发现与完工质检验收',
      badgeColor: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    },
    {
      role: 'operator',
      title: '车间操作员 / 普通用户',
      desc: '负责日常生产设备看护、突发异响报修申请、设备运行状态与知识规程查询',
      badgeColor: 'bg-slate-100 text-slate-600 border-slate-200',
    },
  ];

  const permissionsMatrix = [
    {
      module: '设备档案与台账',
      admin: true,
      technician: true,
      inspector: true,
      operator: '仅查看',
    },
    {
      module: '设备实时健康遥测',
      admin: true,
      technician: true,
      inspector: true,
      operator: true,
    },
    {
      module: '工单创建与申报',
      admin: true,
      technician: true,
      inspector: true,
      operator: true,
    },
    {
      module: '工单调度派单权限',
      admin: true,
      technician: false,
      inspector: false,
      operator: false,
    },
    {
      module: '工单施工接单与维修报告',
      admin: true,
      technician: true,
      inspector: false,
      operator: false,
    },
    {
      module: '工单质检验收归档',
      admin: true,
      technician: false,
      inspector: true,
      operator: false,
    },
    {
      module: '现场点巡检打卡与抄表',
      admin: true,
      technician: true,
      inspector: true,
      operator: false,
    },
    {
      module: '高危安全作业票审批放行',
      admin: true,
      technician: false,
      inspector: false,
      operator: false,
    },
    {
      module: 'LOTO 能量隔离挂牌上锁',
      admin: true,
      technician: true,
      inspector: false,
      operator: false,
    },
    {
      module: 'AI 检修大脑与图像诊断',
      admin: true,
      technician: true,
      inspector: true,
      operator: true,
    },
    {
      module: '知识库发布与规程修订',
      admin: true,
      technician: true,
      inspector: false,
      operator: '仅检索',
    },
  ];

  const [localUsers, setLocalUsers] = useState<UserProfile[]>(allUsers || []);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  React.useEffect(() => {
    setLocalUsers(allUsers || []);
  }, [allUsers]);

  const handleToggleUserStatus = async (targetUser: UserProfile) => {
    const nextStatus = targetUser.status === 'disabled' ? 'active' : 'disabled';
    setStatusUpdatingId(targetUser.id);
    try {
      const res = await authApi.updateUserStatus(targetUser.id, nextStatus);
      if (res && res.user) {
        setLocalUsers((prev) =>
          prev.map((u) => (u.id === targetUser.id ? { ...u, status: nextStatus } : u))
        );
      }
    } catch (err: any) {
      alert(err?.message || '修改用户状态失败');
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const filteredUsers = (localUsers || []).filter((u) => {
    const q = (searchQuery || '').toLowerCase();
    const matchesRole = selectedRoleFilter === 'all' || u.role === selectedRoleFilter;
    const matchesSearch =
      (u.name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.department || '').toLowerCase().includes(q) ||
      (u.roleTitle || '').toLowerCase().includes(q);

    return matchesRole && matchesSearch;
  });

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const roleObj = rolesList.find((r) => r.role === newUserForm.role);
    setIsCreatingUser(true);
    setCreateUserError(null);
    try {
      // 真实落库：通过后端接口创建账号 (RBAC: 仅管理员，bcrypt 密码哈希)
      const created = await authApi.createUser({
        username: newUserForm.username || `user_${Date.now().toString().slice(-4)}`,
        name: newUserForm.name,
        // 初始密码与种子账号保持一致，创建后可由管理员修改
        password: 'password123',
        role: newUserForm.role,
        roleTitle: roleObj?.title || '普通用户',
        department: newUserForm.department,
        phone: newUserForm.phone,
        email: newUserForm.email,
        permissions: ['read', 'create_order'],
      });
      onAddUser(created);
      setShowAddModal(false);
      setNewUserForm({
        name: '',
        username: '',
        role: 'technician',
        department: '动力机电维保车间',
        phone: '',
        email: '',
      });
    } catch (err: any) {
      setCreateUserError(err?.message || '创建用户失败，请稍后重试');
    } finally {
      setIsCreatingUser(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center">
            <Users className="w-5 h-5 mr-2 text-cyan-400" />
            系统用户管理与四级 RBAC 角色权限矩阵
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            面向管理员、维修人员、巡检人员与普通操作员，实现工业级业务职责分离与数字签名合规
          </p>
        </div>

        {currentUser.role === 'admin' && (
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors flex items-center space-x-1.5 shadow-md shadow-cyan-600/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>添加新系统人员</span>
          </button>
        )}
      </div>

      {/* Role Cards Definition */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {rolesList.map((r) => {
          const userCount = allUsers.filter((u) => u.role === r.role).length;
          const isCurrentActiveRole = currentUser.role === r.role;

          return (
            <div
              key={r.role}
              className={`p-4 rounded-lg border flex flex-col justify-between transition-all ${
                isCurrentActiveRole
                  ? 'bg-blue-50/70 border-blue-500 shadow-sm ring-1 ring-blue-500/30'
                  : 'card-industrial bg-white border-slate-200 shadow-xs hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${r.badgeColor}`}>
                    {r.role.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-slate-500">{userCount} 位成员</span>
                </div>

                <h3 className="text-xs font-bold text-slate-900">{r.title}</h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed line-clamp-2">{r.desc}</p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                {isCurrentActiveRole ? (
                  <span className="text-[10px] text-blue-700 font-bold flex items-center">
                    <UserCheck className="w-3 h-3 mr-1" />
                    当前登录角色
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      const sampleUser = allUsers.find((u) => u.role === r.role);
                      if (sampleUser) onSwitchUser(sampleUser);
                    }}
                    className="text-[11px] text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                  >
                    一键切换模拟体验
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* RBAC Permission Matrix Table */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 flex items-center">
          <Shield className="w-4 h-4 mr-2 text-blue-600" />
          全业务功能模块权限对照矩阵 (RBAC Permission Matrix)
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[11px] text-slate-600 border-b border-slate-200 font-semibold">
              <tr>
                <th className="px-4 py-2.5">功能业务模块</th>
                <th className="px-4 py-2.5 text-center text-rose-600">系统管理员</th>
                <th className="px-4 py-2.5 text-center text-orange-600">维修技师</th>
                <th className="px-4 py-2.5 text-center text-blue-600">巡检/质检员</th>
                <th className="px-4 py-2.5 text-center text-slate-600">普通用户/操作员</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {permissionsMatrix.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{item.module}</td>
                  <td className="px-4 py-2.5 text-center">
                    {item.admin === true ? (
                      <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                    ) : item.admin === false ? (
                      <X className="w-4 h-4 text-slate-300 mx-auto" />
                    ) : (
                      <span className="text-[10px] text-slate-500">{item.admin}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {item.technician === true ? (
                      <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                    ) : item.technician === false ? (
                      <X className="w-4 h-4 text-slate-300 mx-auto" />
                    ) : (
                      <span className="text-[10px] text-slate-500">{item.technician}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {item.inspector === true ? (
                      <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                    ) : item.inspector === false ? (
                      <X className="w-4 h-4 text-slate-300 mx-auto" />
                    ) : (
                      <span className="text-[10px] text-slate-500">{item.inspector}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {item.operator === true ? (
                      <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                    ) : item.operator === false ? (
                      <X className="w-4 h-4 text-slate-300 mx-auto" />
                    ) : (
                      <span className="text-[10px] text-slate-500">{item.operator}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Accounts Directory */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center">
            <Users className="w-4 h-4 mr-2 text-blue-600" />
            企业注册运维人员花名册 ({allUsers.length} 人)
          </h3>

          <div className="flex items-center space-x-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索姓名、部门、工号..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white"
              />
            </div>

            <select
              value={selectedRoleFilter}
              onChange={(e) => setSelectedRoleFilter(e.target.value)}
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
              {filteredUsers.map((u) => {
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
                            onClick={() => handleToggleUserStatus(u)}
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
                          onClick={() => onSwitchUser(u)}
                          disabled={u.status === 'disabled'}
                          className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-slate-100 text-slate-400 cursor-default'
                              : u.status === 'disabled'
                              ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                              : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-xs'
                          }`}
                        >
                          {isCurrent ? '正在使用' : u.status === 'disabled' ? '已停用' : '以此身份登录'}
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

      {/* Modal: Add User */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateUser}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center">
                <Plus className="w-4 h-4 mr-1.5 text-blue-600" />
                新增运维成员与权限授权
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
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
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">系统登录用户名 (工号) *</label>
                <input
                  type="text"
                  required
                  placeholder="例如: tech_zhao"
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">系统角色权限 *</label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as any })}
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
                  value={newUserForm.department}
                  onChange={(e) => setNewUserForm({ ...newUserForm, department: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">手机号码 (接收紧急抢修短信)</label>
                <input
                  type="text"
                  placeholder="13800138000"
                  value={newUserForm.phone}
                  onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>
            </div>

            {createUserError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
                {createUserError}
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium cursor-pointer shadow-xs"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isCreatingUser}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
              >
                {isCreatingUser ? '保存中...' : '保存授权'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
