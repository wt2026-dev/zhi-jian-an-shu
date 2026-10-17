import React from 'react';
import {
  Clock,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { WorkOrder } from '../../types';

export interface WorkOrderKpiHeaderProps {
  scopedOrders: WorkOrder[];
  activeStatusTab: string;
  onSelectStatusTab: (status: string) => void;
}

export const WorkOrderKpiHeader: React.FC<WorkOrderKpiHeaderProps> = ({
  scopedOrders,
  activeStatusTab,
  onSelectStatusTab,
}) => {
  const createdCount = (scopedOrders || []).filter((w) => w.status === 'created').length;
  const inProgressCount = (scopedOrders || []).filter((w) => w.status === 'in_progress').length;
  const pendingAcceptanceCount = (scopedOrders || []).filter((w) => w.status === 'pending_acceptance').length;
  const urgentSlaCount = (scopedOrders || []).filter((w) => w.priority === 'urgent' && w.status !== 'completed').length;

  return (
    <>
      {/* 检修特色：顶部数据条 (Maintenance Pipeline Telemetry) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 border border-orange-200 flex items-center justify-center font-bold text-xs">
              待
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">待办派单</span>
              <span className="text-base font-bold text-slate-900 font-mono">
                {createdCount} <span className="text-xs text-slate-500 font-normal">单</span>
              </span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-medium">
            调度中
          </span>
        </div>

        <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center font-bold text-xs">
              修
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">现场检修中</span>
              <span className="text-base font-bold text-blue-700 font-mono">
                {inProgressCount} <span className="text-xs text-slate-500 font-normal">单</span>
              </span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium">
            处置中
          </span>
        </div>

        <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center font-bold text-xs">
              验
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">质检验收</span>
              <span className="text-base font-bold text-purple-700 font-mono">
                {pendingAcceptanceCount} <span className="text-xs text-slate-500 font-normal">单</span>
              </span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-medium">
            待复核
          </span>
        </div>

        <div className="p-3 bg-white border border-rose-200 rounded-xl shadow-xs flex items-center justify-between relative overflow-hidden">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center font-bold text-xs animate-pulse">
              急
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">紧急 SLA 抢修</span>
              <span className="text-base font-bold text-rose-600 font-mono">
                {urgentSlaCount} <span className="text-xs text-slate-500 font-normal">单</span>
              </span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 font-bold flex items-center gap-1 animate-pulse">
            <Clock className="w-3 h-3" /> SLA警戒
          </span>
        </div>
      </div>

      {/* 检修特色：工单状态流转管线 */}
      <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            工单全生命周期流转管线状态
          </span>
          <button
            type="button"
            onClick={() => onSelectStatusTab('all')}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
              activeStatusTab === 'all'
                ? 'bg-blue-600 text-white font-semibold border-blue-600 shadow-xs'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            全部工单 ({scopedOrders.length})
          </button>
        </div>

        <div className="flex items-center justify-between overflow-x-auto gap-2 py-1 scrollbar-none">
          {[
            { id: 'created', label: '1. 待派单', count: scopedOrders.filter((w) => w.status === 'created').length, color: 'text-orange-600', badge: 'bg-orange-50 border-orange-200' },
            { id: 'dispatched', label: '2. 待接单', count: scopedOrders.filter((w) => w.status === 'dispatched').length, color: 'text-blue-600', badge: 'bg-blue-50 border-blue-200' },
            { id: 'in_progress', label: '3. 检修中', count: scopedOrders.filter((w) => w.status === 'in_progress').length, color: 'text-indigo-600', badge: 'bg-indigo-50 border-indigo-200' },
            { id: 'pending_acceptance', label: '4. 待验收', count: scopedOrders.filter((w) => w.status === 'pending_acceptance').length, color: 'text-purple-600', badge: 'bg-purple-50 border-purple-200' },
            { id: 'completed', label: '5. 已闭环', count: scopedOrders.filter((w) => w.status === 'completed').length, color: 'text-emerald-600', badge: 'bg-emerald-50 border-emerald-200' },
          ].map((node, index, arr) => {
            const isSelected = activeStatusTab === node.id;
            return (
              <React.Fragment key={node.id}>
                <button
                  type="button"
                  onClick={() => onSelectStatusTab(node.id)}
                  className={`flex-1 min-w-[140px] p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-blue-50/80 border-blue-500 shadow-xs ring-2 ring-blue-500/20'
                      : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200/80'
                  }`}
                >
                  <div>
                    <span className={`text-xs font-bold block ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                      {node.label}
                    </span>
                    <span className="text-[10px] text-slate-500">管线处理节点</span>
                  </div>
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${node.badge} ${node.color}`}>
                    {node.count}
                  </span>
                </button>
                {index < arr.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-slate-300 shrink-0 hidden sm:block" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </>
  );
};
