import React from 'react';
import {
  EquipmentPoint,
  DutyTechnician,
  DispatchRecommendationItem,
} from '../../api';
import { RegionBox } from './dispatchTypes';

interface DispatchSvgPlanProps {
  hasAmapKey: boolean;
  amapFailed: boolean;
  regions: RegionBox[];
  equipmentPoints: EquipmentPoint[];
  technicians: DutyTechnician[];
  selectedEqPoint?: EquipmentPoint;
  recommendations: DispatchRecommendationItem[];
  hoverTech: DutyTechnician | null;
  hoverEq: EquipmentPoint | null;
  onHoverTech: (t: DutyTechnician | null) => void;
  onHoverEq: (eq: EquipmentPoint | null) => void;
}

export const DispatchSvgPlan: React.FC<DispatchSvgPlanProps> = ({
  hasAmapKey,
  amapFailed,
  regions,
  equipmentPoints,
  technicians,
  selectedEqPoint,
  recommendations,
  hoverTech,
  hoverEq,
  onHoverTech,
  onHoverEq,
}) => {
  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-[#f1f5f9]">
      {hasAmapKey && amapFailed && (
        <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-[10px] text-amber-700">
          地图加载失败（离线或无权限），已回退平面示意图
        </div>
      )}
      <svg
        viewBox="0 0 1000 1000"
        className="w-full h-[420px] md:h-[480px]"
        style={{ transform: 'scaleY(1)' }}
      >
        {/* 网格底纹 */}
        <defs>
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e2e8f0" strokeWidth="1" />
          </pattern>
          <radialGradient id="faultGlow">
            <stop offset="0%" stopColor="rgba(239,68,68,0.45)" />
            <stop offset="100%" stopColor="rgba(239,68,68,0)" />
          </radialGradient>
        </defs>
        <rect width="1000" height="1000" fill="url(#grid)" />

        {/* 车间区域块 */}
        {regions.map((r) => (
          <g key={r.name}>
            <rect
              x={r.x}
              y={r.y}
              width={Math.max(r.w, 60)}
              height={Math.max(r.h, 60)}
              rx={16}
              fill={r.color}
              stroke="#cbd5e1"
              strokeWidth={1.2}
              strokeDasharray="6 4"
            />
            <text x={r.x + 10} y={r.y + 20} fontSize={17} fill="#64748b" fontWeight="600">
              {r.name}
            </text>
          </g>
        ))}

        {/* 推荐连线：选中设备 → 推荐师傅（虚线 + 距离） */}
        {selectedEqPoint &&
          recommendations.slice(0, 3).map((r) => (
            <g key={`line-${r.technician.id}`}>
              <line
                x1={selectedEqPoint.mapX}
                y1={selectedEqPoint.mapY}
                x2={r.technician.mapX}
                y2={r.technician.mapY}
                stroke={r === recommendations[0] ? '#3b82f6' : '#94a3b8'}
                strokeWidth={r === recommendations[0] ? 2.5 : 1.2}
                strokeDasharray="7 5"
              />
              <text
                x={(selectedEqPoint.mapX + r.technician.mapX) / 2}
                y={(selectedEqPoint.mapY + r.technician.mapY) / 2 - 6}
                fontSize={15}
                fill="#475569"
                textAnchor="middle"
              >
                {r.distanceLabel}
              </text>
            </g>
          ))}

        {/* 故障设备点位（红色脉冲） */}
        {equipmentPoints.map((p) => {
          const isFaulty =
            p.openOrders > 0 || ['fault', 'warning', 'overhauling'].includes(p.status);
          return (
            <g
              key={p.id}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => onHoverEq(p)}
              onMouseLeave={() => onHoverEq(null)}
            >
              {isFaulty && <circle cx={p.mapX} cy={p.mapY} r={26} fill="url(#faultGlow)" />}
              <circle
                cx={p.mapX}
                cy={p.mapY}
                r={isFaulty ? 9 : 5.5}
                fill={isFaulty ? '#ef4444' : '#cbd5e1'}
                stroke="#fff"
                strokeWidth={2}
              />
              {isFaulty && (
                <circle
                  cx={p.mapX}
                  cy={p.mapY}
                  r={15}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={2}
                  opacity={0.6}
                >
                  <animate
                    attributeName="r"
                    values="11;20;11"
                    dur="1.8s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.7;0.15;0.7"
                    dur="1.8s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
            </g>
          );
        })}

        {/* 在岗师傅（绿点 + 名字 + 状态角标） */}
        {technicians.map((t) => (
          <g
            key={t.id}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => onHoverTech(t)}
            onMouseLeave={() => onHoverTech(null)}
          >
            <circle
              cx={t.mapX}
              cy={t.mapY}
              r={10}
              fill={t.onlineStatus === 'idle' ? '#10b981' : '#3b82f6'}
              stroke="#fff"
              strokeWidth={2.5}
            />
            <text
              x={t.mapX}
              y={t.mapY - 18}
              fontSize={17}
              fill="#0f172a"
              fontWeight="700"
              textAnchor="middle"
            >
              {t.name}
            </text>
            <rect
              x={t.mapX + 10}
              y={t.mapY - 6}
              width={30}
              height={15}
              rx={7}
              fill={t.onlineStatus === 'idle' ? '#d1fae5' : '#dbeafe'}
              stroke={t.onlineStatus === 'idle' ? '#10b981' : '#3b82f6'}
              strokeWidth={1}
            />
            <text
              x={t.mapX + 25}
              y={t.mapY + 5}
              fontSize={11}
              textAnchor="middle"
              fill="#334155"
            >
              {t.onlineStatus === 'idle' ? '空闲' : '在岗'}
            </text>
          </g>
        ))}
      </svg>

      {/* 悬浮卡片：师傅 */}
      {hoverTech && (
        <div className="absolute top-3 left-3 glass-card p-3 text-xs shadow-lg max-w-[240px] pointer-events-none">
          <p className="font-bold text-slate-800">
            {hoverTech.name} · {hoverTech.roleTitle}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            位置：
            {hoverTech.geoLng != null && hoverTech.geoLat != null
              ? `(${hoverTech.geoLng.toFixed(5)}, ${hoverTech.geoLat.toFixed(5)})`
              : `(${Math.round(hoverTech.mapX)}, ${Math.round(hoverTech.mapY)})`}{' '}
            · {hoverTech.onlineStatus === 'idle' ? '空闲' : '在岗'}
          </p>
          <p className="text-[11px] text-slate-500">
            最近上报：{hoverTech.lastLocationAt || '无记录'}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(hoverTech.skills || []).map((s) => (
              <span
                key={s}
                className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px]"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
      {/* 悬浮卡片：设备 */}
      {hoverEq && !hoverTech && (
        <div className="absolute top-3 left-3 glass-card p-3 text-xs shadow-lg max-w-[240px] pointer-events-none">
          <p className="font-bold text-slate-800">{hoverEq.name}</p>
          <p className="text-[11px] text-slate-500 font-mono">
            {hoverEq.code} · {hoverEq.workshop || '未标定'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            健康分 {hoverEq.healthScore} · 未完结工单 {hoverEq.openOrders}
          </p>
        </div>
      )}
    </div>
  );
};
