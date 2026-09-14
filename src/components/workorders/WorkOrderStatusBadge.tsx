/**
 * WorkOrderStatusBadge & WorkOrderPriorityBadge
 *
 * 从 WorkOrdersView.tsx 提取的独立子组件。
 *
 * 重构动机：
 *   原 WorkOrdersView.tsx（124KB，2410行）中，getStatusInfo / getPriorityInfo
 *   两个纯函数及其 JSX 渲染逻辑内联在父组件闭包内，无法单独测试，也无法在
 *   DashboardView / DispatchBoardView 等其他视图中复用。
 *
 *   提取为独立组件后：
 *   ✅ 可被任意视图 import，消除重复的 switch-case 代码
 *   ✅ 可单独编写单元测试（vitest + @testing-library/react）
 *   ✅ WorkOrdersView.tsx 职责收窄，向"组合多子组件"方向演进
 *
 * 使用示例：
 *   <WorkOrderStatusBadge status="in_progress" />
 *   <WorkOrderPriorityBadge priority="urgent" />
 */

import React from 'react';
import { WorkOrderStatus, WorkOrderPriority } from '../../types';

// ─── 状态标签配置 ──────────────────────────────────────────────────────────────
export interface StatusInfo {
  label: string;
  /** TailwindCSS 徽章颜色类，格式：bg-xxx text-xxx border-xxx */
  color: string;
}

/**
 * 将 WorkOrderStatus 枚举值转换为中文标签与颜色配置。
 * 集中维护状态映射，全局一致，避免各视图自行 switch-case。
 */
export function getWorkOrderStatusInfo(status: WorkOrderStatus): StatusInfo {
  switch (status) {
    case 'created':
      return { label: '待派单', color: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'dispatched':
      return { label: '待接单', color: 'bg-blue-50 text-blue-700 border-blue-200' };
    case 'in_progress':
      return { label: '检修中', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    case 'pending_acceptance':
      return { label: '待验收', color: 'bg-purple-50 text-purple-700 border-purple-200' };
    case 'completed':
      return { label: '已归档', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    default:
      return { label: String(status), color: 'bg-slate-100 text-slate-600 border-slate-200' };
  }
}

/**
 * 工单状态徽章组件
 *
 * @param status   - 工单状态值
 * @param size     - 'sm'（默认）| 'xs'，控制字体与内边距
 * @param showDot  - 是否在标签前显示状态圆点（默认 false）
 */
export const WorkOrderStatusBadge: React.FC<{
  status: WorkOrderStatus;
  size?: 'xs' | 'sm';
  showDot?: boolean;
}> = ({ status, size = 'sm', showDot = false }) => {
  const { label, color } = getWorkOrderStatusInfo(status);
  const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';

  return (
    <span className={`inline-flex items-center gap-1 rounded border font-medium ${sizeClass} ${color}`}>
      {showDot && (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: 'currentColor', opacity: 0.6 }}
        />
      )}
      {label}
    </span>
  );
};

// ─── 优先级标签配置 ────────────────────────────────────────────────────────────
export interface PriorityInfo {
  label: string;
  color: string;
}

/**
 * 将 WorkOrderPriority 枚举值转换为中文标签与颜色配置。
 */
export function getWorkOrderPriorityInfo(priority: WorkOrderPriority): PriorityInfo {
  switch (priority) {
    case 'urgent':
      return { label: '紧急抢修', color: 'bg-red-50 text-red-700 border-red-200' };
    case 'high':
      return { label: '高优先级', color: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'medium':
      return { label: '中优先级', color: 'bg-blue-50 text-blue-700 border-blue-200' };
    case 'low':
      return { label: '常规维保', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    default:
      return { label: String(priority), color: 'bg-slate-100 text-slate-600 border-slate-200' };
  }
}

/**
 * 工单优先级徽章组件
 */
export const WorkOrderPriorityBadge: React.FC<{
  priority: WorkOrderPriority;
  size?: 'xs' | 'sm';
}> = ({ priority, size = 'sm' }) => {
  const { label, color } = getWorkOrderPriorityInfo(priority);
  const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';

  return (
    <span className={`inline-flex items-center rounded border font-medium ${sizeClass} ${color}`}>
      {label}
    </span>
  );
};
