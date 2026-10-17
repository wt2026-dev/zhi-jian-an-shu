/**
 * 3D 车间「彩色可视化层」图例 —— 悬浮在画面下沿（停靠位由调用方给），一眼看懂每种颜色 / 线型代表什么。
 *
 * 背景：车间地面上同时叠加了 7 种彩色可视化层（故障环 / 恢复环 / 技师轨迹 /
 * 派工指引虚线 / 冷却水粒子 / 油路粒子 / 安全边界），此前既没有图例也没有开关，
 * 用户无法区分颜色含义，视觉上也互相干扰。本组件只负责"把颜色语言讲清楚"：
 *   - 每行 = 一块 SVG 样例（真实线型：实线 / 虚线 / 脉冲环 / 粒子）+ 中文说明；
 *   - 行内样例与 3D 里的实际配色一一对应（改配色时两边要一起改）；
 *   - 开关关掉的层在图例里变暗并标注「已关」，避免"图例说有、画面上没有"的困惑。
 *
 * 布局约定（与 ProductionHUD / 右侧详情面板共存）：
 *   - 宽 220px；**停靠位置完全由调用方给的 `className` 决定**（含 left/right 与 bottom，
 *     默认 `left-3 bottom-3`），组件内部不再写死 bottom —— 上一版把 `bottom-3` 写死在
 *     容器上，调用方再传 `bottom-20` 会得到两个同优先级类，谁生效取决于样式表顺序。
 *   - 厂区层（L1）现在停在「底部 KPI 卡片右侧、右侧指标面板左侧」：右面板是
 *     top-[110px] 起、可长到容器底部上方 74px 的滚动列表，图例若贴 right-3 必然
 *     与它同列相交；横向让开一个面板宽（250）+ 间隙，两条要求同时成立；
 *   - 车间 / 聚焦层仍留在左侧：HUD 左侧功能菜单占 left 10px + 240px，
 *     图例整体让到菜单右侧（left 262px = 10 + 240 + 12），HUD 关闭时才用 left 12px；
 *   - **纵向会自动避让底部中间的 HUD 面板**（见 useAutoLift）：那块「工序达成与交付
 *     表盘」是 `bottom-2.5 left-1/2 z-20` 且默认展开，写死 bottom 值不可靠，
 *     所以量一次它的顶边再把图例抬上去（只往上抬，不会低过调用方给的停靠位）；
 *   - 深色半透明底 rgba(15,23,42,0.85) + 圆角 8px；
 *   - z-index 取 10，**低于**右侧详情面板（z-20）与左侧菜单（z-20）。
 *
 * 纯展示组件：不持有任何业务状态，开关状态由 EquipmentScene 通过 props 传入。
 * （自动避让只读 DOM 几何、只写自己的 `style.bottom`，不碰任何业务状态。）
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ListTree } from 'lucide-react';

/** 图例宽度（px）。自动避让要按它算水平相交，所以提成常量而不是只写在 class 里。 */
const LEGEND_WIDTH = 220;
/** 兜底贴底距离（px）：只在读不到停靠位时使用，正常停靠位由调用方的 bottom-* 类给出。 */
const LEGEND_BOTTOM_DEFAULT = 12;
/** 抬升后与遮挡面板之间保留的间隙 */
const LIFT_GAP = 10;

/**
 * 把图例抬到"会压住它的底部浮层"之上。
 *
 * 为什么不用写死的 bottom：遮挡它的「工序达成与交付表盘」可折叠（高度 ~30px ↔ ~194px），
 * 视口高度也会随 HUD 状态变化（实测同一窗口下 3D 视口从 672px 变到 563px），
 * 任何固定值都会在某个状态下失效。
 *
 * 判据（全部用视口坐标，避免和 offsetParent 的坐标系混用）：
 *   ① 绝对定位、z-index 比图例高（比它低的压不住它）；
 *   ② 不是全屏铺底容器（`inset-0` 的视口/HUD 包裹层装着图例，不算遮挡）；
 *   ③ 贴着底边（`hostBottom - panelBottom <= 48`）—— 只避让底部条，不避让顶部/侧边面板；
 *   ④ 与图例水平相交。
 * 只读几何、只写自己的 `style.bottom`，且水平范围取自 `getBoundingClientRect().left/right`
 * （改 bottom 不会改它），所以不会自我触发成循环。
 */
