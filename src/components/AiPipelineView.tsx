import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import { equipmentApi, aiPipelineApi, AiPipelineTask, AiPipelineStep } from '../api';
import { Equipment } from '../types';

/**
 * AI 协同任务链路视图：把 14 项点状 AI 能力中的 4 项
 * （故障诊断 → 检修方案生成 → 风险审核 ∥ 派单推荐）
 * 编排为一次可追踪、可审核的「AI 协同诊断」任务。
 */
const STEP_META: Record<string, { icon: React.ComponentType<{ className?: string }>; desc: string }> = {
  '故障诊断': { icon: Activity, desc: 'qwen-plus 工程机理分析，输出严重度与可能原因' },
  '检修方案生成': { icon: ClipboardList, desc: '结合知识库 SOP 与历史检修记录生成作业指导书' },
  '风险审核': { icon: ShieldCheck, desc: 'JSA 作业安全分析，评定风险等级与 LOTO 建议' },
  '派单推荐': { icon: UserCheck, desc: '按负载与历史经验推荐主修技师' },
};

export const AiPipelineView: React.FC = () => {
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [problem, setProblem] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<AiPipelineTask | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    equipmentApi
      .list()
      .then((list) => {
        setEquipments(list || []);
        if (list?.length) setEquipmentId((prev) => prev || list[0].id);
      })
      .catch(() => setError('设备列表加载失败，请刷新重试'));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const isTerminal = task?.status === 'completed' || task?.status === 'failed';

  // 轮询任务进度（后端另提供 GET /events SSE 推送，供大屏/小程序消费）
  const startPolling = useCallback((taskId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await aiPipelineApi.getById(taskId);
        setTask(res.task);
        if (res.task.status === 'completed' || res.task.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        /* 单次轮询失败忽略，下一轮重试 */
      }
    }, 2000);
  }, []);

  const handleStart = async () => {
    if (!equipmentId || problem.trim().length < 2) {
      setError('请选择设备并填写至少 2 个字符的问题描述');
      return;
    }
    setError(null);
    setStarting(true);
    setTask(null);
    try {
      const res = await aiPipelineApi.create({ equipmentId, problemDescription: problem.trim() });
      const initial = await aiPipelineApi.getById(res.taskId);
      setTask(initial.task);
      startPolling(res.taskId);
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '启动协同任务失败，请稍后重试');
    } finally {
      setStarting(false);
    }
  };

  const renderStepBody = (step: AiPipelineStep) => {
    if (step.status === 'pending') {
      return <p className="text-xs text-slate-400">等待前序步骤完成…</p>;
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
            <span className="text-[10px] font-mono text-slate-400">紧急评分 {d.urgencyScore ?? '—'}</span>
            {step.result?.degraded && <DegradedBadge />}
          </div>
          <p className="text-xs text-slate-700">{d.summary}</p>
          <ul className="text-[11px] text-slate-500 space-y-0.5">
            {(d.probableCauses || []).slice(0, 3).map((c: any, i: number) => (
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
            {(p.steps || []).slice(0, 4).map((s: any) => (
              <li key={s.step}>{s.operation}</li>
            ))}
          </ol>
          <p className="text-[10px] text-slate-400 font-mono">预估工时 {p.estimatedHours ?? '—'}h · {(p.steps || []).length} 个步骤</p>
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
                需 LOTO（{a.lotoAdvice.lockCount ?? 2} 把锁）
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500">{a.riskReason}</p>
          <ul className="text-[11px] text-slate-500 space-y-0.5">
            {(a.jsaMeasures || []).slice(0, 3).map((m: any, i: number) => (
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
            <span className="text-[10px] font-mono text-slate-400">预估 {r.estimatedHours ?? '—'}h</span>
          </div>
          <p className="text-[11px] text-slate-500">{r.recommended?.reason}</p>
          {(r.alternatives || []).length > 0 && (
            <p className="text-[10px] text-slate-400">
              备选：{r.alternatives.map((a: any) => a.name).join('、')}
            </p>
          )}
        </div>
      );
    }
    return <p className="text-xs text-slate-400">{step.result?.message || '结果待生成…'}</p>;
  };

  const report = task?.result?.report;

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto">
      {/* 页头：闭环叙事 */}
      <div className="glass-card p-5 shadow-sm mb-4">
        <div className="flex items-start justify-between gap-4 flex-col md:flex-row">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center">
              <Sparkles className="w-5 h-5 mr-2 text-blue-600" />
              AI 协同诊断
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              一次点击，编排 4 项 AI 能力按依赖顺序协同执行，全过程可追踪、可审核
            </p>
          </div>
          <div className="flex items-center text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">① 故障诊断</span>
            <ChevronRight className="w-3.5 h-3.5 mx-1 text-slate-300" />
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">② 检修方案</span>
            <ChevronRight className="w-3.5 h-3.5 mx-1 text-slate-300" />
            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-semibold">③ 风险审核 ∥ 派单推荐</span>
          </div>
        </div>
      </div>

      {/* 启动表单 */}
      <div className="glass-card p-5 shadow-sm mb-4">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,280px)_1fr_auto] gap-3 items-start">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1.5">目标设备</label>
            <select
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {equipments.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.name}（{eq.code}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1.5">问题描述（异常现象 / 报警信息）</label>
            <textarea
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              rows={2}
              placeholder="例：运行中轴承箱温度持续升高并伴有金属摩擦异响，振动值接近报警上限"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
            />
          </div>
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            className="h-[42px] px-5 rounded-lg btn-gradient text-sm font-semibold text-white flex items-center justify-center space-x-1.5 cursor-pointer hover:shadow-md transition-all disabled:opacity-60 md:mt-6"
          >
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span>{starting ? '启动中…' : '启动协同诊断'}</span>
          </button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-rose-600 flex items-center">
            <AlertTriangle className="w-3.5 h-3.5 mr-1" />
            {error}
          </p>
        )}
      </div>

      {/* 步骤执行状态 */}
      {task && (
        <div className="glass-card p-5 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center">
              <Zap className="w-4 h-4 mr-1.5 text-blue-600" />
              协同任务执行状态
              <span className="ml-2 text-[10px] font-mono text-slate-400">{task.id}</span>
            </h2>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                task.status === 'completed'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : task.status === 'failed'
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}
            >
              {task.status === 'completed'
                ? '已完成'
                : task.status === 'failed'
                ? '存在失败步骤'
                : task.status === 'running'
                ? `执行中 · ${task.currentStep || ''}`
                : '排队中'}
            </span>
          </div>

          {/* 任务总进度条 */}
          <div className="h-1.5 w-full rounded-full bg-slate-100 mb-4 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
              style={{ width: `${task.progress}%` }}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {task.steps.map((step) => {
              const meta = STEP_META[step.stepName] || { icon: Wrench, desc: '' };
              const Icon = meta.icon;
              return (
                <div
                  key={step.id}
                  className={`p-4 rounded-xl border ${
                    step.status === 'completed'
                      ? 'bg-emerald-50/40 border-emerald-200'
                      : step.status === 'failed'
                      ? 'bg-rose-50/50 border-rose-200'
                      : step.status === 'running'
                      ? 'bg-blue-50/50 border-blue-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-800 flex items-center">
                      <Icon className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                      {step.stepName}
                    </span>
                    <span className="flex items-center">
                      {step.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {step.status === 'failed' && <XCircle className="w-4 h-4 text-rose-500" />}
                      {step.status === 'running' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                      {step.status === 'pending' && <Clock className="w-4 h-4 text-slate-300" />}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mb-2">{meta.desc}</p>
                  {step.status === 'running' && (
                    <div className="h-1 w-full rounded-full bg-blue-100 overflow-hidden mb-2">
                      <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: `${Math.max(step.progress, 15)}%` }} />
                    </div>
                  )}
                  {renderStepBody(step)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 协同检修报告（完成后汇总） */}
      {isTerminal && report && (
        <div className="glass-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center">
              <ClipboardList className="w-4 h-4 mr-1.5 text-blue-600" />
              协同检修报告
            </h2>
            {task?.result?.degradedSteps?.length ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                {task.result.degradedSteps.join('、')} 为规则引擎降级结果
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                全部步骤 AI 原生结果
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <p className="font-bold text-slate-700 mb-1">设备与问题</p>
              <p className="text-slate-600">
                {report.equipment?.name}（{report.equipment?.code}）· 健康分 {report.equipment?.healthScore ?? '—'}
              </p>
              <p className="text-slate-500 mt-1">{report.problemDescription}</p>
            </div>
            {report.diagnosis && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <p className="font-bold text-slate-700 mb-1">① 诊断结论{report.diagnosis.degraded ? '（降级）' : ''}</p>
                <p className="text-slate-600">
                  {report.diagnosis.severity} · {report.diagnosis.summary}
                </p>
              </div>
            )}
            {report.plan && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <p className="font-bold text-slate-700 mb-1">② 检修方案{report.plan.degraded ? '（降级）' : ''}</p>
                <p className="text-slate-600">{report.plan.overview}</p>
                <p className="text-[10px] text-slate-400 mt-1 font-mono">预估工时 {report.plan.estimatedHours ?? '—'}h</p>
              </div>
            )}
            {report.risk && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <p className="font-bold text-slate-700 mb-1">③ 风险审核{report.risk.degraded ? '（降级）' : ''}</p>
                <p className="text-slate-600">
                  风险等级 <span className="font-bold">{report.risk.riskLevel}</span>
                  {report.risk.lotoAdvice?.required ? ' · 需执行 LOTO 能量隔离' : ''}
                </p>
              </div>
            )}
            {report.assignee && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <p className="font-bold text-slate-700 mb-1">④ 派单推荐{report.assignee.degraded ? '（降级）' : ''}</p>
                <p className="text-slate-600">
                  推荐主修 <span className="font-bold">{report.assignee.recommended?.name || '—'}</span> · 预估{' '}
                  {report.assignee.estimatedHours ?? '—'}h
                </p>
              </div>
            )}
          </div>
          <p className="mt-3 text-[10px] text-slate-400 font-mono">报告生成时间：{report.generatedAt}</p>
        </div>
      )}
    </div>
  );
};

const DegradedBadge: React.FC = () => (
  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
    规则引擎降级
  </span>
);
