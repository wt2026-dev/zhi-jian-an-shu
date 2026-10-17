import React from 'react';
import {
  Wrench,
  Clock,
  Boxes,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { WorkOrder } from '../../types';
import {
  WorkOrderStatusBadge,
  WorkOrderPriorityBadge,
} from './WorkOrderStatusBadge';
import { hasExplodedView } from '../equipment3d/explodedViewFiles';

export interface WorkOrderListItemProps {
  order: WorkOrder;
  onSelect: () => void;
  onNavigateTo3D?: (workOrderId: string) => void;
  openInExploded: (order: WorkOrder) => void;
}

export const WorkOrderListItem: React.FC<WorkOrderListItemProps> = ({
  order: wo,
  onSelect,
  onNavigateTo3D,
  openInExploded,
}) => {
  const isUrgent = wo.priority === 'urgent';
  const isHigh = wo.priority === 'high';
  const isMedium = wo.priority === 'medium';

  const priorityBorder = isUrgent
    ? 'border-l-4 border-l-rose-500'
    : isHigh
    ? 'border-l-4 border-l-amber-500'
    : isMedium
    ? 'border-l-4 border-l-blue-500'
    : 'border-l-4 border-l-slate-400';

  return (
    <div
      key={wo.id}
      onClick={onSelect}
      className={`p-4 bg-white hover:bg-slate-50/90 border border-slate-200/80 rounded-xl shadow-xs transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3 ${priorityBorder} hover:shadow-md hover:border-slate-300`}
    >
      <div className="flex items-start space-x-3.5 flex-1 min-w-0">
        <div
          className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
            isUrgent
              ? 'bg-rose-50 text-rose-600 border border-rose-200'
              : 'bg-blue-50 text-blue-600 border border-blue-200'
          }`}
        >
          <Wrench className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="font-mono text-xs font-bold text-blue-600">{wo.orderNo}</span>
            <WorkOrderPriorityBadge priority={wo.priority} size="xs" />
            <WorkOrderStatusBadge status={wo.status} size="xs" />
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
              {wo.faultType}
            </span>
            {isUrgent && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-300 font-semibold animate-pulse flex items-center gap-1">
                <Clock className="w-3 h-3 text-rose-600" />
                SLA抢修响应倒计时: 18m
              </span>
            )}
          </div>

          <h3 className="text-sm font-bold text-slate-800 group-hover:text-blue-600 transition-colors truncate">
            {wo.title}
          </h3>
          <p className="text-xs text-slate-500 line-clamp-1 mt-1">{wo.description}</p>

          <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-[11px] text-slate-500 mt-2">
            <span>设备: <strong className="text-slate-700">{wo.equipmentName} ({wo.equipmentCode})</strong></span>
            <span>车间: {wo.workshop}</span>
            <span>报修人: {wo.creator}</span>
            <span>主修技师: <strong className="text-blue-700 font-semibold">{wo.assignee || '待派发/未分配'}</strong></span>
            <span>计划工时: <strong className="text-slate-700 font-mono font-medium">3.5h</strong></span>
          </div>
        </div>
      </div>

      {/* Right Action & Timeline Status */}
      <div className="flex items-center justify-between md:justify-end space-x-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
        <div className="text-right hidden sm:block">
          <span className="text-[10px] text-slate-500 block">创建时间</span>
          <span className="font-mono text-xs text-slate-600">{wo.createdAt}</span>
        </div>

        {/* 3D 查看 */}
        <button
          type="button"
          data-testid={`workorder-3d-view-${wo.id}`}
          onClick={(e) => {
            e.stopPropagation();
            if (onNavigateTo3D) {
              onNavigateTo3D(wo.id);
            } else {
              const url = new URL(window.location.href);
              url.searchParams.set('view', 'equipment_3d');
              url.searchParams.set('workOrderId', wo.id);
              window.location.href = url.toString();
            }
          }}
          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-cyan-300 hover:text-cyan-200 border border-cyan-500/30 hover:border-cyan-500/60 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 cursor-pointer shadow-xs"
          title="跳转 3D 场景并自动聚焦设备"
        >
          <Boxes className="w-3.5 h-3.5 text-cyan-400" />
          <span>3D 查看</span>
        </button>

        {hasExplodedView(wo.equipmentId) && (
          <button
            type="button"
            data-testid={`workorder-exploded-view-${wo.id}`}
            onClick={(e) => {
              e.stopPropagation();
              openInExploded(wo);
            }}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-cyan-300 hover:text-cyan-200 border border-cyan-500/30 hover:border-cyan-500/60 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 cursor-pointer shadow-xs"
            title="打开该设备的拆解视图，自动定位维修目标零件"
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>拆解视图</span>
          </button>
        )}

        <button className="px-3.5 py-1.5 bg-blue-50 group-hover:bg-blue-600 text-blue-700 group-hover:text-white border border-blue-200 group-hover:border-blue-600 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1 cursor-pointer">
          <span>处理/详情</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
