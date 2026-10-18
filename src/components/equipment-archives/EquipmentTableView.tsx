import React from 'react';
import { Equipment } from '../../types';
import { getStatusBadge } from './equipmentArchiveTypes';

interface EquipmentTableViewProps {
  equipments: Equipment[];
  onSelectEquipment: (eq: Equipment) => void;
  onOpenWorkOrder: (eq: Equipment) => void;
}

export const EquipmentTableView: React.FC<EquipmentTableViewProps> = ({
  equipments,
  onSelectEquipment,
  onOpenWorkOrder,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs card-industrial">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="bg-slate-50 text-[11px] text-slate-600 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-4 py-3">位号编码</th>
              <th className="px-4 py-3">设备名称 / 型号</th>
              <th className="px-4 py-3">车间位置</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">健康度</th>
              <th className="px-4 py-3">关键遥测 (温/振/电)</th>
              <th className="px-4 py-3">下次点检</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {equipments.map((eq) => {
              const statusBadge = getStatusBadge(eq.status);
              return (
                <tr key={eq.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-cyan-700">
                    {eq.code}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{eq.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{eq.model}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {eq.workshop}
                    <div className="text-[10px] text-slate-500">{eq.location}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${statusBadge.color}`}>
                      {statusBadge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold">
                    <span
                      className={
                        eq.healthScore < 60
                          ? 'text-rose-600'
                          : eq.healthScore < 80
                          ? 'text-amber-600'
                          : 'text-emerald-600'
                      }
                    >
                      {eq.healthScore}分
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] space-x-2">
                    <span className={eq.telemetry.temperature > 75 ? 'text-rose-600' : 'text-slate-700'}>
                      {eq.telemetry.temperature}°C
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className={eq.telemetry.vibration > 4.5 ? 'text-rose-600' : 'text-slate-700'}>
                      {eq.telemetry.vibration}mm/s
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className="text-slate-700">{eq.telemetry.current}A</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-500">{eq.nextInspectionDate}</td>
                  <td className="px-4 py-3 text-right space-x-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectEquipment(eq)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-cyan-50 text-slate-700 hover:text-cyan-700 rounded border border-slate-200 transition-colors cursor-pointer"
                    >
                      详情
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenWorkOrder(eq)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-amber-50 text-slate-700 hover:text-amber-700 rounded border border-slate-200 transition-colors cursor-pointer"
                    >
                      报修
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
