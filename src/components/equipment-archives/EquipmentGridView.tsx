import React from 'react';
import { ChevronRight, Layers, MapPin, Shield, Sparkles, Wrench } from 'lucide-react';
import { Equipment } from '../../types';
import { getStatusBadge } from './equipmentArchiveTypes';

interface EquipmentGridViewProps {
  equipments: Equipment[];
  onSelectEquipment: (eq: Equipment) => void;
  onOpenAiDiagnose: (eq: Equipment) => void;
  onOpenWorkOrder: (eq: Equipment) => void;
}

export const EquipmentGridView: React.FC<EquipmentGridViewProps> = ({
  equipments,
  onSelectEquipment,
  onOpenAiDiagnose,
  onOpenWorkOrder,
}) => {
  if (equipments.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs card-industrial">
        <Layers className="w-12 h-12 text-slate-500 mx-auto mb-3" />
        <h4 className="text-sm font-semibold text-slate-700">未检索到匹配的工业设备</h4>
        <p className="text-xs text-slate-500 mt-1">请尝试更换搜索关键字或重置筛选条件</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {equipments.map((eq) => {
        const statusBadge = getStatusBadge(eq.status);
        const isAlarm = eq.healthScore < 60 || eq.status === 'fault';
        const isWarn = eq.healthScore >= 60 && eq.healthScore < 80;

        return (
          <div
            key={eq.id}
            onClick={() => onSelectEquipment(eq)}
            className="bg-white border border-slate-200 hover:border-cyan-400 rounded-xl p-4 transition-all hover:shadow-md flex flex-col justify-between group cursor-pointer card-industrial shadow-xs"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200 font-semibold">
                  {eq.code}
                </span>
                <div className="flex items-center space-x-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${statusBadge.color}`}>
                    {statusBadge.label}
                  </span>
                  <span
                    className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
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
              </div>
              <h3 className="text-sm font-bold text-slate-800 group-hover:text-cyan-700 transition-colors">
                {eq.name}
              </h3>
              <p className="text-xs text-slate-500 font-mono mt-0.5 line-clamp-1">{eq.model}</p>
              <div className="mt-3 space-y-1 text-xs text-slate-600">
                <div className="flex items-center text-slate-500">
                  <MapPin className="w-3.5 h-3.5 mr-1.5 text-cyan-600 shrink-0" />
                  <span className="truncate">{eq.workshop} · {eq.location}</span>
                </div>
                <div className="flex items-center text-slate-500">
                  <Shield className="w-3.5 h-3.5 mr-1.5 text-purple-600 shrink-0" />
                  <span>重要等级: <strong className="text-slate-700">{eq.criticality}</strong></span>
                </div>
              </div>
              <div className="mt-3 p-2 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-500 block text-[10px]">轴温</span>
                  <span className={`font-mono font-semibold ${eq.telemetry && eq.telemetry.temperature > 75 ? 'text-rose-600' : 'text-slate-700'}`}>
                    {eq.telemetry?.temperature ?? "—"}°C
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">振动RMS</span>
                  <span className={`font-mono font-semibold ${eq.telemetry && eq.telemetry.vibration > 4.5 ? 'text-rose-600' : 'text-slate-700'}`}>
                    {eq.telemetry?.vibration ?? "—"}mm/s
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">运行电流</span>
                  <span className="font-mono font-semibold text-slate-700">{eq.telemetry?.current ?? "—"}A</span>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-cyan-600 hover:text-cyan-700 font-semibold flex items-center">
                <span>详细台账</span>
                <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
              </span>
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenAiDiagnose(eq);
                  }}
                  title="AI智能诊断"
                  className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white transition-colors cursor-pointer border border-blue-200"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenWorkOrder(eq);
                  }}
                  title="快速报修开单"
                  className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-600 text-amber-600 hover:text-white transition-colors cursor-pointer border border-amber-200"
                >
                  <Wrench className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
