import React, { useState, useEffect } from 'react';
import {
  Wrench,
  ShieldCheck,
  Search,
  Activity,
  UserCheck,
  Layers,
  Bell,
  CheckCircle2,
  QrCode,
  Sparkles,
  Zap,
  Download,
  LogOut,
  Share2,
  BookOpen,
  Tv,
  Box,
  AlertTriangle,
  Camera,
} from 'lucide-react';
import { Logo } from './Logo';
import { UserRole, UserProfile, NotificationItem } from '../types';
import { UserAvatar } from './UserAvatar';
import { AvatarChangeModal } from './AvatarChangeModal';

interface HeaderProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onSwitchUser: (user: UserProfile) => void;
  onUpdateCurrentUser?: (user: UserProfile) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenQuickWorkOrder: () => void;
  onOpenQrScanner: () => void;
  onLogout?: () => void;
  unreadCount?: number;
  notifications?: NotificationItem[];
  onMarkNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  allUsers,
  onSwitchUser,
  onUpdateCurrentUser,
  activeTab,
  onTabChange,
  onOpenQuickWorkOrder,
  onOpenQrScanner,
  onLogout,
  unreadCount = 0,
  notifications = [],
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
}) => {
  const [timeStr, setTimeStr] = useState<string>('');
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

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          weekday: 'short',
        }) +
        ' ' +
        now.toLocaleTimeString('zh-CN', { hour12: false })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // 全角色徽章映射：任何 role 都有返回值，绝不返回 undefined (否则 roleInfo.color 直接崩溃)
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

  const navItems = [
    { id: 'dashboard', label: '工作台', icon: Activity },
    { id: 'cockpit', label: '数据驾驶舱', icon: Tv, highlight: true },
    { id: 'equipments', label: '设备档案', icon: Layers },
    { id: 'health', label: '健康监测', icon: Zap },
    { id: 'work_orders', label: '检修工单', icon: Wrench },
    { id: 'spare_parts', label: '备件库存', icon: Box },
    { id: 'hazards', label: '隐患闭环', icon: AlertTriangle },
    { id: 'procedures', label: '作业指引', icon: BookOpen },
    { id: 'inspections', label: '巡检作业', icon: CheckCircle2 },
    { id: 'safety', label: '安全与LOTO', icon: ShieldCheck },
    { id: 'knowledge', label: '知识库RAG', icon: Search },
    { id: 'knowledge_graph', label: '知识图谱', icon: Share2 },
    { id: 'ai_assistant', label: 'AI数字人助手', icon: Sparkles, highlight: true },
    { id: 'users', label: '用户与权限', icon: UserCheck },
  ];

  // 空值保护：currentUser 未就绪 (undefined/null) 时使用占位对象，任何位置都不直接读其属性
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
    <header
      className="sticky top-0 z-40 bg-gradient-to-b from-white via-white/95 to-[#f0f4ff]/40 border-b border-slate-200/80 backdrop-blur-md shadow-[0_2px_12px_rgba(15,23,42,0.04)]"
      style={{ borderTop: '1px solid rgba(59, 130, 246, 0.3)' }}
    >
      {/* Top Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Title */}
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
            <Logo size="md" />
            <div className="min-w-0">
              <div className="flex items-center space-x-1.5 sm:space-x-2">
                <span className="font-bold text-sm sm:text-base md:text-lg text-slate-900 tracking-tight truncate max-w-[170px] sm:max-w-none">
                  设备检修知识检索与作业系统
                </span>
                <span className="text-xs font-mono px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                  v2.0.0
                </span>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-100 rounded shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
                  工业物联网在线
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono hidden md:block">
                {timeStr || '2026-09-02 06:10:00'} | 工业设备数字化全生命周期运维平台
              </p>
            </div>
          </div>

          {/* Right Action Area */}
          <div className="flex items-center space-x-3">
            {/* Quick Actions */}
            <button
              id="header-quick-ticket-btn"
              onClick={onOpenQuickWorkOrder}
              className="hidden lg:flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-medium btn-gradient rounded-md transition-all cursor-pointer"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>快速报修</span>
            </button>

            <button
              id="header-qr-scanner-btn"
              onClick={onOpenQrScanner}
              title="扫描设备二维码"
              className="p-2 rounded-md bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 transition-colors cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
            </button>

            {/* Notification Center */}
            <div ref={notificationContainerRef} className="relative">
              <button
                id="header-notification-btn"
                onClick={() => setShowNotificationMenu(!showNotificationMenu)}
                className="relative p-2 rounded-md bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotificationMenu && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-lg z-50 p-3 animate-in fade-in slide-in-from-top-2 duration-150">
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
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer disabled:text-slate-500 disabled:no-underline disabled:cursor-not-allowed"
                    >
                      全部已读
                    </button>
                  </div>
                  <div className="space-y-2 text-xs max-h-80 overflow-y-auto pr-1">
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-[11px] text-slate-500">
                        暂无系统通知，业务告警与工单流转消息将在此实时推送
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handleNotificationClick(n)}
                          className={`w-full text-left p-2.5 rounded-md cursor-pointer transition-opacity hover:opacity-90 ${notificationStyle(n.type)} ${n.read ? 'opacity-60' : ''
                            }`}
                          title={n.read ? '已读 (点击直达)' : '未读 (点击标为已读并直达页面)'}
                        >
                          <div className="flex items-center justify-between font-medium">
                            <span className="truncate">{n.title}</span>
                            <span className="text-[10px] opacity-75 shrink-0 ml-2">{n.time}</span>
                          </div>
                          <p className="text-[11px] mt-1 leading-relaxed opacity-90">{n.content}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Role Switcher Pill */}
            <div ref={roleMenuContainerRef} className="relative">
              <button
                id="header-role-switcher-btn"
                onClick={() => setShowRoleMenu(!showRoleMenu)}
                className="flex items-center space-x-2 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-all cursor-pointer group"
              >
                <UserAvatar user={safeUser} size={28} showBorder />
                <div className="text-left hidden sm:block">
                  <div className="text-xs font-semibold text-slate-800 group-hover:text-blue-600 flex items-center">
                    <span>{safeUser.name}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className={`text-[10px] px-1.5 py-0.2 rounded border ${roleInfo.color}`}>
                      {roleInfo.label}
                    </span>
                  </div>
                </div>
              </button>

              {/* Role Dropdown */}
              {showRoleMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-lg shadow-lg z-50 p-3 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="text-xs font-semibold text-slate-500 mb-2 px-1">
                    切换当前用户角色 (演示与权限切换)
                  </div>
                  <div className="space-y-1.5">
                    {allUsers.map((user) => {
                      const isSelected = user.id === safeUser.id;
                      const badge = getRoleBadge(user.role);
                      return (
                        <button
                          key={user.id}
                          id={`switch-user-${user.role}`}
                          onClick={() => {
                            onSwitchUser(user);
                            setShowRoleMenu(false);
                          }}
                          className={`w-full flex items-center space-x-2.5 p-2 rounded-md text-left transition-colors cursor-pointer ${isSelected
                              ? 'bg-blue-50 border border-blue-200'
                              : 'hover:bg-slate-50 border border-transparent'
                            }`}
                        >
                          <UserAvatar user={user} size={32} />
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
                      工号: <span className="text-blue-600 font-mono">{safeUser.employeeNo || "—"}</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        type="button"
                        id="btn-header-change-avatar"
                        onClick={() => {
                          setShowRoleMenu(false);
                          setShowAvatarModal(true);
                        }}
                        className="text-blue-600 hover:text-blue-700 flex items-center space-x-1 cursor-pointer font-medium hover:underline"
                        title="更换个人头像"
                      >
                        <Camera className="w-3 h-3 text-blue-500" />
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
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <nav className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
          {navItems.map((item, idx) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isGroupStart = ['equipments', 'hazards', 'knowledge', 'users'].includes(item.id);
            return (
              <React.Fragment key={item.id}>
                {isGroupStart && <div className="h-5 w-px bg-slate-200/80 mx-1 shrink-0" />}
                <button
                  id={`nav-tab-${item.id}`}
                  onClick={() => onTabChange(item.id)}
                  className={`group relative flex items-center gap-2 pl-3.5 pr-3 py-1.5 text-xs whitespace-nowrap transition-all cursor-pointer rounded-lg ${
                    isActive
                      ? 'text-blue-600 font-semibold'
                      : item.highlight
                        ? 'text-slate-700 hover:text-blue-600'
                        : 'text-slate-500 hover:text-blue-600'
                  }`}
                >
                  {/* 选中态：左侧 2px 蓝青渐变竖线，禁止整块背景高亮 */}
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-full bg-gradient-to-b from-[#3B82F6] to-[#06B6D4]" />
                  )}
                  <div
                    className={`icon-tile icon-tile-sm shrink-0 transition-all ${
                      isActive
                        ? 'border-blue-300 shadow-[0_2px_8px_rgba(59,130,246,0.2)]'
                        : 'opacity-85 group-hover:opacity-100 group-hover:border-blue-200'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-blue-600' : 'text-slate-500 group-hover:text-blue-600'
                      }`}
                    />
                  </div>
                  <span>{item.label}</span>
                  {item.highlight && (
                    <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold border border-blue-100">
                      AI
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
