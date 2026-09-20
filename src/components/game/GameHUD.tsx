// 「检修闯关」HUD 子组件：状态栏 / 进度条 / 星级 / 结算面板 / 反馈徽标。
// 深色工业科技风（深蓝黑底 + 青色/琥珀高亮），对齐 CockpitDashboardView / ProductionHUD 的面板语言。
import { useEffect, useRef, useState } from 'react';

/** 顶部状态栏：规程标题 + 设备名 + 倒计时 + 生命 + 得分 */
export function GameTopBar(props: {
  title: string;
  equipmentName: string;
  secondsLeft: number;
  lives: number;
  score: number;
  stepLabel: string;
}) {
  const { title, equipmentName, secondsLeft, lives, score, stepLabel } = props;
  const urgent = secondsLeft <= 10;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-400/25 bg-[rgba(8,15,30,0.72)] px-3 py-2 backdrop-blur">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-cyan-100">{title}</div>
        <div className="truncate text-[11px] text-slate-400">
          {equipmentName} · {stepLabel}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div
          className={`hud-tabular-nums rounded-md border px-2.5 py-1 text-sm font-bold ${urgent ? 'animate-pulse border-rose-400/60 bg-rose-400/10 text-rose-300' : 'border-cyan-400/30 bg-cyan-400/5 text-cyan-200'}`}
          title="本步剩余时间"
        >
          ⏱ {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}
        </div>
        <div className="flex items-center gap-0.5 text-base" title="生命值">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < lives ? 'text-rose-400' : 'text-slate-700'}>
              {i < lives ? '❤' : '🖤'}
            </span>
          ))}
        </div>
        <div className="hud-value-glow hud-tabular-nums rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 text-sm font-bold text-amber-300" title="得分">
          {score} 分
        </div>
      </div>
    </div>
  );
}

/** 步骤进度条：一格一步，已过=青、当前=琥珀、未到=灰 */
export function StepProgress(props: { current: number; total: readonly unknown[] }) {
  const { current, total } = props;
  return (
    <div className="flex items-center gap-1.5">
      {total.map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${i < current ? 'bg-cyan-400/80' : i === current ? 'bg-amber-400/80' : 'bg-slate-700/60'}`}
          title={`第 ${i + 1} / ${total.length} 步`}
        />
      ))}
    </div>
  );
}

/** 星级展示（结算 + 最佳记录共用） */
export function StarRating({ stars, size = 'text-3xl' }: { stars: number; size?: string }) {
  return (
    <div className={`${size} tracking-widest`} aria-label={`${stars} 星`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= stars ? 'text-amber-300' : 'text-slate-700'}>
          ★
        </span>
      ))}
    </div>
  );
}

/** 对/错反馈徽标（答题后短暂展示） */
export function FeedbackBadge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
        ok ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/50 bg-rose-400/10 text-rose-300'
      }`}
      role="status"
    >
      {ok ? '✓ ' : '✗ '}
      {text}
    </div>
  );
}

/** 倒计时钩子：单步 45s，归零回调；只有 resetKey 变化才重置——同步内推进下一小关不重置，才是真的"每步 45 秒"预算 */
export function useCountdown(seconds: number, onTimeout: () => void, active: boolean, resetKey = 0) {
  const [left, setLeft] = useState(seconds);
  const cbRef = useRef(onTimeout);
  cbRef.current = onTimeout;
  useEffect(() => {
    setLeft(seconds);
  }, [seconds, resetKey]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          window.clearInterval(timer);
          cbRef.current();
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, seconds, resetKey]);
  return left;
}

/** 结算面板：星级 / 用时 / 正确率 / 错误复盘 / 最佳记录 */
export function ResultPanel(props: {
  success: boolean;
  stars: number;
  score: number;
  timeSec: number;
  accuracyPct: number;
  best?: { stars: number; score: number; timeSec: number } | null;
  isNewBest: boolean;
  mistakes: { stepName: string; question: string; correctAnswer: string }[];
  onRetry: () => void;
  onBack: () => void;
}) {
  const { success, stars, score, timeSec, accuracyPct, best, isNewBest, mistakes, onRetry, onBack } = props;
  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-cyan-400/30 bg-[rgba(8,15,30,0.85)] p-6 backdrop-blur">
      <div className="text-center">
        <div className={`text-xl font-bold ${success ? 'text-cyan-200' : 'text-rose-300'}`}>
          {success ? '🎉 检修闯关完成' : '💥 检修失败'}
        </div>
        <div className="mt-3 flex justify-center">
          <StarRating stars={stars} size="text-4xl" />
        </div>
        {isNewBest && success && <div className="mt-1 text-xs font-semibold text-amber-300">★ 新的最佳纪录！</div>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] py-2">
          <div className="hud-value-glow hud-tabular-nums text-xl font-bold text-cyan-100">{score}</div>
          <div className="text-[10px] text-slate-500">总得分</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] py-2">
          <div className="hud-tabular-nums text-xl font-bold text-emerald-300">
            {Math.floor(timeSec / 60)}:{String(timeSec % 60).padStart(2, '0')}
          </div>
          <div className="text-[10px] text-slate-500">总用时</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] py-2">
          <div className="hud-tabular-nums text-xl font-bold text-amber-300">{accuracyPct}%</div>
          <div className="text-[10px] text-slate-500">正确率</div>
        </div>
      </div>

      {best && (
        <div className="text-center text-[11px] text-slate-500">
          我的最佳：{'★'.repeat(best.stars)}{'☆'.repeat(3 - best.stars)} · {best.score} 分 ·{' '}
          {Math.floor(best.timeSec / 60)}:{String(best.timeSec % 60).padStart(2, '0')}
        </div>
      )}

      {mistakes.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-1.5 text-xs font-semibold text-slate-300">错误复盘（{mistakes.length} 处）</div>
          <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {mistakes.map((m, i) => (
              <div key={i} className="rounded border border-rose-400/20 bg-rose-400/5 px-2 py-1.5 text-[11px]">
                <div className="font-semibold text-rose-300">{m.stepName}</div>
                <div className="text-slate-400">{m.question}</div>
                <div className="text-emerald-300">正确答案：{m.correctAnswer}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-center gap-3 pt-1">
        <button
          onClick={onRetry}
          className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/20"
        >
          再来一次
        </button>
        <button
          onClick={onBack}
          className="rounded-lg border border-white/15 bg-white/[0.04] px-5 py-2 text-sm text-slate-300 transition-colors hover:bg-white/[0.08]"
        >
          返回选设备
        </button>
      </div>
    </div>
  );
}
