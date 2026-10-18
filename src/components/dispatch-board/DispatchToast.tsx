import React from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { DispatchToastState } from './dispatchTypes';

interface DispatchToastProps {
  toast: DispatchToastState | null;
}

export const DispatchToast: React.FC<DispatchToastProps> = ({ toast }) => {
  if (!toast) return null;

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium max-w-[90vw] ${
        toast.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
      }`}
      role="status"
    >
      <span className="flex items-center">
        {toast.ok ? (
          <CheckCircle2 className="w-4 h-4 mr-1.5 shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 mr-1.5 shrink-0" />
        )}
        {toast.text}
      </span>
    </div>
  );
};
