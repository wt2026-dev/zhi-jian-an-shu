import React from 'react';
import { History, X } from 'lucide-react';
import { SparePart, SparePartMovement } from '../../types';

interface SparePartMovementsModalProps {
  part: SparePart | null;
  onClose: () => void;
  loading: boolean;
  movements: SparePartMovement[];
}

export const SparePartMovementsModal: React.FC<SparePartMovementsModalProps> = ({
  part,
  onClose,
  loading,
  movements,
}) => {
  if (!part) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl animate-in fade-in zoom-in-95">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center">
              <History className="w-5 h-5 mr-2 text-blue-600" />
              出入库明细流水: {part.name}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              编号: {part.code} · 当前库存: {part.stock} {part.unit}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {loading && (
            <div className="py-8 text-center text-slate-500">正在查询流水台账...</div>
          )}

          {!loading && movements.length === 0 && (
            <div className="py-12 text-center text-slate-500">暂无出入库变动流水</div>
          )}

          {!loading &&
            movements.map((m) => (
              <div
                key={m.id}
                className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                      m.type === 'in'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-orange-50 text-orange-700 border border-orange-200'
                    }`}
                  >
                    {m.type === 'in' ? '+' : '-'}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">
                      {m.type === 'in' ? '采购到货入库' : '检修现场领用出库'}: {m.reason || '无'}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center space-x-2 mt-0.5">
                      <span>经办: {m.operator || '系统'}</span>
                      {m.work_order_id && (
                        <span className="font-mono text-blue-700 font-medium">
                          工单: {m.work_order_id}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`font-mono font-bold text-sm ${
                      m.type === 'in' ? 'text-emerald-700' : 'text-orange-700'
                    }`}
                  >
                    {m.type === 'in' ? `+${m.quantity}` : `-${m.quantity}`} {part.unit}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {m.created_at ? new Date(m.created_at).toLocaleString() : ''}
                  </div>
                </div>
              </div>
            ))}
        </div>

        <div className="p-4 border-t border-slate-100 text-right bg-slate-50/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer shadow-xs"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
