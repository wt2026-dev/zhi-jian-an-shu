/**
 * 《检修大师》—— 2D 横版闯关主视图。
 *
 * 你扮演一名年轻工程师，在工厂里跑动、跳到设备旁、点开设备做检修。
 * 4 关各有玩法：教学 / 紧急抢修（多台 + 倒计时）/ 故障解谜（逐部位排查）/ BOSS 战（分阶段限时）。
 *
 * ## 分层（刻意拆开，各自可测）
 * - `platformerEngine.ts` 跑跳物理与镜头（纯函数，可单测）
 * - `platformerRender.ts` canvas 2D 绘制（纯程序化美术，零新增素材）
 * - `masterLevels.ts` 4 关的布局与规则（内容来自真实规程）
 * - 本文件 = React 外壳：输入、命中测试、rAF 循环、HUD 与面板
 *
 * ## 数据红线（与项目既有口径一致）
 * 题目全部由 `levelPlay.buildDeviceLevel()` 从**真实规程 + 真实遥测**生成；
 * 没有阈值的量只显示读数、标"无阈值"；读数缺失显示"未接入"。这里不编造任何故障。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Hammer, Heart, Info, RotateCcw, Timer, Trophy, Wrench, Zap } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import type { MaintenanceProcedure } from '../../types';
import { fetchProcedures } from './gameData';
import {
  buildMasterLevels,
  nextRankHint,
  phaseLimitOf,
  rankFor,
  tickTimer,
  RANK_NAME,
  type MasterLevel,
  type Rank,
} from './masterLevels';
import {
  createCamera,
  createPlayer,
  followCamera,
  nearDevice,
  playerBox,
  stepPlayer,
  VIEW_H,
  VIEW_W,
  type Camera,
  type Input,
  type PlayerState,
} from './platformerEngine';
import {
  deviceHitBox,
  partScreenPos,
  renderScene,
  type DeviceVisual,
  type PartVisual,
  type SceneState,
} from './platformerRender';
import {
  GRADE_COLOR,
  GRADE_TEXT,
  MAX_LIVES,
  scoreStep,
  type Grade,
  type LevelStep,
} from './levelPlay';

/* ============================ 存档 ============================ */

const SAVE_KEY = 'maint-master-progress';

interface SaveData {
  cleared: number[];
  bestScore: number;
  hasS: boolean;
  grades: Record<string, Grade>;
}

const EMPTY_SAVE: SaveData = { cleared: [], bestScore: 0, hasS: false, grades: {} };

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return EMPTY_SAVE;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      cleared: Array.isArray(parsed.cleared) ? parsed.cleared : [],
      bestScore: typeof parsed.bestScore === 'number' ? parsed.bestScore : 0,
      hasS: !!parsed.hasS,
      grades: parsed.grades && typeof parsed.grades === 'object' ? parsed.grades : {},
    };
  } catch {
    return EMPTY_SAVE;
  }
}

function writeSave(s: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式下写不进去，不影响游玩 */
  }
}

/* ============================ 阶段 ============================ */

type Phase = 'brief' | 'run' | 'interact' | 'settle';

interface Settle {
  success: boolean;
  grade: Grade;
  score: number;
  timeSec: number;
  mistakes: number;
  rankBefore: Rank;
  rankAfter: Rank;
  hint: string | null;
  reason: string;
}

/** 每一关的运行态（跑跳之外的部分） */
interface RunState {
  /** 各设备是否已完成 */
  done: boolean[];
  /** 当前打开的设备下标，-1 = 没打开 */
  active: number;
  /** 当前设备的第几步 */
  stepIdx: number;
  /** 解谜关：已探开的部位 key */
  revealed: string[];
  /** 排序关：已摆入槽位的动作 */
  orderSeq: string[];
  score: number;
  lives: number;
  mistakes: number;
  /** 限时剩余（秒）；-1 = 不限时。BOSS 关存的是**当前阶段**的剩余时间 */
  timeLeft: number;
  /** 已用时（秒） */
  elapsed: number;
}

function freshRun(level: MasterLevel): RunState {
  return {
    done: level.devices.map(() => false),
    active: -1,
    stepIdx: 0,
    revealed: [],
    orderSeq: [],
    score: 0,
    lives: MAX_LIVES,
    mistakes: 0,
    // 全关限时优先；BOSS 关没有全关限时，起表值就是第 0 阶段的限时
    timeLeft: level.timeLimit > 0 ? level.timeLimit : (level.phaseSeconds[0] ?? -1),
    elapsed: 0,
  };
}

/* ============================ 组件 ============================ */

/**
 * 外层：数据与关卡进度。
 * 只负责「设备台账 + 检修规程 → 4 关关卡表」和「现在第几关」，把存档托管住。
 * 世界状态（物理、镜头、本关进度）全部由内层 `MasterRun` 持有 —— 见下方 key 的说明。
 *
 * `levelIndex` / `onLevelIndexChange` 可选：由外层托管时，"切到 3D 地图再切回来"
 * 不会掉回第 1 关（不传则自己管，组件仍可单独使用）。
 */
