import React from 'react';
import {
  Wrench,
  ShieldCheck,
  Sparkles,
  Search,
  CalendarDays,
  Clock,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { WorkOrder, UserProfile } from '../../types';

export interface OperationsSectionProps {
  currentUser: UserProfile;
  dashboardWorkOrders: WorkOrder[];
  activeWorkOrders: WorkOrder[];
  urgentOrders: WorkOrder[];
  totalWorkOrdersCount: number;
  onSelectWorkOrder: (wo: WorkOrder) => void;
  onOpenCreateWorkOrder: () => void;
  onOpenCreateSafetyPermit: () => void;
  onNavigate: (tab: string) => void;
  onOpenAiReport: () => void;
}

export const OperationsSection: React.FC<OperationsSectionProps> = ({
  currentUser,
  dashboardWorkOrders,
  activeWorkOrders,
  urgentOrders,
  totalWorkOrdersCount,
  onSelectWorkOrder,
  onOpenCreateWorkOrder,
  onOpenCreateSafetyPermit,
  onNavigate,
  onOpenAiReport,
}) => {
  return (
    <div className="space-y-6">
      {/* Quick Actions：彩色 icon 瓷砖矩阵 */}
      <div className="glass-card p-4 shadow-sm relative">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-slate-900 flex items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2" />
            快捷作业通道（{currentUser.roleTitle}）
          </h3>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {/* 工单 = blue */}
          <button
            id="btn-quick-create-wo"
            onClick={onOpenCreateWorkOrder}
            className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-blue-300 cursor-pointer group"
          >
            <span className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 group-hover:scale-105 transition-transform">
              <Wrench className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-semibold text-slate-700 group-hover:text-blue-600 transition-colors">
              创建报修工单
            </span>
            <span className="text-[9px] text-slate-500 -mt-1.5">突发故障一键派单</span>
          </button>

          {/* 安全作业票 = amber (LOTO) */}
          <button
            id="btn-quick-safety"
            onClick={onOpenCreateSafetyPermit}
            className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-amber-300 cursor-pointer group"
          >
            <span className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-semibold text-slate-700 group-hover:text-amber-600 transition-colors">
              申请安全作业票
            </span>
            <span className="text-[9px] text-slate-500 -mt-1.5">动火/高处/LOTO</span>
          </button>

          {/* AI 诊断 = sky */}
          <button
            id="btn-quick-ai-diag"
            onClick={() => onNavigate('ai_assistant')}
            className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-sky-300 cursor-pointer group"
          >
            <span className="w-11 h-11 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-500 group-hover:scale-105 transition-transform">
              <Sparkles className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-semibold text-slate-700 group-hover:text-sky-600 transition-colors">
              AI故障诊断向导
            </span>
            <span className="text-[9px] text-slate-500 -mt-1.5">输入症状秒出SOP</span>
          </button>

          {/* 知识库 = purple */}
          <button
            id="btn-quick-knowledge"
            onClick={() => onNavigate('knowledge')}
            className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-purple-300 cursor-pointer group"
          >
            <span className="w-11 h-11 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-500 group-hover:scale-105 transition-transform">
              <Search className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-semibold text-slate-700 group-hover:text-purple-600 transition-colors">
              检索检修规程
            </span>
            <span className="text-[9px] text-slate-500 -mt-1.5">SOP/事故案例/图谱</span>
          </button>

          {/* AI 报告 = violet */}
          <button
            id="btn-quick-ai-report"
            onClick={onOpenAiReport}
            className="flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-violet-300 cursor-pointer group"
          >
            <span className="w-11 h-11 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center text-violet-500 group-hover:scale-105 transition-transform">
              <CalendarDays className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-semibold text-slate-700 group-hover:text-violet-600 transition-colors">
              AI 智能报告
            </span>
            <span className="text-[9px] text-slate-500 -mt-1.5">巡检/检修/月度</span>
          </button>
        </div>
      </div>

      {/* Active Work Orders Table / Queue */}
      <div className="glass-card p-4 shadow-sm relative">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center">
              <Wrench className="w-4 h-4 mr-2 text-blue-600" />
              {currentUser.role === 'technician'
                ? `待我处置的检修工单 (${dashboardWorkOrders.length})`
                : `紧急检修工单 (活动态 ${activeWorkOrders.length} 条 / 紧急 ${urgentOrders.length} 条)`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              按优先级排序: 待派单 → 待接单 → 检修处理 → 待验收
            </p>
          </div>
          <button
            onClick={() => onNavigate('work_orders')}
            className="text-xs text-blue-600 hover:text-blue-700 flex items-center font-medium cursor-pointer"
          >
            查看全部工单 ({totalWorkOrdersCount})
            <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </button>
        </div>

        <div className="max-h-[480px] overflow-y-auto pr-1 space-y-2.5">
          {dashboardWorkOrders.map((wo) => {
            const isUrgent = wo.priority === 'urgent';
            const isHigh = wo.priority === 'high';

            const statusMap: Record<string, { label: string; color: string }> = {
              created: { label: '待派单', color: 'bg-orange-50 text-orange-700 border-orange-200' },
              dispatched: { label: '待接单', color: 'bg-blue-50 text-blue-700 border-blue-200' },
              in_progress: { label: '检修中', color: 'bg-blue-50 text-blue-700 border-blue-200' },
              pending_acceptance: { label: '待验收', color: 'bg-purple-50 text-purple-700 border-purple-200' },
              completed: { label: '已归档', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
            };

            const currentStatus = statusMap[wo.status] || {
              label: wo.status,
              color: 'bg-slate-100 text-slate-600 border-slate-200',
            };

            return (
              <div
                key={wo.id}
                onClick={() => onSelectWorkOrder(wo)}
                className="p-3 bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-blue-300 rounded-lg transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 group shadow-xs"
              >
                <div className="flex items-start space-x-3">
                  <div
                    className={`p-2 rounded-md mt-0.5 ${
                      isUrgent
                        ? 'bg-rose-50 text-rose-600 border border-rose-200'
                        : isHigh
                        ? 'bg-amber-50 text-amber-600 border border-amber-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    <Wrench className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs text-slate-500">{wo.orderNo}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded border font-semibold ${
                          isUrgent
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : isHigh
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {wo.priority === 'urgent' ? '紧急' : wo.priority === 'high' ? '高' : '一般'}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border font-medium ${currentStatus.color}`}>
                        {currentStatus.label}
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-slate-900 group-hover:text-blue-600 transition-colors mt-0.5">
                      {wo.title}
                    </h4>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center space-x-3">
                      <span>设备: {wo.equipmentName}</span>
                      <span>车间: {wo.workshop}</span>
                      <span>主修: {wo.assignee || '待分配'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end space-x-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                  <span className="text-[10px] font-mono text-slate-500 flex items-center">
                    <Clock className="w-3 h-3 mr-1 text-slate-500" />
                    {wo.createdAt.split(' ')[1] || wo.createdAt}
                  </span>
                  <button className="px-2.5 py-1 text-xs bg-slate-100 group-hover:bg-blue-600 text-slate-700 group-hover:text-white rounded-md transition-colors flex items-center font-medium shadow-xs">
                    <span>详情/处理</span>
                    <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {dashboardWorkOrders.length === 0 && (
            <div className="p-8 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center">
              <CheckCircle2 className="w-8 h-8 text-slate-500 mb-2" />
              <p className="text-xs font-semibold text-slate-700">暂无进行中工单</p>
              <p className="text-[11px] text-slate-500 mt-1">
                当前没有待派单 / 待接单 / 检修中 / 待验收的活动工单，可点击上方「创建报修工单」发起。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
