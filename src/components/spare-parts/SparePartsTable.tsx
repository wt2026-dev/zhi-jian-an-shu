import React from 'react';
import { Package } from 'lucide-react';
import { SparePart } from '../../types';

interface SparePartsTableProps {
  filteredParts: SparePart[];
  isLoading: boolean;
  canOperate: boolean;
  onOpenInOut: (part: SparePart) => void;
  onOpenMovements: (part: SparePart) => void;
}

export const SparePartsTable: React.FC<SparePartsTableProps> = ({
  filteredParts,
  isLoading,
  canOperate,
  onOpenInOut,
  onOpenMovements,
}) => {
  return (
    <div className="card-industrial bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
            <tr>
              <th className="py-3 px-4">备件编号 / 名称</th>
              <th className="py-3 px-4">规格型号</th>
              <th className="py-3 px-4">类别</th>
              <th className="py-3 px-4">在库余量 / 安全线</th>
              <th className="py-3 px-4">仓储库位</th>
              <th className="py-3 px-4">单价 (元)</th>
              <th className="py-3 px-4">适配设备型号</th>
              <th className="py-3 px-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredParts.map((part) => {
              const isLow = part.stock <= part.safe_stock;
              const stockPercent = Math.min(
                100,
                Math.round((part.stock / (part.safe_stock * 2 || 1)) * 100)
              );

              return (
                <tr
                  key={part.id}
                  className={`hover:bg-slate-50/80 transition-colors ${
                    isLow ? 'bg-rose-50/30' : ''
                  }`}
                >
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900 flex items-center space-x-2">
                      <span>{part.name}</span>
                      {isLow && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-200">
                          低库存
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">{part.code}</div>
                  </td>

                  <td className="py-3 px-4 text-slate-700 font-mono">{part.specification}</td>

                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] border border-slate-200 font-medium">
                      {part.category}
                    </span>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`font-mono font-bold text-sm ${
                          isLow ? 'text-rose-600' : 'text-slate-900'
                        }`}
                      >
                        {part.stock}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        / {part.safe_stock} {part.unit}
                      </span>
                    </div>
                    {/* Mini Bar */}
                    <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                      <div
                        className={`h-full rounded-full ${
                          isLow ? 'bg-rose-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${Math.max(5, stockPercent)}%` }}
                      />
                    </div>
                  </td>

                  <td className="py-3 px-4 text-slate-700">
                    <span className="font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-medium">
                      {part.location || '待分配'}
                    </span>
                  </td>

                  <td className="py-3 px-4 font-mono text-slate-800 font-medium">
                    ¥{part.price ? part.price.toFixed(2) : '0.00'}
                  </td>

                  <td
                    className="py-3 px-4 text-slate-600 text-[11px] max-w-xs truncate"
                    title={
                      Array.isArray(part.compatible_models)
                        ? part.compatible_models.join(', ')
                        : part.compatible_models || ''
                    }
                  >
                    {(Array.isArray(part.compatible_models)
                      ? part.compatible_models.join(', ')
                      : part.compatible_models) || '通用工业标准件'}
                  </td>

                  <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                    {canOperate && (
                      <button
                        onClick={() => onOpenInOut(part)}
                        className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shadow-xs transition-colors"
                      >
                        出入库
                      </button>
                    )}
                    <button
                      onClick={() => onOpenMovements(part)}
                      className="px-2.5 py-1 rounded-md bg-white hover:bg-slate-50 text-slate-700 text-xs border border-slate-200 cursor-pointer shadow-xs transition-colors font-medium"
                    >
                      明细
                    </button>
                  </td>
                </tr>
              );
            })}

            {filteredParts.length === 0 && !isLoading && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <Package className="w-10 h-10 mx-auto mb-2 text-slate-500" />
                  未找到匹配的备件记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
