import React from 'react';
import { QrCode, X, ShieldAlert } from 'lucide-react';
import { InspectionItem } from '../../types';

interface InspectionRecordModalProps {
  selectedPoint: InspectionItem | null;
  pointReading: {
    value: number;
    notes: string;
    isAbnormal: boolean;
  };
  createHazardOnSave: boolean;
  hazardLevelOnSave: 'general' | 'major';
  onChangeReadingValue: (val: number) => void;
  onChangeReadingNotes: (notes: string) => void;
  onChangeReadingIsAbnormal: (isAbnormal: boolean) => void;
  onChangeCreateHazard: (val: boolean) => void;
  onChangeHazardLevel: (level: 'general' | 'major') => void;
  onClose: () => void;
  onSave: () => void;
}

export const InspectionRecordModal: React.FC<InspectionRecordModalProps> = ({
  selectedPoint,
  pointReading,
  createHazardOnSave,
  hazardLevelOnSave,
  onChangeReadingValue,
  onChangeReadingNotes,
  onChangeReadingIsAbnormal,
  onChangeCreateHazard,
  onChangeHazardLevel,
  onClose,
  onSave,
}) => {
  if (!selectedPoint) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900 flex items-center">
            <QrCode className="w-4 h-4 mr-1.5 text-blue-600" />
            现场测点打卡与仪表抄表
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs space-y-3">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="font-bold text-slate-800">{selectedPoint.equipmentName}</div>
            <div className="text-blue-700 font-medium mt-0.5">{selectedPoint.checkPoint || selectedPoint.checkItem}</div>
            <div className="text-slate-500 mt-1">标准要求: {selectedPoint.standard}</div>
            {(selectedPoint.maxLimit !== undefined || selectedPoint.maxVal !== undefined) && (
              <div className="text-orange-700 font-mono mt-0.5 font-bold">
                预警上限: {selectedPoint.maxLimit ?? selectedPoint.maxVal} {selectedPoint.unit || ''}
              </div>
            )}
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-semibold">
              实测数值 ({selectedPoint.unit || '数值'}) *
            </label>
            <input
              type="number"
              step="0.1"
              required
              value={pointReading.value}
              onChange={(e) => onChangeReadingValue(Number(e.target.value))}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono text-base font-bold"
            />
          </div>

          <div>
            <label className="block text-slate-700 mb-1">现场异常描述/巡检备注</label>
            <textarea
              rows={2}
              placeholder="如发现异常振动、漏油、摩擦声响请在此记录..."
              value={pointReading.notes}
              onChange={(e) => onChangeReadingNotes(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center space-x-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <input
              type="checkbox"
              id="chk-manual-abnormal"
              checked={pointReading.isAbnormal}
              onChange={(e) => onChangeReadingIsAbnormal(e.target.checked)}
              className="w-4 h-4 text-rose-600 rounded bg-white border-slate-300 focus:ring-rose-500"
            />
            <label htmlFor="chk-manual-abnormal" className="text-xs text-rose-700 font-medium cursor-pointer">
              标记为此测点发现人为直观异常 (如杂音/破损)
            </label>
          </div>

          {/* 登记为现场安全隐患 (功能四：隐患闭环管理联动) */}
          <div className="space-y-2 p-2.5 rounded-lg bg-rose-50/60 border border-rose-200">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="chk-create-hazard-modal"
                checked={createHazardOnSave}
                onChange={(e) => onChangeCreateHazard(e.target.checked)}
                className="w-4 h-4 text-rose-600 rounded bg-white border-slate-300 focus:ring-rose-500"
              />
              <label htmlFor="chk-create-hazard-modal" className="text-xs text-rose-700 font-semibold cursor-pointer flex items-center">
                <ShieldAlert className="w-3.5 h-3.5 mr-1 text-rose-600" />
                登记为现场安全隐患 (纳入闭环管理)
              </label>
            </div>
            {createHazardOnSave && (
              <div className="pt-1 flex items-center space-x-2">
                <span className="text-[11px] text-slate-700">隐患等级:</span>
                <select
                  value={hazardLevelOnSave}
                  onChange={(e) => onChangeHazardLevel(e.target.value as 'general' | 'major')}
                  className="bg-white border border-slate-200 text-xs text-slate-800 rounded px-2 py-1 focus:outline-none focus:border-rose-500"
                >
                  <option value="general">一般隐患 (限期班组消缺)</option>
                  <option value="major">重大隐患 (厂级重点督办)</option>
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium cursor-pointer shadow-xs"
          >
            取消
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-xs"
          >
            保存测点打卡
          </button>
        </div>
      </div>
    </div>
  );
};
