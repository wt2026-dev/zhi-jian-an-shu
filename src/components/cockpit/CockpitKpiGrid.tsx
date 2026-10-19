import React from 'react';
import {
  Box,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ShieldAlert,
  ChevronRight,
} from 'lucide-react';
import { Hazard } from '../../types';
import { CockpitAbnormalType } from '../../api';

export interface CockpitKpiGridProps {
  runningEquipments: number;
  totalEquipments: number;
  onlineRate: string | null;
  healthAbnormalCount: number;
  completedOrders: number;
  totalOrders: number;
  woCompletionRate: string | null;
  orderBacklogCount: number;
  completedInspections: number;
  totalInspections: number;
  inspCompletionRate: string | null;
  inspectionAbnormalCount: number;
  pendingHazards: Hazard[];
  majorHazards: Hazard[];
  hazardsCount: number;
  hazardPendingCount: number;
  aiCallsDisplay: React.ReactNode;
  mistakeRate: string | null;
  openDrill: (type: CockpitAbnormalType) => void;
  fmtPct: (v: string | null) => string;
}

export const CockpitKpiGrid: React.FC<CockpitKpiGridProps> = ({
  runningEquipments,
  totalEquipments,
  onlineRate,
  healthAbnormalCount,
  completedOrders,
  totalOrders,
  woCompletionRate,
  orderBacklogCount,
  completedInspections,
  totalInspections,
  inspCompletionRate,
  inspectionAbnormalCount,
  pendingHazards,
  majorHazards,
  hazardsCount,
  hazardPendingCount,
  aiCallsDisplay,
  mistakeRate,
  openDrill,
  fmtPct,
}) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      {/* KPI 1: 设备总数与在线率（轻浅渐变卡 · 可下钻：设备健康异常） */}
      <button
        type="button"
        onClick={() => openDrill('health')}
        className="rounded-xl border border-blue-200 bg-gradient-to-br from-white to-blue-50/60 p-3.5 shadow-sm relative overflow-hidden group transition-all text-left cursor-pointer w-full hover:border-blue-400 hover:shadow-md"
      >
        <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
          <span>在线设备 / 总台数</span>
          <div className="icon-tile icon-tile-sm icon-tile-primary">
            <Box className="w-4 h-4 text-blue-600" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline space-x-1.5">
          <span className="text-3xl font-bold font-mono text-blue-600 leading-none tracking-tight">
            {runningEquipments}
          </span>
          <span className="text-xs text-slate-500 font-sans">/ {totalEquipments} 台</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">综合在网率</span>
          <span className="text-slate-900 font-mono font-bold">{fmtPct(onlineRate)}</span>
        </div>
        {/* 监测 → 定位 → 干预 闭环链路指示 */}
        <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
          <span className="flex items-center text-[9px] text-slate-500 font-medium tracking-tight">
            监测 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 定位 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 干预
          </span>
          <span
            className={`text-[9px] font-semibold truncate ${
              healthAbnormalCount > 0 ? 'text-amber-600' : 'text-emerald-600'
            }`}
          >
            {healthAbnormalCount > 0
              ? `异常 ${healthAbnormalCount} 台 · 点击定位干预`
              : '全部健康 · 点击查看'}
          </span>
        </div>
      </button>

      {/* KPI 2: 今日工单与完工率（可下钻：工单积压） */}
      <button
        type="button"
        onClick={() => openDrill('order')}
        className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-400 hover:shadow-md transition-all text-left cursor-pointer w-full"
      >
        <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
          <span>累计工单 / 完工</span>
          <div className="icon-tile icon-tile-sm icon-tile-warning">
            <Wrench className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline space-x-1.5">
          <span className="data-number text-2xl tracking-tight">{completedOrders}</span>
          <span className="text-xs text-slate-500 font-sans">/ {totalOrders} 笔</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">工单完结率</span>
          <span className="text-blue-600 font-mono font-bold">{fmtPct(woCompletionRate)}</span>
        </div>
        {/* 监测 → 定位 → 干预 闭环链路指示 */}
        <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
          <span className="flex items-center text-[9px] text-slate-500 font-medium tracking-tight">
            监测 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 定位 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 干预
          </span>
          <span
            className={`text-[9px] font-semibold truncate ${
              orderBacklogCount > 0 ? 'text-amber-600' : 'text-emerald-600'
            }`}
          >
            {orderBacklogCount > 0
              ? `积压 ${orderBacklogCount} 单 · 点击定位干预`
              : '无积压 · 点击查看'}
          </span>
        </div>
      </button>

      {/* KPI 3: 巡检完成率（可下钻：巡检异常） */}
      <button
        type="button"
        onClick={() => openDrill('inspection')}
        className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-400 hover:shadow-md transition-all text-left cursor-pointer w-full"
      >
        <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
          <span>点检任务完成率</span>
          <div className="icon-tile icon-tile-sm icon-tile-success">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline space-x-1.5">
          <span className="data-number text-2xl text-emerald-700 tracking-tight">
            {fmtPct(inspCompletionRate)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">已点检</span>
          <span className="text-slate-700 font-mono">
            {completedInspections} / {totalInspections} 点位
          </span>
        </div>
        {/* 监测 → 定位 → 干预 闭环链路指示 */}
        <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
          <span className="flex items-center text-[9px] text-slate-500 font-medium tracking-tight">
            监测 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 定位 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 干预
          </span>
          <span
            className={`text-[9px] font-semibold truncate ${
              inspectionAbnormalCount > 0 ? 'text-rose-600' : 'text-emerald-600'
            }`}
          >
            {inspectionAbnormalCount > 0
              ? `异常 ${inspectionAbnormalCount} 项 · 点击定位干预`
              : '无异常 · 点击查看'}
          </span>
        </div>
      </button>

      {/* KPI 4: 待处理隐患（可下钻：隐患待处理） */}
      <button
        type="button"
        onClick={() => openDrill('hazard')}
        className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-400 hover:shadow-md transition-all text-left cursor-pointer w-full"
      >
        <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
          <span>在控隐患闭环</span>
          <div className="icon-tile icon-tile-sm icon-tile-danger">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline space-x-2">
          <span className="data-number text-2xl text-amber-700 tracking-tight">
            {pendingHazards.length}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold border border-rose-200">
            重大 {majorHazards.length}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">整改闭环率</span>
          <span className="text-emerald-600 font-mono font-bold">
            {hazardsCount > 0
              ? (((hazardsCount - pendingHazards.length) / hazardsCount) * 100).toFixed(0)
              : '85'}
            %
          </span>
        </div>
        {/* 监测 → 定位 → 干预 闭环链路指示 */}
        <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
          <span className="flex items-center text-[9px] text-slate-500 font-medium tracking-tight">
            监测 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 定位 <ChevronRight className="w-2.5 h-2.5 mx-px" /> 干预
          </span>
          <span
            className={`text-[9px] font-semibold truncate ${
              hazardPendingCount > 0 ? 'text-rose-600' : 'text-emerald-600'
            }`}
          >
            {hazardPendingCount > 0
              ? `待处理 ${hazardPendingCount} 项 · 点击定位干预`
              : '全部闭环 · 点击查看'}
          </span>
        </div>
      </button>

      {/* KPI 5: AI 智能调用次数 */}
      <div className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
          <span>AI 推理中枢调用</span>
          <div className="icon-tile icon-tile-sm icon-tile-cyan">
            <Sparkles className="w-4 h-4 text-cyan-600" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline space-x-1">
          <span className="data-number text-2xl text-blue-700 tracking-tight">{aiCallsDisplay}</span>
          <span className="text-xs text-slate-500 font-sans">次</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">多模态命中</span>
          <span className="text-blue-600 font-mono font-bold">96.8%</span>
        </div>
      </div>

      {/* KPI 6: 检修合规失误率 */}
      <div className="glass-card data-card p-3.5 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-all">
        <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
          <span>SOP 作业失误率</span>
          <div className="icon-tile icon-tile-sm icon-tile-danger">
            <ShieldAlert className="w-4 h-4 text-rose-500" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline space-x-1">
          <span className="data-number text-2xl text-rose-700 tracking-tight">
            {fmtPct(mistakeRate)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">安全准入受控</span>
          <span className="text-emerald-600 font-mono font-bold">100% 达标</span>
        </div>
      </div>
    </div>
  );
};