function useAutoLift(ref: React.RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const host = el.closest('.industrial-workspace') as HTMLElement | null;
    if (!host) return;

    const observed = new Set<Element>();
    const ro = new ResizeObserver(() => apply());
    let lastBottom = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    function apply(): void {
      const hostRect = host!.getBoundingClientRect();
      if (!hostRect.height) return; // jsdom / 未布局：直接跳过，别把样式写坏
      const mine = el!.getBoundingClientRect();
      const selfZ = Number(getComputedStyle(el!).zIndex) || 0;
      let blockTop = Infinity;

      for (const n of Array.from(host!.querySelectorAll<HTMLElement>('div'))) {
        if (n === el || el!.contains(n) || n.contains(el!)) continue;
        const cs = getComputedStyle(n);
        if (cs.position !== 'absolute') continue;
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        if ((Number(cs.zIndex) || 0) <= selfZ) continue;
        const b = n.getBoundingClientRect();
        // 尺寸门槛比最终判据松：面板是**长出来的**（表盘数据到位才撑开），
        // 先在它还小的时候就把它纳入观察，否则永远等不到它变大的那一刻。
        if (b.width < 40 || b.height < 8) continue;
        if (b.width * b.height >= hostRect.width * hostRect.height * 0.95) continue;
        if (hostRect.bottom - b.bottom > 48) continue;
        if (b.right <= mine.left || b.left >= mine.right) continue;
        if (b.top < blockTop) blockTop = b.top;
        // 面板尺寸会变（折叠 / 数据到位），观察它本身 —— 只观察 host 抓不到。
        if (!observed.has(n)) {
          observed.add(n);
          ro.observe(n);
        }
      }

      /**
       * 停靠位（调用方 className 里的 bottom-*）换算成 px。
       * 读之前先把内联值清空，否则读到的是上一次抬升的结果，抬升会逐次累加。
       */
      function dockBottomPx(): number {
        const inline = el!.style.bottom;
        el!.style.bottom = '';
        const v = Number.parseFloat(getComputedStyle(el!).bottom);
        el!.style.bottom = inline;
        return Number.isFinite(v) ? v : LEGEND_BOTTOM_DEFAULT;
      }

      const need = Number.isFinite(blockTop)
        ? Math.round(hostRect.bottom - blockTop + LIFT_GAP)
        : NaN;
      // 只往上抬：低过停靠位就没有"避让"，反而把图例从右下角拽到中部面板底下。
      const next = Number.isFinite(need) ? `${Math.max(dockBottomPx(), need)}px` : '';
      if (next !== lastBottom) {
        lastBottom = next;
        el!.style.bottom = next;
      }
    }

    /** DOM 变动（HUD 面板迟挂载 / 内容撑开）后再量一次；合并到 300ms 一次，别每帧扫 DOM。 */
    const schedule = (): void => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        apply();
      }, 300);
    };

    apply();
    ro.observe(host);
    // 只监听 childList（不监听 attributes）：本函数写的是自己的 style.bottom，
    // 若监听 attributes 会自我触发。childList 不受影响。
    const mo = new MutationObserver(schedule);
    mo.observe(host, { childList: true, subtree: true });
    return () => {
      if (timer) clearTimeout(timer);
      mo.disconnect();
      ro.disconnect();
    };
  }, [ref]);
}

