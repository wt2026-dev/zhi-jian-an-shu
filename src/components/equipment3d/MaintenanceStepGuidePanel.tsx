/**
 * 拆解视图侧栏「维修步骤指引」面板 —— 现场作业终端形态。
 *
 * 与旧版的区别：勾选态不再停留在会话内存里，而是**每点一次就写进工单**。
 *
 * 数据契约（真实 DB，禁止 mock）：
 *   · 步骤原文 = `GET /api/v1/equipments/:id/field-session` 的 `steps`，
 *     服务端直接切分工单实填的 work_orders.repair_log.resolutionSteps，
 *     并把每步原文在该设备拆解页真实 BOM 目录中匹配出目标位号；
 *     工单没填步骤 ⇒ 空数组，本面板如实显示"未填写"，绝不退回硬编码假步骤
 *     （RepairStepCard 的 getDefaultProcedures 是 3D 场景内的演示兜底，这里明确不采用）。
 *   · 「✅ 完成这一步 / 跳过 / 有问题」→ `POST /api/v1/work-orders/:id/field-actions/step`，
 *     操作人由服务端会话身份写入（不信任前端传的身份），完成时间与用时同样由服务端计时；
 *     跳过与有问题必须填原因（服务端 422 硬校验）。
 *   · LOTO 未确认 ⇒ 服务端 403 拒绝任何步骤记录，本面板据此把记录按钮置灰并给出入口。
 *   · 全部步骤 done/skip（无 issue）⇒ 服务端自动**提交完工上报**（转「待验收」，
 *     与标准流程同一落点，不绕过质检验收），面板如实回显上报留档。
 *
 * 交互口径：现场戴手套操作 —— 记录按钮给足点击面积（py-2.5 + 明确文案），
 * 一行一步、一步一动作，不需要长按/双击/悬停。
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ListChecks,
  ShieldCheck,
  ChevronDown,
  Play,
  Wrench,
  CircleCheck,
  CircleDashed,
  Loader2,
  MinusCircle,
  AlertTriangle,
  Undo2,
  Clock,
} from 'lucide-react';
import { ApiError, fieldOpsApi } from '../../api';
import type { FieldSessionData, FieldSessionStepInfo } from '../../api';

export interface MaintenanceStepGuidePanelProps {
  /** 现场作业会话（null = 尚未加载完成） */
  session: FieldSessionData | null;
  /** 会话加载失败的真实原因（如该设备无拆解 BOM 目录） */
  sessionError?: string | null;
  /** 正在播放的步骤（1-based 索引；null = 无），用于行内"演示中"态 */
  activeStepIndex: number | null;
  /** 点击步骤：宿主在 iframe 里高亮该步目标零件并播放拆解动画 */
  onRunStep: (step: FieldSessionStepInfo) => void;
  /** 写操作成功后把服务端返回的最新会话交还宿主（单一数据源，不在本地拼） */
  onSessionChange: (session: FieldSessionData) => void;
  /** 未完成 LOTO 时点开安全确认弹窗 */
  onRequestLoto: () => void;
  onCollapseChange?: (collapsed: boolean) => void;
  /** 初始是否折叠（默认展开） */
  initialCollapsed?: boolean;
}

/** 服务端返回的会话里带完工标记（步骤端点额外带 autoCompleted，其余端点读会话自身字段） */
type SessionWithCompletion = FieldSessionData & { autoCompleted?: FieldSessionData['autoCompleted'] };

type StepStatus = 'done' | 'skip' | 'issue';

