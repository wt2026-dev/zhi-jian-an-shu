import React from 'react';
import { Activity } from 'lucide-react';
import { TelemetrySample } from './healthTypes';

interface RealtimeMetersCardProps {
  latest: TelemetrySample;
  isTempAlert: boolean;
  isVibAlert: boolean;
}

export const RealtimeMetersCard: React.FC<RealtimeMetersCardProps> = ({
  latest,
  isTempAlert,
  isVibAlert,
}) => {
  return (
    <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-xs">
      <h4 className="text-xs font-semibold text-slate-800 flex items-center">
        <Activity className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
        实时仪表传感器读数
      </h4>
      <div className="space-y-2 text-xs">
        <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-slate-600">轴承温度 (PT100)</span>
          <span className={`font-mono font-bold ${isTempAlert ? 'text-rose-600' : 'text-slate-800'}`}>
            {latest.temperature ?? '—'} °C
          </span>
        </div>
        <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-slate-600">振动速度 (IEPE)</span>
          <span className={`font-mono font-bold ${isVibAlert ? 'text-rose-600' : 'text-slate-800'}`}>
            {latest.vibration ?? '—'} mm/s
          </span>
        </div>
        <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-slate-600">工作电压</span>
          <span className="font-mono font-bold text-slate-800">{latest.voltage ?? '—'} V</span>
        </div>
        <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-slate-600">三相电流</span>
          <span className="font-mono font-bold text-slate-800">{latest.current ?? '—'} A</span>
        </div>
        <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-slate-600">工况负荷率</span>
          <span className="font-mono font-bold text-slate-800">{latest.loadRate ?? '—'} %</span>
        </div>
      </div>
    </div>
  );
};
