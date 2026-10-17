/**
 * 驾驶舱沙盘的坐标系与设备状态语义。
 *
 * 从 `CockpitDashboardView.tsx` 按行号原样搬出（搬移块与原文逐字节一致），
 * 只为把 1750 行的巨型视图压下来。**纯常量 + 纯函数，无 React 依赖。**
 */

/** 沙盘设备状态语义（浅底深字，与全站状态色规范对齐） */
const SANDBOX_STATUS: Record<
  string,
  { label: string; dot: string; ring: string; text: string; chip: string }
> = {
  running: { label: '正常运行', dot: '#10b981', ring: 'rgba(16,185,129,0.55)', text: '#047857', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  warning: { label: '预警关注', dot: '#f59e0b', ring: 'rgba(245,158,11,0.55)', text: '#b45309', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  fault: { label: '故障待修', dot: '#ef4444', ring: 'rgba(239,68,68,0.55)', text: '#b91c1c', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  overhauling: { label: '检修中', dot: '#3b82f6', ring: 'rgba(59,130,246,0.55)', text: '#1d4ed8', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  standby: { label: '停机备用', dot: '#64748b', ring: 'rgba(100,116,139,0.45)', text: '#475569', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  scrapped: { label: '已报废', dot: '#94a3b8', ring: 'rgba(148,163,184,0.40)', text: '#64748b', chip: 'bg-slate-100 text-slate-500 border-slate-200' },
};
const sandboxStatus = (s: string) => SANDBOX_STATUS[s] || SANDBOX_STATUS.standby;

/** 沙盘坐标系：底图 SVG 与设备锚点共用 1000×420 视图，锚点按百分比落位 */
const SANDBOX_W = 1000;
const SANDBOX_H = 420;
const ANCHOR_POS: [number, number][] = [
  [130, 296], [205, 322], [285, 292], [360, 330],
  [440, 300], [515, 336], [590, 298], [665, 330],
  [740, 300], [815, 334], [890, 296], [955, 330],
  [250, 372], [400, 386], [620, 372], [790, 384],
];
const anchorPct = (i: number) => {
  const [x, y] = ANCHOR_POS[i % ANCHOR_POS.length];
  return { left: `${(x / SANDBOX_W) * 100}%`, top: `${(y / SANDBOX_H) * 100}%` };
};

export { SANDBOX_STATUS, sandboxStatus, SANDBOX_W, SANDBOX_H, ANCHOR_POS, anchorPct };
