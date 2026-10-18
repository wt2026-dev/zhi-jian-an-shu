import React from 'react';
import {
  ClipboardCheck,
  Sparkles,
  X,
  ChevronRight,
  Wrench,
  AlertTriangle,
} from 'lucide-react';
import { InspectionTask, InspectionItem } from '../../types';

interface InspectionPointsWorkbenchProps {
  activeTask: InspectionTask | null | undefined;
  itemsList: InspectionItem[];
  hazardNotice: string | null;
  onCloseHazardNotice: () => void;
  onInspectionReport: () => void;
  onSelectPoint: (pt: InspectionItem) => void;
  onConvertAbnormalToWorkOrder: (pt: InspectionItem, equipmentName: string) => void;
  onConvertAbnormalToHazard: (pt: InspectionItem) => void;
  onAiGenerateWorkOrder: (pt: InspectionItem) => void;
}

export const InspectionPointsWorkbench: React.FC<InspectionPointsWorkbenchProps> = ({
  activeTask,
  itemsList,
  hazardNotice,
  onCloseHazardNotice,
  onInspectionReport,
  onSelectPoint,
  onConvertAbnormalToWorkOrder,
  onConvertAbnormalToHazard,
  onAiGenerateWorkOrder,
}) => {
  return (
    <div className="lg:col-span-7">
      {activeTask ? (
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center">
                <span className="w-2 h-2 rounded-full bg-blue-600 mr-2 animate-pulse" />
                {activeTask.title} - 点巡检测点明细清单
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                责任巡检员: {activeTask.inspectorName || (activeTask as any).inspector || '现场巡检员'} | 计划执行时段: {activeTask.scheduledDate}
              </p>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                测点总数: {activeTask.totalPoints}
              </span>
              <button
                onClick={onInspectionReport}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center space-x-1 cursor-pointer shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI 巡检报告</span>
              </button>
            </div>
          </div>

          {hazardNotice && (
            <div className="p-2.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 text-xs flex items-center justify-between">
              <span>{hazardNotice}</span>
              <button onClick={onCloseHazardNotice} className="text-slate-500 hover:text-slate-700">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Points List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[660px] overflow-y-auto pr-1">
            {itemsList.map((pt, idx) => {
              const isAbnormal = pt.isPass === false || pt.status === 'abnormal';
              const isNormal = pt.isPass === true || pt.status === 'normal';
              const checkTitle = pt.checkPoint || pt.checkItem || '重点部件监测';
              const maxLimitVal = pt.maxLimit ?? pt.maxVal;

              return (
                <div
                  key={pt.id || idx}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                    isAbnormal
                      ? 'bg-rose-50/70 border-rose-300 ring-1 ring-rose-200 shadow-xs'
                      : isNormal
                      ? 'bg-emerald-50/40 border-emerald-200'
                      : 'bg-white border-slate-200 hover:border-blue-300 shadow-xs'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-mono font-bold flex items-center justify-center border border-slate-200">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-bold text-slate-800">{pt.equipmentName}</span>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                          isAbnormal
                            ? 'bg-rose-100 text-rose-700 border-rose-200 font-bold'
                            : isNormal
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {isAbnormal ? '🔴 测点超标异常' : isNormal ? '🟢 合格已打卡' : '待点检'}
                      </span>
                    </div>

                    <div className="text-xs text-slate-800 font-medium">{checkTitle}</div>
                    <div className="text-[11px] text-slate-500 mt-1 flex items-center space-x-2">
                      <span>标准要求: <strong className="text-slate-700">{pt.standard}</strong></span>
                      {maxLimitVal !== undefined && (
                        <span>限值: <strong className="text-orange-700 font-mono">&le; {maxLimitVal}{pt.unit || ''}</strong></span>
                      )}
                    </div>

                    {/* Recorded value if checked */}
                    {pt.recordedValue !== undefined && pt.recordedValue !== '' && (
                      <div className="mt-2 p-2 rounded bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                        <span className="text-slate-500">实测读数:</span>
                        <span
                          className={`font-mono font-bold ${
                            isAbnormal ? 'text-rose-600 text-sm' : 'text-emerald-700'
                          }`}
                        >
                          {pt.recordedValue} {pt.unit || ''}
                        </span>
                      </div>
                    )}
                    {pt.notes && (
                      <p className="text-[11px] text-rose-600 mt-1">备注: {pt.notes}</p>
                    )}
                  </div>

                  {/* Actions for this Point */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <button
                      onClick={() => onSelectPoint(pt)}
                      className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg transition-colors flex items-center space-x-1 cursor-pointer font-medium shadow-xs"
                    >
                      <span>{(pt.recordedValue !== undefined && pt.recordedValue !== '') ? '修改读数' : '现场打卡抄表'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    {isAbnormal && (
                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => onConvertAbnormalToWorkOrder(pt, pt.equipmentName)}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-medium flex items-center space-x-1 shadow-xs cursor-pointer text-[11px]"
                        >
                          <Wrench className="w-3 h-3" />
                          <span>转工单</span>
                        </button>
                        <button
                          onClick={() => onConvertAbnormalToHazard(pt)}
                          className="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded-md font-medium flex items-center space-x-1 shadow-xs cursor-pointer text-[11px]"
                          title="上报至安全隐患闭环清单"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          <span>转隐患</span>
                        </button>
                        <button
                          onClick={() => onAiGenerateWorkOrder(pt)}
                          className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium flex items-center space-x-1 shadow-xs cursor-pointer text-[11px]"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>AI</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500 shadow-xs">
          <ClipboardCheck className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-slate-800">请选择左侧巡检任务</h4>
          <p className="text-xs text-slate-500 mt-1">选择任务后将在此展开现场测点清单与数据采集工作台</p>
        </div>
      )}
    </div>
  );
};
