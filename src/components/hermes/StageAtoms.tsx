import type { ReactNode } from 'react';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import type { Stage3Prefill } from './types';

export function RevertButton({ onRevert }: { onRevert: () => void }) {
  return (
    <button
      type="button"
      onClick={onRevert}
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer"
    >
      <RotateCcw className="w-3 h-3" />
      <span>恢复 AI 原值</span>
    </button>
  );
}

export function StructuredBlock({
  title,
  icon,
  note,
  aside,
  children,
}: {
  title: string;
  icon: ReactNode;
  note?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        {aside}
      </div>
      {note && <p className="text-[11px] text-slate-500 leading-relaxed">{note}</p>}
      {children}
    </div>
  );
}

export function Para({ label, text }: { label: string; text?: string | null }) {
  if (!text) return null;
  return (
    <p className="text-xs text-slate-700 leading-relaxed">
      <strong>{label}：</strong>
      {text}
    </p>
  );
}

export function ListBlock({ label, items }: { label: string; items?: string[] }) {
  const list = (items || []).filter((x) => String(x || '').trim() !== '');
  if (!list.length) return null;
  return (
    <div className="text-xs text-slate-700 space-y-1">
      <div className="font-semibold text-slate-800">{label}</div>
      <ul className="space-y-1">
        {list.map((item, idx) => (
          <li key={idx} className="flex gap-1.5 leading-relaxed">
            <span className="text-blue-500 shrink-0">·</span>
            <span className="text-slate-600">{String(item)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
      <div className="text-slate-400 text-[11px]">{label}</div>
      <div className="font-semibold text-slate-800 mt-0.5 break-all">{value || '—'}</div>
    </div>
  );
}

export function StandardsList({ raw }: { raw?: Stage3Prefill }) {
  const standards = raw?.standards || [];
  if (!standards.length) return null;
  return (
    <div className="text-[11px] text-slate-500 space-y-0.5">
      {standards.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0" />
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

export function EmptyBlock({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-xs text-slate-500">{text}</div>;
}

export function EmptyLine({ text }: { text: string }) {
  return <p className="text-[11px] text-slate-500 leading-relaxed">{text}</p>;
}

export function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-slate-700 border border-slate-200/80">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}
