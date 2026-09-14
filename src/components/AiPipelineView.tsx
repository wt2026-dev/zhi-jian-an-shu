import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  GitBranch,
  History,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  equipmentApi,
  aiPipelineApi,
  AiPipelineTask,
  AiPipelineStep,
  AiPipelineListItem,
} from '../api';
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

interface CapabilityItem {
  name: string;
  stageBadge: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  output: string;
}

const CAPABILITY_CARDS: CapabilityItem[] = [
  {
    name: '故障诊断',
    stageBadge: '机理分析 · 串行',
    icon: Activity,
    desc: STEP_META['故障诊断'].desc,
    output: '诊断结论 + 可能原因',
  },
  {
    name: '检修方案生成',
    stageBadge: 'SOP生成 · 串行',
    icon: ClipboardList,
    desc: STEP_META['检修方案生成'].desc,
    output: '作业指导书',
  },
  {
    name: '风险审核',
    stageBadge: 'JSA风控 · 并行',
    icon: ShieldCheck,
    desc: STEP_META['风险审核'].desc,
    output: '风险等级 + LOTO 建议',
  },
  {
    name: '派单推荐',
    stageBadge: '智能派工 · 并行',
    icon: UserCheck,
    desc: STEP_META['派单推荐'].desc,
    output: '主修技师推荐',
  },
];

interface AiPipelineViewProps {
  /** 携带任务设备跳转调度大屏（派单推荐卡片「前往调度」） */
  onGoDispatch?: (preset: { workOrderId?: string | null; equipmentId?: string | null }) => void;
}

