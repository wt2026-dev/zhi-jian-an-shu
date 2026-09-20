/**
 * 主线 HUD 的最小面板集 —— 与 3D 视图（`equipment-industrial.css`）同一套深色工业风，
 * 但刻意不复用检修闯关的 `GameHUD`：那边的面板绑定了"生命值 + 单关倒计时"语义，
 * 主线要的是"幕进度 + 真实台账读数"，硬套只会多出几个用不上的 prop。
 */
import type { ReactNode } from 'react';

export function Panel(props: { title: string; accent?: 'cyan' | 'amber' | 'rose' | 'emerald'; right?: ReactNode; children: ReactNode; className?: string }) {
  const { title, accent = 'cyan', right, children, className = '' } = props;
  const tone = {
    cyan: 'border-cyan-400/25 text-cyan-100',
    amber: 'border-amber-400/30 text-amber-100',
    rose: 'border-rose-400/35 text-rose-100',
    emerald: 'border-emerald-400/30 text-emerald-100',
  }[accent];
  return (
    <section className={`rounded-lg border bg-[rgba(8,15,30,0.78)] backdrop-blur ${tone} ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <h3 className="text-[11px] font-bold tracking-wide">{title}</h3>
        {right}
      </header>
      <div className="px-3 py-2 text-[11px] leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

/** 读数行：标签 + 值。值为 null 时显示"未接入"，绝不显示 0 或横杠占位 */
export function DataRow(props: { label: string; value: ReactNode; tone?: 'default' | 'warn' | 'bad' | 'good' }) {
  const { label, value, tone = 'default' } = props;
  const color = { default: 'text-slate-200', warn: 'text-amber-300', bad: 'text-rose-300', good: 'text-emerald-300' }[tone];
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className={`hud-tabular-nums text-right font-semibold ${color}`}>{value}</span>
    </div>
  );
}

export function Missing(props: { text?: string }) {
  return <span className="text-slate-500 italic">{props.text ?? '未接入'}</span>;
}

/** 幕末操作条：一句提示 + 主按钮 */
export function ActFooter(props: { hint?: ReactNode; primary?: { text: string; onClick: () => void; disabled?: boolean }; secondary?: { text: string; onClick: () => void }; busy?: boolean }) {
  const { hint, primary, secondary, busy } = props;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-[rgba(8,15,30,0.72)] px-3 py-2">
      <div className="min-w-0 text-[11px] text-slate-400">{hint}</div>
      <div className="flex items-center gap-2">
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-cyan-400/40 hover:text-cyan-200"
          >
            {secondary.text}
          </button>
        )}
        {primary && (
          <button
            type="button"
            disabled={primary.disabled || busy}
            onClick={primary.onClick}
            className="rounded-md border border-cyan-400/45 bg-cyan-400/12 px-3 py-1 text-[11px] font-bold text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            {busy ? '处理中…' : primary.text}
          </button>
        )}
      </div>
    </div>
  );
}

/** 报警横幅：真实读数说话，红色呼吸边框由 equipment-industrial.css 提供 */
export function AlarmBanner(props: { title: string; detail: string; source: string }) {
  return (
    <div className="campaign-alarm rounded-lg border border-rose-400/45 bg-[rgba(38,8,8,0.8)] px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-400 shadow-[0_0_10px_2px_rgba(244,63,94,0.8)]" />
        <span className="text-xs font-bold text-rose-200">{props.title}</span>
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-rose-100/85">{props.detail}</div>
      <div className="mt-1 text-[10px] text-rose-200/55">数据来源：{props.source}</div>
    </div>
  );
}

/** 真实接口调用失败时的说明 —— 直说失败原因，不给假数据 */
export function ApiNotice(props: { kind: 'error' | 'degraded' | 'empty'; text: string }) {
  const tone =
    props.kind === 'error'
      ? 'border-rose-400/35 bg-rose-500/8 text-rose-200'
      : props.kind === 'degraded'
        ? 'border-amber-400/35 bg-amber-400/8 text-amber-200'
        : 'border-slate-500/35 bg-slate-500/8 text-slate-300';
  const label = props.kind === 'error' ? '接口调用失败' : props.kind === 'degraded' ? '结果可能不完整' : '暂无数据';
  return (
    <div className={`rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed ${tone}`}>
      <span className="font-bold">{label}：</span>
      {props.text}
    </div>
  );
}
