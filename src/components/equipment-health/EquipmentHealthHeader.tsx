import React from 'react';
import { Activity, Play, Pause, RefreshCw } from 'lucide-react';

interface EquipmentHealthHeaderProps {
  isSimulating: boolean;
  setIsSimulating: (sim: boolean) => void;
  sampleSpeed: number;
  setSampleSpeed: (speed: number) => void;
  loadingTelemetry: boolean;
  onRefreshTelemetry: () => void;
  demo: boolean;
}

export const EquipmentHealthHeader: React.FC<EquipmentHealthHeaderProps> = ({
  isSimulating,
  setIsSimulating,
  sampleSpeed,
  setSampleSpeed,
  loadingTelemetry,
  onRefreshTelemetry,
  demo,
}) => {
  return (
    <>
      {/* 顶部常驻显式模拟角标/横幅 */}
      {isSimulating && (
        <div className="p-3.5 bg-amber-500/15 border-2 border-amber-500 rounded-xl flex items-center justify-between text-amber-900 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center space-x-2.5">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </span>
            <span className="font-extrabold text-xs bg-amber-500 text-white px-2.5 py-0.5 rounded shadow-xs">
              模拟数据运行中
            </span>
            <span className="text-xs text-amber-900 font-medium">
              当前展示数据为本地算法生成的演示扰动波形，非现场硬件直连真实传感器数据（参赛演示模式专用）
            </span>
          </div>
          <button
            onClick={() => setIsSimulating(false)}
            className="text-xs text-amber-800 hover:text-amber-950 font-bold underline cursor-pointer ml-3 shrink-0"
          >
            关闭模拟
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <Activity className="w-5 h-5 mr-2 text-blue-600" />
            工业级精密机组健康画像与多维遥测监视
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            采集温度、振动加速度(RMS)、三相电流、电压与工况负荷率，融合AI多参数时序健康算法
          </p>
        </div>

        {/* Simulation Controls (仅演示模式展示) */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onRefreshTelemetry}
            disabled={loadingTelemetry}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 text-blue-700 border border-slate-200 flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            title="调用真实后端 API /api/v1/equipments/:id/telemetry-history 获取最新时序传感器数据"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingTelemetry ? 'animate-spin text-blue-600' : ''}`} />
            <span>{loadingTelemetry ? '同步API中' : '刷新真实时序'}</span>
          </button>

          {demo && (
            <>
              <button
                onClick={() => setIsSimulating(!isSimulating)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  isSimulating
                    ? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold'
                    : 'bg-white text-slate-600 border border-slate-200'
                }`}
                title="演示模式开关：启动前端动态扰动波形模拟"
              >
                {isSimulating ? <Pause className="w-3.5 h-3.5 text-amber-600" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isSimulating ? '模拟运行中' : '启用模拟数据'}</span>
              </button>

              {isSimulating && (
                <select
                  value={sampleSpeed}
                  onChange={(e) => setSampleSpeed(Number(e.target.value))}
                  className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-blue-500 shadow-xs"
                >
                  <option value={1000}>模拟步进: 1秒 (高速)</option>
                  <option value={2000}>模拟步进: 2秒 (标准)</option>
                  <option value={5000}>模拟步进: 5秒 (低频)</option>
                </select>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};
