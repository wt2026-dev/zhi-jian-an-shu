import React from 'react';
import { SANDBOX_W, SANDBOX_H } from './sandbox';

/**
 * 沙盘的两层纯装饰：底图背板 + 流动光轨。
 *
 * 从 `CockpitDashboardView.tsx` 按行号原样搬出（搬移块与原文逐字节一致）。
 * 两者都不接收 props、不读任何 state —— 搬出去不会改变任何行为。
 */

/** 真实 3D 工业数字孪生全景底图（现代智能重工园区 + 真实透视光影 + 全息微光网格层） */
const TwinBackplate: React.FC = () => (
  <div className="absolute inset-0 w-full h-full overflow-hidden select-none pointer-events-none">
    {/* 真实 3D 渲染高精数字孪生实景大地图 */}
    <img
      src="/assets/digital_twin_map.jpg"
      alt="工业数字孪生全景沙盘"
      className="w-full h-full object-cover object-center transform scale-[1.01] filter contrast-[1.05] brightness-[1.02]"
    />
    {/* 晨曦柔光与全息景深透光层：保持设备管道真实细节的同时，赋予顶级工业科技美学 */}
    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 via-slate-900/15 to-white/10 mix-blend-overlay" />
    <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-slate-950/20" />
    {/* 工业高科技坐标矩阵与刻度十字网 */}
    <div className="absolute inset-0 opacity-30 bg-[linear-gradient(to_right,#0ea5e918_1px,transparent_1px),linear-gradient(to_bottom,#0ea5e918_1px,transparent_1px)] bg-[size:48px_48px]" />
    {/* 四角高科技装甲 HUD 切角标线 */}
    <div className="absolute top-2.5 left-2.5 w-4 h-4 border-t-2 border-l-2 border-amber-400/90 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
    <div className="absolute top-2.5 right-2.5 w-4 h-4 border-t-2 border-r-2 border-amber-400/90 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
    <div className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b-2 border-l-2 border-amber-400/90 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
    <div className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b-2 border-r-2 border-amber-400/90 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
  </div>
);

/** 流动光轨：巡检（金）与物料输送（青）两条粒子流路径 */
const TwinFlowRoutes: React.FC = () => (
  <svg
    className="absolute inset-0 w-full h-full pointer-events-none"
    viewBox={`0 0 ${SANDBOX_W} ${SANDBOX_H}`}
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path
      d="M 96 302 C 220 268, 300 340, 440 300 S 660 266, 800 306 S 918 342, 982 300"
      fill="none"
      stroke="#E8A33D"
      strokeWidth="2.5"
      opacity="0.85"
      className="flow-line flow-glow"
    />
    <path
      d="M 60 382 C 200 352, 320 402, 480 372 S 720 346, 882 388"
      fill="none"
      stroke="#0EA5E9"
      strokeWidth="2.5"
      opacity="0.8"
      className="flow-line flow-line-slow flow-glow"
    />
  </svg>
);

export { TwinBackplate, TwinFlowRoutes };
