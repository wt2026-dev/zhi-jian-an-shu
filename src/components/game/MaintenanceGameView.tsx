/**
 * 「检修闯关」主页面 —— 3D 关卡地图版。
 *
 * 结构（取代原来的设备卡片列表）：
 *   ① `map`      3D 车间俯视关卡地图：设备摆在各自点位上，绿=已通关 / 黄=可挑战 / 红=未解锁，
 *                点击设备 → 相机俯冲拉近；
 *   ② `playing`  三步关卡：找异常部位（点 3D 场景里的测点）→ 选工具 → 按顺序操作；
 *   ③ `result`   S/A/B/C 评级结算，数字人播放庆祝 / 遗憾动作。
 *
 * 数据红线：题目全部来自真实规程与真实遥测；无规程的设备在地图上显示为"未解锁"且不可进入，
 * 遥测缺失时显示"未接入"，绝不编造。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Map as MapIcon, RotateCcw, Gamepad2 } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import type { Equipment } from '../../types';
import {
  LevelTopBar,
  VitalPanel,
  BottomHintBar,
  GradePanel,
  MapLegend,
  FeedbackBadge,
  ResultPanel,
  useCountdown,
} from './GameHUD';
import { HazardHunt, type HuntResult } from './HazardHunt';
import { GameSceneView } from './GameSceneView';
import { STATION_STATE_META, type FaultSpotSpec, type GameScene, type StationSpec, type StationState } from './gameScene';
import type { CharacterMood } from './gameCharacter';
import {
  buildDeviceLevel,
  gradeFor,
  scoreStep,
  GRADE_COLOR,
  GRADE_TEXT,
  MAX_LIVES,
  STEP_SECONDS,
  type DeviceLevel,
  type Grade,
  type LevelStep,
} from './levelPlay';
import { fetchProcedures, findProcedureForEquipment } from './gameData';
import { MasterGameView } from './MasterGameView';

type Mode = 'map' | 'hunt';
type Phase = 'map' | 'playing' | 'result';

interface BestRecord {
  grade: Grade;
  score: number;
  timeSec: number;
}

const GRADE_RANK: Record<Grade, number> = { S: 4, A: 3, B: 2, C: 1 };
const bestKey = (equipmentId: string) => `maint-game-lv-${equipmentId}`;

function loadBest(equipmentId: string): BestRecord | null {
  try {
    const raw = localStorage.getItem(bestKey(equipmentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BestRecord;
    return parsed && typeof parsed.score === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function saveBestIfBetter(equipmentId: string, rec: BestRecord): boolean {
  try {
    const prev = loadBest(equipmentId);
    const better = !prev || GRADE_RANK[rec.grade] > GRADE_RANK[prev.grade] || (GRADE_RANK[rec.grade] === GRADE_RANK[prev.grade] && rec.score > prev.score);
    if (better) localStorage.setItem(bestKey(equipmentId), JSON.stringify(rec));
    return better;
  } catch {
    return false;
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

/* ============================ 主组件 ============================ */

