import React from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Send } from 'lucide-react';
import { Hazard } from '../../types';
import { getStatusBadge } from './hazardTypes';

interface HazardCardListProps {
  hazards: Hazard[];
  isLoading: boolean;
  canOperate: boolean;
  onSelectHazard: (hazard: Hazard) => void;
  onAssign: (hazard: Hazard) => void;
  onVerify: (hazard: Hazard) => void;
}

export const HazardCardList: React.FC<HazardCardListProps> = ({
  hazards,
  isLoading,
  canOperate,
  onSelectHazard,
  onAssign,
  onVerify,
}) => {
  return (
    <div className="space-y-3">
      {hazards.map((hazard) => {
        const isMajor = hazard.level === 'major';

        return (
          <div
            key={hazard.id}
            onClick={() => onSelectHazard(hazard)}
            className={`p-4 rounded-lg border transition-all cursor-pointer shadow-xs ${
              isMajor
                ? 'bg-rose-50/40 border-rose-200 hover:border-rose-300'
                : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Major Pin Badge */}
                  {isMajor && (
                    <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold flex items-center space-x-1 shadow-xs">
                      <AlertTriangle className="w-3 h-3" />
                      <span>重大隐患 · 厂级督办</span>
                    </span>
                  )}

                  <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-semibold">
                    {hazard.code}
                  </span>

                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] border border-slate-200 font-medium">
                    {hazard.category}
                  </span>

                  {getStatusBadge(hazard.status)}
                </div>

                <h3 className="text-sm font-bold text-slate-900 flex items-center">
                  <span>{hazard.title}</span>
                </h3>

                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                  {hazard.description}
                </p>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1">
                  <span>关联设备: <strong className="text-slate-800 font-medium">{hazard.equipment_name || '公共区域'}</strong></span>
                  <span>区域: <span className="text-slate-700">{hazard.location || '厂区'}</span></span>
                  <span>上报人: <span className="text-slate-700">{hazard.reported_by}</span></span>
                  <span>要求整改期限: <strong className="text-orange-700 font-mono font-bold">{hazard.deadline || '即刻处置'}</strong></span>
                  {hazard.rectifier && (
                    <span>责任技师: <strong className="text-blue-700 font-medium">{hazard.rectifier}</strong></span>
                  )}
                </div>
              </div>

              {/* Right Action Button */}
              <div className="flex items-center space-x-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                {canOperate && hazard.status === 'pending' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssign(hazard);
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center space-x-1 shadow-xs cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>下发整改单</span>
                  </button>
                )}

                {canOperate && hazard.status === 'verifying' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onVerify(hazard);
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center space-x-1 shadow-xs cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>复核销号</span>
                  </button>
                )}

                <button className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs border border-slate-200 flex items-center space-x-1 cursor-pointer font-medium shadow-xs">
                  <span>处理详情</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {hazards.length === 0 && !isLoading && (
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500 shadow-xs">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-emerald-600" />
          <p className="text-sm text-slate-800 font-semibold">该状态下暂无安全隐患</p>
          <p className="text-xs text-slate-500 mt-1">安全防线保持平稳，继续落实日常巡检与预防性维护</p>
        </div>
      )}
    </div>
  );
};
