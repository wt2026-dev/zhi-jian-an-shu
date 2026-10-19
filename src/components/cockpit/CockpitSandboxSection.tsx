import React from 'react';
import {
  Layers,
  Target,
  Clock,
  Radio,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { Equipment } from '../../types';
import { TwinScene3D, Anchor3D, TwinDataSign } from '../digital-twin/TwinScene3D';
import { sandboxStatus } from './sandbox';

export interface CockpitSandboxSectionProps {
  anchor3DList: Anchor3D[];
  handleAnchorProject: (screen: { x: number; y: number; visible: boolean }[]) => void;
  twinDataSigns: TwinDataSign[];
  sandboxAnchors: { eq: Equipment; left: string; top: string }[];
  anchorProjected: { x: number; y: number; visible: boolean }[];
  sandboxEq: Equipment | null;
  setSandboxEqId: (id: string | null) => void;
  sandboxNodeIdx: number;
  setSandboxNodeIdx: (idx: number) => void;
  sandboxTimeline: { label: string; date: string; detail: string }[];
  activeSandboxNode: { label: string; date: string; detail: string } | null;
  speakSandbox: (text: string) => void;
  onSelectEquipment?: (eq: Equipment) => void;
  onAskAi?: (prompt: string) => void;
}

export const CockpitSandboxSection: React.FC<CockpitSandboxSectionProps> = ({
  anchor3DList,
  handleAnchorProject,
  twinDataSigns,
  sandboxAnchors,
  anchorProjected,
  sandboxEq,
  setSandboxEqId,
  sandboxNodeIdx,
  setSandboxNodeIdx,
  sandboxTimeline,
  activeSandboxNode,
  speakSandbox,
  onSelectEquipment,
  onAskAi,
}) => {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mb-4 items-stretch">
      {/* 沙盘主视图：全景数字孪生基地实景 */}
      <div className="xl:col-span-8 hud-card relative overflow-hidden min-h-[380px] lg:min-h-[460px] rounded-2xl border border-sky-200/70 bg-gradient-to-b from-[#f8fafc] via-[#f1f5f9] to-[#e8eef6] shadow-md group">
        {/* 3D 数字孪生场景（Three.js 程序化工业工厂） */}
        <div className="absolute inset-0 z-0">
          <TwinScene3D
            anchors={anchor3DList}
            onAnchorProject={handleAnchorProject}
            dataSigns={twinDataSigns}
          />
        </div>

        {/* 视口边缘柔光景深蒙版（使 3D 场景边缘与白色界面完美漫射融合） */}
        <div className="pointer-events-none absolute inset-0 z-[1] shadow-[inset_0_0_50px_rgba(241,245,249,0.85)]" />

        {/* 高科技全息精密四角装甲标线 */}
        <div className="pointer-events-none absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-sky-500/80 drop-shadow-[0_0_4px_rgba(14,165,233,0.4)] z-20" />
        <div className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-sky-500/80 drop-shadow-[0_0_4px_rgba(14,165,233,0.4)] z-20" />
        <div className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-sky-500/80 drop-shadow-[0_0_4px_rgba(14,165,233,0.4)] z-20" />
        <div className="pointer-events-none absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-sky-500/80 drop-shadow-[0_0_4px_rgba(14,165,233,0.4)] z-20" />

        {/* 底部全息网格刻度标尺微线 */}
        <div className="pointer-events-none absolute bottom-2 left-10 right-10 z-20 flex items-center justify-between text-[9px] font-mono text-slate-600 tracking-wider">
          <span className="flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
            GRID-COORDINATES: SEC-04 / 3D-HOLOGRAM
          </span>
          <span className="hidden sm:inline-block">ROTATION-TRACKING: ACTIVE</span>
          <span>SCALE: 1:1 REALTIME</span>
        </div>

        {/* 沙盘标题 HUD 胶囊 */}
        <div className="absolute left-4 top-4 z-20 flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1.5 rounded-full bg-white/92 backdrop-blur-md border border-sky-200/90 text-[11px] font-semibold text-slate-800 flex items-center gap-1.5 shadow-sm ring-1 ring-sky-400/20">
            <Layers className="w-3.5 h-3.5 text-sky-600" />
            全景数字孪生智能沙盘
          </span>
          <span className="px-2.5 py-1 rounded-full bg-white/85 backdrop-blur-md border border-cyan-200/80 text-[10px] font-mono text-cyan-700 hidden sm:flex items-center gap-1.5 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-ping" />
            {sandboxAnchors.length} 台设备 · 实时三维锚定
          </span>
        </div>

        {/* 状态图例 HUD 胶囊 */}
        <div className="absolute right-4 top-4 z-20 hidden md:flex items-center gap-3 px-3 py-1.5 rounded-full bg-white/92 backdrop-blur-md border border-slate-200/90 shadow-sm">
          {['running', 'warning', 'fault', 'overhauling'].map((k) => (
            <span key={k} className="flex items-center gap-1 text-[10px] font-medium text-slate-600">
              <span
                className="w-2 h-2 rounded-full ring-1 ring-white"
                style={{ backgroundColor: sandboxStatus(k).dot }}
              />
              {sandboxStatus(k).label}
            </span>
          ))}
        </div>

        {/* 设备锚点：同心圆呼吸脉冲 + 状态点（优先使用3D投影坐标） */}
        {sandboxAnchors.map(({ eq, left, top }, idx) => {
          const meta = sandboxStatus(eq.status);
          const active = sandboxEq?.id === eq.id;
          const proj = anchorProjected[idx];
          // 使用3D投影坐标（如果有且可见），否则回退到2D百分比坐标
          const useProj = proj && proj.visible;
          const posStyle: React.CSSProperties = useProj
            ? { left: `${proj.x}%`, top: `${proj.y}%` }
            : { left, top };
          return (
            <div key={eq.id} style={posStyle} className="absolute w-0 h-0 z-10 transition-[left,top] duration-100">
              <span
                className="absolute w-12 h-12 rounded-full border pulse-ring pointer-events-none"
                style={{ left: 0, top: 0, marginLeft: -24, marginTop: -24, borderColor: meta.ring }}
              />
              <span
                className="absolute w-12 h-12 rounded-full border pulse-ring pulse-ring-2 pointer-events-none"
                style={{ left: 0, top: 0, marginLeft: -24, marginTop: -24, borderColor: meta.ring }}
              />
              <button
                type="button"
                onClick={() => {
                  setSandboxEqId(eq.id);
                  setSandboxNodeIdx(-1);
                }}
                title={`${eq.code} · ${eq.name}`}
                aria-label={`${eq.code} ${eq.name}`}
                className={`absolute rounded-full cursor-pointer transition-all ${
                  active ? 'w-4 h-4 ring-4 ring-sky-400/40 scale-125' : 'w-3 h-3 hover:scale-125 hover:ring-2 hover:ring-sky-300'
                }`}
                style={{
                  left: 0,
                  top: 0,
                  marginLeft: active ? -8 : -6,
                  marginTop: active ? -8 : -6,
                  backgroundColor: meta.dot,
                  boxShadow: `0 0 0 2px #fff, 0 3px 10px ${meta.ring}`,
                }}
              />
              {active && (
                <div
                  className="absolute flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/95 backdrop-blur-md border border-sky-300/80 text-[10px] font-mono font-bold whitespace-nowrap shadow-md pointer-events-none z-20"
                  style={{ left: 0, top: 0, marginLeft: 12, marginTop: -26, color: meta.text }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
                  {eq.code}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 设备情报卡：精炼典雅的次世代 HUD 终端，自适应整洁布局 */}
      <div className="xl:col-span-4 z-20 relative flex flex-col">
        <div className="hud-card p-4 h-full flex flex-col justify-between gap-3 bg-white/95 backdrop-blur-xl border border-sky-200/80 rounded-2xl shadow-sm ring-1 ring-sky-400/10">
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-sky-100/90">
            <div className="min-w-0">
              <div className="text-[10px] text-sky-700 font-semibold flex items-center gap-1">
                <Target className="w-3 h-3 text-sky-500" />
                设备情报 · 全息悬浮 HUD
              </div>
              <div className="text-sm font-bold text-slate-900 truncate mt-0.5">
                {sandboxEq ? sandboxEq.name : '暂无可定位设备'}
              </div>
              <div className="text-[10px] text-slate-500 font-mono truncate">
                {sandboxEq ? `${sandboxEq.code} · ${sandboxEq.workshop} / ${sandboxEq.location}` : '—'}
              </div>
            </div>
            {sandboxEq && (
              <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${sandboxStatus(sandboxEq.status).chip}`}>
                {sandboxStatus(sandboxEq.status).label}
              </span>
            )}
          </div>

          {sandboxEq ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 rounded-xl bg-white/70 border border-slate-100">
                  <span className="text-[9px] text-slate-500 block">健康度</span>
                  <span
                    className={`font-mono font-bold text-lg ${
                      sandboxEq.healthScore == null
                        ? 'text-slate-400'
                        : sandboxEq.healthScore >= 85
                        ? 'text-emerald-600'
                        : sandboxEq.healthScore >= 70
                        ? 'text-amber-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {sandboxEq.healthScore ?? '—'}
                  </span>
                </div>
                <div className="p-2 rounded-xl bg-white/70 border border-slate-100">
                  <span className="text-[9px] text-slate-500 block">重要度</span>
                  <span className="text-[11px] font-bold text-slate-800">{sandboxEq.criticality}</span>
                </div>
                <div className="p-2 rounded-xl bg-white/70 border border-slate-100">
                  <span className="text-[9px] text-slate-500 block">下次巡检</span>
                  <span className="text-[11px] font-mono font-bold text-slate-800">{sandboxEq.nextInspectionDate || '—'}</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>健康度能量条</span>
                  <span className="font-mono">{sandboxEq.healthScore == null ? '未评估' : `${sandboxEq.healthScore} / 100`}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 border border-slate-200/70 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      // 未评估时长度给 0 且用中性灰，不要 Math.max(4, ...) 把它抬成"极差"的 4%
                      width: `${sandboxEq.healthScore == null ? 0 : Math.max(4, Math.min(100, sandboxEq.healthScore))}%`,
                      background: 'linear-gradient(90deg, #F6D08A 0%, #E8A33D 45%, #0EA5E9 100%)',
                    }}
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 flex flex-col">
                <div className="text-[10px] text-slate-500 font-semibold flex items-center gap-1 mb-1">
                  <Clock className="w-3 h-3 text-amber-500" />
                  设备时光长卷（投产 → 技改 → 今日智能态）
                </div>
                <div className="timeline-scroll">
                  {sandboxTimeline.map((n, i) => (
                    <button
                      key={`${n.label}-${i}`}
                      type="button"
                      onClick={() => setSandboxNodeIdx(i)}
                      className={`timeline-node ${sandboxNodeIdx === i ? 'timeline-node-active' : ''}`}
                    >
                      <span className="timeline-dot" />
                      <span className="timeline-label">{n.label}</span>
                      <span className="text-[9px] text-slate-400 font-mono">{n.date}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 p-2.5 rounded-xl bg-white/70 border border-amber-100/80 text-[11px] text-slate-600 leading-relaxed flex-1 overflow-y-auto max-h-24">
                  {activeSandboxNode ? (
                    <>
                      <span className="font-semibold text-amber-800">{activeSandboxNode.label}</span>
                      <span className="text-slate-400 font-mono ml-1.5">{activeSandboxNode.date}</span>
                      <p className="mt-1">{activeSandboxNode.detail}</p>
                    </>
                  ) : (
                    <p>点击上方时间节点可展开该阶段技改/检修详情；点击沙盘上的呼吸锚点可切换设备。</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-amber-100/80">
                <button
                  type="button"
                  onClick={() =>
                    speakSandbox(
                      `${sandboxEq.name}，编号 ${sandboxEq.code}，位于${sandboxEq.workshop}${sandboxEq.location}。当前状态${sandboxStatus(sandboxEq.status).label}，健康度 ${sandboxEq.healthScore} 分，重要度${sandboxEq.criticality}，下次巡检日期 ${sandboxEq.nextInspectionDate || '未安排'}。`
                    )
                  }
                  className="chip-cyan flex-1 justify-center"
                >
                  <Radio className="w-3 h-3" />
                  语音播报
                </button>
                {onSelectEquipment && (
                  <button
                    type="button"
                    onClick={() => onSelectEquipment(sandboxEq)}
                    className="chip-gold flex-1 justify-center"
                  >
                    <ArrowUpRight className="w-3 h-3" />
                    查看档案
                  </button>
                )}
              </div>

              {onAskAi && (
                <button
                  type="button"
                  onClick={() =>
                    onAskAi(
                      `请针对设备「${sandboxEq.name}」（编号 ${sandboxEq.code}，${sandboxEq.workshop}/${sandboxEq.location}）做一次全面诊断：当前状态${sandboxStatus(sandboxEq.status).label}，健康度 ${sandboxEq.healthScore} 分，重要度${sandboxEq.criticality}，型号 ${sandboxEq.model}，厂家 ${sandboxEq.manufacturer}，下次巡检 ${sandboxEq.nextInspectionDate || '未安排'}。请给出故障/劣化趋势研判、3 条优先处置建议，以及需要重点监测的遥测指标。`
                    )
                  }
                  className="w-full py-2 rounded-full btn-gradient text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  问 AI 深入诊断该设备
                </button>
              )}
            </>
          ) : (
            <div className="py-10 text-center text-xs text-slate-500">设备数据加载中…</div>
          )}
        </div>
      </div>
    </div>
  );
};
