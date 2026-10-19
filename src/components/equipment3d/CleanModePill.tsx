import React from 'react';
import { Eye, Sparkles } from 'lucide-react';

interface CleanModePillProps {
  onExit: () => void;
  className?: string;
}

/**
 * 纯净模式常驻逃生浮标：
 * 避开原数字人位置，显示于右下角，支持点击或 Esc 恢复完整外围面板。
 */
export const CleanModePill: React.FC<CleanModePillProps> = ({ onExit, className = '' }) => {
  return (
    <aside
      aria-label="纯净模式状态提示"
      className={`fixed bottom-6 right-6 z-50 pointer-events-auto ${className}`}
    >
      <button
        type="button"
        data-testid="equipment3d-clean-mode-pill"
        onClick={onExit}
        title="点击或按 Esc 键退出纯净模式，恢复全部操作面板"
        className="group flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-950/90 hover:bg-slate-900 border border-cyan-500/40 hover:border-cyan-400 text-cyan-200 hover:text-white text-xs font-medium shadow-[0_4px_20px_rgba(0,0,0,0.6)] backdrop-blur-md transition-all cursor-pointer hover:scale-105 active:scale-95"
      >
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse group-hover:bg-cyan-300" />
        <Eye className="w-3.5 h-3.5 text-cyan-400" />
        <span>纯净模式 · Esc 恢复</span>
      </button>
    </aside>
  );
};

export default CleanModePill;
