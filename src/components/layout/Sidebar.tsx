import React from 'react';
import { NAV_GROUPS } from './navConfig';
import { Sparkles, ChevronRight, X } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  isCollapsed: boolean;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  /** 当前登录角色，用于过滤受限菜单（如调度大屏） */
  role?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  isCollapsed,
  isMobileOpen = false,
  onCloseMobile,
  role,
}) => {
  const content = (
    <div className="flex flex-col h-full bg-gradient-to-b from-white via-white to-[#f8fafc] border-r border-slate-200/80 select-none">
      {/* Mobile Drawer Header (Only shown when opened as off-canvas drawer) */}
      <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-slate-100 shrink-0">
        <span className="text-xs font-bold text-slate-800 tracking-tight">系统功能导航</span>
        <button
          type="button"
          onClick={onCloseMobile}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Groups List */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-4 custom-scrollbar">
        {NAV_GROUPS.map((group) => {
        // 按角色过滤受限菜单项（item.roles 未设置则全员可见）
        const visibleItems = group.items.filter((item) => !item.roles || (role && item.roles.includes(role)));
        if (visibleItems.length === 0) return null;
        return (
          <div key={group.id} className="space-y-1">
            {/* Group Header */}
            {!isCollapsed ? (
              <div className="px-3 pt-1 pb-1 text-[11px] font-medium tracking-wider text-slate-400">
                {group.label}
              </div>
            ) : (
              <div className="h-2 flex items-center justify-center">
                <div className="w-1 h-1 rounded-full bg-slate-200" />
              </div>
            )}

            {/* Group Items */}
            <div className="space-y-0.5">
              {visibleItems.map((item) => {
                const isSelected = activeTab === item.id;
                const Icon = item.icon;

                return (
                  <button
                    key={item.id}
                    id={`nav-tab-${item.id}`}
                    type="button"
                    onClick={() => {
                      onTabChange(item.id);
                      if (onCloseMobile) onCloseMobile();
                    }}
                    title={isCollapsed ? item.label : undefined}
                    className={`group relative w-full flex items-center rounded-lg transition-all duration-150 cursor-pointer text-left ${
                      isCollapsed
                        ? 'justify-center h-10 px-0'
                        : 'px-3 py-2 gap-3'
                    } ${
                      isSelected
                        ? 'bg-[#eff6ff] text-[#2563eb] font-semibold shadow-2xs'
                        : 'text-[#475569] hover:text-slate-900 hover:bg-slate-100/70 font-normal'
                    }`}
                  >
                    {/* Selected state 3px blue-cyan gradient indicator */}
                    {isSelected && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
                        style={{ background: 'linear-gradient(180deg, #3b82f6 0%, #06b6d4 100%)' }}
                      />
                    )}

                    {/* Icon */}
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isSelected
                          ? 'text-[#2563eb]'
                          : 'text-[#64748b] group-hover:text-[#2563eb]'
                      }`}
                    />

                    {/* Label & Badges (when not collapsed) */}
                    {!isCollapsed && (
                      <div className="flex-1 flex items-center justify-between min-w-0">
                        <span className="text-xs truncate tracking-tight">
                          {item.label}
                        </span>
                        {item.highlight && (
                          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-cyan-50 text-cyan-600 border border-cyan-100 shrink-0">
                            AI
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>

      {/* Sidebar Footer Status (when expanded) */}
      {!isCollapsed && (
        <div className="p-3 border-t border-slate-100 shrink-0 bg-white/70 backdrop-blur-xs">
          <div className="flex items-center space-x-2 px-2 py-1.5 rounded-md bg-slate-50 border border-slate-200/60 text-[11px] text-slate-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="truncate">边缘遥测节点在线 (16台)</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* 1. Desktop & Tablet Static Sidebar */}
      <aside
        className={`hidden md:block shrink-0 transition-all duration-200 ease-in-out h-full z-30 ${
          isCollapsed ? 'w-[64px]' : 'w-[220px]'
        }`}
      >
        {content}
      </aside>

      {/* 2. Mobile Off-Canvas Drawer (<768px) */}
      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
            onClick={onCloseMobile}
          />
          {/* Slide-out panel */}
          <div className="relative w-[260px] max-w-[80vw] h-full shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            {content}
          </div>
        </div>
      )}
    </>
  );
};
