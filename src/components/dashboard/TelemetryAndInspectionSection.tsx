import React from 'react';
import {
  Activity,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { Equipment, InspectionTask, LotoLock } from '../../types';

export interface TelemetryAndInspectionSectionProps {
  equipments: Equipment[];
  inspections: InspectionTask[];
  activeLotoLocks: LotoLock[];
  onSelectEquipment: (eq: Equipment) => void;
  onNavigate: (tab: string) => void;
}

export const TelemetryAndInspectionSection: React.FC<TelemetryAndInspectionSectionProps> = ({
  equipments,
  inspections,
  activeLotoLocks,
  onSelectEquipment,
  onNavigate,
}) => {
  return (
    <div className="space-y-6">
      {/* Real-time Focus Equipment Health List */}
      <div className="glass-card p-4 shadow-sm relative">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center">
            <Activity className="w-4 h-4 mr-2 text-emerald-600" />
            设备健康实时雷达
          </h3>
          <button
            onClick={() => onNavigate('health')}
            className="text-xs text-blue-600 hover:underline cursor-pointer font-medium"
          >
            遥测大屏
          </button>
        </div>

        <div className="space-y-2.5">
          {equipments.slice(0, 4).map((eq) => {
            const isAlarm = eq.healthScore < 60 || eq.status === 'fault';
            const isWarn = eq.healthScore >= 60 && eq.healthScore < 80;
            return (
              <div
                key={eq.id}
                onClick={() => onSelectEquipment(eq)}
                className="p-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-all cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900 group-hover:text-blue-600 truncate">
                    {eq.name}
                  </span>
                  <span
                    className={`text-xs font-bold font-mono px-1.5 py-0.2 rounded ${
                      isAlarm
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : isWarn
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}
                  >
                    {eq.healthScore}分
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5 font-medium">
                  <span>
                    温度:{' '}
                    <strong className={eq.telemetry.temperature > 75 ? 'text-rose-600 font-mono' : 'text-slate-800 font-mono'}>
                      {eq.telemetry.temperature}°C
                    </strong>
                  </span>
                  <span>
                    振动:{' '}
                    <strong className={eq.telemetry.vibration > 4.5 ? 'text-rose-600 font-mono' : 'text-slate-800 font-mono'}>
                      {eq.telemetry.vibration}mm/s
                    </strong>
                  </span>
                  <span>
                    负荷: <strong className="text-slate-800 font-mono">{eq.telemetry.loadRate}%</strong>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Today's Inspection Progress Widget */}
      <div className="glass-card p-4 shadow-sm relative">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center">
            <CheckCircle2 className="w-4 h-4 mr-2 text-blue-600" />
            巡检路线打卡与状态
          </h3>
          <button
            onClick={() => onNavigate('inspections')}
            className="text-xs text-blue-600 hover:underline cursor-pointer font-medium"
          >
            进入巡检终端
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto pr-1 space-y-2">
          {inspections.map((task) => (
            <div key={task.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 truncate">{task.title}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                    task.status === 'in_progress'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                >
                  {task.status === 'in_progress' ? '进行中' : '未开始'}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1 truncate">
                路线: {task.route}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                <span>
                  已完成: <strong className="text-slate-800 font-mono">{task.completedPoints}/{task.totalPoints}</strong> 测点
                </span>
                {task.abnormalCount > 0 && (
                  <span className="text-rose-600 font-medium">发现 {task.abnormalCount} 处异常</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* LOTO Safety Interlock Quick Status */}
      <div className="glass-card p-4 shadow-sm relative">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center">
            <Lock className="w-4 h-4 mr-2 text-purple-600" />
            LOTO 停电挂牌生命锁状态
          </h3>
          <button
            onClick={() => onNavigate('safety')}
            className="text-xs text-blue-600 hover:underline cursor-pointer font-medium"
          >
            安全管理
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
          {activeLotoLocks.map((lock) => (
            <div
              key={lock.id}
              className="p-2.5 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-900 space-y-1"
            >
              <div className="flex items-center justify-between font-semibold">
                <span className="truncate">{lock.pointName || lock.permitTitle || '能量隔离点已锁定'}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-600 text-white font-mono shrink-0 ml-2">
                  {lock.lockNo}
                </span>
              </div>
              <p className="text-[11px] text-slate-600">
                隔离动力源: {lock.energySource || '—'} | 锁闭人: {lock.lockedBy || '—'}
              </p>
            </div>
          ))}
          {activeLotoLocks.length === 0 && (
            <div className="p-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center text-[11px] text-slate-500">
              当前无挂锁执行中的 LOTO 能量隔离作业
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
