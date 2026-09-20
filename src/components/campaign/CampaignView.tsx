/**
 * 《庖丁检修师》七幕主线 —— 页面壳。
 *
 * 职责边界：
 * - 壳只管**幕序、总计时、3D 舞台、结算**；每一幕的玩法与接口调用都在 `acts/*` 里，
 *   幕组件只拿到 `ActProps`（见 `actContract.ts`），不知道下一幕是什么。
 * - 舞台（WebGL + 数字人 GLB）整场只挂一次：切幕重建会掉相机、重下 6.4MB 模型，
 *   所以幕组件通过 `StageBridge` 下指令，而不是各自持有场景。
 *
 * 数据红线：等级/经验/成就是游戏元数据，只写本地（`campaignProgress.ts`）；
 * 主线里出现的每一台设备、每一条读数、每一张工单都来自真实接口，
 * 拿不到就显示"未接入/未获取"，绝不用 mock 撑流程。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, Flag } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import type { MaintenanceProcedure, UserProfile } from '../../types';
import { safeStorage } from '../../api';
import { GameSceneView } from '../game/GameSceneView';
import type { FaultSpotSpec, GameScene, GameSceneHooks } from '../game/gameScene';
import type { CharacterMood } from '../game/gameCharacter';
import { findProcedureForEquipment, fetchProcedures } from '../game/gameData';
import type { Grade } from '../game/levelPlay';
import { cancelSpeech, isSpeechSupported, SPEECH_ENABLED_KEY, speakChinese } from '../digital-human/speech';
import { ACTS, actOf, actScoreOf, buildStations, nextAct, rankFor, runGrade, runTotalScore, type ActId, type ActOutcome } from './campaignModel';
import {
  applyRun,
  EMPTY_PROGRESS,
  loadProgress,
  PROGRESS_KEY,
  resetProgress,
  saveProgress,
  type CampaignProgress,
  type FinishedRun,
  type RunSettlement,
} from './campaignProgress';
import { EMPTY_RUN, type ActComponent, type ActProps, type RunContext, type StageBridge } from './actContract';
import { ActOverview } from './acts/ActOverview';
import { ActIncident } from './acts/ActIncident';
import { ActDiagnose } from './acts/ActDiagnose';
import { ApiNotice, ActFooter, DataRow, Panel } from './CampaignPanels';
import '../equipment3d/equipment-industrial.css';
import './campaign.css';

/** 已实现的幕；未列出的幕在界面上如实标"待接入"，不会静默跳过也不会在结算里冒充走完 */
const ACT_REGISTRY: Partial<Record<ActId, ActComponent>> = {
  overview: ActOverview,
  incident: ActIncident,
  diagnose: ActDiagnose,
};

const ACHIEVEMENT_NAME: Record<string, string> = {
  first_run: '首次独立检修',
  zero_mistake: '零失误通关',
  fastest: '最快维修记录',
  s_grade: '完美检修',
  loto_first: '第一把锁',
  ai_teamwork: '人机协同',
  qc_eye: '火眼金睛',
  knowledge: '经验留得下',
};

const GRADE_ORDER: Grade[] = ['C', 'B', 'A', 'S'];