/** 图例行标识（也是自动化验收读取的稳定钩子） */
export type LegendLayerKey =
  | 'faultRing'
  | 'recoveryRing'
  | 'workerTrail'
  | 'dispatchGuide'
  | 'coolingWater'
  | 'oilFlow'
  | 'safetyBoundary';

/**
 * 图例行归属的图层开关（决定该行是否显示「已关」）。
 * guide 与 workers 分开：派工指引虚线在聚焦层里即使总开关关着也会出现
 * （选中设备即高亮该设备相关链路），所以它需要独立的"实际是否在画面上"状态。
 */
export type LegendToggleKey = 'faultLocator' | 'workers' | 'guide' | 'fluid' | 'safety';

type SwatchKind =
  | 'ringRed'
  | 'ringGreen'
  | 'lineSolid'
  | 'lineDashed'
  | 'particlesCyan'
  | 'particlesAmber'
  | 'boundaryYellow';

interface LegendRow {
  key: LegendLayerKey;
  /** 颜色 + 线型，如「红色脉冲环」 */
  name: string;
  /** 含义说明，如「设备故障定位（轴承 / 振动异常）」 */
  desc: string;
  toggle: LegendToggleKey;
  swatch: SwatchKind;
}

/**
 * 7 行图例。顺序按"离故障处理越近越靠上"排：故障 → 恢复 → 人 → 介质 → 安全区。
 * 颜色取自场景实际材质：
 *   故障环 0xef4444 / 0xf87171，恢复环 0x22c55e / 0x4ade80，
 *   技师轨迹与派工指引 0x3b82f6（工单完成时指引线转 0x22c55e），
 *   冷却水 0x38bdf8，油路 0xfbbf24，安全边界 0xfacc15。
 */
const ROWS: LegendRow[] = [
  { key: 'faultRing', name: '红色脉冲环', desc: '设备故障定位（轴承 / 振动异常）', toggle: 'faultLocator', swatch: 'ringRed' },
  { key: 'recoveryRing', name: '绿色环', desc: '检修中 / 已恢复', toggle: 'faultLocator', swatch: 'ringGreen' },
  { key: 'workerTrail', name: '蓝色实线', desc: '技师巡检轨迹', toggle: 'workers', swatch: 'lineSolid' },
  { key: 'dispatchGuide', name: '蓝色虚线', desc: '派工指引（技师 → 故障设备）', toggle: 'guide', swatch: 'lineDashed' },
  { key: 'coolingWater', name: '青色粒子流', desc: '冷却水流动', toggle: 'fluid', swatch: 'particlesCyan' },
  { key: 'oilFlow', name: '琥珀粒子流', desc: '油路循环', toggle: 'fluid', swatch: 'particlesAmber' },
  { key: 'safetyBoundary', name: '黄色边界', desc: '安全作业区', toggle: 'safety', swatch: 'boundaryYellow' },
];

