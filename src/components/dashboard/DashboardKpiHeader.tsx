import React from 'react';
import {
  Activity,
  Wrench,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  Sparkles,
  ArrowUpRight,
  Box,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { SparePart, Hazard } from '../../types';
import { KpiCard } from './KpiCard';

export interface DashboardKpiHeaderProps {
  totalEquipments: number;
  runningEquipments: number;
  warningEquipments: number;
  faultEquipments: number;
  pendingWorkOrdersCount: number;
  urgentOrdersCount: number;
  inProgressOrdersCount: number;
  pendingAcceptanceOrdersCount: number;
  completedInspectionPoints: number;
  totalInspectionPoints: number;
  inspectionAbnormalCount: number;
  activeSafetyPermitsCount: number;
  pendingSafetyApprovalsCount: number;
  lotoPermitCount: number;
  hotWorkPermitCount: number;
  heightWorkPermitCount: number;
  sparePartsLoadFailed: boolean;
  lowStockParts: SparePart[];
  hazardsLoadFailed: boolean;
  pendingHazardsList: Hazard[];
  onNavigate: (tab: string) => void;
}

export const DashboardKpiHeader: React.FC<DashboardKpiHeaderProps> = ({
  totalEquipments,
  runningEquipments,
  warningEquipments,
  faultEquipments,
  pendingWorkOrdersCount,
  urgentOrdersCount,
  inProgressOrdersCount,
  pendingAcceptanceOrdersCount,
  completedInspectionPoints,
  totalInspectionPoints,
  inspectionAbnormalCount,
  activeSafetyPermitsCount,
  pendingSafetyApprovalsCount,
  lotoPermitCount,
  hotWorkPermitCount,
  heightWorkPermitCount,
  sparePartsLoadFailed,
  lowStockParts,
  hazardsLoadFailed,
  pendingHazardsList,
  onNavigate,
}) => {
  return (
    <>
      {/* L2 KPI 核心态势网格：5 列对称工业玻璃态卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* KPI 1: 设备总数与台账 */}
        <KpiCard
          title="设备总数"
          value={totalEquipments}
          icon={<Activity className="w-4 h-4" />}
          iconColor="bg-blue-50 text-blue-600"
          accentColor="hover:border-blue-400"
          badge={
            <span className="text-[11px] text-emerald-600 flex items-center font-medium">
              <TrendingUp className="w-3 h-3 mr-0.5" /> 100% 台账
            </span>
          }
          footer={
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
              <span className="text-emerald-600">运行 {runningEquipments}</span>
              <span className="text-amber-600">预警 {warningEquipments}</span>
              <span className="text-rose-600">故障 {faultEquipments}</span>
            </div>
          }
          onClick={() => onNavigate('equipment')}
        />

        {/* KPI 2: 待办检修工单 */}
        <KpiCard
          title="待办检修工单"
          value={pendingWorkOrdersCount}
          icon={<Wrench className="w-4 h-4" />}
          iconColor="bg-amber-50 text-amber-600"
          accentColor="hover:border-amber-400"
          badge={
            urgentOrdersCount > 0 ? (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold animate-pulse">
                紧急 {urgentOrdersCount}
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">无紧急</span>
            )
          }
          footer={
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>检修中: {inProgressOrdersCount}</span>
              <span>待验收: {pendingAcceptanceOrdersCount}</span>
            </div>
          }
          onClick={() => onNavigate('work_orders')}
        />

        {/* KPI 3: 今日巡检进度 */}
        <KpiCard
          title="今日巡检进度"
          value={completedInspectionPoints}
          unit={`/${totalInspectionPoints}点`}
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconColor="bg-cyan-50 text-cyan-600"
          accentColor="hover:border-cyan-400"
          badge={
            <span
              className={`text-[11px] font-medium ${
                inspectionAbnormalCount > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              异常: {inspectionAbnormalCount}
            </span>
          }
          footer={
            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round(
                    (completedInspectionPoints / (totalInspectionPoints || 1)) * 100
                  )}%`,
                }}
              />
            </div>
          }
          onClick={() => onNavigate('inspections')}
        />

        {/* KPI 4: 在控安全作业票 */}
        <KpiCard
          title="在控安全作业票"
          value={activeSafetyPermitsCount}
          icon={<ShieldCheck className="w-4 h-4" />}
          iconColor="bg-purple-50 text-purple-600"
          accentColor="hover:border-purple-400"
          badge={
            pendingSafetyApprovalsCount > 0 ? (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                {pendingSafetyApprovalsCount} 待审批
              </span>
            ) : (
              <span className="text-[11px] text-emerald-600 font-medium">受控闭环</span>
            )
          }
          footer={
            <div className="text-[10px] text-slate-500 flex justify-between">
              <span>LOTO: {lotoPermitCount}</span>
              <span>动火: {hotWorkPermitCount}</span>
              <span>高处: {heightWorkPermitCount}</span>
            </div>
          }
          onClick={() => onNavigate('safety')}
        />

        {/* KPI 5: AI 检修大脑 */}
        <div
          onClick={() => onNavigate('ai_pipeline')}
          className="glass-card data-card p-4 relative overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-md transition-all group shadow-sm bg-gradient-to-br from-blue-50/50 via-white to-indigo-50/30"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900 flex items-center">
              <Sparkles className="w-3.5 h-3.5 mr-1 text-blue-600" /> AI 协同编排
            </span>
            <ArrowUpRight className="w-4 h-4 text-blue-600 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </div>
          <div className="mt-2">
            <div className="text-xs font-semibold text-slate-800">4 步机理并发诊断</div>
            <p className="text-[10px] text-slate-500 mt-0.5">串行方案 · 风险与派单并行协同</p>
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
            <span className="text-slate-500">通义千问</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono font-semibold">
              DAG Pipeline
            </span>
          </div>
        </div>
      </div>

      {/* 紧凑型监控警报胶囊条：备件库存告急 + 现场隐患闭环 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* 低库存告警卡片（紧凑横幅） */}
        <div
          onClick={() => onNavigate('spare_parts')}
          className={`p-3 rounded-xl border transition-all cursor-pointer group shadow-sm flex items-center justify-between ${
            lowStockParts.length > 0
              ? 'bg-rose-50/60 border-rose-200 hover:border-rose-300'
              : 'bg-white border-slate-200 hover:border-blue-300'
          }`}
        >
          <div className="flex items-center space-x-3 min-w-0">
            <div
              className={`p-2 rounded-lg shrink-0 ${
                lowStockParts.length > 0 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'
              }`}
            >
              <Box className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-800">工业备件安全库存</span>
                {sparePartsLoadFailed ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                    未知
                  </span>
                ) : lowStockParts.length > 0 ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 font-semibold">
                    {lowStockParts.length} 项告急
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                    充足
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                {sparePartsLoadFailed
                  ? '备件数据加载失败，无法判断库存是否充足'
                  : lowStockParts.length > 0
                  ? `包括 ${lowStockParts.slice(0, 2).map((p) => p.name).join('、')} 等低于安全阈值`
                  : '全部备件均在安全阈值之上'}
              </p>
            </div>
          </div>
          <span className="text-xs text-blue-600 font-medium group-hover:translate-x-1 transition-transform flex items-center shrink-0 ml-2">
            备件库 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </span>
        </div>

        {/* 现场隐患闭环卡片（紧凑横幅） */}
        <div
          onClick={() => onNavigate('hazards')}
          className={`p-3 rounded-xl border transition-all cursor-pointer group shadow-sm flex items-center justify-between ${
            pendingHazardsList.length > 0
              ? 'bg-amber-50/60 border-amber-200 hover:border-amber-300'
              : 'bg-white border-slate-200 hover:border-blue-300'
          }`}
        >
          <div className="flex items-center space-x-3 min-w-0">
            <div
              className={`p-2 rounded-lg shrink-0 ${
                pendingHazardsList.length > 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-800">安全隐患治理闭环</span>
                {pendingHazardsList.filter((h) => h.level === 'major').length > 0 && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 font-semibold">
                    {pendingHazardsList.filter((h) => h.level === 'major').length} 重大
                  </span>
                )}
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-semibold">
                  {hazardsLoadFailed ? '—' : `${pendingHazardsList.length} 在控`}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                {hazardsLoadFailed
                  ? '隐患数据加载失败，无法判断是否存在未消缺隐患'
                  : pendingHazardsList.length > 0
                  ? `最新: ${pendingHazardsList[0]?.title.slice(0, 24)}...`
                  : '当前无未闭环隐患'}
              </p>
            </div>
          </div>
          <span className="text-xs text-blue-600 font-medium group-hover:translate-x-1 transition-transform flex items-center shrink-0 ml-2">
            治理台 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </span>
        </div>
      </div>
    </>
  );
};
