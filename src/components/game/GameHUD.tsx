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

/**
 * 倒计时钩子：单步限时，归零回调。
 *
 * ⚠️ 这里的"重置"刻意不写 `setLeft(seconds)`：
 *   · 渲染期 setState ⇒ 命中 `react-hooks/set-state-in-render`（error 级）；
 *   · effect 里同步 setState ⇒ 命中 `react-hooks/set-state-in-effect`（级联渲染）。
 * 改为「键控计数」：已走秒数连同 `seconds|resetKey` 一起存，键不匹配就**视为 0**。
 * 调用方每推进一小关 / 每答错一次都会改 resetKey，所以每步都拿到独立预算，
 * 恰好就是"每步 N 秒"，而且不需要任何重置副作用。
 */
export function useCountdown(seconds: number, onTimeout: () => void, active: boolean, resetKey = 0) {
  const cbRef = useRef(onTimeout);
  useEffect(() => {
    cbRef.current = onTimeout;
  });

  const cycleKey = `${seconds}|${resetKey}`;
  const [walked, setWalked] = useState({ key: cycleKey, n: 0 });
  const steps = walked.key === cycleKey ? walked.n : 0;
  const left = Math.max(0, seconds - steps);
  const running = active && left > 0;

  // 走秒：setState 只在定时器回调里发生（异步，不触发 set-state-in-effect）
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setWalked((w) => ({ key: cycleKey, n: (w.key === cycleKey ? w.n : 0) + 1 }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, cycleKey]);

  // 归零回调：放在 effect 里（不是 setState），firedRef 保证同一小关只触发一次
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active || seconds <= 0 || steps < seconds) return;
    if (firedRef.current === cycleKey) return;
    firedRef.current = cycleKey;
    cbRef.current();
  }, [active, seconds, steps, cycleKey]);

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

/* ==================================================================================
 * 以下为 3D 关卡地图版新增的 HUD 部件（顶部关卡进度 / 左侧生命与积分 / 底部提示 / 评级结算）。
 * 与上面的旧部件并存 —— 隐患找茬模式仍在用旧部件，不改动它们。
 * ================================================================================== */

