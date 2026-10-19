import React from 'react';
import {
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { UserProfile, WorkOrder } from '../../types';

export interface DashboardHeroProps {
  currentUser: UserProfile;
  /**
   * 全厂平均健康分。null = 没有任何设备做过健康评估 —— 这时显示「—」，
   * 不能显示 0，也不能显示 100（那会被读成"全厂满分"）。
   */
  avgHealthScore: number | null;
  pendingWorkOrdersCount: number;
  urgentOrdersCount: number;
  urgentOrder?: WorkOrder;
  onSelectWorkOrder: (wo: WorkOrder) => void;
}

export const DashboardHero: React.FC<DashboardHeroProps> = ({
  currentUser,
  avgHealthScore,
  pendingWorkOrdersCount,
  urgentOrdersCount,
  urgentOrder,
  onSelectWorkOrder,
}) => {
  return (
    <>
      {/* L1 Hero：极浅渐变页头 + 主 KPI 大数字（设备综合健康度） */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-white to-blue-50 border border-blue-100 px-6 py-6 shadow-sm">
        <div
          className="absolute inset-0 opacity-5 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 85% 25%, #3b82f6 0, transparent 45%)' }}
        />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div>
            <p className="text-slate-500 text-xs font-medium tracking-wide">
              {new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好'}，{currentUser.name} ·{' '}
              {currentUser.roleTitle || currentUser.role}
            </p>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-1 tracking-tight">检修工作台</h1>
            <p className="text-slate-500 text-xs mt-1">全厂设备状态、检修执行与安全合规一屏总览</p>
          </div>
          <div className="flex items-center gap-6 md:gap-8 shrink-0">
            <div>
              <div className="text-4xl font-bold font-mono leading-none text-blue-600">
                {avgHealthScore ?? '—'}
                {avgHealthScore != null && <span className="text-base font-normal text-slate-500 ml-1">/100</span>}
              </div>
              <div className="text-[11px] text-slate-500 mt-1.5">
                {avgHealthScore == null
                  ? '设备综合健康度 · 暂无评估数据'
                  : `设备综合健康度 · ${avgHealthScore >= 85 ? '优良状态' : '需重点关注'}`}
              </div>
            </div>
            <div className="h-12 w-px bg-slate-200 hidden sm:block" />
            <div className="hidden sm:block">
              <div className="text-2xl font-bold font-mono leading-none text-slate-900">{pendingWorkOrdersCount}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">待办检修工单</div>
            </div>
            <div className="hidden md:block">
              <div className="text-2xl font-bold font-mono leading-none text-rose-600">{urgentOrdersCount}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">紧急告警</div>
            </div>
          </div>
        </div>
      </div>

      {/* 紧急告警横幅（白底 + 玫红左边条） */}
      {urgentOrder && (
        <div className="bg-white border border-slate-200 border-l-4 border-l-rose-500 rounded-lg px-4 py-2.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-rose-100 text-rose-600 rounded-md">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-600 text-white uppercase">
                  紧急告警 (SLA 响应中)
                </span>
                <span className="text-sm font-semibold text-rose-900">
                  {urgentOrder.title}
                </span>
              </div>
              <p className="text-xs text-rose-700 mt-0.5">
                设备: {urgentOrder.equipmentName} ({urgentOrder.equipmentCode}) | 车间: {urgentOrder.workshop}
              </p>
            </div>
          </div>
          <button
            onClick={() => onSelectWorkOrder(urgentOrder)}
            className="px-3.5 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors flex items-center space-x-1 cursor-pointer shrink-0 shadow-xs"
          >
            <span>立即处置抢修</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};
