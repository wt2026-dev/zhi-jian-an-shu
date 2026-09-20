// 三层下钻共用的 HUD 面板积木（全国层 / 城市层同一套观感：边框 + 渐变底 + 图标标题栏）。
// 只负责"真实数据怎么读"，不产生任何数据。
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { DayBucket } from "./mapStats";
import "./drilldown-transitions.css";

export function HudPanel({
  icon: Icon,
  title,
  aside,
  className = "",
  bodyClassName = "",
  children,
}: {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={`hud-data-card dd-hud-card dd-hud-panel pointer-events-auto rounded-lg ${className}`}>
      <div className="dd-hud-head">
        <Icon />
        <span>{title}</span>
        {aside && <span className="ml-auto pl-2 text-[10px] tracking-normal text-slate-500">{aside}</span>}
      </div>
      <div className={`mt-2 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

const TONE: Record<string, string> = {
  cyan: "text-cyan-100",
  rose: "text-rose-300",
  amber: "text-amber-200",
  emerald: "text-emerald-300",
  sky: "text-sky-300",
  slate: "text-slate-200",
};

export function Metric({
  label,
  value,
  unit,
  tone = "cyan",
  size = "lg",
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  tone?: keyof typeof TONE;
  size?: "sm" | "lg";
}) {
  return (
    <div>
      <div
        className={`hud-value-glow hud-tabular-nums font-semibold ${TONE[tone] ?? TONE.cyan} ${
          size === "lg" ? "text-2xl" : "text-base"
        }`}
      >
        {value ?? "—"}
        {value != null && unit && <span className="ml-0.5 text-[10px] font-normal text-slate-500">{unit}</span>}
      </div>
      <div className="mt-0.5 text-[10px] leading-tight text-slate-500">{label}</div>
    </div>
  );
}

/** 标签 + 数值 + 归一化占比条（区域 / 厂区 / 设备状态分布共用） */
export function BarRow({
  label,
  value,
  share,
  color,
  tag,
}: {
  label: string;
  value: ReactNode;
  share: number;
  color: string;
  tag?: ReactNode;
}) {
  return (
    <div className="dd-bar-row">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 flex-none rounded-full" style={{ background: color }} />
        <span className="truncate">{label}</span>
        {tag}
      </span>
      <span className="hud-tabular-nums text-slate-400">{value}</span>
      <span className="dd-bar-track">
        <span
          className="dd-bar-fill"
          style={{ width: `${Math.max(2, Math.min(1, share) * 100)}%`, background: color, boxShadow: `0 0 6px ${color}66` }}
        />
      </span>
    </div>
  );
}

/** 近 N 天真实报修柱状图：0 单的日期保留占位，保证时间轴连续（不补数、不造假） */
export function TrendChart({ buckets }: { buckets: DayBucket[] }) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  return (
    <div>
      <div className="dd-trend">
        {buckets.map((b) => (
          <div key={b.at} className="dd-trend-col" title={`${b.label} · ${b.count} 单`}>
            <div
              className={`dd-trend-bar ${b.count === 0 ? "is-empty" : ""}`}
              style={{ height: b.count === 0 ? 2 : `${Math.round((b.count / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>{buckets[0]?.label}</span>
        <span>峰值 {max || "—"} 单/日</span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="py-2 text-center text-[11px] leading-relaxed text-slate-500">{children}</div>;
}

/** 光柱 / 图例色点 */
export function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />;
}
