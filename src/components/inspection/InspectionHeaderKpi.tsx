import React from 'react';
import { CheckCircle2, AlertTriangle, MapPin, QrCode } from 'lucide-react';
import { UserProfile } from '../../types';

interface InspectionHeaderKpiProps {
  currentUser: UserProfile;
  completedPointsCount: number;
  totalPointsCount: number;
  totalAbnormalCount: number;
  overallRate: number;
  onOpenQrModal: () => void;
}

export const InspectionHeaderKpi: React.FC<InspectionHeaderKpiProps> = ({
  currentUser,
  completedPointsCount,
  totalPointsCount,
  totalAbnormalCount,
  overallRate,
  onOpenQrModal,
}) => {
  return (
    <>
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <CheckCircle2 className="w-5 h-5 mr-2 text-blue-600" />
            工业设备点巡检作业与异常一键闭环
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            路线—测点两级结构、高精度测温测振抄表、限值比对、现场异常一键生成报修单
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={onOpenQrModal}
            className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
            title="打开摄像头扫码，自动识别设备并载入巡检作业表单"
          >
            <QrCode className="w-4 h-4 text-white" />
            <span>扫码直达巡检</span>
          </button>

          <span className="text-xs text-slate-500 hidden sm:inline">当前巡检员:</span>
          <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-semibold text-xs border border-slate-200">
            {currentUser.name} ({currentUser.roleTitle})
          </span>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* 1. 今日巡检测点数 */}
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs text-slate-500 font-medium">今日巡检测点</div>
            <div className="text-2xl font-bold text-slate-900 font-mono mt-1">
              {completedPointsCount} <span className="text-xs text-slate-500 font-normal">/ {totalPointsCount} 点</span>
            </div>
            <div className="text-[11px] text-blue-600 mt-1">标准路线</div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <MapPin className="w-5 h-5" />
          </div>
        </div>

        {/* 2. 巡检打卡完成率 */}
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs text-slate-500 font-medium">打卡完成率</div>
            <div className="text-2xl font-bold text-emerald-700 font-mono mt-1">
              {overallRate}%
            </div>
            <div className="w-28 bg-slate-100 border border-slate-200/80 h-2 rounded-full overflow-hidden mt-1.5">
              <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${overallRate}%` }} />
            </div>
          </div>
          <div className="w-11 h-11 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        {/* 3. 现场异常数 */}
        <div
          className={`card-industrial rounded-lg p-4 flex items-center justify-between shadow-xs ${
            totalAbnormalCount > 0 ? 'bg-rose-50/40 border border-rose-200' : 'bg-white border border-slate-200'
          }`}
        >
          <div>
            <div
              className={`text-xs font-medium flex items-center ${
                totalAbnormalCount > 0 ? 'text-rose-700' : 'text-slate-500'
              }`}
            >
              <span>发现异常测点</span>
              {totalAbnormalCount > 0 && <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping ml-2" />}
            </div>
            <div
              className={`text-2xl font-bold font-mono mt-1 ${
                totalAbnormalCount > 0 ? 'text-rose-700' : 'text-slate-900'
              }`}
            >
              {totalAbnormalCount} <span className="text-xs font-normal text-slate-500">处待治理</span>
            </div>
            <div className={`text-[11px] mt-1 ${totalAbnormalCount > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
              {totalAbnormalCount > 0 ? '超标告警 · 急需闭环' : '平稳正常'}
            </div>
          </div>
          <div
            className={`w-11 h-11 rounded-lg border flex items-center justify-center ${
              totalAbnormalCount > 0
                ? 'bg-rose-100 border-rose-200 text-rose-600'
                : 'bg-slate-100 border border-slate-200 text-slate-600'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>
    </>
  );
};
