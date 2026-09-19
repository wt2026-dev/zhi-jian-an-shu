import React from 'react';
import { ShieldAlert, ArrowLeft, UserCog } from 'lucide-react';
import { NAV_GROUPS } from './layout/navConfig';
import { FORBIDDEN_HINT, getRoleHome, normalizeRole } from '../utils/rbac';

interface PermissionDeniedProps {
  /** 被拒绝的页面 id（nav item id） */
  tabId?: string;
  /** 当前角色（原始值，可能是 'user'） */
  role?: string | null;
  /** 当前用户显示名 */
  userName?: string;
  /** 返回该角色默认首页 */
  onBackHome?: () => void;
}

const ROLE_LABEL: Record<string, string> = {
  admin: '总工',
  manager: '车间主管',
  technician: '检修技师',
  inspector: '点检工程师',
  operator: '操作工',
  archivist: '档案员',
};

/**
 * 无权限访问时的友好占位页 —— 替代白屏 / 报错堆栈。
 * 菜单里不会出现无权限项，所以正常点击进不来；这里是给
 * 「手敲 URL / ?view=xxx 深链 / 切换角色后停留在旧页面」这三类场景兜底。
 */
export const PermissionDenied: React.FC<PermissionDeniedProps> = ({
  tabId,
  role,
  userName,
  onBackHome,
}) => {
  const effective = normalizeRole(role);
  const roleLabel = ROLE_LABEL[effective ?? ''] ?? '当前角色';

  // 找出被拒页面的中文名与"哪些角色能看"，让提示是可操作的而不是干巴巴一句"没权限"
  let pageLabel = tabId || '该页面';
  let allowedLabel = '';
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.id === tabId);
    if (item) {
      pageLabel = item.label;
      allowedLabel = item.roles?.length
        ? item.roles.map((r) => ROLE_LABEL[r] ?? r).join('、')
        : '全部角色';
      break;
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center py-10">
      <div
        data-testid="permission-denied"
        className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-sm p-7 text-center"
      >
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mb-4">
          <ShieldAlert className="w-7 h-7 text-amber-500" />
        </div>

        <h2 className="text-base font-bold text-slate-900 mb-1.5">{FORBIDDEN_HINT}</h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          <strong className="text-slate-700">{pageLabel}</strong> 不对{roleLabel}开放
          {allowedLabel ? <>，仅 <strong className="text-slate-700">{allowedLabel}</strong> 可访问</> : null}。
        </p>

        {userName ? (
          <p className="mt-2 text-[11px] text-slate-400">
            当前登录：{userName}（{roleLabel}）
          </p>
        ) : null}

        <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-2.5">
          {onBackHome && (
            <button
              type="button"
              id="btn-permission-back-home"
              data-testid="btn-permission-back-home"
              onClick={onBackHome}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回我的首页</span>
            </button>
          )}
          <span className="text-[11px] text-slate-400 flex items-center space-x-1">
            <UserCog className="w-3.5 h-3.5" />
            <span>或点击右上角头像切换角色后重试</span>
          </span>
        </div>
      </div>
    </div>
  );
};

/** 便捷封装：直接按角色算出默认首页并跳回去 */
export function useRoleHomeRedirect(
  role?: string | null,
  onNavigate?: (tabId: string) => void
): () => void {
  return React.useCallback(() => {
    onNavigate?.(getRoleHome(role));
  }, [role, onNavigate]);
}
