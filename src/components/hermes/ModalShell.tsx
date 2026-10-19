import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  widthClass?: string;
}

/**
 * 工作台统一弹窗外壳。必须 portal 到 document.body：
 * 各卡片根节点带 backdrop-blur（CSS filter），而 filter 会为 position:fixed 后代
 * 创建包含块——就地渲染时遮罩只盖住卡片自己，弹窗底部还会被裁到视口外，
 * 「关闭预览」按钮够不着，也挡不住底下的推进按钮。
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  title,
  subtitle,
  icon,
  children,
  footer,
  onClose,
  widthClass = 'max-w-2xl',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white rounded-2xl w-full ${widthClass} max-h-[86vh] flex flex-col shadow-2xl border border-slate-200 outline-none animate-in fade-in zoom-in-95 duration-150`}
      >
        <header className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">{title}</h3>
              {subtitle && <p className="text-[11px] font-mono text-slate-500 truncate">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="shrink-0 text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="shrink-0 px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
};
