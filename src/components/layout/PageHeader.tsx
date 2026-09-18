import React from 'react';

export interface PageHeaderMetrics {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

export interface PageHeaderProps {
  group: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  metrics?: PageHeaderMetrics[];
}

const TONE_MAP: Record<string, string> = {
  default: 'bg-slate-50 text-slate-700 border-slate-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function PageHeader({ group, title, subtitle, actions, metrics }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
      <div className="flex items-center gap-3">
        <div
          className="w-0.5 h-8 rounded-full shrink-0"
          style={{ background: 'linear-gradient(180deg, var(--gold) 0%, var(--sky) 100%)' }}
        />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{group}</span>
            <span className="text-slate-300">·</span>
            <h1 className="text-base font-bold text-slate-900">{title}</h1>
          </div>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {metrics?.map((m, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${TONE_MAP[m.tone || 'default']}`}
          >
            <span className="text-slate-400 font-normal">{m.label}</span>
            <span className="font-mono">{m.value}</span>
          </span>
        ))}
        {actions}
      </div>
    </div>
  );
}
