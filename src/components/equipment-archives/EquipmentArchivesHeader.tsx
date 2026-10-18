import React from 'react';
import { Layers, Plus } from 'lucide-react';

interface EquipmentArchivesHeaderProps {
  totalCount: number;
  isAdmin: boolean;
  viewMode: 'grid' | 'table';
  onChangeViewMode: (mode: 'grid' | 'table') => void;
  onOpenAdd: () => void;
}

export const EquipmentArchivesHeader: React.FC<EquipmentArchivesHeaderProps> = ({
  totalCount,
  isAdmin,
  viewMode,
  onChangeViewMode,
  onOpenAdd,
}) => {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 flex items-center">
          <Layers className="w-5 h-5 mr-2 text-cyan-600" />
          工业设备资产档案与全生命周期台账
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          共收录 <strong className="text-cyan-700 font-mono font-bold">{totalCount}</strong> 台重点工业机组，覆盖运行状态、遥测实时数据、大修履历与电子二维码标签
        </p>
      </div>

      <div className="flex items-center space-x-2">
        {isAdmin && (
          <button
            id="btn-add-equipment"
            onClick={onOpenAdd}
            className="px-3.5 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新增设备档案</span>
          </button>
        )}

        <div className="flex rounded-lg bg-slate-100 p-1 border border-slate-200">
          <button
            onClick={() => onChangeViewMode('grid')}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
              viewMode === 'grid' ? 'bg-white text-cyan-700 font-medium shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            卡片视图
          </button>
          <button
            onClick={() => onChangeViewMode('table')}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
              viewMode === 'table' ? 'bg-white text-cyan-700 font-medium shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            表格视图
          </button>
        </div>
      </div>
    </div>
  );
};
