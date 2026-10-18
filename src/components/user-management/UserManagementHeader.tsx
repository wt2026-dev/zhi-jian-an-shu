import React from 'react';
import { Users, Plus } from 'lucide-react';

interface UserManagementHeaderProps {
  canAddUser: boolean;
  onOpenAddModal: () => void;
}

export const UserManagementHeader: React.FC<UserManagementHeaderProps> = ({
  canAddUser,
  onOpenAddModal,
}) => {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-100 flex items-center">
          <Users className="w-5 h-5 mr-2 text-cyan-400" />
          系统用户管理与四级 RBAC 角色权限矩阵
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          面向管理员、维修人员、巡检人员与普通操作员，实现工业级业务职责分离与数字签名合规
        </p>
      </div>

      {canAddUser && (
        <button
          type="button"
          onClick={onOpenAddModal}
          className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors flex items-center space-x-1.5 shadow-md shadow-cyan-600/20 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>添加新系统人员</span>
        </button>
      )}
    </div>
  );
};
