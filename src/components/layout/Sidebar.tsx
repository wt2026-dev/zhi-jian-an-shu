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
    <div className="flex flex-col h-full bg-white/95 backdrop-blur-md border-r border-slate-200/80 select-none">
      {/* Mobile Drawer Header (Only shown when opened as off-canvas drawer) */}
      <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-slate-100 shrink-0">
        <span className="text-xs font-bold text-slate-800 tracking-tight">系统功能导航</span>
        <button
          type="button"
          onClick={onCloseMobile}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Groups List */}
      <div className="flex-1 overflow-y-auto py-3.5 px-2.5 space-y-4 custom-scrollbar">
        {NAV_GROUPS.map((group) => {
        // 按角色过滤受限菜单项（item.roles 未设置则全员可见）
        const visibleItems = group.items.filter((item) => !item.roles || (role && item.roles.includes(role)));
        if (visibleItems.length === 0) return null;
        return (
          <div key={group.id} className="space-y-1">
            {/* Group Header */}
            {!isCollapsed ? (
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                {group.label}
              </div>
            ) : (
              <div className="h-2 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
              </div>
            )}

            {/* Group Items */}
            <div className="space-y-1">
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
                    className={`group relative w-full flex items-center rounded-xl transition-all duration-150 cursor-pointer text-left ${
                      isCollapsed
                        ? 'justify-center h-10 px-0'
                        : 'px-3 py-2.5 gap-3'
                    } ${
                      isSelected
                        ? 'bg-blue-50/90 text-blue-700 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 font-normal'
                    }`}
                  >
                    {/* Selected state left accent pill indicator */}
                    {isSelected && (
                      <span
                        className="absolute left-1 top-2 bottom-2 w-[3.5px] rounded-full bg-gradient-to-b from-blue-600 to-indigo-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]"
                      />
                    )}

                    {/* Icon */}
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-transform duration-150 ${
                        isSelected
                          ? 'text-blue-600 scale-105'
                          : 'text-slate-400 group-hover:text-blue-600 group-hover:scale-105'
                      }`}
                    />

                    {/* Label & Badges (when not collapsed) */}
                    {!isCollapsed && (
                      <div className="flex-1 flex items-center justify-between min-w-0">
                        <span className="text-xs truncate tracking-tight">
                          {item.label}
                        </span>
                        {item.highlight && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 border border-blue-200/60 shrink-0">
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
        <div className="p-3 border-t border-slate-100/90 shrink-0 bg-white/70 backdrop-blur-xs">
          <div className="flex items-center space-x-2.5 px-3 py-2 rounded-xl bg-slate-50/90 border border-slate-200/70 text-xs text-slate-600 shadow-2xs">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <div className="flex items-center justify-between flex-1 min-w-0">
              <span className="text-[11px] font-medium text-slate-700 truncate">边缘遥测节点</span>
              <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200/60 shrink-0">16台在线</span>
            </div>
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
