import React from 'react';
import {
  Target,
  X,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Zap,
  FilePlus2,
} from 'lucide-react';
import { CockpitAbnormalItem, CockpitAbnormalType } from '../../api';

export interface CockpitDrillDrawerProps {
  drillType: CockpitAbnormalType | null;
  closeDrill: () => void;
  drillLoading: boolean;
  drillError: string | null;
  drillItems: CockpitAbnormalItem[];
  creatingKeys: Set<string>;
  createdKeys: Set<string>;
  handleOneClickRepair: (item: CockpitAbnormalItem) => Promise<void>;
  drillMeta: Record<CockpitAbnormalType, { title: string; hint: (n: number) => string; desc: string }>;
}

export const CockpitDrillDrawer: React.FC<CockpitDrillDrawerProps> = ({
  drillType,
  closeDrill,
  drillLoading,
  drillError,
  drillItems,
  creatingKeys,
  createdKeys,
  handleOneClickRepair,
  drillMeta,
}) => {
  if (!drillType) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-slate-900/40 backdrop-blur-sm"
      onClick={closeDrill}
    >
      <aside
        className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 抽屉头：闭环链路 + 关闭 */}
        <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-white">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center">
              <Target className="w-4 h-4 mr-1.5 text-blue-600" />
              {drillMeta[drillType].title}
            </h3>
            <button
              onClick={closeDrill}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
              aria-label="关闭异常定位抽屉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="flex items-center text-[10px] text-slate-500 font-medium">
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">监测</span>
              <ChevronRight className="w-3 h-3 mx-0.5 text-slate-300" />
              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                定位（当前）
              </span>
              <ChevronRight className="w-3 h-3 mx-0.5 text-slate-300" />
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">干预</span>
            </span>
            <span className="text-[10px] text-slate-500">{drillMeta[drillType].desc}</span>
          </div>
        </div>

        {/* 明细列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {drillLoading && (
            <div className="py-10 flex flex-col items-center text-slate-500 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
              正在定位异常设备…
            </div>
          )}

          {!drillLoading && drillError && (
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {drillError}
            </div>
          )}

          {!drillLoading && !drillError && drillItems.length === 0 && (
            <div className="py-12 text-center">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
              <p className="text-xs text-emerald-600 font-medium">
                当前无该类异常，运行状态良好
              </p>
            </div>
          )}

          {!drillLoading &&
            drillItems.map((item) => {
              const rowKey = `${drillType}:${item.refId}`;
              const isCreating = creatingKeys.has(rowKey);
              const isCreated = createdKeys.has(rowKey);
              return (
                <div
                  key={rowKey}
                  className={`p-3 rounded-xl border text-xs transition-colors ${
                    item.severity === 'high'
                      ? 'bg-rose-50/60 border-rose-200'
                      : 'bg-amber-50/50 border-amber-200'
                  }`}
                >
                  {/* 行头：设备 + 严重度 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">{item.equipmentName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {item.equipmentCode}
                        {item.workshop ? ` · ${item.workshop}` : ''}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                        item.severity === 'high'
                          ? 'bg-rose-100 text-rose-700 border-rose-200'
                          : 'bg-amber-100 text-amber-700 border-amber-200'
                      }`}
                    >
                      {item.severity === 'high' ? '高优先' : '中优先'}
                    </span>
                  </div>

                  {/* 异常说明 */}
                  <p className="mt-1.5 text-slate-700 leading-relaxed">{item.detail}</p>

                  {/* 关键字段网格：异常类型 / 指标值 / 最近巡检 / 健康分 */}
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
                    <div className="p-1.5 rounded-lg bg-white/80 border border-slate-100">
                      <span className="text-slate-500 block">异常类型</span>
                      <span className="font-semibold text-slate-800">{item.abnormalType}</span>
                    </div>
                    <div className="p-1.5 rounded-lg bg-white/80 border border-slate-100">
                      <span className="text-slate-500 block">{item.metricLabel}</span>
                      <span className="font-mono font-bold text-blue-600">
                        {String(item.metricValue)}
                      </span>
                    </div>
                    <div className="p-1.5 rounded-lg bg-white/80 border border-slate-100">
                      <span className="text-slate-500 block">最近巡检</span>
                      <span className="font-mono text-slate-700">
                        {item.lastInspectionAt || '无记录'}
                      </span>
                    </div>
                    <div className="p-1.5 rounded-lg bg-white/80 border border-slate-100">
                      <span className="text-slate-500 block">健康分</span>
                      <span
                        className={`font-mono font-bold ${
                          item.healthScore == null
                            ? 'text-slate-500'
                            : item.healthScore < 70
                            ? 'text-rose-600'
                            : 'text-emerald-600'
                        }`}
                      >
                        {item.healthScore == null ? '—' : item.healthScore}
                      </span>
                    </div>
                  </div>

                  {/* 一键干预 */}
                  <button
                    type="button"
                    onClick={() => handleOneClickRepair(item)}
                    disabled={isCreating || isCreated || !item.equipmentId}
                    className={`mt-2.5 w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                      isCreated
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                        : !item.equipmentId
                        ? 'bg-slate-50 text-slate-500 border border-slate-200 cursor-not-allowed'
                        : 'btn-gradient text-white cursor-pointer hover:shadow-md disabled:opacity-60'
                    }`}
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>AI 草稿生成中…</span>
                      </>
                    ) : isCreated ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>工单已生成 ✓</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>一键生成检修工单</span>
                      </>
                    )}
                  </button>
                  {!item.equipmentId && (
                    <p className="mt-1 text-[9px] text-slate-500 flex items-center">
                      <FilePlus2 className="w-3 h-3 mr-1" />
                      该异常未关联设备，请到工单页手动创建
                    </p>
                  )}
                </div>
              );
            })}
        </div>

        {/* 抽屉底：干预说明 */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 flex items-center">
          <Zap className="w-3 h-3 mr-1 text-blue-500" />
          一键干预将复用 AI 工单草稿能力自动填充标题/描述/优先级，并创建真实检修工单
        </div>
      </aside>
    </div>
  );
};
