import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import { AiPipelineTask, AiPipelineStep } from '../../api';
import { STEP_META } from './pipelineConfig';
import { DegradedBadge } from './DegradedBadge';

interface PipelineExecutionFlowProps {
  task: AiPipelineTask;
  taskSectionRef: React.RefObject<HTMLDivElement | null>;
}

export const PipelineExecutionFlow: React.FC<PipelineExecutionFlowProps> = ({
  task,
  taskSectionRef,
}) => {
  const renderStepBody = (step: AiPipelineStep) => {
    if (step.status === 'pending') {
      return <p className="text-xs text-slate-500">等待前序步骤完成…</p>;
    }
    if (step.status === 'failed') {
      return (
        <p className="text-xs text-rose-600 flex items-start">
          <AlertTriangle className="w-3.5 h-3.5 mr-1 mt-0.5 shrink-0" />
          <span>执行失败：{step.error || '未知错误'}</span>
        </p>
      );
    }
    const data = step.result?.data || {};
    if (step.stepName === '故障诊断' && data.diagnosis) {
      const d = data.diagnosis;
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
              严重度：{d.severity || '—'}
            </span>
            <span className="text-[10px] font-mono text-slate-500">紧急评分 {d.urgencyScore ?? '—'}</span>
            {step.result?.degraded && <DegradedBadge />}
          </div>
          <p className="text-xs text-slate-700">{d.summary}</p>
          <ul className="text-[11px] text-slate-500 space-y-0.5">
            {(d.probableCauses || []).slice(0, 3).map((c: { cause?: string; probability?: number; detail?: string }, i: number) => (
              <li key={i}>• {c.cause}（{c.probability ?? '?'}%）：{c.detail}</li>
            ))}
          </ul>
        </div>
      );
    }
    if (step.stepName === '检修方案生成' && data.plan) {
      const p = data.plan;
      return (
        <div className="space-y-1.5">
          {step.result?.degraded && <DegradedBadge />}
          <p className="text-xs text-slate-700">{p.overview}</p>
          <ol className="text-[11px] text-slate-500 space-y-0.5 list-decimal list-inside">
            {(p.steps || []).slice(0, 4).map((s: { step?: number; operation?: string }) => (
              <li key={s.step}>{s.operation}</li>
            ))}
          </ol>
          <p className="text-[10px] text-slate-500 font-mono">预估工时 {p.estimatedHours ?? '—'}h · {(p.steps || []).length} 个步骤</p>
        </div>
      );
    }
    if (step.stepName === '风险审核' && data.assessment) {
      const a = data.assessment;
      const levelColor =
        a.riskLevel === '极高' || a.riskLevel === '高'
          ? 'text-rose-600'
          : a.riskLevel === '中'
          ? 'text-amber-600'
          : 'text-emerald-600';
      return (
        <div className="space-y-1.5">
          {step.result?.degraded && <DegradedBadge />}
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${levelColor}`}>风险等级：{a.riskLevel || '—'}</span>
            {a.lotoAdvice?.required && (
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                需 LOTO{a.lotoAdvice.lockCount == null ? '' : `（${a.lotoAdvice.lockCount} 把锁）`}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500">{a.riskReason}</p>
          <ul className="text-[11px] text-slate-500 space-y-0.5">
            {(a.jsaMeasures || []).slice(0, 3).map((m: { hazard?: string; control?: string }, i: number) => (
              <li key={i}>• {m.hazard} → {m.control}</li>
            ))}
          </ul>
        </div>
      );
    }
    if (step.stepName === '派单推荐' && data.recommendation) {
      const r = data.recommendation;
      return (
        <div className="space-y-1.5">
          {step.result?.degraded && <DegradedBadge />}
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold">
              推荐主修：{r.recommended?.name || '—'}
            </span>
            <span className="text-[10px] font-mono text-slate-500">预估 {r.estimatedHours ?? '—'}h</span>
          </div>
          <p className="text-[11px] text-slate-500">{r.recommended?.reason}</p>
          {(r.alternatives || []).length > 0 && (
            <p className="text-[10px] text-slate-500">
              备选：{r.alternatives.map((alt: { name?: string }) => alt.name).join('、')}
            </p>
          )}
        </div>
      );
    }
    return <p className="text-xs text-slate-500">{step.result?.message || '结果待生成…'}</p>;
  };

  return (
    <div ref={taskSectionRef} className="card-saas p-6 border border-slate-200/80 scroll-mt-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-slate-100 border-b">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
            <Zap className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">
            协同任务执行流水线
          </h2>
          <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
            ID: {task.id.slice(0, 12)}…
          </span>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
            task.status === 'completed'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : task.status === 'failed'
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : task.status === 'running'
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-slate-50 text-slate-600 border-slate-200'
          }`}
        >
          {task.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
          {task.status === 'failed' && <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />}
          {task.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />}
          {task.status === 'completed'
            ? '全流程协同完成'
            : task.status === 'failed'
            ? '存在失败步骤'
            : task.status === 'running'
            ? `编排执行中 · ${task.currentStep || ''}`
            : '排队中'}
        </span>
      </div>

      {/* 任务总进度条 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 font-medium">链路执行总进度</span>
          <span className="font-mono font-bold text-blue-600">{task.progress}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 transition-all duration-500 shadow-xs"
            style={{ width: `${task.progress}%` }}
          />
        </div>
      </div>

      {/* 步骤执行视图：前 2 步串行展示，后 2 步分叉并发展示 */}
      <div className="space-y-3.5 pt-1">
        {/* 串行阶段：步骤 1 (故障诊断) & 步骤 2 (检修方案) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {task.steps.slice(0, 2).map((step) => {
            const meta = STEP_META[step.stepName] || { icon: Wrench, desc: '' };
            const Icon = meta.icon;
            return (
              <div
                key={step.id}
                className={`p-4 rounded-xl border transition-all ${
                  step.status === 'completed'
                    ? 'bg-emerald-50/20 border-emerald-200/90 shadow-2xs'
                    : step.status === 'failed'
                    ? 'bg-rose-50/40 border-rose-200/90'
                    : step.status === 'running'
                    ? 'bg-blue-50/30 border-blue-400 ring-2 ring-blue-100 shadow-xs'
                    : 'bg-slate-50/60 border-slate-200/80'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-200/70 text-slate-700">
                      串行
                    </span>
                    <span className="text-xs font-bold text-slate-900 flex items-center">
                      <Icon className="w-4 h-4 mr-1 text-slate-700" />
                      {step.stepName}
                    </span>
                  </div>
                  <span className="flex items-center">
                    {step.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {step.status === 'failed' && <XCircle className="w-4 h-4 text-rose-500" />}
                    {step.status === 'running' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                    {step.status === 'pending' && <Clock className="w-4 h-4 text-slate-300" />}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2.5 leading-relaxed">{meta.desc}</p>
                {step.status === 'running' && (
                  <div className="h-1.5 w-full rounded-full bg-blue-100 overflow-hidden mb-2.5">
                    <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: `${Math.max(step.progress, 15)}%` }} />
                  </div>
                )}
                {renderStepBody(step)}
              </div>
            );
          })}
        </div>

        {/* 并行阶段提示与分发框：步骤 3A (风险审核) ∥ 步骤 3B (派单推荐) */}
        <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/90 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700">
                <Layers className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-slate-900">
                双路异步并发协同阶段（Promise.all）
              </span>
              {(task.steps[2]?.status === 'running' || task.steps[3]?.status === 'running') && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200 animate-pulse flex items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-1" />
                  双 Agent 异步求解中
                </span>
              )}
            </div>
            <span className="text-xs font-mono text-slate-500">
              安全审核 ∥ 派单调度 并发非阻塞
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {task.steps.slice(2).map((step, idx) => {
              const meta = STEP_META[step.stepName] || { icon: Wrench, desc: '' };
              const Icon = meta.icon;
              const isBranch1 = idx === 0;
              return (
                <div
                  key={step.id}
                  className={`p-4 rounded-xl border transition-all ${
                    step.status === 'completed'
                      ? 'bg-white border-emerald-200/90 shadow-2xs'
                      : step.status === 'failed'
                      ? 'bg-rose-50/40 border-rose-200/90'
                      : step.status === 'running'
                      ? isBranch1
                        ? 'bg-white border-emerald-400 ring-2 ring-emerald-100 shadow-xs'
                        : 'bg-white border-purple-400 ring-2 ring-purple-100 shadow-xs'
                      : 'bg-white/90 border-slate-200/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                        isBranch1 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-purple-50 text-purple-700 border border-purple-200/60'
                      }`}>
                        {isBranch1 ? '并发路 1' : '并发路 2'}
                      </span>
                      <span className="text-xs font-bold text-slate-900 flex items-center">
                        <Icon className={`w-4 h-4 mr-1 ${isBranch1 ? 'text-emerald-600' : 'text-purple-600'}`} />
                        {step.stepName}
                      </span>
                    </div>
                    <span className="flex items-center">
                      {step.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {step.status === 'failed' && <XCircle className="w-4 h-4 text-rose-500" />}
                      {step.status === 'running' && (
                        <Loader2 className={`w-4 h-4 animate-spin ${isBranch1 ? 'text-emerald-500' : 'text-purple-500'}`} />
                      )}
                      {step.status === 'pending' && <Clock className="w-4 h-4 text-slate-300" />}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-2.5 leading-relaxed">{meta.desc}</p>
                  {step.status === 'running' && (
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden mb-2.5">
                      <div
                        className={`h-full rounded-full animate-pulse ${isBranch1 ? 'bg-emerald-500' : 'bg-purple-500'}`}
                        style={{ width: `${Math.max(step.progress, 15)}%` }}
                      />
                    </div>
                  )}
                  {renderStepBody(step)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