function MapGameView({ currentUser }: { currentUser?: { name?: string } | null }) {
  const { equipments } = useAppData();
  const [mode, setMode] = useState<Mode>('map');
  const [procs, setProcs] = useState<Awaited<ReturnType<typeof fetchProcedures>>>([]);
  const [loading, setLoading] = useState(true);

  const [phase, setPhase] = useState<Phase>('map');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [level, setLevel] = useState<DeviceLevel | null>(null);

  const [stepIdx, setStepIdx] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [mistakes, setMistakes] = useState<{ title: string; detail: string; answer: string }[]>([]);
  const [hint, setHint] = useState<string>('拖动旋转视角 · 点击设备进入检修关卡');
  const [mood, setMood] = useState<CharacterMood>('idle');
  const [resetKey, setResetKey] = useState(0);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** 关卡已用时（秒）。由 1s 定时器推进，避免在渲染期直接调 Date.now() / 读 ref。 */
  const [elapsedSec, setElapsedSec] = useState(0);

  // 第三步：按顺序摆放
  const [orderSeq, setOrderSeq] = useState<string[]>([]);
  const [dragItem, setDragItem] = useState<string | null>(null);

  const [result, setResult] = useState<{
    success: boolean;
    grade: Grade;
    score: number;
    timeSec: number;
    accuracyPct: number;
    isNewBest: boolean;
    best: BestRecord | null;
  } | null>(null);

  const sceneRef = useRef<GameScene | null>(null);
  const statsRef = useRef({ firstTry: 0, total: 0 });
  /** 关卡开始时间戳：只在事件回调里写、只在回调里读。渲染期读 ref / 调 Date.now 都会被 lint 拦下。 */
  const startedAtRef = useRef(0);
  /**
   * 下面 5 个 ref 只服务于"计时器与答题回调要读到最新值"，同时保持 useCallback 身份稳定
   * （重建会让 3D 场景的 hooks 换新对象）。
   *
   * ⚠️ 不能在渲染期直接 `ref.current = state`（`react-hooks/refs` 会拦），统一放到下面那个
   * `useLayoutEffect` 里回填：layout effect 在 commit 内同步执行，任何后续回调读到的一定是最新值。
   * 也刻意不用"自定义 hook 包一层"的写法 —— 那样编译器就不再把返回值当 ref，
   * `exhaustive-deps` 会要求把它塞进依赖数组，等于白写。
   */
  const livesRef = useRef(MAX_LIVES);
  const stepRef = useRef(0);
  const mistakesRef = useRef<{ title: string; detail: string; answer: string }[]>([]);
  const scoreRef = useRef(0);
  /** 剩余秒数：handleAnswer / advanceStep 要用它算速度加成。 */
  const secondsLeftRef = useRef(30);

  // 隐患找茬模式
  const [huntResult, setHuntResult] = useState<HuntResult | null>(null);

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

  /* ---------- 关卡地图点位 ---------- */

  /** 每台设备的进度（localStorage）。用 equipments 作为依赖以便通关后重算。 */
  const [progressTick, setProgressTick] = useState(0);
  const stations: StationSpec[] = useMemo(() => {
    void progressTick;
    return equipments.map((eq, i) => {
      const proc = findProcedureForEquipment(eq, procs);
      const best = loadBest(eq.id);
      const state: StationState = !proc ? 'locked' : best ? 'cleared' : 'current';
      return {
        id: eq.id,
        index: i + 1,
        name: eq.name,
        code: eq.code,
        category: eq.category,
        workshop: eq.workshop,
        state,
        playable: !!proc,
        bestGrade: best?.grade ?? null,
      };
    });
  }, [equipments, procs, progressTick]);

  const clearedCount = stations.filter((s) => s.state === 'cleared').length;
  const stationIndexById = useMemo(() => {
    const m = new Map<string, number>();
    stations.forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [stations]);

  const activeEquipment: Equipment | null = useMemo(
    () => equipments.find((e) => e.id === activeId) ?? null,
    [equipments, activeId]
  );

  const step: LevelStep | null = level?.steps[stepIdx] ?? null;

  /* ---------- 第一步：把测点推给 3D 场景 ---------- */
  const faultSpots: FaultSpotSpec[] | null = useMemo(() => {
    if (!step || step.kind !== 'hunt') return null;
    return step.spots.map((s) => ({ key: s.key, label: s.label, abnormal: s.abnormal, reading: s.reading }));
  }, [step]);

  /* ---------- 判定 ---------- */

  const finishLevel = useCallback(
    (success: boolean, finalScore: number, equipmentId: string) => {
      const total = statsRef.current.total || 1;
      const accuracyPct = Math.round((statsRef.current.firstTry / total) * 100);
      const timeSec = Math.round((Date.now() - startedAtRef.current) / 1000);
      const mistakeCount = mistakesRef.current.length;
      const grade = success ? gradeFor({ mistakes: mistakeCount, firstTryRate: statsRef.current.firstTry / total }) : 'C';
      const rec: BestRecord = { grade, score: finalScore, timeSec };
      const isNewBest = success ? saveBestIfBetter(equipmentId, rec) : false;
      setMood(success ? 'celebrate' : 'regret');
      setResult({ success, grade, score: finalScore, timeSec, accuracyPct, isNewBest, best: loadBest(equipmentId) });
      setPhase('result');
      setProgressTick((v) => v + 1);
    },
    []
  );

  const advanceStep = useCallback(
    (equipmentId: string) => {
      const lv = level;
      if (!lv) return;
      if (stepRef.current + 1 >= lv.steps.length) {
        // 最后一步通过 → 把本步速度加分也算进去
        const bonus = scoreStep({ firstTry: true, secondsLeft: secondsLeftRef.current }, lv.steps[stepRef.current].kind);
        const finalScore = scoreRef.current + bonus;
        setScore(finalScore);
        finishLevel(true, finalScore, equipmentId);
        return;
      }
      const next = stepRef.current + 1;
      setStepIdx(next);
      setOrderSeq([]);
      setFeedback(null);
      setResetKey((k) => k + 1);
      // 步骤提示由 stepHintText 派生（见下），无需回写 hint state
    },
    [level, finishLevel]
  );

  const handleAnswer = useCallback(
    (ok: boolean, detail: string, answer: string) => {
      const lv = level;
      const equipmentId = activeId;
      if (!lv || !equipmentId || feedback) return;
      const cur = lv.steps[stepRef.current];
      if (!cur) return;

      if (ok) {
        const gained = scoreStep({ firstTry: true, secondsLeft: secondsLeftRef.current }, cur.kind);
        setScore((v) => v + gained);
        scoreRef.current += gained;
        statsRef.current.firstTry += 1;
        setFeedback({ ok: true, text: `正确！+${gained} 分` });
        window.setTimeout(() => {
          setFeedback(null);
          advanceStep(equipmentId);
        }, 900);
      } else {
        statsRef.current.total += 1;
        setMistakes((m) => [...m, { title: cur.title, detail, answer }]);
        const left = Math.max(0, livesRef.current - 1);
        setLives(left);
        setFeedback({ ok: false, text: `错误 · ${answer}` });
        window.setTimeout(() => {
          setFeedback(null);
          if (left <= 0) {
            finishLevel(false, scoreRef.current, equipmentId);
          } else {
            // 扣血后重答本步
            setOrderSeq([]);
            setResetKey((k) => k + 1);
          }
        }, 1100);
      }
    },
    [level, activeId, feedback, advanceStep, finishLevel]
  );

  /* ---------- 倒计时（放在 handleAnswer 之后，避免引用未初始化的块级变量） ---------- */
  const stepSeconds = step ? STEP_SECONDS[step.kind] : 30;
  const secondsLeft = useCountdown(
    stepSeconds,
    () => handleAnswer(false, `本步限时 ${stepSeconds} 秒内未完成`, '在限时内完成本步'),
    phase === 'playing' && !feedback,
    resetKey
  );
  useLayoutEffect(() => {
    // 上面那批 ref 的唯一写入点（布局期，commit 内同步完成）
    livesRef.current = lives;
    stepRef.current = stepIdx;
    mistakesRef.current = mistakes;
    scoreRef.current = score;
    secondsLeftRef.current = secondsLeft;
  });

  /** 关卡计时：定时器回调里 setState（异步，不触发 set-state-in-effect） */
  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* ---------- 进入 / 退出关卡 ---------- */

  const startLevelFor = useCallback(
    (equipmentId: string) => {
      const eq = equipments.find((e) => e.id === equipmentId);
      if (!eq) return;
      const proc = findProcedureForEquipment(eq, procs);
      if (!proc) return;
      const lv = buildDeviceLevel(eq, proc, procs);
      if (!lv.steps.length) return;
      setActiveId(equipmentId);
      setLevel(lv);
      setStepIdx(0);
      setLives(MAX_LIVES);
      setScore(0);
      scoreRef.current = 0;
      setMistakes([]);
      setOrderSeq([]);
      setFeedback(null);
      setResult(null);
      setMood('idle');
      setResetKey((k) => k + 1);
      statsRef.current = { firstTry: 0, total: lv.steps.length };
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      setPhase('playing');
      // 步骤提示由 stepHintText 派生（见下），无需回写 hint state
    },
    [equipments, procs]
  );

  const backToMap = useCallback(() => {
    setPhase('map');
    setActiveId(null);
    setLevel(null);
    setResult(null);
    setMood('idle');
    setHint('拖动旋转视角 · 点击设备进入检修关卡');
    sceneRef.current?.setFocused(null);
    sceneRef.current?.resetView();
  }, []);

  /* ---------- 场景回调 ---------- */

  const hooks = useMemo(
    () => ({
      onStationPick: (id: string) => {
        const st = stations.find((s) => s.id === id);
        if (!st) return;
        if (!st.playable) {
          setHint(`${st.name} 暂无标准化检修规程，无法进入关卡`);
          return;
        }
        sceneRef.current?.diveTo(id);
        setHint(`正在进入 ${st.name} 的检修关卡…`);
      },
      onDiveEnd: (id: string) => {
        sceneRef.current?.setFocused(id);
        startLevelFor(id);
      },
      onFaultPick: (key: string) => {
        if (!step || step.kind !== 'hunt') return;
        const spot = step.spots.find((s) => s.key === key);
        if (!spot) return;
        if (key === step.correctKey) {
          handleAnswer(true, `命中 ${spot.label}`, step.explain);
        } else {
          handleAnswer(false, `点到了「${spot.label}」（读数 ${spot.reading ?? '未接入'}）`, step.explain);
        }
      },
      onHover: (id: string | null) => setHoverId(id),
    }),
    [stations, step, handleAnswer, startLevelFor]
  );

  /* ---------- 提示语（派生，不用 effect 回写 state） ---------- */

  /**
   * 步骤相关提示是**纯派生值**：`phase / step / hoverId` 一变就该变。
   * 原来用两个 effect 去 `setHint(...)`，既命中 `set-state-in-effect`，又有个真 bug ——
   * 悬停移开后提示不会复位。派生写法两个问题一起解决。
   */
  const stepHintText = useMemo(() => {
    if (phase !== 'playing' || !step) return null;
    if (step.kind === 'hunt') {
      if (hoverId) {
        const spot = step.spots.find((s) => s.key === hoverId);
        if (spot) return `${spot.label}：${spot.reading ?? '未接入'}`;
      }
      const anyData = step.spots.some((s) => s.reading !== null);
      return anyData
        ? '点击 3D 场景中读数异常的部位（悬停可查看读数）'
        : '遥测未接入，请按规程判断该重点检查的部位后点击它';
    }
    return stepHint(step);
  }, [phase, step, hoverId]);

  /** 地图态悬停设备 → 顺手给个"点它进关卡"的引导（hint state 只承载事件驱动的瞬时文案） */
  const mapHoverHint = useMemo(() => {
    if (phase !== 'map' || !hoverId) return null;
    const st = stations.find((s) => s.id === hoverId);
    if (!st) return null;
    return st.playable ? `点击进入「${st.name}」检修关卡` : `${st.name} 暂无标准化检修规程`;
  }, [phase, hoverId, stations]);

  const hintText = stepHintText ?? mapHoverHint ?? hint;

  /* ---------- 渲染 ---------- */

  const huntStars = huntResult ? (huntResult.accuracyPct >= 90 ? 3 : huntResult.accuracyPct >= 70 ? 2 : 1) : 0;

  if (mode === 'hunt') {
    return (
      <div className="min-h-full bg-gradient-to-b from-[#0d1b30] to-[#081224] p-3 text-slate-100 sm:p-5">
        <div className="mx-auto max-w-5xl space-y-3">
          <ModeTabs mode={mode} setMode={setMode} />
          {huntResult ? (
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
                setMode('map');
              }}
            />
          ) : (
            <HazardHunt onFinish={(r) => setHuntResult(r)} onQuit={() => setMode('map')} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-full bg-[#081224] text-slate-100">
      {/* 3D 场景铺满整块工作区。
          ⚠️ 结算阶段必须**保持** focusedId：一旦回落成 null，场景会走 setFocused(null)
          → 数字人被挪回地图边缘（placeCharacterFor(null)），庆祝/遗憾动作就演给空气看了。
          只有回到地图（phase === 'map'）才解除聚焦。 */}
      <GameSceneView
        className="absolute inset-0"
        stations={stations}
        hooks={hooks}
        focusedId={phase === 'map' ? null : activeId}
        mood={mood}
        faultSpots={phase === 'playing' ? faultSpots : null}
        onReady={(s) => {
          sceneRef.current = s;
        }}
      />

      {/* ---------- 覆盖层 UI ---------- */}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        {/* 顶部：标题 + 关卡进度 */}
        <div className="pointer-events-auto p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gamepad2 className="h-5 w-5 text-cyan-400" />
              <h1 className="text-base font-bold text-slate-100">检修闯关</h1>
              <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
                3D 关卡地图
              </span>
              {currentUser?.name && <span className="text-[11px] text-slate-400">{currentUser.name}</span>}
            </div>
            <ModeTabs mode={mode} setMode={setMode} />
          </div>

          {phase === 'playing' && level && step && activeId && (
            <div className="mx-auto max-w-3xl">
              <LevelTopBar
                levelIndex={stationIndexById.get(activeId) ?? 1}
                levelTotal={stations.length}
                equipmentName={activeEquipment?.name ?? level.equipmentName}
                stepIndex={stepIdx}
                stepTotal={level.steps.length}
                stepTitle={step.title}
                secondsLeft={secondsLeft}
                stepSeconds={stepSeconds}
              />
            </div>
          )}
        </div>

        {/* 主体：左侧生命/积分 + 中间内容 */}
        <div className="flex min-h-0 flex-1 gap-3 px-3">
          {phase === 'playing' && (
            <div className="pointer-events-auto pt-1">
              <VitalPanel lives={lives} maxLives={MAX_LIVES} score={score} mistakes={mistakes.length} />
            </div>
          )}

          {phase === 'map' && (
            <div className="pointer-events-auto pt-1">
              <MapLegend
                cleared={clearedCount}
                total={stations.length}
                states={[STATION_STATE_META.cleared, STATION_STATE_META.current, STATION_STATE_META.locked]}
              />
              {loading && <div className="mt-2 text-[11px] text-slate-400">规程加载中…</div>}
            </div>
          )}

          <div className="pointer-events-none flex min-h-0 flex-1 items-end justify-center pb-3">
            {/* 第二步：工具选择（游戏化格子，不是文字选项列表） */}
            {phase === 'playing' && step?.kind === 'tool' && !feedback && (
              <div className="pointer-events-auto mb-2 w-full max-w-2xl">
                <ToolTray
                  options={step.options}
                  prompt={step.prompt}
                  onPick={(tool) => handleAnswer(tool === step.correct, `选择了「${tool}」`, step.explain)}
                />
              </div>
            )}

            {/* 第三步：按顺序摆放 */}
            {phase === 'playing' && step?.kind === 'order' && !feedback && (
              <div className="pointer-events-auto mb-2 w-full max-w-2xl">
                <OrderBoard
                  items={step.items}
                  seq={orderSeq}
                  dragItem={dragItem}
                  setDragItem={setDragItem}
                  onAppend={(item) => {
                    if (orderSeq.includes(item)) return;
                    const next = [...orderSeq, item];
                    setOrderSeq(next);
                    if (next.length === step.items.length) {
                      const ok = next.every((v, i) => v === step.items[i]);
                      handleAnswer(ok, `摆放顺序：${next.join(' → ')}`, step.explain);
                    }
                  }}
                  onRemove={(item) => setOrderSeq((s) => s.filter((x) => x !== item))}
                  onReset={() => setOrderSeq([])}
                />
              </div>
            )}

            {/* 反馈徽标 */}
            {feedback && (
              <div className="pointer-events-none mb-4 w-full max-w-md">
                <FeedbackBadge ok={feedback.ok} text={feedback.text} />
              </div>
            )}

            {/* 结算 */}
            {phase === 'result' && result && (
              <div className="pointer-events-auto mb-2 w-full max-w-xl">
                <GradePanel
                  success={result.success}
                  grade={result.grade}
                  gradeText={GRADE_TEXT[result.grade]}
                  gradeColor={GRADE_COLOR[result.grade]}
                  score={result.score}
                  timeSec={result.timeSec}
                  accuracyPct={result.accuracyPct}
                  bestGrade={result.best?.grade ?? null}
                  bestScore={result.best?.score ?? null}
                  isNewBest={result.isNewBest}
                  mistakes={mistakes}
                  onRetry={() => activeId && startLevelFor(activeId)}
                  onBack={backToMap}
                />
              </div>
            )}
          </div>
        </div>

        {/* 底部：操作提示 */}
        <div className="pointer-events-auto p-3">
          <div className="mx-auto max-w-3xl space-y-2">
            {phase === 'playing' && step?.kind === 'hunt' && (
              <div className="rounded-lg border border-cyan-400/20 bg-[rgba(6,14,26,0.8)] px-3 py-2 text-xs text-slate-300">
                <div className="flex items-center gap-2 font-semibold text-cyan-100">
                  <BookOpen className="h-3.5 w-3.5" />
                  {level?.sourceStepName}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  规程：{level?.procedureTitle} · 第 {level?.sourceStepNo} 步
                </div>
              </div>
            )}
            <BottomHintBar
              text={hintText}
              tone={feedback ? (feedback.ok ? 'good' : 'bad') : 'info'}
              right={phase === 'playing' ? `已用 ${elapsedSec}s` : undefined}
            />
            {phase === 'playing' && (
              <button
                onClick={backToMap}
                className="flex items-center gap-1 rounded border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/[0.08]"
              >
                <RotateCcw className="h-3 w-3" /> 放弃并返回地图
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ 子部件 ============================ */

function stepHint(step: LevelStep): string {
  if (step.kind === 'hunt') return '点击 3D 场景中读数异常的部位';
  if (step.kind === 'tool') return '从下方工具格中选出本步骤应使用的那一件';
  return '把下方动作按正确顺序摆放（拖拽或依次点击）';
}

function ModeTabs({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="flex gap-1 rounded-lg border border-cyan-400/25 bg-[rgba(8,15,30,0.72)] p-1 backdrop-blur">
      {([
        ['map', '3D 关卡地图', MapIcon],
        ['hunt', '隐患找茬', BookOpen],
      ] as const).map(([m, label, Icon]) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors ${
            mode === m ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

/** 工具托盘：游戏化的"工具格"，每格一件工具，点选即提交。 */
function ToolTray({ options, prompt, onPick }: { options: string[]; prompt: string; onPick: (tool: string) => void }) {
  return (
    <div className="rounded-xl border border-cyan-400/25 bg-[rgba(6,14,26,0.86)] p-3 backdrop-blur">
      <div className="mb-2 text-center text-xs font-semibold text-cyan-200">{prompt}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((t) => (
          <button
            key={t}
            onClick={() => onPick(t)}
            className="group rounded-lg border border-white/10 bg-white/[0.03] px-2 py-3 text-center text-[11px] text-slate-200 transition-all hover:border-cyan-400/60 hover:bg-cyan-400/10 hover:shadow-[0_0_18px_rgba(34,211,238,0.22)]"
          >
            <div className="mb-1 text-xl text-cyan-300/80 transition-transform group-hover:scale-110">🛠</div>
            <div className="leading-tight">{t}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 排序板：上方是"已摆放"的槽位条，下方是候选动作。
 * 支持**拖拽**与**依次点击**两种操作（都追加到末尾），点击槽位可撤回。
 */
function OrderBoard(props: {
  items: string[];
  seq: string[];
  dragItem: string | null;
  setDragItem: (v: string | null) => void;
  onAppend: (item: string) => void;
  onRemove: (item: string) => void;
  onReset: () => void;
}) {
  const { items, seq, setDragItem, onAppend, onRemove, onReset } = props;
  const pool = shuffleMemo(items);
  const done = seq.length === items.length;

  return (
    <div className="rounded-xl border border-cyan-400/25 bg-[rgba(6,14,26,0.86)] p-3 backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-cyan-200">按正确顺序摆放</span>
        <button
          onClick={onReset}
          className="rounded border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/[0.08]"
        >
          清空
        </button>
      </div>

      {/* 槽位条 */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const item = e.dataTransfer.getData('text/plain');
          if (item && items.includes(item)) onAppend(item);
          setDragItem(null);
        }}
        className={`mb-2 flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 ${
          done ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-cyan-400/30 bg-cyan-400/5'
        }`}
      >
        {seq.length === 0 ? (
          <span className="text-[11px] text-slate-500">把下方动作拖到这里，或按顺序依次点击…</span>
        ) : (
          seq.map((x, i) => (
            <button
              key={x}
              onClick={() => onRemove(x)}
              title="点击撤回"
              className="rounded border border-cyan-400/40 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-400/20"
            >
              <span className="hud-tabular-nums mr-1 text-[10px] text-cyan-400/80">{i + 1}</span>
              {x}
            </button>
          ))
        )}
      </div>

      {/* 候选动作 */}
      <div className="space-y-1.5">
        {pool.map((x) => {
          const used = seq.includes(x);
          return (
            <button
              key={x}
              draggable={!used}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', x);
                setDragItem(x);
              }}
              onDragEnd={() => setDragItem(null)}
              disabled={used}
              onClick={() => onAppend(x)}
              className={`w-full cursor-grab rounded-lg border px-3 py-2 text-left text-[11px] transition-all disabled:cursor-default disabled:opacity-35 ${
                used
                  ? 'border-cyan-400/30 bg-cyan-400/5 text-cyan-200/60'
                  : 'border-white/10 bg-white/[0.03] text-slate-200 hover:border-amber-400/50 hover:bg-amber-400/10'
              }`}
            >
              {x}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================ 页面外壳 ============================ */

type PlayMode = 'master' | 'map';

/**
 * 「检修闯关」页面外壳 —— 两种玩法可切换：
 * - 《检修大师》（默认）：2D 横版跑酷闯关，跑动 / 跳跃 / 点设备检修，4 关 + 职称晋升；
 * - 3D 关卡地图：车间俯视地图上逐台设备挑战（保留，作为另一种入口）。
 *
 * 两者共用同一套数据红线：题目全部来自真实检修规程与真实遥测读数，无规程的设备不可挑战。
 */
export function MaintenanceGameView({ currentUser }: { currentUser?: { name?: string } | null }) {
  const [playMode, setPlayMode] = useState<PlayMode>('master');
  /** 关卡进度托管在页面层：切到 3D 地图再切回来不会掉回第 1 关 */
  const [levelIndex, setLevelIndex] = useState(0);

  const tab = (mode: PlayMode, label: string) => (
    <button
      type="button"
      onClick={() => setPlayMode(mode)}
      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        playMode === mode ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full w-full flex-col bg-[#040a14]">
      {/* 顶部模式条：独立占位，避免与两种玩法各自的 HUD 互相压叠 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Gamepad2 size={14} className="text-cyan-300" />
          <span className="text-xs font-semibold text-slate-200">检修闯关</span>
          <span className="hidden text-[11px] text-slate-500 sm:inline">
            · {playMode === 'master' ? '《检修大师》2D 横版跑酷闯关' : '3D 车间关卡地图'}
          </span>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
          {tab('master', '检修大师')}
          {tab('map', '3D 地图')}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {playMode === 'master' ? (
          <MasterGameView levelIndex={levelIndex} onLevelIndexChange={setLevelIndex} />
        ) : (
          <MapGameView currentUser={currentUser} />
        )}
      </div>
    </div>
  );
}

/* ============================ 工具 ============================ */

/** 打乱顺序，但同一关卡内保持稳定（按内容做种子，避免每次渲染都重排） */
function shuffleMemo(items: string[]): string[] {
  const key = items.join('|');
  const cache = shuffleCache;
  if (cache.key !== key) {
    cache.key = key;
    cache.value = shuffle(items);
  }
  return cache.value;
}
const shuffleCache: { key: string; value: string[] } = { key: '', value: [] };
