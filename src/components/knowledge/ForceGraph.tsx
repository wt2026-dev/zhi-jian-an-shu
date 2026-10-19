/**
 * ForceGraph —— 零依赖自研 SVG 力导向图。
 *
 * 背景：本项目此前同时引入 echarts（知识图谱的 force graph + 合规折线图）与 recharts
 * （驾驶舱/遥测折线图）两套图表库。折线图 recharts 完全覆盖，力导向图是 echarts 唯一
 * 不可替代的使用点；为收敛双图表库、砍掉全量 `import * as echarts`（约 1MB 打包体积），
 * 这里用 ~250 行纯 SVG + 简易力模拟替代。
 *
 * 量级假设：知识图谱节点 ≤ 数百。O(n²) 斥力 + 弹簧同步模拟 260 轮在此量级下毫秒级，
 * 无需 rAF 动画循环。布局确定性：初始位置按索引排布于同心圆，不引入随机数，测试可复现。
 *
 * 交互：节点拖拽（拖拽后局部松弛 30 轮）、滚轮缩放（指针为中心）、空白处拖拽平移、
 * 节点点选回调、原生 <title> 悬浮提示。
 */
import React, { useMemo, useRef, useState } from 'react';

export interface ForceGraphNode {
  id: string;
  label: string;
  color: string;
  /** 节点半径（虚拟坐标） */
  radius: number;
  /** 悬浮提示（原生 <title>，可多行） */
  tooltip?: string;
}

export interface ForceGraphEdge {
  source: string;
  target: string;
  /** 连线中点的关系标签 */
  label?: string;
  tooltip?: string;
}

export interface ForceGraphProps {
  nodes: ForceGraphNode[];
  edges: ForceGraphEdge[];
  /** 左上角图例 */
  legend?: { label: string; color: string }[];
  onNodeClick?: (id: string) => void;
  className?: string;
}

/** 虚拟画布：固定 viewBox，实际缩放交给浏览器与内部 pan/zoom 变换 */
const W = 1000;
const H = 620;
const CX = W / 2;
const CY = H / 2;
const PAD = 70;

// 力学参数（模拟后整体 fit 进画布，常数无需精确）
const REPULSION = 26000;
const SPRING_LENGTH = 130;
const SPRING_K = 0.035;
const GRAVITY = 0.02;
const DAMPING = 0.85;
const MAX_SPEED = 24;
const LAYOUT_TICKS = 260;
const DRAG_RELAX_TICKS = 30;

interface Pt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

/** 在 pts 上原地跑 ticks 轮力模拟（斥力 + 弹簧 + 向心 + 阻尼） */
function simulate(nodes: ForceGraphNode[], edges: ForceGraphEdge[], pts: Pt[], ticks: number): void {
  const idx = new Map(nodes.map((n, i) => [n.id, i] as const));
  for (let t = 0; t < ticks; t++) {
    // 两两斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = pts[j].x - pts[i].x;
        let dy = pts[j].y - pts[i].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // 完全重叠时给一个确定性的微小扰动，避免除零后永远重叠
          dx = ((i + j) % 7) - 3 || 1;
          dy = ((j - i) % 5) - 2 || 1;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = REPULSION / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        pts[i].vx -= fx;
        pts[i].vy -= fy;
        pts[j].vx += fx;
        pts[j].vy += fy;
      }
    }
    // 边弹簧
    for (const e of edges) {
      const a = idx.get(e.source);
      const b = idx.get(e.target);
      if (a == null || b == null || a === b) continue;
      const dx = pts[b].x - pts[a].x;
      const dy = pts[b].y - pts[a].y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const f = (d - SPRING_LENGTH) * SPRING_K;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      pts[a].vx += fx;
      pts[a].vy += fy;
      pts[b].vx -= fx;
      pts[b].vy -= fy;
    }
    // 向心力 + 积分
    for (let i = 0; i < nodes.length; i++) {
      const p = pts[i];
      p.vx += (CX - p.x) * GRAVITY;
      p.vy += (CY - p.y) * GRAVITY;
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > MAX_SPEED) {
        p.vx = (p.vx / sp) * MAX_SPEED;
        p.vy = (p.vy / sp) * MAX_SPEED;
      }
      if (!p.fixed) {
        p.x += p.vx;
        p.y += p.vy;
      }
      p.vx = 0;
      p.vy = 0;
    }
  }
}

/** 初始布局：按索引排布于同心圆（确定性，无随机） */
function initPositions(nodes: ForceGraphNode[]): Pt[] {
  const r0 = 200;
  return nodes.map((_, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
    const r = r0 * (0.55 + 0.45 * ((i % 5) / 4));
    return { x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r, vx: 0, vy: 0 };
  });
}

/** 计算把包围盒 fit 进画布的变换（留 PAD 边距） */
function fitTransform(nodes: ForceGraphNode[], pts: Pt[]): { x: number; y: number; k: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((n, i) => {
    minX = Math.min(minX, pts[i].x - n.radius);
    minY = Math.min(minY, pts[i].y - n.radius);
    maxX = Math.max(maxX, pts[i].x + n.radius);
    maxY = Math.max(maxY, pts[i].y + n.radius);
  });
  if (!isFinite(minX) || maxX <= minX || maxY <= minY) return { x: 0, y: 0, k: 1 };
  const k = Math.min((W - PAD * 2) / (maxX - minX), (H - PAD * 2) / (maxY - minY), 1.6);
  return {
    k,
    x: CX - ((minX + maxX) / 2) * k,
    y: CY - ((minY + maxY) / 2) * k,
  };
}

function truncateLabel(name: string): string {
  return name.length > 6 ? name.slice(0, 5) + '..' : name;
}

