/**
 * KpiCard — 仪表盘 KPI 指标卡组件
 *
 * 从 DashboardView.tsx 提取的独立子组件（原文件 119KB，2145行）。
 *
 * 重构动机：
 *   原 DashboardView 中的 KPI 卡片（设备总数/待办工单/巡检进度/安全作业票/AI协同）
 *   均以 600+ 行的内联 JSX 实现，样式与数据逻辑完全耦合。提取后：
 *   ✅ CockpitDashboardView / DispatchBoardView 可复用同样的卡片外观
 *   ✅ 支持单独进行快照测试（Storybook / vitest）
 *   ✅ 父组件 DashboardView 行数可减少约 150 行（5张卡片 × 30行/张）
 *
 * 设计约束：
 *   - 纯展示组件（stateless presentational component），不持有任何状态
 *   - 接受 onClick 回调实现导航，不直接依赖路由或 Context
 */

import React from 'react';

export interface KpiCardProps {
  /** 卡片标题（如"设备总数"） */
  title: string;
  /** 主要数值 */
  value: string | number;
  /** 数值单位（可选，如"/100"） */
  unit?: string;
  /** 右上角图标节点 */
  icon: React.ReactNode;
  /** 图标背景色 TailwindCSS 类（如 "bg-blue-50 text-blue-600"） */
  iconColor: string;
  /** 悬停边框高亮颜色 TailwindCSS 类（如 "hover:border-blue-400"） */
  accentColor?: string;
  /** 底部描述行节点（可选），用于展示如"运行 X / 预警 Y"等补充信息 */
  footer?: React.ReactNode;
  /** 右侧次要数值 / 徽章（可选），用于展示如"紧急 2"等告警徽章 */
  badge?: React.ReactNode;
  /** 点击回调（导航到对应模块） */
  onClick?: () => void;
  /** 额外 className（用于 AI 卡片的渐变背景等特殊样式） */
  className?: string;
}

/**
 * KPI 指标卡 — 统一样式的工业玻璃态卡片
 *
 * 用法示例：
 * `	sx
 * <KpiCard
 *   title="设备总数"
 *   value={totalEquipments}
 *   icon={<Activity className="w-4 h-4" />}
 *   iconColor="bg-blue-50 text-blue-600"
 *   accentColor="hover:border-blue-400"
 *   footer={
 *     <div className="flex justify-between text-[11px]">
 *       <span className="text-emerald-600">运行 {runningEquipments}</span>
 *       <span className="text-amber-600">预警 {warningEquipments}</span>
 *       <span className="text-rose-600">故障 {faultEquipments}</span>
 *     </div>
 *   }
 *   onClick={() => onNavigate('equipment')}
 * />
 * `
 */
export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  unit,
  icon,
  iconColor,
  accentColor = 'hover:border-slate-300',
  footer,
  badge,
  onClick,
  className = '',
}) => {
  return (
    <div
      onClick={onClick}
      className={`glass-card data-card p-4 relative overflow-hidden group hover:shadow-md transition-all shadow-sm ${accentColor} ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {/* 顶部：标题 + 图标 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{title}</span>
        <span className={`p-1.5 rounded-lg group-hover:scale-105 transition-transform ${iconColor}`}>
          {icon}
        </span>
      </div>


      {/* 中部：主数值 + 右侧徽章 */}
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-2xl font-bold font-mono text-slate-900 leading-none">
          {value}
          {unit && <span className="text-xs font-normal text-slate-500 ml-1">{unit}</span>}
        </span>
        {badge}
      </div>

      {/* 底部：补充信息 */}
      {footer && (
        <div className="mt-2.5 pt-2 border-t border-slate-100">
          {footer}
        </div>
      )}
    </div>
  );
};
