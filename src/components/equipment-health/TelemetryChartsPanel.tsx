import React from 'react';
import { Activity, X } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
  Dot,
} from 'recharts';
import { TelemetrySample, AiSafetyNoticeData, AiDiagTraceabilityData } from './healthTypes';
import { AiLiveInsightBanner } from './AiLiveInsightBanner';

interface TelemetryChartsPanelProps {
  historyData: TelemetrySample[];
  isSimulating: boolean;
  onStartSimulating: () => void;
  demo: boolean;
  aiAnalysisResult: string | null;
  aiSafetyNotice: AiSafetyNoticeData | null;
  aiDiagTraceability: AiDiagTraceabilityData | null;
  selectedChartPoint: TelemetrySample | null;
  onSelectChartPoint: (point: TelemetrySample | null) => void;
}

export const TelemetryChartsPanel: React.FC<TelemetryChartsPanelProps> = ({
  historyData,
  isSimulating,
  onStartSimulating,
  demo,
  aiAnalysisResult,
  aiSafetyNotice,
  aiDiagTraceability,
  selectedChartPoint,
  onSelectChartPoint,
}) => {
  return (
    <div className="lg:col-span-3 space-y-6">
      {/* AI Live Insight Banner */}
      <AiLiveInsightBanner
        aiAnalysisResult={aiAnalysisResult}
        aiSafetyNotice={aiSafetyNotice}
        aiDiagTraceability={aiDiagTraceability}
      />

      {/* Chart 1: Vibration & Temperature (Twin Critical Metrics) */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-2" />
              振动速度有效值 (mm/s) 与 轴承温度 (°C) 动态波形
            </h3>
            <span className="text-[11px] text-slate-500">
              黄色警戒线: 4.5mm/s (振动), 70°C (温度) | 红色停机线: 7.1mm/s, 80°C
            </span>
          </div>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
              isSimulating
                ? 'text-amber-800 bg-amber-100 border border-amber-300'
                : 'text-blue-700 bg-blue-50 border border-blue-200'
            }`}
          >
            {isSimulating ? '⚠️ 演示模拟波形' : '现场真实时序'}
          </span>
        </div>

        {historyData.length === 0 ? (
          <div className="h-60 w-full flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50 p-6 text-center">
            <Activity className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-xs font-semibold text-slate-700">暂无实时遥测历史数据</p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
              {demo
                ? '未接入现场硬件时序。当前处于演示模式，可点击右上角"启用模拟数据"体验动态波形。'
                : '设备传感器离线或尚未采集到连续时序样本，请检查现场测点连接状态。'}
            </p>
            {demo && !isSimulating && (
              <button
                onClick={onStartSimulating}
                className="mt-3 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-xs transition-colors"
              >
                启用演示模拟数据
              </button>
            )}
          </div>
        ) : (
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={historyData}>
                <defs>
                  <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorVib" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                <YAxis yAxisId="left" stroke="#ef4444" fontSize={10} domain={[20, 100]} />
                <YAxis yAxisId="right" orientation="right" stroke="#2563eb" fontSize={10} domain={[0, 12]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    fontSize: '11px',
                    color: '#1e293b',
                  }}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="temperature"
                  name="轴承温度(°C)"
                  stroke="#ef4444"
                  fillOpacity={1}
                  fill="url(#colorTemp)"
                  strokeWidth={2}
                  activeDot={{
                    r: 5,
                    strokeWidth: 2,
                    onClick: (dotProps: React.ComponentProps<typeof Dot>) =>
                      onSelectChartPoint((dotProps as { payload?: TelemetrySample }).payload || null),
                  }}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="vibration"
                  name="振动RMS(mm/s)"
                  stroke="#2563eb"
                  fillOpacity={1}
                  fill="url(#colorVib)"
                  strokeWidth={2}
                  activeDot={{
                    r: 5,
                    strokeWidth: 2,
                    onClick: (dotProps: React.ComponentProps<typeof Dot>) =>
                      onSelectChartPoint((dotProps as { payload?: TelemetrySample }).payload || null),
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 时间点游标信息面板 */}
        {selectedChartPoint && (
          <div className="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-between text-xs animate-in fade-in duration-150">
            <div className="flex items-center gap-4">
              <span className="font-semibold text-blue-800">{selectedChartPoint.time}</span>
              <span>
                轴温{' '}
                <strong
                  className={`font-mono ${
                    (selectedChartPoint.temperature ?? 0) > 75
                      ? 'text-rose-600'
                      : (selectedChartPoint.temperature ?? 0) > 70
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                  }`}
                >
                  {selectedChartPoint.temperature ?? '—'}°C
                </strong>
                <span className="text-slate-400 ml-1">（正常阈值 85°C）</span>
              </span>
              <span>
                振动{' '}
                <strong
                  className={`font-mono ${
                    (selectedChartPoint.vibration ?? 0) > 7.1
                      ? 'text-rose-600'
                      : (selectedChartPoint.vibration ?? 0) > 4.5
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                  }`}
                >
                  {selectedChartPoint.vibration ?? '—'}mm/s
                </strong>
                <span className="text-slate-400 ml-1">（正常阈值 4.5mm/s）</span>
              </span>
            </div>
            <button
              onClick={() => onSelectChartPoint(null)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Chart 2: Current & Load Rate */}
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500 mr-2" />
              三相运行电流 (A) 与 机组负荷率 (%)
            </h3>
            <span className="text-[11px] text-slate-500">
              评估电机驱动负荷与传动阻力矩突变
            </span>
          </div>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
              isSimulating
                ? 'text-amber-800 bg-amber-100 border border-amber-300'
                : 'text-slate-600 bg-slate-100 border border-slate-200'
            }`}
          >
            {isSimulating ? '⚠️ 模拟数据' : '现场真实'}
          </span>
        </div>

        {historyData.length === 0 ? (
          <div className="h-48 w-full flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50 p-4 text-center">
            <p className="text-xs text-slate-400">暂无运行电流与负荷率数据</p>
          </div>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                <YAxis yAxisId="left" stroke="#f59e0b" fontSize={10} />
                <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={10} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    fontSize: '11px',
                    color: '#1e293b',
                  }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="current"
                  name="电流(A)"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="loadRate"
                  name="负载率(%)"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