/** 线型样例：固定 30x14 视口，行高一致。 */
function Swatch({ kind }: { kind: SwatchKind }): React.ReactElement {
  const common = { width: 30, height: 14, viewBox: '0 0 30 14', fill: 'none' as const, 'aria-hidden': true };
  switch (kind) {
    case 'ringRed':
    case 'ringGreen': {
      const core = kind === 'ringRed' ? '#ef4444' : '#22c55e';
      const halo = kind === 'ringRed' ? '#f87171' : '#4ade80';
      return (
        <svg {...common}>
          <circle cx="15" cy="7" r="5.5" stroke={halo} strokeWidth="1" opacity="0.45" />
          <circle cx="15" cy="7" r="3" stroke={core} strokeWidth="1.6" />
          <circle cx="15" cy="7" r="1" fill={core} opacity="0.9" />
        </svg>
      );
    }
    case 'lineSolid':
      return (
        <svg {...common}>
          <line x1="1" y1="7" x2="29" y2="7" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'lineDashed':
      return (
        <svg {...common}>
          <line x1="1" y1="7" x2="29" y2="7" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />
        </svg>
      );
    case 'particlesCyan':
    case 'particlesAmber': {
      const c = kind === 'particlesCyan' ? '#38bdf8' : '#fbbf24';
      return (
        <svg {...common}>
          <line x1="1" y1="9" x2="29" y2="5" stroke={c} strokeWidth="1" opacity="0.28" />
          <circle cx="5" cy="8.4" r="1.5" fill={c} />
          <circle cx="12" cy="7.4" r="1.5" fill={c} />
          <circle cx="19" cy="6.4" r="1.5" fill={c} />
          <circle cx="26" cy="5.4" r="1.5" fill={c} />
        </svg>
      );
    }
    case 'boundaryYellow':
    default:
      return (
        <svg {...common}>
          <rect x="1.5" y="2" width="27" height="10" rx="1.5" stroke="#facc15" strokeWidth="1.4" strokeDasharray="3 2" />
        </svg>
      );
  }
}

export interface SceneLegendProps {
  /** 各图层当前开关状态；关掉的层在图例里变暗并标注「已关」 */
  layers?: Partial<Record<LegendToggleKey, boolean>>;
  /** 初始折叠态（默认展开，符合"打开页面就能看懂"的诉求） */
  defaultCollapsed?: boolean;
  /**
   * 停靠位置：横向（left-* 或 right-*）与纵向（bottom-*）都由调用方给，
   * 组件本身只负责 absolute。默认停在左下角。
   */
  className?: string;
}

export function SceneLegend({
  layers,
  defaultCollapsed = false,
  className = 'left-3 bottom-3',
}: SceneLegendProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const ref = useRef<HTMLDivElement | null>(null);
  useAutoLift(ref);

  return (
    <div
      ref={ref}
      data-testid="equipment3d-scene-legend"
      data-collapsed={collapsed ? 'true' : 'false'}
      role="group"
      aria-label="3D 场景可视化图层图例"
      // 圆角显式写 8px：本项目的 --radius-lg 被主题改成 20px，rounded-lg 拿不到 8px。
      // 宽度与 useAutoLift 的 LEGEND_WIDTH 同源，避免两处各写一个数字后悄悄不一致。
      // 停靠位（left/right + bottom）全部来自 className：这里再写一个 bottom-3 会和
      // 调用方的 bottom-20 打架，谁生效取决于样式表顺序而不是这里的意图。
      className={`pointer-events-auto absolute z-10 rounded-[8px] border border-white/10 text-slate-200 backdrop-blur-sm ${className}`}
      style={{ background: 'rgba(15, 23, 42, 0.85)', width: LEGEND_WIDTH }}
    >
      {/* 标题行：点击收起 / 展开 */}
      <button
        type="button"
        data-testid="equipment3d-scene-legend-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? '展开图例' : '收起图例'}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left rounded-t-[8px] hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-slate-200">
          <ListTree className="w-3 h-3 text-cyan-400" />
          可视化图层图例
          <span className="text-slate-400 font-normal">7 层</span>
        </span>
        {collapsed ? (
          <ChevronUp className="w-3 h-3 shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="w-3 h-3 shrink-0 text-slate-400" />
        )}
      </button>

      {!collapsed && (
        <div className="px-2.5 pb-2 pt-1 flex flex-col gap-1 border-t border-white/10">
          {ROWS.map((row) => {
            const on = layers?.[row.toggle] !== false;
            return (
              <div
                key={row.key}
                data-legend-row={row.key}
                data-layer-on={on ? 'true' : 'false'}
                className={`flex items-start gap-2 transition-opacity ${on ? '' : 'opacity-40'}`}
              >
                <span className="shrink-0 mt-[1px]">
                  <Swatch kind={row.swatch} />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="text-[10px] text-slate-100">{row.name}</span>
                  <span className="text-[10px] text-slate-400"> — {row.desc}</span>
                  {!on && <span className="ml-1 text-[9px] text-slate-500">（已关）</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SceneLegend;