export const AiPipelineView: React.FC<AiPipelineViewProps> = ({ onGoDispatch }) => {
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [problem, setProblem] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<AiPipelineTask | null>(null);
  const [recentTasks, setRecentTasks] = useState<AiPipelineListItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskSectionRef = useRef<HTMLDivElement>(null);

  const loadRecentTasks = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const res = await aiPipelineApi.list(5);
      setRecentTasks(res.tasks || []);
    } catch {
      // 容错处理，不中断界面
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    equipmentApi
      .list()
      .then((list) => {
        setEquipments(list || []);
        if (list?.length) setEquipmentId((prev) => prev || list[0].id);
      })
      .catch(() => setError('设备列表加载失败，请刷新重试'));

    loadRecentTasks();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadRecentTasks]);

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
          loadRecentTasks();
        }
      } catch {
        /* 单次轮询失败忽略，下一轮重试 */
      }
    }, 2000);
  }, [loadRecentTasks]);

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
      loadRecentTasks();
      setTimeout(() => {
        taskSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '启动协同任务失败，请稍后重试');
    } finally {
      setStarting(false);
    }
  };

  const handleSelectRecentTask = async (taskId: string) => {
    setLoadingTaskId(taskId);
    setError(null);
    try {
      const res = await aiPipelineApi.getById(taskId);
      setTask(res.task);
      if (res.task.status === 'running' || res.task.status === 'pending') {
        startPolling(res.task.id);
      } else if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setTimeout(() => {
        taskSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } catch (e: any) {
      setError(e?.message || '加载任务详情失败');
    } finally {
      setLoadingTaskId(null);
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
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-4">
      {/* 页头：闭环叙事 */}
      <div className="glass-card p-5 shadow-sm">
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

      {/* 编排流程图区块 */}
      <div className="glass-card p-5 shadow-sm border border-blue-100/70 bg-gradient-to-r from-blue-50/20 via-white/50 to-indigo-50/20">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4 pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-blue-100/80 text-blue-700">
              <GitBranch className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">协同编排架构（DAG 拓扑流程）</h2>
              <p className="text-[11px] text-slate-500">机理分析串行驱动，多维决策并行加速</p>
            </div>
          </div>
          <span className="text-[11px] px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium">
            4 项 AI 能力 · 串行依赖 2 段 · 并行执行 2 路 · 全过程可追踪可审核
          </span>
        </div>

        {/* 流程拓扑节点 */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          {/* 节点 1：故障诊断 */}
          <div className="flex-1 p-3.5 rounded-xl border border-slate-200 bg-white/90 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">步骤 1 · 串行</span>
              <Activity className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="font-bold text-xs text-slate-800">故障诊断</div>
            <div className="text-[10px] text-slate-400 mt-1">输入：遥测数据 + 故障现象</div>
            <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-blue-600 font-medium">
              输出：严重度与可能原因
            </div>
          </div>

          {/* 串行连接 1 */}
          <div className="flex items-center justify-center text-blue-400 shrink-0">
            <ArrowRight className="w-4 h-4 hidden lg:block" />
            <div className="text-center py-1 lg:hidden text-blue-500 text-[11px] font-medium">
              ↓ 串行输入诊断结论
            </div>
          </div>

          {/* 节点 2：检修方案生成 */}
          <div className="flex-1 p-3.5 rounded-xl border border-slate-200 bg-white/90 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">步骤 2 · 串行</span>
              <ClipboardList className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <div className="font-bold text-xs text-slate-800">检修方案生成</div>
            <div className="text-[10px] text-slate-400 mt-1">输入：诊断结论 + 知识库 SOP</div>
            <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-indigo-600 font-medium">
              输出：作业指导书与步骤
            </div>
          </div>

          {/* 串行到并行连接 */}
          <div className="flex items-center justify-center text-indigo-400 shrink-0">
            <ArrowRight className="w-4 h-4 hidden lg:block" />
            <div className="text-center py-1 lg:hidden text-indigo-500 text-[11px] font-medium">
              ↓ 并行分发 (Promise.all)
            </div>
          </div>

          {/* 并行分支区 */}
          <div className="flex-1 flex flex-col gap-2 p-2.5 rounded-xl bg-indigo-50/40 border border-indigo-100">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-bold text-indigo-700 flex items-center">
                <Layers className="w-3 h-3 mr-1" /> 并行分支（Promise.all）
              </span>
              <span className="text-[9px] text-slate-400 font-mono">2 路并发</span>
            </div>

            {/* 分支 3A */}
            <div className="p-2.5 rounded-lg border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-slate-800 flex items-center">
                  <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                  风险审核
                </span>
                <span className="text-[9px] px-1 rounded bg-emerald-100 text-emerald-700 font-semibold">并行路 1</span>
              </div>
              <p className="text-[10px] text-slate-400">JSA 风险等级评定与 LOTO 隔离建议</p>
            </div>

            {/* 分支 3B */}
            <div className="p-2.5 rounded-lg border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-slate-800 flex items-center">
                  <UserCheck className="w-3.5 h-3.5 mr-1 text-purple-600" />
                  派单推荐
                </span>
                <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-700 font-semibold">并行路 2</span>
              </div>
              <p className="text-[10px] text-slate-400">主修技师匹配、负载均衡与工时预估</p>
            </div>
          </div>
        </div>
      </div>

      {/* 协同能力说明（4 张能力卡） */}
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {CAPABILITY_CARDS.map((cap) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.name}
                className="glass-card p-4 shadow-xs border border-slate-200 hover:border-blue-300 transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600 border border-slate-200">
                      {cap.stageBadge}
                    </span>
                  </div>
                  <h3 className="text-xs font-bold text-slate-800 mb-1">{cap.name}</h3>
                  <p className="text-[11px] text-slate-500 mb-3 min-h-[32px] line-clamp-2 leading-relaxed">
                    {cap.desc}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">核心产物</span>
                  <span className="font-semibold text-blue-700 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-100">
                    {cap.output}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 启动表单 */}
      <div className="glass-card p-5 shadow-sm">
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
        <div ref={taskSectionRef} className="glass-card p-5 shadow-sm scroll-mt-6">
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
                  : task.status === 'running'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
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
                {onGoDispatch && (
                  <button
                    type="button"
                    onClick={() => onGoDispatch({ equipmentId: report.equipment?.id })}
                    className="mt-2 px-3 py-1.5 rounded-lg btn-gradient text-[11px] font-semibold text-white cursor-pointer flex items-center"
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    前往调度大屏就近派单
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="mt-3 text-[10px] text-slate-400 font-mono">报告生成时间：{report.generatedAt}</p>
        </div>
      )}

      {/* 最近协同任务列表 */}
      <div className="glass-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">最近协同任务</h2>
              <p className="text-[11px] text-slate-500">最近 5 次 AI 协同诊断记录与执行回溯</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadRecentTasks}
            disabled={loadingRecent}
            className="flex items-center space-x-1 text-xs text-slate-500 hover:text-blue-600 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingRecent ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
        </div>

        {loadingRecent && recentTasks.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-slate-400 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            <p className="text-xs">加载最近任务记录…</p>
          </div>
        ) : recentTasks.length === 0 ? (
          <div className="py-10 text-center rounded-xl bg-slate-50/60 border border-dashed border-slate-200">
            <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-medium text-slate-700">暂无协同诊断记录</p>
            <p className="text-[11px] text-slate-400 mt-1">发起一次协同诊断后，任务记录会展示在这里</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-medium">
                  <th className="pb-2.5 font-medium">设备名</th>
                  <th className="pb-2.5 font-medium">问题摘要</th>
                  <th className="pb-2.5 font-medium">状态</th>
                  <th className="pb-2.5 font-medium">创建时间</th>
                  <th className="pb-2.5 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentTasks.map((item) => {
                  const isCurrent = task?.id === item.id;
                  const isLoadingThis = loadingTaskId === item.id;
                  const statusBadgeClass =
                    item.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : item.status === 'failed'
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : item.status === 'running'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200';

                  const statusText =
                    item.status === 'completed'
                      ? '已完成'
                      : item.status === 'failed'
                      ? '存在失败'
                      : item.status === 'running'
                      ? `执行中 ${item.progress}%`
                      : '排队中';

                  const dateFormatted = item.createdAt
                    ? new Date(item.createdAt).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                      })
                    : '—';

                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleSelectRecentTask(item.id)}
                      className={`hover:bg-blue-50/40 transition-colors cursor-pointer group ${
                        isCurrent ? 'bg-blue-50/60' : ''
                      }`}
                    >
                      <td className="py-3 pr-3 font-semibold text-slate-800 flex items-center gap-1.5">
                        <span className="truncate max-w-[150px]">{item.equipmentName || '—'}</span>
                        {isCurrent && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" title="当前载入" />
                        )}
                      </td>
                      <td className="py-3 pr-3 text-slate-600 max-w-[320px]">
                        <p className="truncate" title={item.problemDescription}>
                          {item.problemDescription || '—'}
                        </p>
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeClass}`}>
                          {statusText}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                        {dateFormatted}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectRecentTask(item.id);
                          }}
                          disabled={isLoadingThis}
                          className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium text-[11px] space-x-1"
                        >
                          {isLoadingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <span>查看详情</span>
                              <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const DegradedBadge: React.FC = () => (
  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
    规则引擎降级
  </span>
);
