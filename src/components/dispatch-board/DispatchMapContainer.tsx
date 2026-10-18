import React from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import {
  EquipmentPoint,
  DutyTechnician,
  DispatchRecommendationItem,
} from '../../api';
import { AmapDispatchMap } from '../AmapDispatchMap';
import { DispatchSvgPlan } from './DispatchSvgPlan';
import { RegionBox } from './dispatchTypes';

interface DispatchMapContainerProps {
  boardLoading: boolean;
  hasAmapKey: boolean;
  amapFailed: boolean;
  regions: RegionBox[];
  equipmentPoints: EquipmentPoint[];
  technicians: DutyTechnician[];
  selectedEqPoint?: EquipmentPoint;
  recommendations: DispatchRecommendationItem[];
  hoverTech: DutyTechnician | null;
  hoverEq: EquipmentPoint | null;
  onFailAmap: () => void;
  onHoverTech: (t: DutyTechnician | null) => void;
  onHoverEq: (eq: EquipmentPoint | null) => void;
}

export const DispatchMapContainer: React.FC<DispatchMapContainerProps> = ({
  boardLoading,
  hasAmapKey,
  amapFailed,
  regions,
  equipmentPoints,
  technicians,
  selectedEqPoint,
  recommendations,
  hoverTech,
  hoverEq,
  onFailAmap,
  onHoverTech,
  onHoverEq,
}) => {
  const isAmapActive = hasAmapKey && !amapFailed;

  return (
    <div className="glass-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-bold text-slate-900 flex items-center">
          <MapPin className="w-4 h-4 mr-1.5 text-blue-600" />
          {isAmapActive ? '厂区地图调度' : '厂区平面调度图'}
          <span className="ml-2 text-[10px] text-slate-500 font-mono">
            {isAmapActive
              ? '高德地图 · 真实经纬度 · 球面距离'
              : '0~1000 归一化坐标 · 降级示意图'}
          </span>
        </h2>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-1 animate-pulse" />
            故障设备
          </span>
          <span className="flex items-center">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1" />
            空闲师傅
          </span>
          <span className="flex items-center">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 mr-1" />
            在岗巡检
          </span>
        </div>
      </div>

      {boardLoading ? (
        <div className="h-[420px] flex items-center justify-center text-slate-500 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
          加载厂区数据…
        </div>
      ) : isAmapActive ? (
        <AmapDispatchMap
          equipmentPoints={equipmentPoints}
          technicians={technicians}
          selectedEqPoint={selectedEqPoint}
          recommendations={recommendations}
          onFail={onFailAmap}
          onHoverTech={onHoverTech}
          onHoverEq={onHoverEq}
        />
      ) : (
        <DispatchSvgPlan
          hasAmapKey={hasAmapKey}
          amapFailed={amapFailed}
          regions={regions}
          equipmentPoints={equipmentPoints}
          technicians={technicians}
          selectedEqPoint={selectedEqPoint}
          recommendations={recommendations}
          hoverTech={hoverTech}
          hoverEq={hoverEq}
          onHoverTech={onHoverTech}
          onHoverEq={onHoverEq}
        />
      )}
    </div>
  );
};