export function MasterGameView({
  levelIndex,
  onLevelIndexChange,
}: {
  levelIndex?: number;
  onLevelIndexChange?: (index: number) => void;
} = {}) {
  const { equipments } = useAppData();
  const [procs, setProcs] = useState<MaintenanceProcedure[]>([]);
  const [save, setSave] = useState<SaveData>(() => loadSave());

  useEffect(() => {
    let alive = true;
    void fetchProcedures().then((list) => {
      if (alive) setProcs(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const levels = useMemo(() => buildMasterLevels(equipments, procs), [equipments, procs]);

  const [ownLevelIdx, setOwnLevelIdx] = useState(0);
  const levelIdx = levelIndex ?? ownLevelIdx;
  const goLevel = useCallback(
    (next: number) => {
      if (onLevelIndexChange) onLevelIndexChange(next);
      else setOwnLevelIdx(next);
    },
    [onLevelIndexChange]
  );
  /** 「再试一次 / 从第 1 关重玩」是同一关原地重开：只换 `level` 引用看不出变化，所以再加一个世代号 */
  const [epoch, setEpoch] = useState(0);

  const level: MasterLevel | null = levels[levelIdx] ?? null;
  if (!level) {
    return (
      <div className="flex h-full items-center justify-center bg-[#081224] text-slate-400">
        <div className="text-sm">正在载入关卡数据…（需要设备台账与检修规程）</div>
      </div>
    );
  }

  /* key = 关卡号 + 世代号 ⇒ 换关或重开都会重挂载内层，物理世界与本关进度自动回到起点。
   * 这是 React 里「props 变了就重置状态」的正解：不需要 effect 里 setState，
   * 也不需要在渲染期写 ref（两者分别被 react-hooks/set-state-in-effect、
   * "Cannot access refs during render" 拦下）。`save` 留在外层，所以跨关不丢。 */
  return (
    <MasterRun
      key={`${level.index}:${epoch}`}
      level={level}
      levelIdx={levelIdx}
      total={levels.length}
      save={save}
      onSave={setSave}
      onNext={() => goLevel(Math.min(levels.length - 1, levelIdx + 1))}
      onRetry={() => setEpoch((e) => e + 1)}
      onRestart={() => {
        goLevel(0);
        setEpoch((e) => e + 1);
      }}
    />
  );
}

interface MasterRunProps {
  level: MasterLevel;
  levelIdx: number;
  total: number;
  save: SaveData;
  onSave: (s: SaveData) => void;
  onNext: () => void;
  onRetry: () => void;
  onRestart: () => void;
}

/** 内层：一关的完整运行时。外层用 key 重挂载，所以这里所有状态都能直接从 `level` 初始化。 */
function MasterRun({ level, levelIdx, total, save, onSave, onNext, onRetry, onRestart }: MasterRunProps) {
  const [phase, setPhase] = useState<Phase>('brief');
  const [run, setRun] = useState<RunState>(() => freshRun(level));
  const [settle, setSettle] = useState<Settle | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; title: string; detail: string } | null>(null);
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  /** HUD 用的轻量镜像：rAF 循环里的时间/位置变化按 10Hz 同步过来，避免每帧 setState */
  const [hud, setHud] = useState({ timeLeft: -1, elapsed: 0, playerX: 0, nearActive: false });

  /* ---------- 场景引用 ---------- */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ scale: 1, offX: 0, offY: 0, cssScale: 1, cssOffX: 0, cssOffY: 0 });
  const playerRef = useRef<PlayerState>(createPlayer(120, level.world.groundY));
  const camRef = useRef<Camera>(createCamera());
  const inputRef = useRef<Input>({ left: false, right: false, jump: false });
  const nowRef = useRef(0);

  /** rAF 循环要读到最新的 meta，但不能进依赖数组（否则每帧重建循环） */
  const mirror = useRef({ phase, run, level, hoverPart });
  useLayoutEffect(() => {
    mirror.current = { phase, run, level, hoverPart };
  });

  /* ---------- DEV 验收探针（只在 dev 下挂 window.__masterGame） ----------
   * 有了它，浏览器验收脚本可以「读状态 + 把玩家放到某台设备旁」，
   * 不必靠模拟几十秒的长距离跑动去等一台设备，验收时间从分钟级降到秒级。 */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const probe: MasterProbe = {
      levelIndex: () => levelIdx,
      phase: () => mirror.current.phase,
      playerX: () => playerRef.current.x,
      playerY: () => playerRef.current.y,
      onGround: () => playerRef.current.onGround,
      stepKind: () => {
        const lv = mirror.current.level;
        const r = mirror.current.run;
        if (!lv || r.active < 0) return null;
        return lv.levels[r.active]?.steps[r.stepIdx]?.kind ?? null;
      },
      deviceX: (i) => mirror.current.level?.devices[i]?.x ?? 0,
      groundY: () => mirror.current.level?.world.groundY ?? 0,
      timeLeft: () => mirror.current.run.timeLeft,
      score: () => mirror.current.run.score,
      lives: () => mirror.current.run.lives,
      teleportTo: (i) => {
        const lv = mirror.current.level;
        const spec = lv?.devices[i];
        if (!lv || !spec) return;
        playerRef.current = { ...playerRef.current, x: spec.x - 60, y: lv.world.groundY, vx: 0, vy: 0, onGround: true };
        camRef.current = followCamera(camRef.current, playerRef.current, lv.world, 1);
      },
      setPlayerX: (x) => {
        const lv = mirror.current.level;
        if (!lv) return;
        playerRef.current = { ...playerRef.current, x, y: lv.world.groundY, vx: 0, vy: 0, onGround: true };
      },
      setTimeLeft: (seconds) => {
        setRun((r) => ({ ...r, timeLeft: seconds }));
      },
      /* 当前可点的目标（虚拟坐标）—— 让验收脚本能发真实鼠标事件，
       * 从而走完整条 "客户端坐标 → 虚拟坐标 → 世界坐标 → 命中" 的链路，
       * 而不是绕过点击直接调内部函数。 */
      targets: () => {
        const lv = mirror.current.level;
        const r = mirror.current.run;
        if (!lv) return { devices: [], spots: [], stepKind: null, answer: null };
        const devices = lv.devices.map((spec, i) => {
          const dv: DeviceVisual = {
            equipmentId: spec.equipmentId,
            name: spec.equipmentName,
            x: spec.x,
            state: r.done[i] ? 'cleared' : 'current',
            alarming: spec.alarming,
            active: false,
            grade: null,
          };
          const b = deviceHitBox(dv, camRef.current, lv.world.groundY);
          return { i, name: spec.equipmentName, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, done: r.done[i] };
        });
        const step = r.active >= 0 ? lv.levels[r.active]?.steps[r.stepIdx] : null;
        if (!step) return { devices, spots: [], stepKind: null, answer: null };
        if (step.kind === 'hunt') {
          const spec = lv.devices[r.active];
          const dv: DeviceVisual = {
            equipmentId: spec.equipmentId,
            name: spec.equipmentName,
            x: spec.x,
            state: 'current',
            alarming: spec.alarming,
            active: true,
            grade: null,
          };
          const spots = step.spots.map((s, i) => {
            const pos = partScreenPos(dv, partVisualFor(s.key, s.label, i), camRef.current, lv.world.groundY);
            return { key: s.key, label: s.label, x: pos.x, y: pos.y };
          });
          return { devices, spots, stepKind: 'hunt', answer: step.correctKey };
        }
        if (step.kind === 'tool') return { devices, spots: [], stepKind: 'tool', answer: step.correct };
        return { devices, spots: [], stepKind: 'order', answer: step.items.join(' → ') };
      },
    };
    (window as unknown as { __masterGame?: MasterProbe | null }).__masterGame = probe;
    return () => {
      (window as unknown as { __masterGame?: MasterProbe | null }).__masterGame = null;
    };
  }, [levelIdx]);

  /* ---------- 画布尺寸 ---------- */
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
      viewRef.current = {
        scale: scale * dpr,
        offX: ((rect.width - VIEW_W * scale) / 2) * dpr,
        offY: ((rect.height - VIEW_H * scale) / 2) * dpr,
        cssScale: scale,
        cssOffX: (rect.width - VIEW_W * scale) / 2,
        cssOffY: (rect.height - VIEW_H * scale) / 2,
      };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /* ---------- 键盘输入 ---------- */
  useEffect(() => {
    const map: Record<string, keyof Input> = {
      ArrowLeft: 'left',
      a: 'left',
      A: 'left',
      ArrowRight: 'right',
      d: 'right',
      D: 'right',
      ArrowUp: 'jump',
      w: 'jump',
      W: 'jump',
      ' ': 'jump',
    };
    const onDown = (e: KeyboardEvent) => {
      const k = map[e.key];
      if (!k) return;
      // 空格/方向键会滚动页面，必须拦掉
      e.preventDefault();
      inputRef.current[k] = true;
    };
    const onUp = (e: KeyboardEvent) => {
      const k = map[e.key];
      if (!k) return;
      e.preventDefault();
      inputRef.current[k] = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  /* ---------- 结算 ---------- */
  const finishLevel = useCallback(
    (success: boolean, r: RunState, lv: MasterLevel, reason: string) => {
      const deviceCount = lv.devices.length;
      const firstTry = Math.max(0, deviceCount - r.mistakes);
      const accuracy = deviceCount > 0 ? firstTry / deviceCount : 1;
      const grade: Grade = !success ? 'C' : r.mistakes === 0 && r.lives === MAX_LIVES ? 'S' : accuracy >= 0.66 ? 'A' : r.mistakes <= 3 ? 'B' : 'C';
      const timeSec = Math.round(r.elapsed);

      const before: SaveData = save;
      const rankBefore = rankFor({
        clearedLevels: before.cleared.length,
        bestTotal: before.bestScore,
        hasS: before.hasS,
      });
      const cleared = success && !before.cleared.includes(lv.index) ? [...before.cleared, lv.index] : before.cleared;
      const nextSave: SaveData = {
        cleared,
        bestScore: Math.max(before.bestScore, r.score),
        hasS: before.hasS || grade === 'S',
        grades: { ...before.grades, [String(lv.index)]: grade },
      };
      const rankAfter = rankFor({ clearedLevels: cleared.length, bestTotal: nextSave.bestScore, hasS: nextSave.hasS });
      writeSave(nextSave);
      onSave(nextSave);
      setSettle({
        success,
        grade,
        score: r.score,
        timeSec,
        mistakes: r.mistakes,
        rankBefore,
        rankAfter,
        hint: nextRankHint({ clearedLevels: cleared.length, bestTotal: nextSave.bestScore, hasS: nextSave.hasS }),
        reason,
      });
      setPhase('settle');
    },
    [save, onSave]
  );

  /* ---------- rAF 主循环 ---------- */
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let hudAcc = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!last) last = t;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      nowRef.current = t / 1000;

      const { phase: ph, run: r, level: lv } = mirror.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!lv || !ctx) return;

      const playing = ph === 'run' || ph === 'interact';

      // 物理：只在跑动阶段推进（面板打开时人物站住，避免"看着面板人还在跑"）
      if (playing) {
        const input: Input = ph === 'run' ? inputRef.current : { left: false, right: false, jump: false };
        playerRef.current = stepPlayer(playerRef.current, input, lv.world, dt);
        camRef.current = followCamera(camRef.current, playerRef.current, lv.world, dt);
      }

      // 计时
      if (ph === 'run' || ph === 'interact') {
        hudAcc += dt;
      }

      const view = viewRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#040a14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(view.scale, 0, 0, view.scale, view.offX, view.offY);

      const activeSpec = r.active >= 0 ? lv.devices[r.active] : null;
      const nearActive = !!activeSpec && nearDevice(playerRef.current, activeSpec.x);

      const devices: DeviceVisual[] = lv.devices.map((d, i) => ({
        equipmentId: d.equipmentId,
        name: d.equipmentName,
        x: d.x,
        state: r.done[i] ? 'cleared' : 'current',
        alarming: d.alarming && !r.done[i],
        active: nearActive && (r.active < 0 || r.active === i) && !r.done[i],
        grade: r.done[i] ? (save.grades[String(lv.index)] ?? '✓') : null,
      }));

      const step: LevelStep | null =
        activeSpec && r.active >= 0 ? (lv.levels[r.active]?.steps[r.stepIdx] ?? null) : null;
      const parts = buildParts(step, r, lv, activeSpec ? activeSpec.x : 0, camRef.current, lv.world.groundY);

      const scene: SceneState = {
        world: lv.world,
        player: playerRef.current,
        camera: camRef.current,
        devices,
        kind: lv.kind,
        now: nowRef.current,
        arrowTo: lv.arrowTo,
        parts,
        hoverPart: mirror.current.hoverPart,
        deviceOpen: ph === 'interact',
        paused: ph === 'settle' || ph === 'brief',
      };
      renderScene(ctx, scene);

      // HUD 按 10Hz 同步（每帧 setState 会把 React 拖垮）
      if (hudAcc > 0.1) {
        hudAcc = 0;
        setHud({ timeLeft: r.timeLeft, elapsed: r.elapsed, playerX: playerRef.current.x, nearActive });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [save.grades]);

  /* ---------- 计时推进（独立于渲染循环，便于暂停） ---------- */
  useEffect(() => {
    if (phase !== 'run' && phase !== 'interact') return;
    const timer = window.setInterval(() => {
      const lv = mirror.current.level;
      if (!lv) return;
      // 计时规则本身是纯函数（见 masterLevels.tickTimer）：全关限时烧完停在 0 由下面判负；
      // BOSS 战的分阶段限时则扣命 + 该阶段重新起表。这里只负责"把结果写回 state + 说给玩家听"。
      const t = tickTimer(mirror.current.run, lv, 0.25);
      setRun((prev) => ({
        ...prev,
        elapsed: prev.elapsed + 0.25,
        timeLeft: t.timeLeft,
        lives: t.lives,
        mistakes: t.mistakes,
      }));
      if (t.phaseTimedOut) {
        setFeedback({
          ok: false,
          title: '本阶段超时',
          detail: `扣 1 条命，本阶段重新计时 ${t.timeLeft}s`,
        });
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* ---------- 限时归零 / 生命耗尽 → 结算 ---------- */
  useEffect(() => {
    if (phase !== 'run' && phase !== 'interact') return;
    const lv = mirror.current.level;
    if (!lv) return;
    if (run.lives <= 0) {
      finishLevel(false, run, lv, '生命值耗尽 —— 检修中断');
      return;
    }
    if (run.timeLeft === 0) {
      // 只有"全关限时"的关卡会走到这里：BOSS 战的分阶段限时在 tickTimer 里就扣命并把
      // 该阶段重新起表了，timeLeft 不会停在 0（它判负走的是上面那条"生命耗尽"）。
      finishLevel(false, run, lv, lv.kind === 'emergency' ? '抢修超时，故障扩大' : '排查超时');
    }
    // finishLevel / run 是有意不放进依赖的：这里只在"归零那一刻"触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.timeLeft, run.lives, phase]);

  /* ---------- 判定 ---------- */

  const applyAnswer = useCallback(
    (ok: boolean, title: string, detail: string, opts: { countMistake?: boolean } = {}) => {
      const countMistake = opts.countMistake ?? !ok;
      setFeedback({ ok, title, detail });
      setRun((r) => ({
        ...r,
        score: r.score + (ok ? scoreStep({ firstTry: true, secondsLeft: 10 }, 'hunt') : 0),
        lives: !ok && countMistake ? r.lives - 1 : r.lives,
        mistakes: countMistake && !ok ? r.mistakes + 1 : r.mistakes,
      }));
    },
    []
  );

  const advance = useCallback(() => {
    const lv = mirror.current.level;
    if (!lv) return;
    const r = mirror.current.run;
    const spec = lv.devices[r.active];
    const devLevel = lv.levels[r.active];
    if (!spec || !devLevel) return;
    setFeedback(null);
    if (r.stepIdx + 1 >= devLevel.steps.length) {
      // 本台设备完成
      setRun((prev) => {
        const done = prev.done.map((v, i) => (i === prev.active ? true : v));
        const allDone = done.every(Boolean);
        const next: RunState = { ...prev, done, active: -1, stepIdx: 0, revealed: [], orderSeq: [] };
        if (allDone) {
          // 结算要读最新的 run，用 setTimeout(0) 把它推到下一轮宏任务，避免在 setState 里再 setState
          window.setTimeout(() => finishLevel(true, next, lv, '全部设备检修完成'), 0);
        }
        return next;
      });
    } else {
      setRun((prev) => {
        const nextStep = prev.stepIdx + 1;
        const limit = phaseLimitOf(lv, nextStep);
        return {
          ...prev,
          stepIdx: nextStep,
          orderSeq: [],
          revealed: [],
          // BOSS 战：每个阶段各有一段限时，进入下一阶段要重新起表
          timeLeft: limit > 0 ? limit : prev.timeLeft,
        };
      });
    }
  }, [finishLevel]);

  const onPickDevice = useCallback(
    (index: number) => {
      const lv = mirror.current.level;
      if (!lv) return;
      const spec = lv.devices[index];
      if (!nearDevice(playerRef.current, spec.x)) {
        setFeedback({ ok: false, title: '离得太远', detail: `${spec.equipmentName} 还在前面，先跑过去` });
        return;
      }
      if (mirror.current.run.done[index]) {
        setFeedback({ ok: true, title: '这台已经修好了', detail: '去下一台设备吧' });
        return;
      }
      setRun((r) => {
        const limit = phaseLimitOf(lv, 0);
        return {
          ...r,
          active: index,
          stepIdx: 0,
          revealed: [],
          orderSeq: [],
          // BOSS 战：开始修这台设备时，第 0 阶段重新起表
          timeLeft: limit > 0 ? limit : r.timeLeft,
        };
      });
      setFeedback(null);
      setPhase('interact');
    },
    []
  );

  /* ---------- 部位点击（第一步：排查 / 找故障点） ---------- */
  const onPickSpot = useCallback(
    (key: string) => {
      const lv = mirror.current.level;
      if (!lv) return;
      const r = mirror.current.run;
      const spec = lv.devices[r.active];
      const step = lv.levels[r.active]?.steps[r.stepIdx];
      if (!spec || !step || step.kind !== 'hunt') return;
      const spot = step.spots.find((s) => s.key === key);
      if (!spot) return;

      // 解谜关：点开即揭示读数，点错只多一次"探查"，不扣血（允许过程性试错）
      if (lv.kind === 'puzzle') {
        const already = r.revealed.includes(key);
        if (!already) setRun((prev) => ({ ...prev, revealed: [...prev.revealed, key] }));
        if (key === step.correctKey) {
          applyAnswer(true, `锁定根因：${spot.label}`, step.explain, { countMistake: false });
          window.setTimeout(advance, 900);
        } else {
          setRun((prev) => ({ ...prev, mistakes: already ? prev.mistakes : prev.mistakes + 1 }));
          setFeedback({
            ok: false,
            title: `${spot.label}：读数 ${spot.reading ?? '未接入'}`,
            detail: already ? '这个部位已经看过了，换个部位' : '该部位读数在正常范围内，继续排查',
          });
        }
        return;
      }

      if (key === step.correctKey) {
        applyAnswer(true, `命中 ${spot.label}`, step.explain);
        window.setTimeout(advance, 900);
      } else {
        applyAnswer(false, `点到了「${spot.label}」`, `读数 ${spot.reading ?? '未接入'} —— 这里不是异常点，再看仔细些`);
      }
    },
    [applyAnswer, advance]
  );

  /* ---------- 画布点击（屏幕 → 世界坐标，先部位后设备） ---------- */
  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const lv = mirror.current.level;
      if (!canvas || !lv) return;
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      const vx = (e.clientX - rect.left - view.cssOffX) / view.cssScale;
      const vy = (e.clientY - rect.top - view.cssOffY) / view.cssScale;

      const r = mirror.current.run;

      // 热点优先：只有正在检修的设备才有部位可点
      if (r.active >= 0) {
        const spec = lv.devices[r.active];
        const step = lv.levels[r.active]?.steps[r.stepIdx];
        if (spec && step?.kind === 'hunt') {
          const dv: DeviceVisual = {
            equipmentId: spec.equipmentId,
            name: spec.equipmentName,
            x: spec.x,
            state: 'current',
            alarming: spec.alarming,
            active: true,
            grade: null,
          };
          for (let i = 0; i < step.spots.length; i++) {
            const p = step.spots[i];
            const pos = partScreenPos(dv, partVisualFor(p.key, p.label, i), camRef.current, lv.world.groundY);
            if (Math.hypot(vx - pos.x, vy - pos.y) <= 16) {
              onPickSpot(p.key);
              return;
            }
          }
        }
      }

      // 设备命中
      for (let i = 0; i < lv.devices.length; i++) {
        const spec = lv.devices[i];
        const dv: DeviceVisual = {
          equipmentId: spec.equipmentId,
          name: spec.equipmentName,
          x: spec.x,
          state: r.done[i] ? 'cleared' : 'current',
          alarming: spec.alarming,
          active: false,
          grade: null,
        };
        const b = deviceHitBox(dv, camRef.current, lv.world.groundY);
        if (vx >= b.x0 && vx <= b.x1 && vy >= b.y0 && vy <= b.y1) {
          onPickDevice(i);
          return;
        }
      }
    },
    [onPickDevice, onPickSpot]
  );

  /* ---------- 工具 / 排序 ---------- */
  const onPickTool = useCallback(
    (tool: string) => {
      const lv = mirror.current.level;
      if (!lv) return;
      const r = mirror.current.run;
      const step = lv.levels[r.active]?.steps[r.stepIdx];
      if (!step || step.kind !== 'tool') return;
      if (tool === step.correct) {
        applyAnswer(true, `用对了：${tool}`, step.explain);
        window.setTimeout(advance, 900);
      } else {
        applyAnswer(false, `「${tool}」不合适`, step.explain);
      }
    },
    [applyAnswer, advance]
  );

  const onPickOrderItem = useCallback(
    (item: string) => {
      setRun((r) => (r.orderSeq.includes(item) ? r : { ...r, orderSeq: [...r.orderSeq, item] }));
      setFeedback(null);
    },
    []
  );

  const onSubmitOrder = useCallback(() => {
    const lv = mirror.current.level;
    if (!lv) return;
    const r = mirror.current.run;
    const step = lv.levels[r.active]?.steps[r.stepIdx];
    if (!step || step.kind !== 'order') return;
    if (r.orderSeq.length !== step.items.length) {
      setFeedback({ ok: false, title: '还没摆完', detail: `还有 ${step.items.length - r.orderSeq.length} 个动作没放进去` });
      return;
    }
    if (r.orderSeq.every((v, i) => v === step.items[i])) {
      applyAnswer(true, '顺序正确', step.explain);
      window.setTimeout(advance, 900);
    } else {
      applyAnswer(false, '顺序不对', `正确顺序：${step.items.map((v, i) => `${i + 1}. ${v}`).join(' → ')}`);
      setRun((prev) => ({ ...prev, orderSeq: [] }));
    }
  }, [applyAnswer, advance]);

  /* ---------- 渲染 ---------- */
  const spec = run.active >= 0 ? level.devices[run.active] : null;
  const step = run.active >= 0 ? (level.levels[run.active]?.steps[run.stepIdx] ?? null) : null;
  const rank = rankFor({ clearedLevels: save.cleared.length, bestTotal: save.bestScore, hasS: save.hasS });
  const nextHint = nextRankHint({ clearedLevels: save.cleared.length, bestTotal: save.bestScore, hasS: save.hasS });

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#040a14]">
      <div ref={hostRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="block h-full w-full cursor-pointer"
          onClick={onCanvasClick}
          onMouseMove={(e) => {
            const canvas = canvasRef.current;
            const lv = mirror.current.level;
            if (!canvas || !lv) return;
            const r = mirror.current.run;
            if (r.active < 0) {
              if (hoverPart !== null) setHoverPart(null);
              return;
            }
            const st = lv.levels[r.active]?.steps[r.stepIdx];
            if (!st || st.kind !== 'hunt') {
              if (hoverPart !== null) setHoverPart(null);
              return;
            }
            const rect = canvas.getBoundingClientRect();
            const view = viewRef.current;
            const vx = (e.clientX - rect.left - view.cssOffX) / view.cssScale;
            const vy = (e.clientY - rect.top - view.cssOffY) / view.cssScale;
            const s = lv.devices[r.active];
            const dv: DeviceVisual = {
              equipmentId: s.equipmentId,
              name: s.equipmentName,
              x: s.x,
              state: 'current',
              alarming: true,
              active: true,
              grade: null,
            };
            let hit: string | null = null;
            st.spots.forEach((sp, i) => {
              const pos = partScreenPos(dv, partVisualFor(sp.key, sp.label, i), camRef.current, lv.world.groundY);
              if (Math.hypot(vx - pos.x, vy - pos.y) <= 18) hit = sp.key;
            });
            if (hit !== hoverPart) setHoverPart(hit);
          }}
        />
      </div>

      {/* ================= HUD ================= */}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        {/* 顶栏：关卡进度 + 计时 */}
        <div className="flex items-start justify-between gap-3 p-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-cyan-400/30 bg-[rgba(8,18,34,0.82)] px-3 py-1.5 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-cyan-300/80">第</span>
                <span className="font-mono text-lg font-bold leading-none text-cyan-100">{level.index}</span>
                <span className="text-[11px] text-slate-400">/ {total} 关</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-300">{level.name}</div>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-amber-400/30 bg-[rgba(8,18,34,0.82)] px-2.5 py-2 backdrop-blur">
              <Trophy size={13} className="text-amber-300" />
              <span className="text-xs font-semibold text-amber-100">{RANK_NAME[rank]}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {hud.timeLeft >= 0 && (
              <div
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-lg font-bold backdrop-blur ${
                  hud.timeLeft <= 20
                    ? 'animate-pulse border-red-400/50 bg-[rgba(40,8,12,0.85)] text-red-300'
                    : 'border-cyan-400/30 bg-[rgba(8,18,34,0.82)] text-cyan-100'
                }`}
              >
                <Timer size={15} />
                {Math.ceil(hud.timeLeft)}s
              </div>
            )}
            <div className="rounded-lg border border-white/10 bg-[rgba(8,18,34,0.82)] px-3 py-1.5 backdrop-blur">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">已用</div>
              <div className="font-mono text-sm text-slate-200">{Math.floor(hud.elapsed)}s</div>
            </div>
          </div>
        </div>

        {/* 左侧：生命值 / 积分 / 本关目标 */}
        <div className="flex min-h-0 flex-1 gap-3 px-3">
          <div className="w-[176px] shrink-0 space-y-2">
            <div className="rounded-xl border border-cyan-400/25 bg-[rgba(8,18,34,0.82)] p-2.5 backdrop-blur">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">生命值</div>
              <div className="flex gap-1">
                {Array.from({ length: MAX_LIVES }).map((_, i) => (
                  <Heart
                    key={i}
                    size={17}
                    className={i < run.lives ? 'fill-rose-500 text-rose-400' : 'text-slate-700'}
                  />
                ))}
              </div>
              <div className="mt-2.5 flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">积分</span>
                <span className="font-mono text-xl font-bold text-cyan-100">{run.score}</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">失误</span>
                <span className="font-mono text-sm text-amber-200">{run.mistakes}</span>
              </div>
            </div>

            <div className="rounded-xl border border-cyan-400/25 bg-[rgba(8,18,34,0.82)] p-2.5 backdrop-blur">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">
                本关目标 {run.done.filter(Boolean).length}/{level.devices.length}
              </div>
              <div className="space-y-1">
                {level.devices.map((d, i) => (
                  <div key={d.equipmentId + i} className="flex items-center gap-1.5 text-[11px]">
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                        run.done[i] ? 'bg-emerald-400' : d.alarming ? 'animate-pulse bg-red-400' : 'bg-amber-400'
                      }`}
                    />
                    <span className={run.done[i] ? 'text-emerald-300 line-through' : 'truncate text-slate-300'}>
                      {d.equipmentName}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {nextHint && (
              <div className="rounded-xl border border-white/10 bg-[rgba(8,18,34,0.7)] p-2.5 text-[10px] leading-relaxed text-slate-400 backdrop-blur">
                {nextHint}
              </div>
            )}
          </div>

          {/* 右侧留给面板 */}
          <div className="pointer-events-none flex min-h-0 flex-1 items-end justify-center pb-3">
            {phase === 'interact' && step && spec && (
              <div className="pointer-events-auto w-full max-w-[620px]">
                {step.kind === 'hunt' && (
                  <HuntPanel
                    step={step}
                    puzzle={level.kind === 'puzzle'}
                    revealed={run.revealed}
                    onPick={onPickSpot}
                    feedback={feedback}
                  />
                )}
                {step.kind === 'tool' && <ToolPanel step={step} onPick={onPickTool} feedback={feedback} />}
                {step.kind === 'order' && (
                  <OrderPanel
                    step={step}
                    seq={run.orderSeq}
                    onPick={onPickOrderItem}
                    onClear={() => setRun((r) => ({ ...r, orderSeq: [] }))}
                    onSubmit={onSubmitOrder}
                    feedback={feedback}
                  />
                )}
              </div>
            )}
            {/* 跑动阶段没有面板，但"阶段超时扣命"这类反馈必须让玩家看见 ——
                否则只是生命值悄悄少一格、计时器悄悄跳回去，玩家不知道发生了什么。 */}
            {phase !== 'interact' && feedback && (
              <div className="w-full max-w-[620px] px-1">
                <FeedbackLine feedback={feedback} />
              </div>
            )}
          </div>
        </div>

        {/* 底栏：操作提示 */}
        <div className="px-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-400/20 bg-[rgba(8,18,34,0.82)] px-3 py-2 backdrop-blur">
            <div className="flex items-center gap-4 text-[11px] text-slate-300">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">A</kbd>
                <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">D</kbd>
                移动
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">空格</kbd>
                跳跃
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">鼠标</kbd>
                点击设备 / 部位
              </span>
            </div>
            <div className="text-[11px] font-semibold text-cyan-200">{hintFor(level, run, hud.nearActive, phase)}</div>
          </div>
        </div>
      </div>

      {/* ================= 开场 / 结算 ================= */}
      {phase === 'brief' && (
        <BriefCard
          level={level}
          total={total}
          onStart={() => setPhase('run')}
        />
      )}
      {phase === 'settle' && settle && (
        <SettlePanel
          settle={settle}
          isLast={levelIdx >= total - 1}
          onNext={onNext}
          onRetry={onRetry}
          onRestart={onRestart}
        />
      )}
    </div>
  );
}

/* ============================ 面板 ============================ */

/** 部位在设备周围的固定摆位（6 个测点围一圈，与渲染层共用同一套坐标） */
const PART_SLOTS: Array<[number, number]> = [
  [-86, -30],
  [86, -30],
  [-92, 26],
  [92, 26],
  [0, -66],
  [0, 34],
];

function partVisualFor(key: string, label: string, index: number): PartVisual {
  const slot = PART_SLOTS[index % PART_SLOTS.length];
  return { key, label, dx: slot[0], dy: slot[1], revealed: false, culprit: false };
}

/** 组装渲染层要的部位热点（含"是否已揭示 / 是否根因"） */
function buildParts(
  step: LevelStep | null,
  run: RunState,
  level: MasterLevel,
  _deviceX: number,
  _cam: Camera,
  _groundY: number
): PartVisual[] {
  if (!step || step.kind !== 'hunt') return [];
  if (level.kind !== 'puzzle' && level.kind !== 'boss') return [];
  return step.spots.map((s, i) => ({
    ...partVisualFor(s.key, s.label, i),
    revealed: run.revealed.includes(s.key),
    culprit: s.key === step.correctKey && run.revealed.includes(s.key),
  }));
}

function hintFor(level: MasterLevel, run: RunState, near: boolean, phase: Phase): string {
  if (phase === 'brief') return '点击「开始」进入关卡';
  if (phase === 'settle') return '本关结束';
  if (phase === 'interact') return '选好后自动判定';
  const pending = level.devices.findIndex((_, i) => !run.done[i]);
  if (pending < 0) return '全部完成';
  const d = level.devices[pending];
  if (level.kind === 'tutorial') {
    return near ? '到了！点击设备开始检修' : '跟着箭头跑到设备旁（A / D 移动，空格跳跃）';
  }
  if (level.kind === 'emergency') return near ? '点击设备处理故障' : '倒计时内跑到报警设备旁';
  if (level.kind === 'puzzle') return near ? '点击设备开始排查' : `前往 ${d.equipmentName}`;
  return near ? '点击设备开始 BOSS 检修' : `前往 ${d.equipmentName}`;
}

function PanelShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-cyan-400/30 bg-[rgba(6,14,26,0.94)] p-3.5 shadow-[0_0_40px_rgba(34,211,238,0.12)] backdrop-blur">
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-cyan-100">{title}</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function FeedbackLine({ feedback }: { feedback: { ok: boolean; title: string; detail: string } | null }) {
  if (!feedback) return null;
  return (
    <div
      className={`mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] leading-relaxed ${
        feedback.ok
          ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
          : 'border-rose-400/40 bg-rose-400/10 text-rose-200'
      }`}
    >
      <span className="font-semibold">{feedback.title}</span>
      <span className="ml-1.5 text-slate-300">{feedback.detail}</span>
    </div>
  );
}

function HuntPanel({
  step,
  puzzle,
  revealed,
  onPick,
  feedback,
}: {
  step: Extract<LevelStep, { kind: 'hunt' }>;
  puzzle: boolean;
  revealed: string[];
  onPick: (key: string) => void;
  feedback: { ok: boolean; title: string; detail: string } | null;
}) {
  return (
    <PanelShell
      title={puzzle ? '逐个部位排查' : '找出异常部位'}
      subtitle={puzzle ? '点开部位看真实读数，读数越限的那个就是根因（点错不扣血，只多一次探查）' : step.prompt}
    >
      <div className="flex flex-wrap gap-2">
        {step.spots.map((s) => {
          const seen = revealed.includes(s.key);
          const showReading = !puzzle || seen;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onPick(s.key)}
              className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                seen && puzzle
                  ? 'border-amber-400/50 bg-amber-400/10'
                  : 'border-cyan-400/25 bg-white/[0.03] hover:border-cyan-300/60 hover:bg-cyan-400/10'
              }`}
            >
              <div className="text-[12px] font-semibold text-slate-100">{s.label}</div>
              <div className="mt-0.5 font-mono text-[11px] text-cyan-200">
                {showReading ? (s.reading ?? '未接入') : '点击查看读数'}
              </div>
            </button>
          );
        })}
      </div>
      <FeedbackLine feedback={feedback} />
    </PanelShell>
  );
}

function ToolPanel({
  step,
  onPick,
  feedback,
}: {
  step: Extract<LevelStep, { kind: 'tool' }>;
  onPick: (tool: string) => void;
  feedback: { ok: boolean; title: string; detail: string } | null;
}) {
  return (
    <PanelShell title="选择检修工具" subtitle={step.prompt}>
      <div className="flex flex-wrap gap-2">
        {step.options.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className="group flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-white/[0.03] px-3 py-2 transition-colors hover:border-cyan-300/60 hover:bg-cyan-400/10"
          >
            <Wrench size={15} className="text-cyan-300" />
            <span className="text-[12px] font-semibold text-slate-100">{t}</span>
          </button>
        ))}
      </div>
      <FeedbackLine feedback={feedback} />
    </PanelShell>
  );
}

function OrderPanel({
  step,
  seq,
  onPick,
  onClear,
  onSubmit,
  feedback,
}: {
  step: Extract<LevelStep, { kind: 'order' }>;
  seq: string[];
  onPick: (item: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  feedback: { ok: boolean; title: string; detail: string } | null;
}) {
  const remaining = step.items.filter((i) => !seq.includes(i));
  return (
    <PanelShell title="按正确顺序操作" subtitle="把规程里的动作按先后顺序点进槽位">
      <div className="mb-2 space-y-1.5">
        {seq.map((it, i) => (
          <div key={it} className="flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.07] px-2.5 py-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-cyan-400/20 font-mono text-[11px] font-bold text-cyan-100">
              {i + 1}
            </span>
            <span className="text-[11px] leading-snug text-slate-100">{it}</span>
          </div>
        ))}
        {seq.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/15 px-2.5 py-3 text-center text-[11px] text-slate-500">
            按顺序点下面的动作，第一个点的就是第 1 步
          </div>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {remaining.map((it) => (
          <button
            key={it}
            type="button"
            onClick={() => onPick(it)}
            className="rounded-lg border border-white/15 bg-white/[0.03] px-2.5 py-1.5 text-left text-[11px] leading-snug text-slate-200 transition-colors hover:border-cyan-300/50 hover:bg-cyan-400/10"
          >
            {it}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={seq.length !== step.items.length}
          className="rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          提交顺序
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/[0.08]"
        >
          清空
        </button>
      </div>
      <FeedbackLine feedback={feedback} />
    </PanelShell>
  );
}

function BriefCard({ level, total, onStart }: { level: MasterLevel; total: number; onStart: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[rgba(4,10,20,0.72)] p-6">
      <div className="w-full max-w-[520px] rounded-2xl border border-cyan-400/35 bg-[rgba(6,14,26,0.96)] p-6 shadow-[0_0_60px_rgba(34,211,238,0.15)]">
        <div className="mb-1 flex items-center gap-2">
          <Zap size={16} className="text-cyan-300" />
          <span className="text-[11px] uppercase tracking-[0.2em] text-cyan-300/80">第 {level.index} / {total} 关</span>
        </div>
        <h2 className="text-2xl font-bold text-cyan-50">{level.name}</h2>
        <p className="mt-3 text-[13px] leading-relaxed text-slate-300">{level.brief}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-slate-300">
            {level.timeLimit > 0 ? `全关限时 ${level.timeLimit}s` : level.phaseSeconds.length ? '分阶段限时' : '不限时'}
          </span>
          <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-slate-300">
            目标设备 {level.devices.length} 台
          </span>
          {level.phaseSeconds.length > 0 && (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-amber-200">
              各阶段 {level.phaseSeconds.map((s) => `${s}s`).join(' / ')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onStart}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/50 bg-cyan-400/20 px-4 py-2.5 text-sm font-bold text-cyan-50 transition-colors hover:bg-cyan-400/30"
        >
          <Hammer size={16} />
          开始检修
        </button>
      </div>
    </div>
  );
}

function SettlePanel({
  settle,
  isLast,
  onNext,
  onRetry,
  onRestart,
}: {
  settle: Settle;
  isLast: boolean;
  onNext: () => void;
  onRetry: () => void;
  onRestart: () => void;
}) {
  const color = GRADE_COLOR[settle.grade];
  const promoted = settle.rankAfter !== settle.rankBefore;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[rgba(4,10,20,0.76)] p-6">
      <div className="w-full max-w-[480px] rounded-2xl border border-cyan-400/35 bg-[rgba(6,14,26,0.96)] p-6 text-center shadow-[0_0_60px_rgba(34,211,238,0.15)]">
        <div className="text-lg font-bold text-cyan-50">{settle.success ? '检修完成' : '检修失败'}</div>
        <div className="mt-0.5 text-[11px] text-slate-400">{settle.reason}</div>

        <div
          className="mx-auto mt-4 flex h-24 w-24 items-center justify-center rounded-full border-2"
          style={{ borderColor: color, boxShadow: `0 0 34px ${color}66`, background: `${color}14` }}
        >
          <span className="font-mono text-5xl font-black" style={{ color }}>
            {settle.grade}
          </span>
        </div>
        <div className="mt-2 text-[12px] text-slate-300">{GRADE_TEXT[settle.grade]}</div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { k: '总得分', v: String(settle.score), c: 'text-cyan-100' },
            { k: '总用时', v: `${settle.timeSec}s`, c: 'text-slate-100' },
            { k: '失误', v: String(settle.mistakes), c: 'text-amber-200' },
          ].map((x) => (
            <div key={x.k} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">{x.k}</div>
              <div className={`mt-0.5 font-mono text-lg font-bold ${x.c}`}>{x.v}</div>
            </div>
          ))}
        </div>

        {promoted && (
          <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[12px] font-semibold text-amber-100">
            🎉 职称晋升：{RANK_NAME[settle.rankBefore]} → {RANK_NAME[settle.rankAfter]}
          </div>
        )}
        {!promoted && settle.hint && <div className="mt-3 text-[11px] text-slate-400">{settle.hint}</div>}

        <div className="mt-5 flex items-center justify-center gap-2">
          {settle.success && !isLast ? (
            <button
              type="button"
              onClick={onNext}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-400/50 bg-cyan-400/20 px-4 py-2 text-sm font-bold text-cyan-50 transition-colors hover:bg-cyan-400/30"
            >
              下一关 <ArrowRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-400/50 bg-cyan-400/20 px-4 py-2 text-sm font-bold text-cyan-50 transition-colors hover:bg-cyan-400/30"
            >
              <RotateCcw size={15} /> 再试一次
            </button>
          )}
          {settle.success && isLast && (
            <button
              type="button"
              onClick={onRestart}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-white/[0.09]"
            >
              从第 1 关重玩
            </button>
          )}
          {!settle.success && (
            <button
              type="button"
              onClick={onRestart}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-white/[0.09]"
            >
              <ArrowLeft size={15} /> 回第 1 关
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center justify-center gap-1 text-[10px] text-slate-500">
          <Info size={11} />
          题目均来自真实检修规程与真实遥测读数
        </div>
      </div>
    </div>
  );
}

/** 供验收探针读取的内部状态（仅 DEV 下挂在 window.__masterGame 上，见上方 effect） */
export interface MasterProbe {
  levelIndex: () => number;
  phase: () => Phase;
  playerX: () => number;
  playerY: () => number;
  onGround: () => boolean;
  stepKind: () => string | null;
  deviceX: (i: number) => number;
  groundY: () => number;
  timeLeft: () => number;
  score: () => number;
  lives: () => number;
  /** 直接把玩家放到某台设备旁（省掉长距离跑动，验收用） */
  teleportTo: (i: number) => void;
  setPlayerX: (x: number) => void;
  /**
   * 直接改剩余限时（验收用）。
   *
   * 为什么需要：BOSS 战的阶段限时是 40/30/55 秒，真等一轮要 40 秒 ——
   * "阶段超时会扣命并重新起表"这条规则就没法在验收里验了（只能靠单测）。
   * 把它拨到 0.2 秒，就能在几百毫秒内看到完整效果。
   */
  setTimeLeft: (seconds: number) => void;
  /** 当前可点目标（虚拟坐标，960×540 系）与当前步骤的正确答案 */
  targets: () => {
    devices: Array<{ i: number; name: string; x: number; y: number; done: boolean }>;
    spots: Array<{ key: string; label: string; x: number; y: number }>;
    stepKind: string | null;
    answer: string | null;
  };
}

/** 玩家碰撞盒（导出给测试用） */
export const PLAYER_HITBOX = playerBox;
