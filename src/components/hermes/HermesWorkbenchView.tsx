import React, { useCallback, useEffect, useRef, useState } from 'react';
import { businessLoopApi, type BusinessLoopSummary } from '../../api/businessLoopApi';
import type {
  BusinessClosedLoopData,
  HistoryLoopItem,
  LoopHeaderStats,
  LotoFieldDraft,
  StageHumanEdits,
  StageId,
} from './types';
import { BusinessOverviewCard } from './BusinessOverviewCard';
import { ClosedLoopStepper } from './ClosedLoopStepper';
import { StageWorkbench } from './StageWorkbench';
import { AiContextRail } from './AiContextRail';
import { ArtifactArchive } from './ArtifactArchive';
import { AiButlerSuggestions } from './AiButlerSuggestions';
import { HistoryLoops } from './HistoryLoops';
import { GoalInputHero } from './GoalInputHero';
import { useToast } from '../../context/ToastContext';
import { useOptionalAuth } from '../../context/AuthContext';
import { FORBIDDEN_HINT, normalizeRole } from '../../utils/rbac';
import { CheckCircle2, Loader2, RefreshCw, ServerCrash } from 'lucide-react';

/** 业务管家写操作角色口径（与后端 routes/businessLoops.ts 的 FIELD_ROLES 一致） */
const FIELD_ROLES = ['admin', 'manager', 'technician'];

/** AI 预填轮询：创建后环节 1-4 由服务端异步调用真实 AI 能力，前端只轮询详情接口取真值 */
const PREFILL_POLL_MS = 3000;
const PREFILL_POLL_LIMIT = 40; // 约 2 分钟，超时即停止并如实提示

type Phase = 'loading' | 'ready' | 'unreachable';

interface HermesWorkbenchViewProps {
  onNavigateTab?: (tabKey: string) => void;
  /** 把页头实时指标回传给 App（数据源仍是本视图的接口结果，不在页头另写死） */
  onStatsChange?: (stats: LoopHeaderStats) => void;
}

/** 归档时间落在本自然周（周一起）的条数；closedDate 形如 2026-10-18 18:20 */
function countArchivedThisWeek(history: HistoryLoopItem[]): number {
  const now = new Date();
  const offsetToMonday = (now.getDay() + 6) % 7;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetToMonday).getTime();
  return history.filter((h) => {
    const t = new Date(h.closedDate.replace(' ', 'T')).getTime();
    return Number.isFinite(t) && t >= weekStart;
  }).length;
}

function buildHeaderStats(running: BusinessLoopSummary[], history: HistoryLoopItem[]): LoopHeaderStats {
  const durations = history
    .map((h) => Number.parseFloat(h.duration))
    .filter((n) => Number.isFinite(n));
  const avg = durations.length
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
    : null;
  return {
    runningCount: running.length,
    archivedThisWeek: countArchivedThisWeek(history),
    avgDurationHours: avg,
  };
}

/** 尚未拿到 AI 预填结果的环节（仅 1-4 会在创建时异步预填） */
function pendingPrefillStages(detail: BusinessClosedLoopData | null) {
  if (!detail) return [];
  return detail.stages.filter((s) => s.order <= 4 && !s.aiPrefill?.engine);
}

function currentStageOf(detail: BusinessClosedLoopData | null): StageId | null {
  if (!detail) return null;
  const inProgress = detail.stages.find((s) => s.status === 'in_progress');
  return (inProgress || detail.stages[detail.stages.length - 1])?.id ?? null;
}

