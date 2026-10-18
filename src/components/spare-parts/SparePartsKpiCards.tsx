import React from 'react';
import { Package, AlertTriangle, Layers, Wrench } from 'lucide-react';

interface SparePartsKpiCardsProps {
  totalKinds: number;
  totalStockCount: number;
  lowStockCount: number;
  onlyLowStock: boolean;
  onToggleLowStock: () => void;
}

export const SparePartsKpiCards: React.FC<SparePartsKpiCardsProps> = ({
  totalKinds,
  totalStockCount,
  lowStockCount,
  onlyLowStock,
  onToggleLowStock,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
        <div>
          <div className="text-xs text-slate-500 font-medium">备件品种数</div>
          <div className="text-2xl font-bold text-slate-900 font-mono mt-1">{totalKinds} 种</div>
          <div className="text-[11px] text-slate-500 mt-1">涵盖机械/电气/密封</div>
        </div>
        <div className="w-11 h-11 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
          <Package className="w-5 h-5" />
        </div>
      </div>

      <div
        onClick={onToggleLowStock}
        className={`card-industrial border rounded-lg p-4 flex items-center justify-between shadow-xs cursor-pointer transition-all ${
          onlyLowStock ? 'ring-2 ring-rose-400 bg-rose-50/70 border-rose-300' :
          lowStockCount > 0
            ? 'border-rose-200 bg-rose-50/50 hover:border-rose-300'
            : 'border-slate-200 bg-white hover:border-slate-300'
        }`}
      >
        <div>
          <div className="text-xs text-rose-700 font-medium flex items-center">
            <span>低库存告警</span>
            {lowStockCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping ml-2" />
            )}
          </div>
          <div className="text-2xl font-bold text-rose-700 font-mono mt-1">{lowStockCount} 项</div>
          <div className="text-[11px] text-rose-600 mt-1">低于安全库存红线 (点击过滤)</div>
        </div>
        <div className="w-11 h-11 rounded-lg bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600">
          <AlertTriangle className="w-5 h-5" />
        </div>
      </div>

      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
        <div>
          <div className="text-xs text-slate-500 font-medium">在库总件数</div>
          <div className="text-2xl font-bold text-emerald-700 font-mono mt-1">{totalStockCount} 件</div>
          <div className="text-[11px] text-slate-500 mt-1">实物周转总余量</div>
        </div>
        <div className="w-11 h-11 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
          <Layers className="w-5 h-5" />
        </div>
      </div>

      <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
        <div>
          <div className="text-xs text-slate-500 font-medium">适配机组覆盖率</div>
          <div className="text-2xl font-bold text-purple-700 font-mono mt-1">100%</div>
          <div className="text-[11px] text-slate-500 mt-1">离心机/泵/压缩机全覆盖</div>
        </div>
        <div className="w-11 h-11 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600">
          <Wrench className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};
