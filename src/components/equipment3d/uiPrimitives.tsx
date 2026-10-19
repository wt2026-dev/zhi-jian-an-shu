/**
 * 3D 视图的展示型小组件与文案映射（自 EquipmentScene.tsx 机械切出，2026-10-19）。
 *
 * 切分口径：纯展示、零业务状态 —— 布局/视角/画质/壳层选项，分区在建文案，
 * hex/telemetryFeed 工具函数，以及 Chip/Section/Slider/Toggle 四个面板原语。
 * 它们只依赖 props 与类型导入，不触 hooks，不触场景实例。
 */
import React from 'react';
import { LayoutGrid, CircleDot, Grid3x3 } from 'lucide-react';
import type { ViewKey } from './scene';
import type { QualityKey, LayoutPattern } from './styles';
import type { ShellMode } from './hall';

/* ========================= 文案映射 ========================= */

export const LAYOUT_OPTIONS: Array<{ key: LayoutPattern; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'grid', label: '网格', icon: LayoutGrid },
  { key: 'ring', label: '环形', icon: CircleDot },
  { key: 'wall', label: '沿墙', icon: Grid3x3 },
];

export const VIEW_OPTIONS: Array<{ key: ViewKey; label: string }> = [
  { key: 'orbit', label: '环绕' },
  { key: 'overhead', label: '俯瞰' },
  { key: 'iso', label: '等轴' },
  { key: 'closeup', label: '特写' },
];

export const QUALITY_OPTIONS: QualityKey[] = ['low', 'medium', 'high'];

export const SHELL_OPTIONS: Array<{ key: ShellMode; label: string; hint: string }> = [
  { key: 'full', label: '完整', hint: '完整墙顶，适合看厂房外观' },
  { key: 'ghost', label: '半透明', hint: '墙顶半透明，默认：既能看见厂房体量也能看见内部设备' },
  { key: 'none', label: '隐藏', hint: '只留柱网与桁架，纯粹观察内部布局' },
];

/**
 * 分区"在建工程"标牌文案——对应厂区层里那台真实画出来的塔吊+脚手架，
 * 只是位置说明文案，不参与任何指标计算。
 */
export const ZONE_NOTES = [
  '二期智能仓储与管廊工程（进度 85%）',
  '重型机加生产线扩建中',
  '微电网储能站调试并网中',
];

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Clear gaps explicitly instead of retaining previous samples or estimating load. */
export function telemetryFeed(status: string, sample?: { temperature?: number; vibration?: number; current?: number; loadRate?: number; rpm?: number } | null) {
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return { status, temperature: finite(sample?.temperature), vibration: finite(sample?.vibration),
    current: finite(sample?.current), loadRate: finite(sample?.loadRate), rpm: finite(sample?.rpm) };
}

/* ========================= 小组件 ========================= */

export function Chip({
  icon: Icon,
  label,
  value,
  metric,
  tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /** 供自动化验收脚本读取的稳定钩子（只读，不参与任何业务逻辑） */
  metric?: string;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const toneCls =
    tone === 'danger'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : tone === 'warn'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-slate-700 bg-slate-800 text-slate-200';
  return (
    <span
      data-metric={metric}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${toneCls}`}
    >
      <Icon className="w-3.5 h-3.5 opacity-70" />
      <span className="opacity-70">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

export function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="industrial-control-section mb-3 last:mb-0">
      <summary className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold tracking-wide text-slate-300">
        <Icon className="w-3 h-3" />
        {title}
      </summary>
      <div className="space-y-1.5">{children}</div>
    </details>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  display,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  testId?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
        <span className="tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        aria-label={testId ?? display}
        data-slider={testId}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-full appearance-none bg-white/15 accent-blue-400 cursor-pointer"
      />
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  testId,
  icon: Icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-toggle={testId}
      aria-pressed={checked}
      data-checked={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-2 text-[11px] text-slate-300 hover:text-slate-100"
    >
      <span className="text-left leading-tight flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3 shrink-0" />}
        {label}
      </span>
      <span
        className={`shrink-0 relative w-8 h-4 rounded-full transition-colors ${
          checked ? 'bg-blue-500' : 'bg-white/18'
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
            checked ? 'left-4' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}
