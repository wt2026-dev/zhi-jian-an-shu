import React from 'react';
import {
  Sparkles,
  TrendingUp,
  Activity,
  AlertTriangle,
  Boxes,
  Wrench,
} from 'lucide-react';
import { Equipment } from '../../types';

interface HealthScoreCardProps {
  currentEquipment: Equipment;
  isVibAlert: boolean;
  isTempAlert: boolean;
  aiAnalyzing: boolean;
  alarmEquipmentsCount: number;
  onRunAiAnalysis: () => void;
  onHealthForecast: () => void;
  onAiDraftWorkOrder: () => void;
  onEquipmentSummary: () => void;
  onAlarmCorrelation: () => void;
  onNavigateTo3D?: (equipmentId: string) => void;
  onOpenWorkOrder: (eq: Equipment) => void;
}

export const HealthScoreCard: React.FC<HealthScoreCardProps> = ({
  currentEquipment,
  isVibAlert,
  isTempAlert,
  aiAnalyzing,
  alarmEquipmentsCount,
  onRunAiAnalysis,
  onHealthForecast,
  onAiDraftWorkOrder,
  onEquipmentSummary,
  onAlarmCorrelation,
  onNavigateTo3D,
  onOpenWorkOrder,
}) => {
  return (
    <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 text-center relative overflow-hidden shadow-xs">
      <h3 className="text-xs font-semibold text-slate-700">实时健康综合评分</h3>
      <div className="my-4 relative flex items-center justify-center">
        <div className="w-28 h-28 rounded-full border-4 border-slate-100 flex items-center justify-center relative">
          <div
            className={`absolute inset-0 rounded-full border-4 ${
              currentEquipment.healthScore >= 80
                ? 'border-emerald-500'
                : currentEquipment.healthScore >= 60
                ? 'border-amber-500'
                : 'border-rose-500 animate-pulse'
            }`}
            style={{
              clipPath: `polygon(50% 50%, 0 0, 100% 0, 100% 100%, 0 100%)`,
            }}
          />
          <div className="text-center">
            <span className="text-3xl font-mono font-extrabold text-slate-900">
              {currentEquipment.healthScore}
            </span>
            <span className="text-[10px] block text-slate-500">/ 100 分</span>
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-600 space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="text-slate-500">振动权重 (35%):</span>
          <span className={isVibAlert ? 'text-rose-600 font-mono font-bold' : 'text-emerald-700 font-mono'}>
            {isVibAlert ? '超标扣减' : '正常'}
          </span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-slate-500">温升权重 (30%):</span>
          <span className={isTempAlert ? 'text-rose-600 font-mono font-bold' : 'text-emerald-700 font-mono'}>
            {isTempAlert ? '偏高扣减' : '正常'}
          </span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-slate-500">电气负荷 (20%):</span>
          <span className="text-slate-700 font-mono">稳定</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-slate-500">大修周期 (15%):</span>
          <span className="text-slate-700 font-mono">在控</span>
        </div>
      </div>

      {/* Quick Trigger Buttons */}
      <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
        <button
          onClick={onRunAiAnalysis}
          disabled={aiAnalyzing}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{aiAnalyzing ? 'AI 遥测研判中...' : 'AI 异常预警研判'}</span>
        </button>

        {/* AI 劣化趋势预警 */}
        <button
          onClick={onHealthForecast}
          className="w-full py-2 bg-white hover:bg-slate-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>AI 劣化趋势预警</span>
        </button>

        {/* AI 生成检修工单 */}
        <button
          onClick={onAiDraftWorkOrder}
          className="w-full py-2 bg-white hover:bg-slate-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI 生成检修工单</span>
        </button>

        {/* AI 健康画像 */}
        <button
          onClick={onEquipmentSummary}
          className="w-full py-2 bg-white hover:bg-slate-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>AI 健康画像</span>
        </button>

        {/* AI 报警关联分析 (多设备报警时展示) */}
        {alarmEquipmentsCount >= 2 && (
          <button
            onClick={onAlarmCorrelation}
            className="w-full py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span>AI 报警关联分析 ({alarmEquipmentsCount} 台报警)</span>
          </button>
        )}

        {onNavigateTo3D && (
          <button
            type="button"
            data-testid="health-navigate-to-3d"
            onClick={() => onNavigateTo3D(currentEquipment.id)}
            className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
            title="跳转 3D 孪生场景并自动聚焦此设备"
          >
            <Boxes className="w-3.5 h-3.5 text-cyan-400" />
            <span>3D 孪生场景定位</span>
          </button>
        )}

        <button
          onClick={() => onOpenWorkOrder(currentEquipment)}
          className="w-full py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>一键发起检修单</span>
        </button>
      </div>
    </div>
  );
};