const STATUS_CHIP: Record<StepStatus, { label: string; cls: string }> = {
  done: { label: '已完成', cls: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300' },
  skip: { label: '已跳过', cls: 'border-slate-400/40 bg-slate-500/15 text-slate-300' },
  issue: { label: '有问题', cls: 'border-rose-400/50 bg-rose-500/15 text-rose-300' },
};

/** 2026-03-15T09:12:00+08:00 → 09:12（现场只看时刻，日期在时间线里给全） */
function hhmm(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtElapsed(min: number | null): string {
  if (min == null) return '首步计时';
  if (min < 60) return `用时 ${min} 分钟`;
  return `用时 ${(Math.round((min / 60) * 10) / 10).toFixed(1)} 小时`;
}

export const MaintenanceStepGuidePanel: React.FC<MaintenanceStepGuidePanelProps> = ({
  session,
  sessionError = null,
  activeStepIndex,
  onRunStep,
  onSessionChange,
  onRequestLoto,
  onCollapseChange,
  initialCollapsed = false,
}) => {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  /** 正在补录原因的步骤（跳过/有问题必须写原因，服务端 422 硬校验） */
  const [noteFor, setNoteFor] = useState<{ index: number; action: 'skip' | 'issue' } | null>(null);
  const [noteText, setNoteText] = useState('');
  /** 全过程时间线默认折叠，现场需要时才展开 */
  const [timelineOpen, setTimelineOpen] = useState(false);

  useEffect(() => {
    onCollapseChange?.(collapsed);
  }, [collapsed]);

  const orderId = session?.order?.id ?? null;
  const steps = session?.steps ?? [];
  const total = session?.progress.total ?? 0;
  const done = session?.progress.done ?? 0;
  const skipped = session?.progress.skipped ?? 0;
  const issue = session?.progress.issue ?? 0;
  const remaining = session?.progress.remaining ?? 0;
  const current = session?.progress.current ?? null;
  const lotoOk = Boolean(session?.loto);
  const canOperate = Boolean(session?.canOperate);
  const recordable = canOperate && lotoOk;
  const autoCompleted = session?.autoCompleted ?? null;

  const events = useMemo(() => (session?.events ?? []).slice().reverse(), [session?.events]);

  if (collapsed) {
    return (
      <div className="pointer-events-auto self-start" data-testid="equipment3d-step-guide-collapsed">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-cyan-100 bg-slate-900/90 border border-cyan-500/40 hover:border-cyan-400 backdrop-blur shadow cursor-pointer"
        >
          <ListChecks className="h-3.5 w-3.5" />
          维修步骤指引{total > 0 ? ` · ${done + skipped + issue}/${total}` : ''}
          {!lotoOk && canOperate && <span className="text-amber-300">· 待安全确认</span>}
        </button>
      </div>
    );
  }

  const record = async (index: number, action: 'done' | 'skip' | 'issue', note?: string) => {
    if (!orderId) return;
    setOpError(null);
    setPendingIndex(index);
    try {
      const res = (await fieldOpsApi.recordStep(orderId, { index, action, note })) as SessionWithCompletion;
      // 服务端为准：把最新会话整体交还宿主，本地不推算进度
      onSessionChange(res);
      setNoteFor(null);
      setNoteText('');
    } catch (err: unknown) {
      const e = err as ApiError;
      const code = e?.data?.code;
      if (code === 'FIELD_LOTO_REQUIRED') {
        setOpError('安全确认未完成：先通过 LOTO 四项强制检查才能记录步骤。');
        onRequestLoto();
      } else {
        setOpError(e?.message || '步骤记录失败，请稍后重试');
      }
    } finally {
      setPendingIndex(null);
    }
  };

  const stepAction = (index: number, action: 'done' | 'skip' | 'issue') => {
    if (action === 'done') {
      void record(index, 'done');
      return;
    }
    setNoteFor({ index, action });
    setNoteText('');
    setOpError(null);
  };

  return (
    <div
      data-testid="equipment3d-step-guide-panel"
      className="pointer-events-auto flex min-h-0 w-full flex-none flex-col overflow-hidden rounded-xl border border-cyan-500/30 bg-slate-950/92 text-slate-200 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur"
    >
      {/* 头部：进度口径「共 N 步 · 完成 X · 剩余 Z」 */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-slate-900/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <span className="text-[12px] font-semibold text-white">维修步骤作业记录</span>
          {total > 0 && (
            <span
              className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300"
              data-testid="equipment3d-step-guide-progress"
            >
              {done + skipped + issue}/{total}
            </span>
          )}
        </div>
        <button type="button" onClick={() => setCollapsed(true)} title="收起" className="shrink-0 cursor-pointer text-slate-400 hover:text-white">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 进度条：完成（绿）+ 跳过（灰）合并推进 */}
      {total > 0 && (
        <div className="h-1 w-full bg-slate-800">
          <div
            data-testid="equipment3d-step-guide-bar"
            className={`h-full transition-all duration-300 ${remaining === 0 && issue === 0 ? 'bg-emerald-400' : 'bg-cyan-500'}`}
            style={{ width: `${(Math.min(total, done + skipped + issue) / total) * 100}%` }}
          />
        </div>
      )}

      {/* 汇总条：总共几步 / 已完成 / 还剩几步 / 当前进行到哪一步 */}
      {session && total > 0 && (
        <div
          data-testid="equipment3d-step-guide-summary"
          className="grid grid-cols-4 gap-px border-b border-white/10 bg-white/5 text-center"
        >
          <div className="bg-slate-950/70 px-1 py-1.5">
            <div className="font-mono text-[13px] font-bold text-white">{total}</div>
            <div className="text-[9px] text-slate-400">总步骤</div>
          </div>
          <div className="bg-slate-950/70 px-1 py-1.5">
            <div className="font-mono text-[13px] font-bold text-emerald-300">{done}</div>
            <div className="text-[9px] text-slate-400">已完成</div>
          </div>
          <div className="bg-slate-950/70 px-1 py-1.5">
            <div className="font-mono text-[13px] font-bold text-amber-300">{remaining}</div>
            <div className="text-[9px] text-slate-400">还剩</div>
          </div>
          <div className="bg-slate-950/70 px-1 py-1.5">
            <div className="font-mono text-[13px] font-bold text-cyan-300" data-testid="equipment3d-step-guide-current">
              {current ? `第 ${current} 步` : '已全部记录'}
            </div>
            <div className="text-[9px] text-slate-400">进行到</div>
          </div>
        </div>
      )}

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-[11px] leading-relaxed">
        {session === null && (
          <div className="flex items-center gap-2 py-4 text-slate-400" data-testid="equipment3d-step-guide-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
            {sessionError ? sessionError : '正在读取工单检修步骤…'}
          </div>
        )}

        {session && total === 0 && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-2 text-amber-200" data-testid="equipment3d-step-guide-empty">
            {session.blockedReason ?? '这张工单还没有填写标准作业步骤（repair_log.resolutionSteps 为空），暂无可记录的步骤。'}
            <div className="mt-1 text-[9px] text-amber-200/70">
              步骤原文读自工单 repair_log.resolutionSteps，本面板如实反映，不支持假数据兜底。
            </div>
          </div>
        )}

        {/* LOTO 闸门：检修中但未确认 → 强提示 + 打开弹窗；服务端同步硬拦（403） */}
        {session && canOperate && !lotoOk && (
          <div
            data-testid="equipment3d-step-guide-loto-gate"
            className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-400/60 bg-amber-500/15 px-2.5 py-2"
          >
            <div className="flex min-w-0 items-center gap-1.5 text-amber-200">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span className="text-[11px] font-semibold">未做 LOTO 安全确认，不能开始拆解操作记录</span>
            </div>
            <button
              type="button"
              data-testid="equipment3d-step-guide-open-loto"
              onClick={onRequestLoto}
              className="shrink-0 rounded-lg border border-amber-300/70 bg-amber-400/25 px-2.5 py-2 text-[11px] font-bold text-amber-50 hover:bg-amber-400/40 cursor-pointer"
            >
              去确认
            </button>
          </div>
        )}

        {session && canOperate && lotoOk && (
          <div
            data-testid="equipment3d-step-guide-loto-done"
            className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] text-emerald-200"
          >
            <span className="inline-flex items-center gap-1 font-semibold">
              <ShieldCheck className="h-3.5 w-3.5" />
              LOTO 四项已确认
            </span>
            <span>
              确认人 {session.loto?.by?.name ?? '—'} · {hhmm(session.loto?.confirmedAt)} ·{' '}
              {session.loto?.items.length ?? 0} 项留档
            </span>
          </div>
        )}

        {session && !canOperate && (
          <div className="mb-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[10px] text-slate-400" data-testid="equipment3d-step-guide-readonly">
            {session.blockedReason ?? '当前工单不可记录现场步骤。'}
          </div>
        )}

        {autoCompleted && (
          <div
            data-testid="equipment3d-step-guide-complete"
            className="mb-2 rounded-lg border border-emerald-400/50 bg-emerald-500/15 px-2.5 py-2 text-emerald-300"
          >
            <div className="flex items-center gap-2">
              <CircleCheck className="h-4 w-4 shrink-0" />
              <span className="text-[12px] font-semibold">全部步骤已记录 · 已自动提交完工上报</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-emerald-200/90">
              <span>上报时间：{new Date(autoCompleted.at).toLocaleString('zh-CN', { hour12: false })}</span>
              <span>实际维修人：{autoCompleted.by}</span>
              <span>工时：{autoCompleted.workHours} h</span>
              <span>步骤：完成 {autoCompleted.done} / 跳过 {autoCompleted.skipped}</span>
            </div>
            <div className="mt-1 text-[9px] text-emerald-200/70">
              工单已转入「待验收」，需质检复核验收后才归档；现场留痕已写入工单 repair_log.fieldLog，无需再手工填报。
            </div>
          </div>
        )}

        {opError && (
          <div
            data-testid="equipment3d-step-guide-error"
            className="mb-2 flex items-center gap-1.5 rounded-lg border border-rose-400/50 bg-rose-500/15 px-2.5 py-2 text-[11px] text-rose-200"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">{opError}</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5" data-testid="equipment3d-step-guide-steps">
          {steps.map((step) => {
            const state = step.state;
            const isActive = activeStepIndex === step.index;
            const busy = pendingIndex === step.index;
            const chip = state ? STATUS_CHIP[state.status] : null;
            const noteOpen = noteFor?.index === step.index;
            return (
              <div
                key={step.index}
                data-testid={`equipment3d-step-guide-step-${step.index}`}
                className={`rounded-lg border px-2.5 py-2 transition ${
                  isActive
                    ? 'border-cyan-400/70 bg-cyan-500/15'
                    : state?.status === 'issue'
                    ? 'border-rose-400/40 bg-rose-500/8'
                    : state
                    ? 'border-emerald-400/30 bg-emerald-500/5'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">
                    {state ? <CircleCheck className="h-4 w-4 text-emerald-400" /> : <CircleDashed className="h-4 w-4 text-slate-500" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono text-[10px] font-bold ${state ? 'text-emerald-300' : 'text-cyan-300'}`}>
                        步骤 {step.index}
                      </span>
                      {chip && (
                        <span className={`rounded border px-1.5 py-px text-[9px] font-bold ${chip.cls}`} data-testid={`equipment3d-step-guide-state-${step.index}`}>
                          {chip.label}
                        </span>
                      )}
                      {state && (
                        <span className="truncate text-[9px] text-slate-400" data-testid={`equipment3d-step-guide-meta-${step.index}`}>
                          {state.by.name} · {hhmm(state.at)} · {fmtElapsed(state.elapsedMin)}
                        </span>
                      )}
                      {isActive && <Play className="h-3 w-3 text-cyan-300" />}
                    </div>

                    <div className={`mt-0.5 ${state ? 'text-slate-400 line-through decoration-emerald-400/50' : 'text-slate-200'}`}>
                      {step.text}
                    </div>

                    {state?.note && (
                      <div className="mt-1 rounded border border-white/10 bg-slate-900/70 px-1.5 py-1 text-[10px] text-amber-200" data-testid={`equipment3d-step-guide-note-${step.index}`}>
                        现场备注：{state.note}
                      </div>
                    )}

                    {/* 该步骤在真实 BOM 中匹配到的目标零件（未匹配 = 如实说明） */}
                    {step.matchedPart ? (
                      <button
                        type="button"
                        data-testid={`equipment3d-step-guide-part-${step.index}`}
                        onClick={() => onRunStep(step)}
                        className="mt-1 inline-flex items-center gap-1 rounded border border-cyan-400/40 bg-cyan-500/10 px-1.5 py-1 text-[9px] text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
                        title="在拆解视图中高亮该零件并演示拆装动画"
                      >
                        <Wrench className="h-2.5 w-2.5" />
                        定位 {step.matchedPart.posNo} · {step.matchedPart.name}
                        <Play className="h-2.5 w-2.5" />
                      </button>
                    ) : (
                      <span className="mt-1 inline-block rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-500" data-testid={`equipment3d-step-guide-unmatched-${step.index}`}>
                        未匹配到具体零件（BOM 真实文本命中为 0），可对照左侧 BOM 查看
                      </span>
                    )}

                    {/* 现场记录按钮：戴手套可点的大触点 */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {state ? (
                        <button
                          type="button"
                          data-testid={`equipment3d-step-guide-reopen-${step.index}`}
                          disabled={!recordable || busy}
                          onClick={() => {
                            // 改记＝重新落一条同序号记录（服务端按序号覆盖），留痕仍为最近一次现场判定
                            setNoteFor(null);
                            setNoteText('');
                            void record(step.index, 'done');
                          }}
                          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium transition ${
                            recordable && !busy
                              ? 'cursor-pointer border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                              : 'border-white/5 bg-white/2 text-slate-600'
                          }`}
                          title="现场复核后改记为「完成」"
                        >
                          <Undo2 className="h-3 w-3" />
                          改记为完成
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            data-testid={`equipment3d-step-guide-done-${step.index}`}
                            disabled={!recordable || busy}
                            onClick={() => stepAction(step.index, 'done')}
                            className={`inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-[12px] font-bold transition ${
                              recordable && !busy
                                ? 'cursor-pointer border-emerald-400/60 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40'
                                : 'border-white/5 bg-white/5 text-slate-600'
                            }`}
                            title={recordable ? '记录这一步已完成（写入工单留痕）' : '需先完成 LOTO 安全确认且工单处于检修中'}
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleCheck className="h-3.5 w-3.5" />}
                            {busy ? '记录中…' : '✅ 完成这一步'}
                          </button>
                          <button
                            type="button"
                            data-testid={`equipment3d-step-guide-skip-${step.index}`}
                            disabled={!recordable || busy}
                            onClick={() => stepAction(step.index, 'skip')}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2.5 text-[11px] font-medium transition ${
                              recordable && !busy
                                ? 'cursor-pointer border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                                : 'border-white/5 bg-white/2 text-slate-600'
                            }`}
                          >
                            <MinusCircle className="h-3.5 w-3.5" />
                            跳过
                          </button>
                          <button
                            type="button"
                            data-testid={`equipment3d-step-guide-issue-${step.index}`}
                            disabled={!recordable || busy}
                            onClick={() => stepAction(step.index, 'issue')}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2.5 text-[11px] font-medium transition ${
                              recordable && !busy
                                ? 'cursor-pointer border-rose-400/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                                : 'border-white/5 bg-white/2 text-slate-600'
                            }`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            有问题
                          </button>
                        </>
                      )}
                      {!recordable && !state && (
                        <span className="text-[9px] text-slate-500" data-testid={`equipment3d-step-guide-locked-${step.index}`}>
                          {!canOperate ? '工单不在检修中，记录不可用' : '需先完成 LOTO 安全确认'}
                        </span>
                      )}
                    </div>

                    {/* 跳过/有问题的原因录入（必填，服务端 422 复验） */}
                    {noteOpen && noteFor && (
                      <div className="mt-1.5 rounded-lg border border-cyan-400/40 bg-slate-900/80 p-2" data-testid={`equipment3d-step-guide-note-form-${step.index}`}>
                        <label className="block text-[10px] text-cyan-200" htmlFor={`field-step-note-${step.index}`}>
                          {noteFor.action === 'skip' ? '跳过原因' : '问题描述'}（必填，随工单留档）
                        </label>
                        <textarea
                          id={`field-step-note-${step.index}`}
                          data-testid={`equipment3d-step-guide-note-input-${step.index}`}
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          rows={2}
                          maxLength={500}
                          placeholder={noteFor.action === 'skip' ? '如：该步由上一班次完成，已核对无异常' : '如：轴承室拉伤，需申请换件'}
                          className="mt-1 w-full resize-none rounded border border-white/15 bg-slate-950/80 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                        />
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`equipment3d-step-guide-note-submit-${step.index}`}
                            disabled={!noteText.trim() || busy}
                            onClick={() => void record(noteFor.index, noteFor.action, noteText.trim())}
                            className={`rounded-lg px-3 py-2 text-[11px] font-bold transition ${
                              noteText.trim() && !busy
                                ? 'cursor-pointer bg-cyan-500/30 text-cyan-100 border border-cyan-400/60 hover:bg-cyan-500/45'
                                : 'bg-white/5 text-slate-600 border border-white/5'
                            }`}
                          >
                            {busy ? '提交中…' : '提交留痕'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNoteFor(null);
                              setNoteText('');
                            }}
                            className="rounded-lg border border-white/15 px-2.5 py-2 text-[11px] text-slate-400 hover:text-white cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 全过程时间线（LOTO → 每步 → 测量/照片 → 自动完工），由服务端按事件顺序落库 */}
        {session && session.events.length > 0 && (
          <div className="mt-2.5 border-t border-white/10 pt-2" data-testid="equipment3d-step-guide-timeline">
            <button
              type="button"
              data-testid="equipment3d-step-guide-timeline-toggle"
              onClick={() => setTimelineOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] text-slate-300 hover:bg-white/10 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-cyan-400" />
                维修过程时间线（{session.events.length} 条留痕）
              </span>
              <span className="text-cyan-300">{timelineOpen ? '收起' : '展开'}</span>
            </button>
            {timelineOpen && (
              <ol className="mt-1.5 flex flex-col gap-1" data-testid="equipment3d-step-guide-timeline-list">
                {events.map((ev, i) => (
                  <li
                    key={`${ev.at}-${ev.kind}-${i}`}
                    data-testid={`equipment3d-step-guide-event-${i}`}
                    className="rounded border border-white/8 bg-slate-900/60 px-2 py-1.5 text-[10px] leading-snug"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[9px] text-cyan-300">{hhmm(ev.at)}</span>
                      <span className="text-[9px] text-slate-500">{ev.by ?? '—'}</span>
                      <span
                        className={`ml-auto rounded px-1 py-px text-[8px] font-bold ${
                          ev.kind === 'complete'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : ev.kind === 'loto'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-white/8 text-slate-400'
                        }`}
                      >
                        {ev.kind === 'loto' ? '安全确认' : ev.kind === 'step' ? '步骤' : ev.kind === 'measure' ? '测量' : ev.kind === 'photo' ? '照片' : '完工'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-slate-300">{ev.text}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {session && (
          <div className="mt-2 border-t border-white/10 pt-1.5 text-[9px] text-slate-500" data-testid="equipment3d-step-guide-data-note">
            {session.dataNote}
          </div>
        )}
      </div>
    </div>
  );
};

export default MaintenanceStepGuidePanel;
