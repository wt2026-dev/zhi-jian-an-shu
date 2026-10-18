import React from 'react';
import { Box, RefreshCw, Plus } from 'lucide-react';

interface SparePartsHeaderProps {
  isLoading: boolean;
  canOperate: boolean;
  onRefresh: () => void;
  onOpenCreate: () => void;
}

export const SparePartsHeader: React.FC<SparePartsHeaderProps> = ({
  isLoading,
  canOperate,
  onRefresh,
  onOpenCreate,
}) => {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center">
          <Box className="w-5 h-5 mr-2 text-blue-600" />
          工业备品备件库存中枢
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          动态关联在役工业设备型号，支持精密备件出入库流水核销、安全阈值红色预警与工单领用联动
        </p>
      </div>

      <div className="flex items-center space-x-3">
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors shadow-xs cursor-pointer"
          title="刷新备件库存"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
        </button>
        {canOperate ? (
          <button
            id="btn-create-spare"
            onClick={onOpenCreate}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>新增备件入库</span>
          </button>
        ) : (
          <span className="text-xs px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg border border-slate-200">
            备件台账只读查阅
          </span>
        )}
      </div>
    </div>
  );
};
