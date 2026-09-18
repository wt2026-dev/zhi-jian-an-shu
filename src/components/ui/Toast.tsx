import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useToast, ToastItem, ToastType } from '../../context/ToastContext';

const ICON_MAP: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  error: <XCircle className="w-4 h-4 text-rose-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  info: <Info className="w-4 h-4 text-blue-500" />,
};

const COLOR_BAR: Record<ToastType, string> = {
  success: 'border-l-emerald-500',
  error: 'border-l-rose-500',
  warning: 'border-l-amber-500',
  info: 'border-l-blue-500',
};

function ToastItemView({ toast }: { toast: ToastItem }) {
  const { dismiss } = useToast();
  return (
    <div
      className={`flex items-start gap-2.5 p-3 bg-white rounded-lg shadow-lg border border-slate-200 border-l-[3px] ${COLOR_BAR[toast.type]} animate-in fade-in slide-in-from-bottom-2 duration-200 max-w-xs`}
      role="status"
      aria-live="polite"
    >
      <span className="mt-0.5 shrink-0">{ICON_MAP[toast.type]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-800 leading-snug">{toast.title}</p>
        {toast.message && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{toast.message}</p>}
      </div>
      <button
        onClick={() => dismiss(toast.id)}
        className="shrink-0 p-0.5 rounded text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"
        aria-label="关闭"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItemView toast={t} />
        </div>
      ))}
    </div>
  );
}
