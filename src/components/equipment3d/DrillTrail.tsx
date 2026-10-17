// 唯一的下钻路径条（2026-09-23 用户第三轮反馈「太拥挤了」）。
//
// 为什么单独成文件：地图轴（全国地图 / 城市 / 厂区）只有下钻壳看得到，厂区轴（车间 /
// 单设备）只有厂区层看得到，而顶部只许有**一条**面包屑。两边都只依赖这条组件，
// 谁也不 import 谁，避免 DrilldownShell ⇄ EquipmentScene 的运行时循环引用。
//
// 为什么厂区层把它放进工具栏的流里、而不是像壳那样绝对定位在画布正中：
// 绝对定位时它浮在工具栏之上，窄窗口折行会一路往下压到大屏栏（2026-09-23 实测
// 1024px 宽、五级链路时压出 -39px 的重叠）。放进文档流之后，工具栏自己长高、
// 工作区整体下移，「压住下面的卡片」这件事在结构上就不可能发生。
import { X } from "lucide-react";

export interface DrillCrumbNode {
  key: string;
  label: string;
  /** 当前所在节点（高亮、不可点） */
  active: boolean;
  /** 点它回哪一层；不给就是不可点 */
  onGo?: () => void;
  /** 单设备聚焦：尾部挂一个 × 退出（行为同工具栏「返回总览 · Esc」） */
  closable?: boolean;
  /** 节点右上角的小徽标（如演示厂区的「演示」） */
  badge?: string;
}

export function DrillTrail({ nodes }: { nodes: DrillCrumbNode[] }) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-center gap-0.5 rounded-lg border border-cyan-400/25 bg-[rgba(8,15,30,0.85)] px-2 py-1 text-xs backdrop-blur"
      data-testid="equipment3d-drill-trail"
    >
      {nodes.map((node, i) => (
        <span key={node.key} className="flex shrink-0 items-center gap-0.5">
          {i > 0 && <span className="text-slate-600">›</span>}
          <button
            onClick={node.onGo}
            disabled={!node.onGo || node.active}
            className={`max-w-[190px] truncate rounded px-2 py-0.5 transition-colors ${
              node.active ? "bg-cyan-400/15 text-cyan-200" : node.onGo ? "text-slate-400 hover:text-slate-200" : "text-slate-600"
            }`}
          >
            {node.label}
            {node.badge && <span className="ml-1 rounded bg-amber-400/15 px-1 text-[10px] text-amber-300">{node.badge}</span>}
          </button>
          {node.closable && node.onGo && (
            <button
              onClick={node.onGo}
              title="退出单设备聚焦（同工具栏「返回总览 · Esc」）"
              className="rounded p-0.5 text-slate-500 transition-colors hover:text-rose-400"
              data-testid="equipment3d-trail-exit"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
