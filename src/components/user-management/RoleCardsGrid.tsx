import React from 'react';
import { UserCheck } from 'lucide-react';
import { UserProfile } from '../../types';
import { RoleDefinition } from './userManagementTypes';

interface RoleCardsGridProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  rolesList: RoleDefinition[];
  onSwitchUser: (user: UserProfile) => void;
}

export const RoleCardsGrid: React.FC<RoleCardsGridProps> = ({
  currentUser,
  allUsers,
  rolesList,
  onSwitchUser,
}) => {
  return (
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
                <span
                  className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${r.badgeColor}`}
                >
                  {r.role.toUpperCase()}
                </span>
                <span className="text-xs font-mono text-slate-500">{userCount} 位成员</span>
              </div>

              <h3 className="text-xs font-bold text-slate-900">{r.title}</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed line-clamp-2">
                {r.desc}
              </p>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
              {isCurrentActiveRole ? (
                <span className="text-[10px] text-blue-700 font-bold flex items-center">
                  <UserCheck className="w-3 h-3 mr-1" />
                  当前登录角色
                </span>
              ) : (
                <button
                  type="button"
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
  );
};