export const HermesWorkbenchView: React.FC<HermesWorkbenchViewProps> = ({ onNavigateTab, onStatsChange }) => {
  const { show: showToast } = useToast();
  const auth = useOptionalAuth();
  const currentUser = auth?.currentUser;

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [detail, setDetail] = useState<BusinessClosedLoopData | null>(null);
  const [runningLoops, setRunningLoops] = useState<BusinessLoopSummary[]>([]);
  const [history, setHistory] = useState<HistoryLoopItem[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<StageId | null>(null);
  const [goalMode, setGoalMode] = useState(false);
  const [busy, setBusy] = useState<null | 'create' | 'confirm' | 'loto' | 'complete'>();
  const [archivedLoop, setArchivedLoop] = useState<BusinessClosedLoopData | null>(null);
  const [prefillWaiting, setPrefillWaiting] = useState(false);
  const pollRef = useRef<number | null>(null);

  const canOperate = FIELD_ROLES.includes(normalizeRole(currentUser?.role) ?? '');

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const describeError = (err: unknown) => {
    const e = err as { status?: number; message?: string };
    if (e?.status === undefined || e?.status === 0) return '无法连接后端服务（请确认服务已在 3000 端口启动后重试）';
    return e.message || '请求失败';
  };

  // 未确认的 AI 预填用轮询补齐；拿到结果即刷新工作台，不再需要用户手动刷新
  const schedulePrefillPoll = useCallback(
    (loopId: string) => {
      stopPolling();
      let attempt = 0;
      const tick = async () => {
        if (attempt >= PREFILL_POLL_LIMIT) {
          setPrefillWaiting(false);
          return;
        }
        attempt += 1;
        try {
          const next = await businessLoopApi.getById(loopId);
          setDetail(next);
          if (pendingPrefillStages(next).length === 0) {
            setPrefillWaiting(false);
            return;
          }
          pollRef.current = window.setTimeout(tick, PREFILL_POLL_MS);
        } catch {
          setPrefillWaiting(false);
        }
      };
      pollRef.current = window.setTimeout(tick, PREFILL_POLL_MS);
    },
    [stopPolling],
  );

  const refreshSideLists = useCallback(async () => {
    const [loops, hist] = await Promise.all([businessLoopApi.list({ status: 'running', limit: 20 }), businessLoopApi.history()]);
    setRunningLoops(loops);
    setHistory(hist);
  }, []);

  const openLoop = useCallback(async (loopId: string) => {
    const next = await businessLoopApi.getById(loopId);
    setDetail(next);
    setSelectedStageId(currentStageOf(next));
    if (pendingPrefillStages(next).length > 0) {
      setPrefillWaiting(true);
      schedulePrefillPoll(loopId);
    }
    return next;
  }, [schedulePrefillPoll]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase('loading');
      try {
        const loops = await businessLoopApi.list({ status: 'running', limit: 20 });
        if (cancelled) return;
        setRunningLoops(loops);
        setHistory(await businessLoopApi.history());
        if (cancelled) return;
        if (loops.length > 0) {
          await openLoop(loops[0].id);
        } else {
          setDetail(null);
          setGoalMode(true);
        }
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        setLoadError(describeError(err));
        setPhase('unreachable');
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 页头指标随接口结果重算（列表或历史一变就回传，不保留上一次的读数）
  useEffect(() => {
    onStatsChange?.(buildHeaderStats(runningLoops, history));
  }, [runningLoops, history, onStatsChange]);

  const handleGeneratePlan = async (goalText: string) => {
    setBusy('create');
    try {
      const created = await businessLoopApi.create({ goal: goalText });
      setDetail(created);
      setSelectedStageId(currentStageOf(created));
      setGoalMode(false);
      setPhase('ready');
      const loops = await businessLoopApi.list({ status: 'running', limit: 20 });
      setRunningLoops(loops);
      if (pendingPrefillStages(created).length > 0) {
        setPrefillWaiting(true);
        schedulePrefillPoll(created.id);
      }
      showToast({
        type: 'success',
        title: `闭环 ${created.loopCode} 已创建`,
        message: pendingPrefillStages(created).length
          ? '六环节已登记，AI 正在服务端逐项预填工单草稿 / JSA / LOTO / 检修方案'
          : '六环节 AI 预填已就绪，请在环节工作台核对后确认推进',
        duration: 4000,
      });
    } catch (err) {
      showToast({ type: 'error', title: '创建业务闭环失败', message: describeError(err), duration: 5000 });
    } finally {
      setBusy(null);
    }
  };

  const handleSelectLoop = async (loopId: string) => {
    try {
      await openLoop(loopId);
      setGoalMode(false);
    } catch (err) {
      showToast({ type: 'error', title: '读取闭环详情失败', message: describeError(err), duration: 4000 });
    }
  };

  const handleConfirmStage = async (stageNo: number, edits?: StageHumanEdits) => {
    if (!detail) return;
    setBusy('confirm');
    try {
      const next = await businessLoopApi.confirmStage(detail.id, stageNo, edits);
      setDetail(next);
      setSelectedStageId(currentStageOf(next));
      const stillRunning = next.stages.some((s) => s.status === 'in_progress');
      const editCount = Object.values(edits || {}).reduce((acc, g: any) => acc + Object.keys(g || {}).length, 0);
      showToast({
        type: 'success',
        title: `环节 ${stageNo} 已确认${editCount ? `（含 ${editCount} 处人工修订）` : ''}`,
        message: stillRunning
          ? `已按确认人核对后的值落成真实业务记录并推进至「${next.stages.find((s) => s.status === 'in_progress')?.title || '下一环节'}」`
          : '六个环节已全部确认，可执行归档生成质检报告与知识沉淀',
        duration: 4000,
      });
      await refreshSideLists().catch(() => undefined);
    } catch (err) {
      showToast({ type: 'error', title: '确认环节被拒绝', message: describeError(err), duration: 5000 });
    } finally {
      setBusy(null);
    }
  };

  const handleToggleLotoItem = async (itemId: string, confirmed: boolean, fields?: LotoFieldDraft) => {
    if (!detail) return;
    setBusy('loto');
    try {
      const next = await businessLoopApi.toggleLotoItem(detail.id, { itemId, confirmed, fields });
      setDetail(next);
    } catch (err) {
      showToast({ type: 'error', title: 'LOTO 确认失败', message: describeError(err), duration: 4500 });
    } finally {
      setBusy(null);
    }
  };

  const handleAddLotoItem = async (fields: { type: string; point: string; requirement?: string; lockNumber?: string }) => {
    if (!detail) return;
    setBusy('loto');
    try {
      const next = await businessLoopApi.addLotoItem(detail.id, fields);
      setDetail(next);
      showToast({
        type: 'success',
        title: '隔离点已补登',
        message: `「${fields.point}」已按「人工登记」写入清单，需再逐项勾选确认方可推进`,
        duration: 4000,
      });
    } catch (err) {
      showToast({ type: 'error', title: '隔离点补登失败', message: describeError(err), duration: 4500 });
    } finally {
      setBusy(null);
    }
  };

  const handleArchive = async () => {
    if (!detail) return;
    const allDone = detail.stages.every((s) => s.status === 'completed');
    if (!allDone) {
      showToast({
        type: 'info',
        title: '闭环尚未全部确认',
        message: `当前进行到第 ${detail.progress.currentStageOrder}/6 环节，服务端已保存进度，可继续推进后再归档`,
        duration: 4000,
      });
      return;
    }
    setBusy('complete');
    try {
      const next = await businessLoopApi.complete(detail.id);
      setDetail(next);
      setSelectedStageId(currentStageOf(next));
      setArchivedLoop(next);
      await refreshSideLists().catch(() => undefined);
      showToast({ type: 'success', title: `闭环 ${next.loopCode} 已归档`, message: '质检报告与知识沉淀产出物已写入档案', duration: 4500 });
    } catch (err) {
      showToast({ type: 'error', title: '归档失败', message: describeError(err), duration: 5000 });
    } finally {
      setBusy(null);
    }
  };

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>正在读取业务闭环…</span>
      </div>
    );
  }

  if (phase === 'unreachable') {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-6 max-w-xl mx-auto my-8 space-y-3 text-center">
        <div className="flex items-center justify-center gap-2 text-rose-700 font-bold text-sm">
          <ServerCrash className="w-5 h-5" />
          <span>无法连接后端服务</span>
        </div>
        <p className="text-xs text-rose-600 leading-relaxed">{loadError}</p>
        <p className="text-[11px] text-slate-500">
          业务管家页不提供任何演示数据：闭环、AI 预填与产出物全部来自 /api/v1/business-loops 真实接口。
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>重试</span>
        </button>
      </div>
    );
  }

  if (goalMode && !detail) {
    return (
      <div className="space-y-4 pb-8">
        <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-xs text-slate-500 flex items-center justify-between gap-3">
          <span>当前没有进行中的业务闭环，输入一句话业务意图即可编排六环节。</span>
          {history.length > 0 && <span className="text-slate-400">已归档闭环 {history.length} 个</span>}
        </div>
        <GoalInputHero onGeneratePlan={handleGeneratePlan} busy={busy === 'create'} />
        {history.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
            <div className="lg:col-span-3">
              <HistoryLoops historyLoops={history} />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  return (
    <div className="space-y-4 pb-8">
      {runningLoops.length > 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white/90 px-3 py-2.5 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-slate-500 shrink-0">进行中的闭环：</span>
          {runningLoops.map((loop) => (
            <button
              key={loop.id}
              type="button"
              onClick={() => handleSelectLoop(loop.id)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                loop.id === detail.id
                  ? 'bg-blue-50 border-blue-300 text-blue-800 font-semibold'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-blue-200 hover:text-blue-700'
              }`}
            >
              <span className="font-mono">{loop.loopNo}</span>
              <span className="ml-1.5">第 {loop.currentStage}/6 环节</span>
            </button>
          ))}
        </div>
      )}

      {prefillWaiting && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>
            AI 预填进行中：环节 1-4 正在服务端调用 generate-work-order / safety-risk-assessment / safety-interlock /
            generate-maintenance-plan，结果逐环节回写。
          </span>
        </div>
      )}

      {!canOperate && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
          {FORBIDDEN_HINT}：当前角色为 {normalizeRole(currentUser?.role) || '未登录'}，可查看全部环节与产出物，
          确认推进、LOTO 逐项确认与归档需由 {FIELD_ROLES.join(' / ')} 操作。
        </div>
      )}

      {goalMode ? (
        <GoalInputHero onGeneratePlan={handleGeneratePlan} onCancel={() => setGoalMode(false)} busy={busy === 'create'} />
      ) : (
        <>
          <BusinessOverviewCard
            data={detail}
            status={detail.status}
            canOperate={canOperate}
            busy={busy === 'complete'}
            onNewGoal={() => setGoalMode(true)}
            onArchive={handleArchive}
            onSelectStage={(idx) => {
              if (detail.stages[idx]) setSelectedStageId(detail.stages[idx].id);
            }}
          />

          <ClosedLoopStepper
            stages={detail.stages}
            selectedStageId={selectedStageId}
            onSelectStage={(id) => setSelectedStageId(id)}
          />

          {/* 两栏流式排版：左列按内容高度顺排工作台/档案/建议，右列放 AI 上下文与历史，
              不再用 min-h 撑高卡片（原实现会在环节卡片下方与下一行卡片上方留出一整片白） */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-8 space-y-4">
              <StageWorkbench
                currentStageId={selectedStageId}
                stages={detail.stages}
                lotoItems={detail.lotoItems}
                loopData={detail}
                canOperate={canOperate}
                busy={busy === 'confirm' || busy === 'loto'}
                onToggleLotoItem={handleToggleLotoItem}
                onAddLotoItem={handleAddLotoItem}
                onAdvanceStage={handleConfirmStage}
                onNavigateToTab={onNavigateTab}
              />
              <ArtifactArchive artifacts={detail.artifacts} />
              <AiButlerSuggestions
                suggestions={detail.suggestions}
                onActionClick={(sug) => {
                  // 建议由服务端按环节状态生成：风险类指向降级环节，其余回到进行中环节
                  const target =
                    sug.type === 'risk'
                      ? detail.stages.find((s) => s.aiPrefill?.status === 'degraded')
                      : detail.stages.find((s) => s.status === 'in_progress');
                  if (target) setSelectedStageId(target.id);
                  else {
                    const cur = currentStageOf(detail);
                    if (cur) setSelectedStageId(cur);
                  }
                }}
              />
            </div>

            <div className="lg:col-span-4 space-y-4">
              <AiContextRail data={detail} />
              <HistoryLoops historyLoops={history} />
            </div>
          </div>
        </>
      )}

      {archivedLoop && (
        <ArchiveSuccessModal loop={archivedLoop} onClose={() => setArchivedLoop(null)} />
      )}
    </div>
  );
};

/** 归档结果弹窗：数字全部来自归档接口返回的真实产出物与耗时 */
const ArchiveSuccessModal: React.FC<{ loop: BusinessClosedLoopData; onClose: () => void }> = ({ loop, onClose }) => {
  const readyArtifacts = loop.artifacts.filter((a) => a.status === 'ready');
  const knowledgeArtifact = loop.artifacts.find((a) => a.category === '知识沉淀');

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
          <CheckCircle2 className="w-7 h-7" />
        </div>

        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-900">业务闭环已归档</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            闭环编号 <strong className="text-slate-700 font-mono">{loop.loopCode}</strong> 六个环节均已人工确认，
            产出物已写入业务闭环档案表。
          </p>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5 text-left">
          <div className="flex justify-between gap-3">
            <span>已生成产出物：</span>
            <span className="font-mono font-bold text-slate-800">{readyArtifacts.length}/{loop.artifacts.length} 项</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>知识沉淀：</span>
            <span className="font-bold text-emerald-600">
              {knowledgeArtifact?.status === 'ready' ? '已提交至知识贡献审核台' : '未达沉淀标准（可在知识库手动提交）'}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span>自开单起已用时：</span>
            <span className="font-mono font-bold text-slate-800">{loop.progress.elapsedHours}h</span>
          </div>
        </div>

        <div className="pt-2 flex items-center gap-2 justify-center">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
          >
            好的，完成
          </button>
        </div>
      </div>
    </div>
  );
};
