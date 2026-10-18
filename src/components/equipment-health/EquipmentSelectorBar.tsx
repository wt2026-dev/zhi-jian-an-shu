import React from 'react';
import { Equipment } from '../../types';

interface EquipmentSelectorBarProps {
  equipments: Equipment[];
  activeEqId: string;
  onSelectEquipment: (id: string) => void;
}

export const EquipmentSelectorBar: React.FC<EquipmentSelectorBarProps> = ({
  equipments,
  activeEqId,
  onSelectEquipment,
}) => {
  return (
    <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-none">
      {equipments.map((eq) => {
        const isSelected = eq.id === activeEqId;
        const isBad = eq.healthScore < 60;
        return (
          <button
            key={eq.id}
            onClick={() => onSelectEquipment(eq.id)}
            className={`flex items-center space-x-2.5 px-3.5 py-2 rounded-lg text-left whitespace-nowrap transition-all cursor-pointer border ${
              isSelected
                ? 'bg-blue-50 border-blue-500 shadow-xs ring-1 ring-blue-500/30'
                : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                isBad ? 'bg-rose-500 animate-ping' : eq.healthScore < 80 ? 'bg-amber-400' : 'bg-emerald-500'
              }`}
            />
            <div>
              <div className={`text-xs font-bold ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}>
                {eq.name}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {eq.code} · <span className="text-blue-600 font-semibold">{eq.healthScore}分</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};