/** 顶部：关卡进度（第 N / M 关）+ 本步分段计时条。 */
export function LevelTopBar(props: {
  levelIndex: number;
  levelTotal: number;
  equipmentName: string;
  stepIndex: number;
  stepTotal: number;
  stepTitle: string;
  secondsLeft: number;
  stepSeconds: number;
}) {
  const { levelIndex, levelTotal, equipmentName, stepIndex, stepTotal, stepTitle, secondsLeft, stepSeconds } = props;
  const ratio = Math.max(0, Math.min(1, secondsLeft / Math.max(1, stepSeconds)));
  const urgent = secondsLeft <= Math.max(5, stepSeconds * 0.25);
  return (
    <div className="rounded-lg border border-cyan-400/25 bg-[rgba(6,14,26,0.82)] px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="hud-tabular-nums rounded border border-cyan-400/40 bg-cyan-400/10 px-1.5 py-0.5 text-[11px] font-bold text-cyan-200">
            第 {levelIndex} / {levelTotal} 关
          </span>
          <span className="truncate text-sm font-semibold text-slate-100">{equipmentName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">
            第 {stepIndex + 1}/{stepTotal} 步 · {stepTitle}
          </span>
          <span
            className={`hud-tabular-nums rounded border px-2 py-0.5 text-xs font-bold ${
              urgent ? 'animate-pulse border-rose-400/60 bg-rose-400/10 text-rose-300' : 'border-cyan-400/30 bg-cyan-400/5 text-cyan-200'
            }`}
          >
            {secondsLeft}s
          </span>
        </div>
      </div>
      {/* 分段计时条：用格子而不是平滑条，读起来更像"限时" */}
      <div className="mt-1.5 flex gap-0.5">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i / 20 < ratio ? (urgent ? 'bg-rose-400/85' : 'bg-cyan-400/80') : 'bg-slate-700/50'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/** 左侧：生命值 + 积分 + 失误数。竖排，贴左边缘。 */
export function VitalPanel(props: { lives: number; maxLives: number; score: number; mistakes: number }) {
  const { lives, maxLives, score, mistakes } = props;
  return (
    <div className="w-[86px] shrink-0 space-y-2">
      <div className="rounded-lg border border-rose-400/25 bg-[rgba(6,14,26,0.82)] px-2 py-2 text-center backdrop-blur">
        <div className="text-[10px] tracking-wider text-slate-500">生命值</div>
        <div className="mt-1 flex flex-col items-center gap-0.5 text-lg leading-none">
          {Array.from({ length: maxLives }).map((_, i) => (
            <span key={i} className={i < lives ? 'text-rose-400' : 'text-slate-700'}>
              {i < lives ? '❤' : '🖤'}
            </span>
          ))}
        </div>
        <div className="hud-tabular-nums mt-1 text-[10px] text-slate-500">
          {lives}/{maxLives}
        </div>
      </div>

      <div className="rounded-lg border border-amber-400/25 bg-[rgba(6,14,26,0.82)] px-2 py-2 text-center backdrop-blur">
        <div className="text-[10px] tracking-wider text-slate-500">积分</div>
        <div className="hud-value-glow hud-tabular-nums mt-0.5 text-xl font-bold text-amber-300">{score}</div>
      </div>

      <div className="rounded-lg border border-white/10 bg-[rgba(6,14,26,0.82)] px-2 py-2 text-center backdrop-blur">
        <div className="text-[10px] tracking-wider text-slate-500">失误</div>
        <div className={`hud-tabular-nums mt-0.5 text-lg font-bold ${mistakes > 0 ? 'text-rose-300' : 'text-slate-400'}`}>
          {mistakes}
        </div>
      </div>
    </div>
  );
}

/** 底部：操作提示条。 */
export function BottomHintBar(props: { text: string; tone?: 'info' | 'warn' | 'good' | 'bad'; right?: string }) {
  const { text, tone = 'info', right } = props;
  const toneCls =
    tone === 'good'
      ? 'border-emerald-400/35 text-emerald-200'
      : tone === 'bad'
        ? 'border-rose-400/35 text-rose-200'
        : tone === 'warn'
          ? 'border-amber-400/35 text-amber-200'
          : 'border-cyan-400/25 text-slate-300';
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border bg-[rgba(6,14,26,0.85)] px-3 py-2 backdrop-blur ${toneCls}`}>
      <span className="min-w-0 truncate text-xs">{text}</span>
      {right && <span className="hud-tabular-nums shrink-0 text-[11px] text-slate-500">{right}</span>}
    </div>
  );
}

/** 结算：得分 / 用时 / 正确率 / S-A-B-C 评级 / 失误复盘。 */
export function GradePanel(props: {
  success: boolean;
  grade: string;
  gradeText: string;
  gradeColor: string;
  score: number;
  timeSec: number;
  accuracyPct: number;
  bestGrade?: string | null;
  bestScore?: number | null;
  isNewBest: boolean;
  mistakes: { title: string; detail: string; answer: string }[];
  onRetry: () => void;
  onBack: () => void;
}) {
  const {
    success, grade, gradeText, gradeColor, score, timeSec, accuracyPct,
    bestGrade, bestScore, isNewBest, mistakes, onRetry, onBack,
  } = props;
  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-cyan-400/30 bg-[rgba(6,14,26,0.9)] p-6 backdrop-blur">
      <div className="text-center">
        <div className={`text-lg font-bold ${success ? 'text-cyan-200' : 'text-rose-300'}`}>
          {success ? '检修完成' : '检修失败'}
        </div>
        {/* 评级徽章：大号字母 + 发光描边，替代原来的三星 */}
        <div className="mt-3 flex justify-center">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full border-2"
            style={{ borderColor: gradeColor, boxShadow: `0 0 28px ${gradeColor}55, inset 0 0 18px ${gradeColor}33` }}
          >
            <span className="hud-tabular-nums text-5xl font-black" style={{ color: gradeColor }}>
              {grade}
            </span>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-400">{gradeText}</div>
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
          <div className="text-[10px] text-slate-500">一次通过率</div>
        </div>
      </div>

      {(bestGrade || bestScore != null) && (
        <div className="text-center text-[11px] text-slate-500">
          我的最佳：{bestGrade ? `评级 ${bestGrade}` : '—'}
          {bestScore != null ? ` · ${bestScore} 分` : ''}
        </div>
      )}

      {mistakes.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-1.5 text-xs font-semibold text-slate-300">失误复盘（{mistakes.length} 处）</div>
          <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {mistakes.map((m, i) => (
              <div key={i} className="rounded border border-rose-400/20 bg-rose-400/5 px-2 py-1.5 text-[11px]">
                <div className="font-semibold text-rose-300">{m.title}</div>
                <div className="text-slate-400">{m.detail}</div>
                <div className="text-emerald-300">正确：{m.answer}</div>
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
          再挑战一次
        </button>
        <button
          onClick={onBack}
          className="rounded-lg border border-white/15 bg-white/[0.04] px-5 py-2 text-sm text-slate-300 transition-colors hover:bg-white/[0.08]"
        >
          返回关卡地图
        </button>
      </div>
    </div>
  );
}

/** 关卡地图左上角的图例 + 进度总览。 */
export function MapLegend(props: { cleared: number; total: number; states: { label: string; color: string }[] }) {
  const { cleared, total, states } = props;
  return (
    <div className="pointer-events-none rounded-lg border border-cyan-400/25 bg-[rgba(6,14,26,0.8)] px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-cyan-100">检修闯关地图</span>
        <span className="hud-tabular-nums rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-200">
          已通关 {cleared}/{total}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
        {states.map((s) => (
          <span key={s.label} className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-slate-500">拖动旋转 · 滚轮缩放 · 点击设备进入关卡</div>
    </div>
  );
}
