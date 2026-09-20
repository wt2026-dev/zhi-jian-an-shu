// 「检修闯关」主页面：把真实标准化检修规程做成闯关游戏。
// 选设备 → 按规程逐步闯关（工具关/安全关/验收排序关）→ 答错扣命、限时计分 → 星级结算。
// 数据红线：题目全部来自 /api/v1/procedures 真实规程，无规程设备禁用开始，不造假兜底。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gamepad2, BookOpen, Map as MapIcon, Timer, Heart } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import type { Equipment } from '../../types';
import { GameTopBar, StepProgress, ResultPanel, useCountdown, FeedbackBadge } from './GameHUD';
import { HazardHunt, type HuntResult } from './HazardHunt';
import {
  fetchProcedures,
  findProcedureForEquipment,
  buildGameLevel,
  hasPlayableLevel,
  type GameLevel,
  type MiniGame,
} from './gameData';

type Mode = 'procedure' | 'hunt';
type Phase = 'select' | 'playing' | 'result';

const STEP_SECONDS = 45;
const BEST_KEY = (procedureId: string) => `maint-game-best-${procedureId}`;

interface BestRecord {
  stars: number;
  score: number;
  timeSec: number;
}

function loadBest(procedureId: string): BestRecord | null {
  try {
    const raw = localStorage.getItem(BEST_KEY(procedureId));
    return raw ? (JSON.parse(raw) as BestRecord) : null;
  } catch {
    return null;
  }
}