type Phase = 'intro' | 'running' | 'settled';

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function CampaignView(props: { currentUser: UserProfile | null }) {
  const { equipments, isInitialLoading } = useAppData();
  const [phase, setPhase] = useState<Phase>('intro');
  const [actId, setActId] = useState<ActId>('overview');
  const [run, setRun] = useState<RunContext>(() => ({ ...EMPTY_RUN }));
  const [outcomes, setOutcomes] = useState<ActOutcome[]>([]);
  const [progress, setProgress] = useState<CampaignProgress>(() => loadProgress());
  const [settlement, setSettlement] = useState<RunSettlement | null>(null);
  const [mistakes, setMistakes] = useState(0);

  // ---- 整场共用的 3D 舞台 ----
  const sceneRef = useRef<GameScene | null>(null);
  const pickHandlerRef = useRef<((id: string) => void) | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [faultSpots, setFaultSpots] = useState<FaultSpotSpec[] | null>(null);
  const [mood, setMood] = useState<CharacterMood>('idle');

  const [speechOn, setSpeechOn] = useState(() => safeStorage.getItem(SPEECH_ENABLED_KEY) !== '0');
  const speechOnRef = useRef(speechOn);
  useEffect(() => {
    speechOnRef.current = speechOn;
  }, [speechOn]);

  const [elapsed, setElapsed] = useState(0);
  /** 主线起点只在 begin() 里写，渲染期不碰 Date.now()（react-hooks/purity） */
  const runStartRef = useRef(0);

  // 规程匹配决定哪些设备能走完全程（第 5 幕的步骤全部取自真实规程）
  const [procedures, setProcedures] = useState<MaintenanceProcedure[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchProcedures().then((list) => {
      if (alive) setProcedures(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const bestGradeOf = useCallback(
    (id: string): string | null => {
      const hits = progress.history.filter((h) => h.equipmentId === id);
      if (!hits.length) return null;
      return hits.reduce(
        (best, h) => (GRADE_ORDER.indexOf(h.grade as Grade) >= GRADE_ORDER.indexOf(best as Grade) ? h.grade : best),
        hits[0].grade
      );
    },
    [progress.history]
  );

  const stations = useMemo(
    () =>
      buildStations(equipments, {
        playableIds: equipments.filter((eq) => findProcedureForEquipment(eq, procedures) !== null).map((eq) => eq.id),
        clearedIds: progress.clearedEquipmentIds,
        bestGradeOf,
      }),
    [equipments, procedures, progress.clearedEquipmentIds, bestGradeOf]
  );

  const stage = useMemo<StageBridge>(
    () => ({
      setFocused: (id) => setFocusedId(id),
      setFaultSpots: (spots) => setFaultSpots(spots),
      setMood: (m) => setMood(m),
      dive: (id) => {
        setFocusedId(id);
        sceneRef.current?.diveTo(id);
      },
      scene: () => sceneRef.current,
      onPick: (handler) => {
        pickHandlerRef.current = handler;
      },
    }),
    []
  );

  const hooks = useMemo<GameSceneHooks>(
    () => ({
      onStationPick: (id) => pickHandlerRef.current?.(id),
      onHover: () => undefined,
    }),
    []
  );

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - runStartRef.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => () => cancelSpeech(), []);

  const narrate = useCallback((text: string) => {
    if (!speechOnRef.current || !isSpeechSupported()) return;
    void speakChinese(text, { gender: 'male', maxChars: 160 });
  }, []);

  const begin = () => {
    setPhase('running');
    setActId('overview');
    setRun({ ...EMPTY_RUN });
    setOutcomes([]);
    setSettlement(null);
    setMistakes(0);
    setElapsed(0);
    setMood('idle');
    setFocusedId(null);
    setFaultSpots(null);
    runStartRef.current = Date.now();
    narrate('你是新上任的检修主管。第一幕，先看清全厂的家底。');
  };

  const onResetProgress = () => {
    resetProgress();
    setProgress({ ...EMPTY_PROGRESS });
    setSettlement(null);
    setOutcomes([]);
    setRun({ ...EMPTY_RUN });
    setPhase('intro');
  };

  const settle = useCallback(
    (all: ActOutcome[], context: RunContext) => {
      const totalSeconds = Math.max(1, Math.round((Date.now() - runStartRef.current) / 1000));
      const finished: FinishedRun = {
        equipmentId: context.incident?.equipment.id ?? '',
        equipmentName: context.incident?.equipment.name ?? '未选定设备',
        workOrderId: context.workOrderId,
        orderNo: context.orderNo,
        outcomes: all,
        totalSeconds,
        mistakes: all.reduce((s, o) => s + o.mistakes, 0),
        grade: runGrade(all),
        score: runTotalScore(all),
        completed: all.length === ACTS.length,
        flags: {
          lotoRegistered: context.lotoLockNo !== null,
          usedAiDiagnose: context.diagnosis !== null,
          usedAiPlan: context.plan !== null,
          visionQc: context.qcPass !== null,
          knowledgeContributed: context.contributionTitle !== null,
        },
      };
      const result = applyRun(progress, finished);
      saveProgress(result.progress);
      setProgress(result.progress);
      setSettlement(result);
      setPhase('settled');
      setFocusedId(null);
      setFaultSpots(null);
      setMood(result.record.grade === 'C' ? 'regret' : 'celebrate');
      narrate(
        result.xpGained > 0
          ? `本单收工，评级 ${result.record.grade}，得分 ${result.record.score}，经验加 ${result.xpGained}。`
          : `本单收工，评级 ${result.record.grade}。七幕还没走完，这次不计经验。`
      );
    },
    [narrate, progress]
  );

  const finishAct = useCallback(
    (outcome: ActOutcome, patch?: Partial<RunContext>) => {
      const nextRun: RunContext = patch ? { ...run, ...patch } : run;
      const all = [...outcomes.filter((o) => o.actId !== outcome.actId), outcome];
      setRun(nextRun);
      setOutcomes(all);
      const upcoming = nextAct(outcome.actId);
      if (!upcoming || !ACT_REGISTRY[upcoming.id]) {
        // 后续幕次未接入（或已走到第 7 幕）：按已走过的幕结算；没走满七幕时 applyRun 不给 XP
        settle(all, nextRun);
        return;
      }
      setActId(upcoming.id);
      narrate(`${upcoming.index}，${upcoming.title}。${upcoming.brief}`);
    },
    [narrate, outcomes, run, settle]
  );

  const countMistake = useCallback(() => setMistakes((n) => n + 1), []);

  const actDef = actOf(actId);
  const ActComp = ACT_REGISTRY[actId];
  const rank = rankFor(progress.xp);
  const actProps: ActProps = { actId, run, stage, stations, currentUser: props.currentUser, finish: finishAct, countMistake };

  return (
    <div className="relative h-full min-h-[560px] w-full overflow-hidden bg-[#050c17] text-slate-200">
      <GameSceneView
        className="absolute inset-0"
        stations={stations}
        hooks={hooks}
        focusedId={focusedId}
        mood={mood}
        faultSpots={faultSpots}
        onReady={(scene) => {
          sceneRef.current = scene;
        }}
      />

      {/* 覆盖层不吃鼠标事件，3D 点位才点得中；需要交互的面板各自再打开 pointer-events */}
      <div className="pointer-events-none relative z-10 flex h-full flex-col gap-2 p-2.5">
        <header className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-cyan-400/25 bg-[rgba(6,13,26,0.85)] px-3 py-2 backdrop-blur">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-wide text-cyan-100">庖丁检修师 · 七幕主线</div>
            <div className="truncate text-[10px] text-slate-500">
              {phase === 'running'
                ? `第 ${actDef.index} 幕 ${actDef.title} · 对应功能：${actDef.feature}`
                : phase === 'settled'
                  ? '本单已结算'
                  : '开工前的工位交底'}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {ACTS.map((a) => {
              const done = outcomes.some((o) => o.actId === a.id);
              const current = phase === 'running' && a.id === actId;
              return (
                <span
                  key={a.id}
                  title={ACT_REGISTRY[a.id] ? `第 ${a.index} 幕 ${a.title}` : `第 ${a.index} 幕 ${a.title}（界面待接入）`}
                  className={`hud-tabular-nums flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${
                    done
                      ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200'
                      : current
                        ? 'campaign-act-sweep border-cyan-300/70 bg-cyan-400/20 text-cyan-100'
                        : ACT_REGISTRY[a.id]
                          ? 'border-white/15 text-slate-400'
                          : 'border-slate-700/70 text-slate-600'
                  }`}
                >
                  {a.index}
                </span>
              );
            })}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div
              className="rounded-md border border-violet-400/35 bg-violet-400/8 px-2 py-1 text-[10px] font-semibold text-violet-200"
              title={`经验 ${progress.xp}，下一级 ${rank.next ? `${rank.next.title}（${rank.next.minXp} XP）` : '已满级'}`}
            >
              Lv.{rank.current.level} {rank.current.title}
              <span className="ml-1.5 inline-block h-1 w-14 translate-y-0.5 rounded bg-white/10 align-middle">
                <span className="block h-full rounded bg-violet-400/80" style={{ width: `${Math.round(rank.progress * 100)}%` }} />
              </span>
            </div>
            <div className="hud-tabular-nums rounded-md border border-cyan-400/30 bg-cyan-400/5 px-2 py-1 text-xs font-bold text-cyan-200">⏱ {mmss(elapsed)}</div>
            <button
              type="button"
              onClick={() => {
                const next = speechOn ? false : true;
                safeStorage.setItem(SPEECH_ENABLED_KEY, next ? '1' : '0');
                setSpeechOn(next);
                if (!next) cancelSpeech();
                else narrate('讲解已打开。');
              }}
              title={speechOn ? '数字人语音讲解：开' : '数字人语音讲解：关'}
              className="rounded-md border border-white/15 px-1.5 py-1 text-slate-300 hover:border-cyan-400/40"
            >
              {speechOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
            {phase === 'running' && (
              <button
                type="button"
                onClick={() => settle(outcomes, run)}
                className="flex items-center gap-1 rounded-md border border-rose-400/35 bg-rose-400/8 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-400/15"
              >
                <Flag size={12} /> 结束并结算
              </button>
            )}
          </div>
        </header>

        {/* 左列整个留给 3D 舞台，幕面板固定在右侧；窄屏时面板独占一列 */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(330px,400px)]">
          <div className="pointer-events-auto flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5 lg:order-2">
            {isInitialLoading && <ApiNotice kind="empty" text="台账正在从后端加载，加载完成后再开始主线。" />}
            {phase === 'intro' && <IntroPanel progress={progress} rankTitle={`${rank.current.level} · ${rank.current.title}`} onStart={begin} onReset={onResetProgress} />}
            {phase === 'running' &&
              (ActComp ? (
                <ActComp key={actId} {...actProps} />
              ) : (
                <PendingAct actId={actId} mistakes={mistakes} />
              ))}
            {phase === 'settled' && settlement && <SettlePanel settlement={settlement} outcomes={outcomes} run={run} onBack={() => setPhase('intro')} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 界面待接入的幕：只报真实定义，不做假交互 */
function PendingAct(props: { actId: ActId; mistakes: number }) {
  const def = actOf(props.actId);
  return (
    <Panel title={`第 ${def.index} 幕 · ${def.title}`} accent="amber">
      <p className="text-[11px] leading-relaxed text-slate-300">{def.brief}</p>
      <div className="mt-1 text-[10px] text-slate-500">对应功能：{def.feature}</div>
      <div className="mt-1.5">
        <ApiNotice kind="empty" text="这一幕的界面在下一批接入。前面各幕的真实成绩可以先结算，未走满七幕不计经验。" />
      </div>
    </Panel>
  );
}

/* ============================ 开场交底 ============================ */

function IntroPanel(props: { progress: CampaignProgress; rankTitle: string; onStart: () => void; onReset: () => void }) {
  const { progress, rankTitle, onStart, onReset } = props;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Panel title="工位交底 · 你是新上任的检修主管" accent="cyan">
        <p className="text-[11px] leading-relaxed text-slate-300">
          七幕主线就是项目的一条业务闭环：看运转、报故障、AI 诊断、定方案、现场检修、AI 质检、归档复盘。
          每一幕调的都是系统里的真接口，玩完一遍即走通一遍全流程。
        </p>
        <div className="mt-1.5 space-y-0.5">
          {ACTS.map((a) => (
            <div key={a.id} className="flex items-baseline gap-2 text-[11px]">
              <span className="hud-tabular-nums w-4 shrink-0 text-cyan-300">{a.index}</span>
              <span className="w-16 shrink-0 font-semibold text-slate-200">{a.title}</span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{a.feature}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="检修档案（本地进度）" accent="emerald">
        <DataRow label="等级" value={rankTitle} />
        <DataRow label="累计经验" value={`${progress.xp} XP`} />
        <DataRow label="完成主线" value={`${progress.runs} 次`} />
        <DataRow label="最佳评级" value={progress.bestGrade ?? '尚无'} tone={progress.bestGrade === 'S' ? 'good' : 'default'} />
        <DataRow label="最短用时" value={progress.bestRunSeconds === null ? '尚无' : mmss(progress.bestRunSeconds)} />
        <DataRow label="已通关设备" value={`${progress.clearedEquipmentIds.length} 台`} />
        <div className="mt-1 text-[10px] text-slate-500">
          成就 {progress.achievements.length} 枚；进度存于 localStorage（{PROGRESS_KEY}），不写后端库。
        </div>
      </Panel>
      <ActFooter
        hint="进度只存在本机浏览器，工单/LOTO/备件/知识库都是系统真实数据。"
        primary={{ text: '开始今天的第一单', onClick: onStart, disabled: false }}
        secondary={progress.runs > 0 ? { text: '清空档案', onClick: onReset } : undefined}
      />
    </div>
  );
}

/* ============================ 结算 ============================ */

function SettlePanel(props: { settlement: RunSettlement; outcomes: ActOutcome[]; run: RunContext; onBack: () => void }) {
  const { settlement, outcomes, run, onBack } = props;
  const { record } = settlement;
  const achievements = settlement.newAchievements.map((id) => ACHIEVEMENT_NAME[id] ?? id).join('、');
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Panel title="本单结算" accent="amber">
        <div className="flex items-center gap-3">
          <div className="hud-value-glow rounded-lg border border-amber-400/45 bg-amber-400/10 px-3 py-1.5 text-2xl font-black text-amber-200">{record.grade}</div>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-slate-100">{record.equipmentName}</div>
            <div className="truncate text-[10px] text-slate-500">{record.orderNo ? `工单 ${record.orderNo}` : '未开单'}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="hud-tabular-nums text-lg font-bold text-cyan-200">{record.score}</div>
            <div className="text-[10px] text-slate-500">得分</div>
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 border-t border-white/10 pt-1.5">
          <DataRow label="用时" value={mmss(record.seconds)} />
          <DataRow label="失误" value={`${record.mistakes} 次`} tone={record.mistakes ? 'bad' : 'good'} />
          <DataRow label="经验" value={settlement.xpGained > 0 ? `+${settlement.xpGained} XP` : '未走满七幕，不计'} tone={settlement.xpGained > 0 ? 'good' : 'default'} />
          <DataRow
            label="当前等级"
            value={`${settlement.rankLevel} · ${settlement.rankTitle}${settlement.nextRankTitle ? ` → ${settlement.nextRankTitle}` : '（满级）'}`}
          />
        </div>
        {achievements && <div className="mt-1 text-[10px] text-emerald-300">新解锁成就：{achievements}</div>}
        <div className="mt-1.5 space-y-0.5 border-t border-white/10 pt-1.5">
          {outcomes.map((o) => {
            const def = actOf(o.actId);
            return (
              <DataRow
                key={o.actId}
                label={`第 ${def.index} 幕 ${def.title}`}
                value={`${actScoreOf(o)} 分 · ${o.mistakes ? `${o.mistakes} 失误` : '无失误'} · ${mmss(o.seconds)}`}
                tone={o.mistakes ? 'warn' : 'good'}
              />
            );
          })}
        </div>
        {outcomes.length < ACTS.length && (
          <div className="mt-1">
            <ApiNotice kind="empty" text={`本批接入前 ${Object.keys(ACT_REGISTRY).length} 幕，走满七幕才计"首次独立检修"与经验。`} />
          </div>
        )}
        {run.diagnosis?.summary && (
          <div className="mt-1 border-t border-white/10 pt-1 text-[10px] text-slate-500">AI 结论：{String(run.diagnosis.summary).slice(0, 80)}</div>
        )}
      </Panel>
      <ActFooter
        hint="工单、LOTO、备件、知识贡献都是真实数据，可在对应模块复核。"
        primary={{ text: '回工位交底', onClick: onBack }}
      />
    </div>
  );
}

export default CampaignView;