export const ForceGraph: React.FC<ForceGraphProps> = ({ nodes, edges, legend, onNodeClick, className }) => {
  // 布局：数据变化时同步重算（确定性初始位置 → 力模拟 → fit 变换）
  const layout = useMemo(() => {
    const pts = initPositions(nodes);
    simulate(nodes, edges, pts, LAYOUT_TICKS);
    const posById = new Map(nodes.map((n, i) => [n.id, { x: pts[i].x, y: pts[i].y }] as const));
    return { posById, view: fitTransform(nodes, pts) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // 运行期可变状态：拖拽/缩放/平移（不触发重布局，只在虚拟坐标上动）
  const [view, setView] = useState(layout.view);
  const [dragPos, setDragPos] = useState<Map<string, { x: number; y: number }>>(new Map());
  const svgRef = useRef<SVGSVGElement | null>(null);
  const interaction = useRef<{
    mode: 'none' | 'pan' | 'node';
    nodeId?: string;
    moved: number;
    lastX: number;
    lastY: number;
  }>({ mode: 'none', moved: 0, lastX: 0, lastY: 0 });

  const toVirtual = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    // viewBox 缩放比：虚拟坐标 = (client - rect) / rect.size * viewBox.size，再逆 pan/zoom
    const vx = ((clientX - rect.left) / rect.width) * W;
    const vy = ((clientY - rect.top) / rect.height) * H;
    return { x: (vx - view.x) / view.k, y: (vy - view.y) / view.k };
  };

  const handlePointerDown = (e: React.PointerEvent, nodeId?: string) => {
    interaction.current = { mode: nodeId ? 'node' : 'pan', nodeId, moved: 0, lastX: e.clientX, lastY: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const it = interaction.current;
    if (it.mode === 'none') return;
    const dx = e.clientX - it.lastX;
    const dy = e.clientY - it.lastY;
    it.moved += Math.hypot(dx, dy);
    it.lastX = e.clientX;
    it.lastY = e.clientY;
    if (it.mode === 'pan') {
      setView((v) => ({ ...v, x: v.x + dx * (W / (svgRef.current?.clientWidth || W)), y: v.y + dy * (H / (svgRef.current?.clientHeight || H)) }));
      return;
    }
    if (it.mode === 'node' && it.nodeId) {
      const p = toVirtual(e.clientX, e.clientY);
      setDragPos((prev) => {
        const next = new Map(prev);
        next.set(it.nodeId!, { x: p.x, y: p.y });
        return next;
      });
    }
  };

  const handlePointerUp = () => {
    const it = interaction.current;
    if (it.mode === 'node' && it.nodeId && it.moved > 4) {
      // 拖拽后局部松弛：以当前布局为基础再跑 30 轮，让邻居跟上来
      const pts: Pt[] = nodes.map((n) => {
        const base = dragPos.get(n.id) ?? layout.posById.get(n.id)!;
        return { x: base.x, y: base.y, vx: 0, vy: 0, fixed: n.id === it.nodeId };
      });
      simulate(nodes, edges, pts, DRAG_RELAX_TICKS);
      const posById = new Map(nodes.map((n, i) => [n.id, { x: pts[i].x, y: pts[i].y }] as const));
      setDragPos(new Map(posById));
    }
    // 注意：不在这里重置 moved —— click 事件在 pointerup 之后触发，
    // moved 要保留到 click 判断「拖拽不触发点选」用完后，由下一次 pointerdown 归零。
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const k = Math.min(Math.max(v.k * factor, 0.5), 3);
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { ...v, k };
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      // 指针位置在缩放前后保持不动：p = (s - t)/k → t' = s - p*k'
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
    });
  };

  const handleClickNode = (id: string) => {
    if (interaction.current.moved > 4) return; // 拖拽结束不触发点选
    onNodeClick?.(id);
  };

  const posOf = (id: string) => dragPos.get(id) ?? layout.posById.get(id);

  return (
    <div className={`relative w-full h-full ${className || ''}`}>
      {legend && legend.length > 0 && (
        <div className="absolute top-3 left-4 z-10 flex items-center gap-3 bg-white/80 backdrop-blur-sm rounded-lg border border-slate-200 px-3 py-1.5">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full touch-none select-none cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => handlePointerDown(e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <defs>
          <marker id="fg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="rgba(148, 163, 184, 0.85)" />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* 连线层 */}
          {edges.map((e, i) => {
            const a = posOf(e.source);
            const b = posOf(e.target);
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <g key={`e-${i}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(148, 163, 184, 0.6)" strokeWidth={1.5} markerEnd="url(#fg-arrow)">
                  {e.tooltip && <title>{e.tooltip}</title>}
                </line>
                {e.label && (
                  <text x={mx} y={my - 4} textAnchor="middle" fontSize={10} fill="#64748b" stroke="#ffffff" strokeWidth={3} paintOrder="stroke">
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}
          {/* 节点层 */}
          {nodes.map((n) => {
            const p = posOf(n.id);
            if (!p) return null;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className="cursor-pointer"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  handlePointerDown(e, n.id);
                }}
                onClick={() => handleClickNode(n.id)}
              >
                <circle r={n.radius} fill={n.color} stroke="#ffffff" strokeWidth={2} style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.12))' }}>
                  {n.tooltip && <title>{n.tooltip}</title>}
                </circle>
                <text textAnchor="middle" dy="0.35em" fontSize={n.radius >= 24 ? 11 : 10} fontWeight={n.radius >= 24 ? 'bold' : 'normal'} fill="#ffffff" pointerEvents="none">
                  {truncateLabel(n.label)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
};