function saveBest(procedureId: string, rec: BestRecord) {
  try {
    const prev = loadBest(procedureId);
    if (!prev || rec.score > prev.score) localStorage.setItem(BEST_KEY(procedureId), JSON.stringify(rec));
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- 单个小关的渲染与判定 ---------- */

function MiniGameCard(props: {
  game: MiniGame;
  gameKey: number;
  locked: boolean;
  onAnswer: (ok: boolean, question: string, correctAnswer: string) => void;
}) {
  const { game, gameKey, locked, onAnswer } = props;
  const [orderSeq, setOrderSeq] = useState<string[]>([]);
  const shuffled = useMemo(() => (game.kind === 'order' ? shuffle(game.items) : []), [game, gameKey]);

  useEffect(() => {
    setOrderSeq([]);
  }, [gameKey]);

  if (game.kind === 'tool') {
    return (
      <div>
        <div className="mb-2 text-xs font-semibold tracking-wider text-cyan-300/80">工具关 · 选择本步骤的正确工具</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {game.options.map((t) => (
            <button
              key={t}
              disabled={locked}
              onClick={() => onAnswer(t === game.correct, '应选用的工具', game.correct)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-4 text-center text-xs text-slate-200 transition-all hover:border-cyan-400/50 hover:bg-cyan-400/10 hover:shadow-[0_0_16px_rgba(34,211,238,0.15)] disabled:opacity-50"
            >
              <div className="mb-1 text-2xl">🛠</div>
              {t}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (game.kind === 'safety') {
    return (
      <div>
        <div className="mb-2 text-xs font-semibold tracking-wider text-cyan-300/80">安全关 · 判断以下说法</div>
        <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-3 text-sm leading-relaxed text-amber-100">
          {game.statement}
        </div>
        <div className="flex gap-3">
          <button
            disabled={locked}
            onClick={() => onAnswer(game.answer === true, `「${game.statement}」`, game.answer ? '正确' : '错误')}
            className="flex-1 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
          >
            ✓ 正确
          </button>
          <button
            disabled={locked}
            onClick={() => onAnswer(game.answer === false, `「${game.statement}」`, game.answer ? '正确' : '错误')}
            className="flex-1 rounded-lg border border-rose-400/40 bg-rose-400/10 px-4 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-400/20 disabled:opacity-50"
          >
            ✗ 错误
          </button>
        </div>
      </div>
    );
  }

  // 排序关：按正确顺序点击子动作
  const done = orderSeq.length === game.items.length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold tracking-wider text-cyan-300/80">验收关 · 按正确顺序点击操作动作</div>
        <button
          onClick={() => setOrderSeq([])}
          disabled={locked}
          className="rounded border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/[0.08] disabled:opacity-50"
        >
          重排
        </button>
      </div>
      <div className="mb-2 min-h-[34px] rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-2 py-1.5 text-xs text-cyan-200">
        {orderSeq.length === 0 ? <span className="text-slate-500">依次点击下方动作…</span> : orderSeq.map((x, i) => <span key={i}>{i > 0 && ' → '}{x}</span>)}
      </div>
      <div className="space-y-1.5">
        {shuffled.map((x) => {
          const used = orderSeq.includes(x);
          return (
            <button
              key={x}
              disabled={locked || used}
              onClick={() => {
                const seq = [...orderSeq, x];
                setOrderSeq(seq);
                if (seq.length === game.items.length) {
                  const ok = seq.every((v, i) => v === game.items[i]);
                  onAnswer(ok, '操作动作的正确顺序', game.items.join(' → '));
                }
              }}
              className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-all disabled:opacity-40 ${
                used
                  ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200'
                  : 'border-white/10 bg-white/[0.03] text-slate-200 hover:border-amber-400/50 hover:bg-amber-400/10'
              }`}
            >
              {x}
            </button>
          );
        })}
      </div>
      {done && <div className="mt-1 text-[10px] text-slate-500">已选满，正在判定…</div>}
    </div>
  );
}

/* ---------- 页面主组件 ---------- */

export function MaintenanceGameView({ currentUser }: { currentUser?: { name?: string } | null }) {
  const { equipments } = useAppData();
  const [mode, setMode] = useState<Mode>('procedure');
  const [procs, setProcs] = useState<Awaited<ReturnType<typeof fetchProcedures>>>([]);
  const [loading, setLoading] = useState(true);

  const [phase, setPhase] = useState<Phase>('select');
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [level, setLevel] = useState<GameLevel | null>(null);

  const [stepIdx, setStepIdx] = useState(0);
  const [gameIdx, setGameIdx] = useState(0);
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [stepFailed, setStepFailed] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [huntResult, setHuntResult] = useState<HuntResult | null>(null);

  const [mistakes, setMistakes] = useState<{ stepName: string; question: string; correctAnswer: string }[]>([]);
  const totalGames = useMemo(() => (level ? level.steps.reduce((s, st) => s + st.games.length, 0) : 0), [level]);
  const statsRef = useRef({ firstTry: 0, missed: new Set<string>() });
  const startedAtRef = useRef(0);

  // 拉取真实规程
  useEffect(() => {
    let alive = true;
    fetchProcedures().then((list) => {
      if (alive) {
        setProcs(list);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const step = level?.steps[stepIdx] ?? null;
  const game = step?.games[Math.min(gameIdx, step.games.length - 1)] ?? null;

  /* ---------- 答题判定 ---------- */
  const handleAnswer = useCallback(
    (ok: boolean, question: string, correctAnswer: string) => {
      if (!step || !game || feedback) return;
      const st = statsRef.current;
      // 同一小关答错后再答对，不算"一次通过"，否则通关后正确率恒为 100%
      const gateKey = `${stepIdx}:${gameIdx}`;
      let livesLeft = livesRef.current;
      if (!ok) {
        setMistakes((m) => [...m, { stepName: step.name, question, correctAnswer }]);
        st.missed.add(gateKey);
        livesLeft = Math.max(0, livesRef.current - 1);
        setLives(livesLeft);
        setFeedback({ ok: false, text: `回答错误 · 正确答案：${correctAnswer}` });
      } else {
        if (!st.missed.has(gateKey)) st.firstTry += 1;
        setScore((v) => v + 10);
        setFeedback({ ok: true, text: '+10 分' });
      }
      window.setTimeout(() => {
        setFeedback(null);
        if (ok) {
          if (gameIdx + 1 >= step.games.length) {
            // 本步完成 → 速度加成（剩余每 1 秒 +1 分，封顶 +20）
            setScore((v) => v + Math.min(20, secondsLeftRef.current));
            if (stepIdx + 1 >= (level?.steps.length ?? 0)) {
              setPhase('result');
            } else {
              // 进入新步骤：45 秒预算按步重置（同步内推进不重置）
              setStepIdx((i) => i + 1);
              setGameIdx(0);
              setResetKey((k) => k + 1);
            }
          } else {
            setGameIdx((i) => i + 1);
          }
        } else {
          setResetKey((k) => k + 1);
          if (livesLeft <= 0) setStepFailed(true);
        }
      }, 950);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, game, feedback, gameIdx, stepIdx, level]
  );

  const secondsLeftRef = useRef(45);
  const livesRef = useRef(3);
  livesRef.current = lives;
  const secondsLeft = useCountdown(
    STEP_SECONDS,
    () => {
      // 超时算错：扣命并重答本题
      handleAnswer(false, '本步限时内未完成', '在 45 秒内完成本步全部小关');
    },
    phase === 'playing' && !feedback && !stepFailed,
    resetKey
  );
  secondsLeftRef.current = secondsLeft;

  /* ---------- 开始 / 重试 / 返回 ---------- */
  const startLevel = (eq: Equipment, procId: string) => {
    const proc = procs.find((p) => p.id === procId);
    if (!proc) return;
    const lv = buildGameLevel(proc, procs);
    if (!hasPlayableLevel(lv)) return;
    setEquipment(eq);
    setLevel(lv);
    setStepIdx(0);
    setGameIdx(0);
    setLives(3);
    setScore(0);
    setMistakes([]);
    statsRef.current = { firstTry: 0, missed: new Set<string>() };
    setResetKey((k) => k + 1);
    setStepFailed(false);
    setFeedback(null);
    startedAtRef.current = Date.now();
    setPhase('playing');
  };

  const retryStep = () => {
    setLives(3);
    setGameIdx(0);
    setStepFailed(false);
    setFeedback(null);
    setResetKey((k) => k + 1);
  };

  const backToSelect = () => {
    setPhase('select');
    setLevel(null);
    setEquipment(null);
    setHuntResult(null);
  };

  /* ---------- 结算 ---------- */
  const best = level ? loadBest(level.procedureId) : null;
  const [resultView, setResultView] = useState<{ stars: number; score: number; timeSec: number; accuracyPct: number; isNewBest: boolean } | null>(null);
  useEffect(() => {
    if (phase !== 'result' || mode !== 'procedure' || !level) return;
    const accuracyPct = totalGames > 0 ? Math.round((statsRef.current.firstTry / totalGames) * 100) : 0;
    const stars = accuracyPct >= 90 ? 3 : accuracyPct >= 70 ? 2 : 1;
    const timeSec = Math.round((Date.now() - startedAtRef.current) / 1000);
    const prevBest = loadBest(level.procedureId);
    const isNewBest = !prevBest || score > prevBest.score;
    if (isNewBest) saveBest(level.procedureId, { stars, score, timeSec });
    setResultView({ stars, score, timeSec, accuracyPct, isNewBest });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const huntStars = huntResult ? (huntResult.accuracyPct >= 90 ? 3 : huntResult.accuracyPct >= 70 ? 2 : 1) : 0;

  return (
    <div className="min-h-full bg-gradient-to-b from-[#0d1b30] to-[#081224] p-3 text-slate-100 sm:p-5">
      {/* 页头 + 模式切换 */}
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gamepad2 className="h-5 w-5 text-cyan-400" />
            <h1 className="text-lg font-bold text-slate-100">检修闯关</h1>
            <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-300">真实规程驱动</span>
          </div>
          <div className="flex gap-1 rounded-lg border border-cyan-400/25 bg-[rgba(8,15,30,0.72)] p-1">
            {([
              ['procedure', '规程闯关', BookOpen],
              ['hunt', '隐患找茬', MapIcon],
            ] as const).map(([m, label, Icon]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors ${mode === m ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === 'hunt' ? (
          huntResult ? (
            <ResultPanel
              success={huntResult.accuracyPct >= 70}
              stars={huntStars}
              score={huntResult.score}
              timeSec={huntResult.timeSec}
              accuracyPct={huntResult.accuracyPct}
              best={null}
              isNewBest={false}
              mistakes={huntResult.missed.map((m) => ({ stepName: m.scene, question: `${m.type}：${m.desc}`, correctAnswer: '点击命中该隐患位置' }))}
              onRetry={() => setHuntResult(null)}
              onBack={() => {
                setHuntResult(null);
                setMode('procedure');
              }}
            />
          ) : (
            <HazardHunt
              onFinish={(r) => setHuntResult(r)}
              onQuit={() => setMode('procedure')}
            />
          )
        ) : phase === 'select' ? (
          /* ---------- 选设备 ---------- */
          <div className="space-y-3">
            <div className="rounded-lg border border-cyan-400/25 bg-[rgba(8,15,30,0.72)] px-3 py-2.5 text-xs text-slate-300 backdrop-blur">
              选择一台设备，按它的<b className="text-cyan-300">真实标准化检修规程</b>逐步闯关：每步三道小关（工具 / 安全 / 排序），
              答错扣 ❤、限时 45 秒、答对按剩余时间加速加分。{currentUser?.name ? `，${currentUser.name}` : ''}祝你三星通关。
            </div>
            {loading && <div className="py-10 text-center text-sm text-slate-400">规程加载中…</div>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {equipments.map((eq) => {
                const proc = findProcedureForEquipment(eq, procs);
                const lv = proc ? buildGameLevel(proc, procs) : null;
                const playable = hasPlayableLevel(lv);
                const bestRec = proc ? loadBest(proc.id) : null;
                const statusColor =
                  eq.status === 'running' ? 'bg-emerald-400' : eq.status === 'fault' ? 'bg-rose-400' : eq.status === 'overhauling' ? 'bg-amber-400' : 'bg-sky-400';
                return (
                  <button
                    key={eq.id}
                    disabled={!playable}
                    onClick={() => proc && startLevel(eq, proc.id)}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      playable
                        ? 'border-white/10 bg-white/[0.03] hover:border-cyan-400/50 hover:bg-cyan-400/5 hover:shadow-[0_0_16px_rgba(34,211,238,0.12)]'
                        : 'cursor-not-allowed border-white/5 bg-white/[0.01] opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
                        <span className="truncate text-sm font-semibold text-slate-100">{eq.name}</span>
                      </span>
                      <span className="hud-tabular-nums shrink-0 text-[10px] text-slate-500">{eq.code}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {eq.workshop} · {eq.category} · 健康 {eq.healthScore}
                    </div>
                    {playable && proc ? (
                      <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-[11px]">
                        <span className="truncate text-cyan-300/90" title={proc.title}>
                          <BookOpen className="mr-1 inline h-3 w-3" />
                          {proc.title}
                        </span>
                        <span className="hud-tabular-nums shrink-0 text-slate-500">
                          {proc.estimatedMinutes ? `约${proc.estimatedMinutes}分` : ''}
                          {bestRec ? ` · ★${bestRec.stars}` : ''}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-2 border-t border-white/5 pt-2 text-[11px] text-rose-300/70">
                        该设备暂无标准化规程
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : phase === 'playing' && level && step && game ? (
          /* ---------- 闯关中 ---------- */
          <div className="relative mx-auto max-w-3xl space-y-3">
            <GameTopBar
              title={level.title}
              equipmentName={equipment?.name ?? ''}
              secondsLeft={secondsLeft}
              lives={lives}
              score={score}
              stepLabel={`第 ${stepIdx + 1} / ${level.steps.length} 步 · ${step.name}`}
            />
            <StepProgress current={stepIdx} total={level.steps} />

            <div className="rounded-xl border border-cyan-400/25 bg-[rgba(8,15,30,0.78)] p-4 backdrop-blur">
              <div className="mb-3">
                <div className="flex items-center gap-2 text-sm font-bold text-cyan-100">
                  <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 text-[10px] text-cyan-300">STEP {step.stepNo}</span>
                  {step.name}
                </div>
                <div className="mt-1.5 text-xs leading-relaxed text-slate-400">{step.content}</div>
              </div>
              <MiniGameCard game={game} gameKey={stepIdx * 100 + gameIdx} locked={!!feedback} onAnswer={handleAnswer} />
              {feedback && (
                <div className="mt-3">
                  <FeedbackBadge ok={feedback.ok} text={feedback.text} />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" /> 本步限时 {STEP_SECONDS}s，超时算错
              </span>
              <span className="flex items-center gap-1">
                <Heart className="h-3 w-3 text-rose-400" /> 剩余生命 {lives}
              </span>
            </div>

            {stepFailed && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[rgba(4,8,18,0.82)] backdrop-blur-sm">
                <div className="mx-4 rounded-xl border border-rose-400/40 bg-[rgba(30,8,12,0.9)] p-6 text-center">
                  <div className="text-lg font-bold text-rose-300">💥 检修失败</div>
                  <div className="mt-1 text-xs text-slate-400">生命耗尽 · 回到「{step.name}」步骤开头重试</div>
                  <button
                    onClick={retryStep}
                    className="mt-4 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/20"
                  >
                    重试本步骤
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : phase === 'result' && resultView && level ? (
          /* ---------- 结算 ---------- */
          <ResultPanel
            success
            stars={resultView.stars}
            score={resultView.score}
            timeSec={resultView.timeSec}
            accuracyPct={resultView.accuracyPct}
            best={best}
            isNewBest={resultView.isNewBest}
            mistakes={mistakes}
            onRetry={() => equipment && level && startLevel(equipment, level.procedureId)}
            onBack={backToSelect}
          />
        ) : null}
      </div>
    </div>
  );
}
