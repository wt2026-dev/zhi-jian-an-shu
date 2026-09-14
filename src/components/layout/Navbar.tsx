import React, { useState, useEffect } from 'react';
import {
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  Wrench,
  QrCode,
  Bell,
  LogOut,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { Logo } from '../Logo';
import { UserProfile, UserRole, NotificationItem } from '../../types';
import { getBreadcrumb } from './navConfig';
import { UserAvatar } from '../UserAvatar';
import { AvatarChangeModal } from '../AvatarChangeModal';

interface NavbarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMobileDrawer: () => void;
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onSwitchUser: (user: UserProfile) => void;
  onUpdateCurrentUser?: (user: UserProfile) => void;
  onLogout?: () => void;
  onOpenQuickWorkOrder: () => void;
  onOpenQrScanner: () => void;
  unreadCount?: number;
  notifications?: NotificationItem[];
  onMarkNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenMobileDrawer,
  currentUser,
  allUsers,
  onSwitchUser,
  onUpdateCurrentUser,
  onLogout,
  onOpenQuickWorkOrder,
  onOpenQrScanner,
  unreadCount = 0,
  notifications = [],
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
}) => {
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const notificationContainerRef = React.useRef<HTMLDivElement>(null);
  const roleMenuContainerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNotificationMenu && !showRoleMenu) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        showNotificationMenu &&
        notificationContainerRef.current &&
        !notificationContainerRef.current.contains(target)
      ) {
        setShowNotificationMenu(false);
      }
      if (
        showRoleMenu &&
        roleMenuContainerRef.current &&
        !roleMenuContainerRef.current.contains(target)
      ) {
        setShowRoleMenu(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [showNotificationMenu, showRoleMenu]);

  const breadcrumb = getBreadcrumb(activeTab);

  const getRoleBadge = (role: UserRole | undefined | null) => {
    switch (role) {
      case 'admin':
        return { label: '管理员 / 总工', color: 'bg-red-50 text-red-700 border-red-200' };
      case 'manager':
        return { label: '车间安全总监 / 主管', color: 'bg-purple-50 text-purple-700 border-purple-200' };
      case 'technician':
        return { label: '维修技师', color: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'inspector':
        return { label: '巡检主管', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' };
      case 'operator':
        return { label: '现场操作工', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      case 'archivist':
        return { label: '档案管理员', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
      case 'user':
        return { label: '操作工/普通用户', color: 'bg-slate-100 text-slate-600 border-slate-200' };
      default:
        return { label: '普通用户', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    }
  };

  const handleNotificationClick = (n: NotificationItem) => {
    onMarkNotificationRead?.(n.id);
    setShowNotificationMenu(false);
    if (!n.refType) return;
    const tabMap: Record<string, string> = {
      work_order: 'work_orders',
      work_orders: 'work_orders',
      safety: 'safety',
      safety_permit: 'safety',
      loto_lock: 'safety',
      inspection: 'inspections',
      inspections: 'inspections',
      knowledge: 'knowledge',
      knowledge_graph: 'knowledge_graph',
      procedures: 'procedures',
      hazards: 'hazards',
      spare_parts: 'spare_parts',
      health: 'health',
      equipments: 'equipments',
    };
    const targetTab = tabMap[n.refType];
    if (targetTab) {
      onTabChange(targetTab);
    }
  };

  const notificationStyle = (type: NotificationItem['type']) => {
    switch (type) {
      case 'alert':
        return 'bg-red-50 border border-red-200 text-red-700';
      case 'warning':
        return 'bg-orange-50 border border-orange-200 text-orange-700';
      case 'success':
        return 'bg-emerald-50 border border-emerald-200 text-emerald-700';
      default:
        return 'bg-blue-50 border border-blue-200 text-blue-700';
    }
  };

  const safeUser: UserProfile = currentUser ?? {
    id: 'user-loading',
    name: '加载中...',
    role: 'user' as UserRole,
    roleTitle: '身份核验中',
    department: '—',
    phone: '—',
  };
  const roleInfo = getRoleBadge(safeUser.role);

  return (
    <header className="shrink-0 sticky top-0 z-40 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center justify-between px-3 sm:px-4 lg:px-6">
      {/* Left: Hamburger + Logo + Title */}
      <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
        {/* Desktop Collapse Button */}
        <button
          type="button"
          onClick={onToggleSidebar}
          title={isSidebarCollapsed ? '展开侧边栏 (220px)' : '收起侧边栏 (64px)'}
          className="hidden md:flex p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer border border-transparent hover:border-blue-100"
        >
          {isSidebarCollapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>

        {/* Mobile Hamburger Button */}
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          title="打开系统菜单"
          className="md:hidden p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Logo & Title */}
        <div className="flex items-center space-x-2 min-w-0">
          <Logo size="sm" />
          <span className="font-semibold text-sm text-slate-900 tracking-tight truncate max-w-[160px] sm:max-w-none">
            设备检修知识检索与作业系统
          </span>
          <span className="hidden sm:inline-block text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
            v2.0.0
          </span>
        </div>

        {/* Center Breadcrumbs */}
        <div className="hidden xl:flex items-center space-x-2 text-xs text-slate-400 pl-4 ml-2 border-l border-slate-200">
          <span>{breadcrumb.group}</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <span className="font-medium text-slate-700">{breadcrumb.label}</span>
        </div>
      </div>

      {/* Right: Quick Ticket + QR + Notifications + User Avatar */}
      <div className="flex items-center space-x-2 sm:space-x-2.5 shrink-0">
        {/* Quick Work Order Ticket */}
        <button
          id="header-quick-ticket-btn"
          type="button"
          onClick={onOpenQuickWorkOrder}
          className="hidden sm:inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-medium btn-gradient rounded-lg shadow-xs cursor-pointer transition-all"
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>快速报修</span>
        </button>

        {/* QR Scanner */}
        <button
          id="header-qr-scanner-btn"
          type="button"
          onClick={onOpenQrScanner}
          title="扫描设备二维码"
          className="p-2 rounded-lg bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 transition-colors cursor-pointer"
        >
          <QrCode className="w-4 h-4" />
        </button>

        {/* Notification Center */}
        <div ref={notificationContainerRef} className="relative">
          <button
            id="header-notification-btn"
            type="button"
            onClick={() => setShowNotificationMenu(!showNotificationMenu)}
            className="relative p-2 rounded-lg bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotificationMenu && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-3 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                <span className="text-xs font-semibold text-slate-800">
                  系统实时告警与通知 (未读 {unreadCount})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onMarkAllNotificationsRead?.();
                  }}
                  disabled={unreadCount === 0}
                  className="text-[11px] text-blue-600 hover:underline cursor-pointer disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed"
                >
                  全部已读
                </button>
              </div>
              <div className="space-y-2 text-xs max-h-80 overflow-y-auto pr-1">
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-[11px] text-slate-400">
                    暂无系统通知，业务告警与工单流转消息将在此实时推送
                  </div>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleNotificationClick(n)}
                      className={`w-full text-left p-2.5 rounded-md cursor-pointer transition-opacity hover:opacity-90 ${notificationStyle(
                        n.type
                      )} ${n.read ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs">{n.title}</span>
                        <span className="text-[10px] opacity-75">{(n as any).createdAt?.slice(11, 16) || (n as any).time || '刚刚'}</span>
                      </div>
                      <p className="text-[11px] mt-1 leading-relaxed line-clamp-2">{n.content}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile & Role Switcher */}
        <div ref={roleMenuContainerRef} className="relative">
          <button
            id="header-role-switcher-btn"
            type="button"
            onClick={() => setShowRoleMenu(!showRoleMenu)}
            className="flex items-center space-x-2 px-2 sm:px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all cursor-pointer group"
          >
            <UserAvatar
              user={safeUser}
              size={28}
              showBorder
            />
            <div className="text-left hidden md:block">
              <div className="text-xs font-semibold text-slate-800 group-hover:text-blue-600 flex items-center space-x-1">
                <span>{safeUser.name}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </div>
              <span className={`text-[9px] px-1 py-0.2 rounded border ${roleInfo.color}`}>
                {roleInfo.label}
              </span>
            </div>
          </button>

          {/* Role Dropdown Menu */}
          {showRoleMenu && (
            <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-3 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="text-xs font-semibold text-slate-500 mb-2 px-1">
                切换当前用户角色 (演示与权限切换)
              </div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {allUsers.map((user) => {
                  const isSelected = user.id === safeUser.id;
                  const badge = getRoleBadge(user.role);
                  return (
                    <button
                      key={user.id}
                      id={`switch-user-${user.role}`}
                      type="button"
                      onClick={() => {
                        onSwitchUser(user);
                        setShowRoleMenu(false);
                      }}
                      className={`w-full flex items-center space-x-2.5 p-2 rounded-md text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50 border border-blue-200'
                          : 'hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <UserAvatar
                        user={user}
                        size={28}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-slate-800 truncate">{user.name}</p>
                          <span className={`text-[9px] px-1.5 py-0.2 rounded border ${badge.color}`}>
                            {badge.label}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 truncate">{user.roleTitle}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 px-1 flex items-center justify-between">
                <div>
                  工号: <span className="text-blue-600 font-mono">{safeUser.employeeNo || '—'}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRoleMenu(false);
                      setShowAvatarModal(true);
                    }}
                    className="text-blue-600 hover:text-blue-700 flex items-center space-x-1 cursor-pointer font-medium hover:underline"
                    title="更换个人头像"
                  >
                    <Sparkles className="w-3 h-3 text-blue-500" />
                    <span>更换头像</span>
                  </button>
                  {onLogout && (
                    <button
                      type="button"
                      id="btn-logout"
                      onClick={() => {
                        setShowRoleMenu(false);
                        onLogout();
                      }}
                      className="text-rose-600 hover:text-rose-700 flex items-center space-x-1 cursor-pointer font-medium hover:underline"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>退出登录</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Avatar Settings Modal */}
        <AvatarChangeModal
          isOpen={showAvatarModal}
          onClose={() => setShowAvatarModal(false)}
          currentUser={safeUser}
          onAvatarUpdated={(newAvatarUrl) => {
            onUpdateCurrentUser?.({ ...safeUser, avatar: newAvatarUrl });
          }}
        />
      </div>
    </header>
  );
};
