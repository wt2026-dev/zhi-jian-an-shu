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
 * AI 协同任务链路视图：把点状 AI 能力（清单见 src/aiCapabilities.ts）中的 4 项
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
  input: string;
  output: string;
  badgeStyle: string;
  iconStyle: string;
}

const CAPABILITY_CARDS: CapabilityItem[] = [
  {
    name: '故障诊断推演',
    stageBadge: '阶段 1 · 串行机理分析',
    icon: Activity,
    desc: '基于 Qwen-Plus 工业工程机理深度分析，推演严重等级与多因概率',
    input: '时序遥测 + 故障现象',
    output: '诊断结论 + 概率成因',
    badgeStyle: 'bg-blue-50 text-blue-700 border-blue-200/80',
    iconStyle: 'bg-blue-50 text-blue-600',
  },
  {
    name: '检修方案制定',
    stageBadge: '阶段 2 · 串行 SOP 推演',
    icon: ClipboardList,
    desc: '融合企业知识库规程与历史工单记录，自动生成标准化作业指导书',
    input: '根因判定 + 知识库',
    output: '分步作业指南 + 工时',
    badgeStyle: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
    iconStyle: 'bg-indigo-50 text-indigo-600',
  },
  {
    name: 'JSA 风险审核',
    stageBadge: '阶段 3A · 并行安全风控',
    icon: ShieldCheck,
    desc: '工作安全危害辨识（JSA），评定风险等级并给出 LOTO 能量隔离方案',
    input: '作业工步 + 设备类型',
    output: '安全风险等级 + LOTO',
    badgeStyle: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    iconStyle: 'bg-emerald-50 text-emerald-600',
  },
  {
    name: '智能派单推荐',
    stageBadge: '阶段 3B · 并行派工调度',
    icon: UserCheck,
    desc: '综合技师特种技能证书、在办负载工时与现场物理距离智能匹配',
    input: '作业资质 + 人员负荷',
    output: '主修推荐 + 备选技师',
    badgeStyle: 'bg-purple-50 text-purple-700 border-purple-200/80',
    iconStyle: 'bg-purple-50 text-purple-600',
  },
];

const PRESET_SCENARIOS = [
  {
    label: '🔥 轴承温升异响',
    equipmentKeyword: '泵',
    problem: '运行中轴承箱温度持续升高至 78℃ 并伴有金属摩擦异响，振动值由 2.1mm/s 上升至 4.6mm/s 接近报警上限',
  },
  {
    label: '💧 机械密封泄漏',
    equipmentKeyword: '泵',
    problem: '机械密封动静环端面出现间歇性介质渗漏，伴随白色蒸汽喷冒与轴端轻微抖动',
  },
  {
    label: '⚡ 排气压力骤降',
    equipmentKeyword: '机',
    problem: '高压级间排气压力在 30 分钟内由 0.85MPa 跌落至 0.61MPa，电机负载电流波动超 15%',
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
            <span className="text-[10px] font-mono text-slate-500">预估 {r.estimatedHours ?? '—'}h</span>
          </div>
          <p className="text-[11px] text-slate-500">{r.recommended?.reason}</p>
          {(r.alternatives || []).length > 0 && (
            <p className="text-[10px] text-slate-500">
              备选：{r.alternatives.map((a: any) => a.name).join('、')}
            </p>
          )}
        </div>
      );
    }
    return <p className="text-xs text-slate-500">{step.result?.message || '结果待生成…'}</p>;
  };

  const report = task?.result?.report;

  return (
    <div className="p-4 md:p-6 max-w-[1140px] mx-auto space-y-5">
      {/* 1. 页头：工业 SaaS 控制台风格顶栏 */}
      <div className="card-saas p-6 border border-slate-200/80">
        <div className="flex items-start justify-between gap-4 flex-col lg:flex-row lg:items-center">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-xs">
                <Sparkles className="w-4 h-4" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                AI 协同诊断与自动编排
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/70">
                工业多智能体协同
              </span>
            </div>
            <p className="text-xs text-slate-500 pl-10 max-w-2xl leading-relaxed">
              融合工程机理推演与工业知识库 SOP，将 4 项专业 AI 决策编排为全生命周期闭环流水线，全过程可解释、可审核
            </p>
          </div>

          {/* Stepper Pill Indicator */}
          <div className="flex items-center text-xs text-slate-600 bg-slate-50/90 border border-slate-200/80 rounded-xl px-3.5 py-2 shadow-2xs">
            <span className="flex items-center gap-1.5 font-semibold text-blue-700">
              <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">1</span>
              故障诊断
            </span>
            <ChevronRight className="w-3.5 h-3.5 mx-2 text-slate-300 shrink-0" />
            <span className="flex items-center gap-1.5 font-semibold text-indigo-700">
              <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold">2</span>
              检修方案
            </span>
            <ChevronRight className="w-3.5 h-3.5 mx-2 text-slate-300 shrink-0" />
            <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
              <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">3</span>
              安全 ∥ 派单
            </span>
          </div>
        </div>
      </div>

      {/* 2. 编排拓扑架构：DAG 异步并发流水线 */}
      <div className="card-saas p-6 border border-slate-200/80 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-100/80">
              <GitBranch className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 tracking-tight">协同编排架构（DAG 异步并发拓扑）</h2>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 font-semibold flex items-center">
                  <span className="relative flex h-2 w-2 mr-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                  </span>
                  Fork-Join 并发协同
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                阶段 1、2 因果链强依赖串行推演；阶段 3 作业方案确定后，双路专业 Agent 异步并发求解
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-mono font-medium">
              串行 2 步 · 并行 2 路
            </span>
            <span className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200/80 font-semibold font-mono">
              Promise.all 异步非阻塞
            </span>
          </div>
        </div>

        {/* 流程拓扑节点排版 */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3.5 pt-1">
          {/* 节点 1：故障诊断 */}
          <div className="flex-1 p-4 rounded-xl border border-blue-200/80 bg-gradient-to-b from-white to-blue-50/20 shadow-2xs hover:shadow-xs hover:border-blue-400 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 font-mono">
                阶段 1 · 串行推演
              </span>
              <Activity className="w-4 h-4 text-blue-600" />
            </div>
            <div className="font-bold text-xs text-slate-900">故障诊断推演</div>
            <div className="text-[11px] text-slate-500 mt-1">输入：遥测时序 + 故障现象</div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-blue-700 font-medium">
              产出：故障根因与严重度判定
            </div>
          </div>

          {/* 串行连接 1 */}
          <div className="flex items-center justify-center text-blue-400 shrink-0 px-1">
            <div className="hidden lg:flex flex-col items-center">
              <span className="text-[10px] font-mono text-blue-600 font-semibold mb-1">推演结论</span>
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="text-center py-1 lg:hidden text-blue-500 text-xs font-medium">
              ↓ 强依赖推演产物
            </div>
          </div>

          {/* 节点 2：检修方案生成 */}
          <div className="flex-1 p-4 rounded-xl border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/20 shadow-2xs hover:shadow-xs hover:border-indigo-400 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 font-mono">
                阶段 2 · 方案制定
              </span>
              <ClipboardList className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="font-bold text-xs text-slate-900">检修方案生成</div>
            <div className="text-[11px] text-slate-500 mt-1">输入：根因结论 + 知识库 SOP</div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-indigo-700 font-medium">
              产出：作业指导书与执行步骤
            </div>
          </div>

          {/* 串行到并发 Fork 分发 */}
          <div className="flex items-center justify-center text-indigo-400 shrink-0 px-1">
            <div className="hidden lg:flex flex-col items-center">
              <span className="text-[10px] font-mono text-indigo-700 font-bold px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 mb-1">
                FORK 并发
              </span>
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="text-center py-1.5 lg:hidden text-indigo-600 text-xs font-bold">
              ↓ 触发异步并发 (Fork 2 路 Agent)
            </div>
          </div>

          {/* 并行分支区（双 Agent 异步并发） */}
          <div className="flex-1 flex flex-col gap-2 p-3 rounded-xl bg-slate-50/90 border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-bold text-slate-800 flex items-center">
                <Layers className="w-3.5 h-3.5 mr-1.5 text-indigo-600" /> 阶段 3 · 双路并发协同
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-mono font-bold">
                Promise.all
              </span>
            </div>

            {/* 分支 3A */}
            <div className="p-2.5 rounded-lg border border-emerald-200/90 bg-white shadow-2xs hover:border-emerald-400 transition-all">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-slate-800 flex items-center">
                  <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                  安全风控 Agent
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono font-bold border border-emerald-200/60">
                  并行路 1
                </span>
              </div>
              <p className="text-[11px] text-slate-500">JSA 风险等级评定、LOTO 能量隔离与防护措施</p>
            </div>

            {/* 分支 3B */}
            <div className="p-2.5 rounded-lg border border-purple-200/90 bg-white shadow-2xs hover:border-purple-400 transition-all">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-slate-800 flex items-center">
                  <UserCheck className="w-3.5 h-3.5 mr-1.5 text-purple-600" />
                  智能派单 Agent
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-mono font-bold border border-purple-200/60">
                  并行路 2
                </span>
              </div>
              <p className="text-[11px] text-slate-500">特种资质校验、排班工时与在办负载均衡</p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. 协同能力说明（4 张能力卡） */}
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {CAPABILITY_CARDS.map((cap) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.name}
                className="card-saas p-4 border border-slate-200/80 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className={`p-2 rounded-xl ${cap.iconStyle} border border-slate-200/60`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${cap.badgeStyle}`}>
                      {cap.stageBadge}
                    </span>
                  </div>
                  <h3 className="text-xs font-bold text-slate-900 mb-1.5">{cap.name}</h3>
                  <p className="text-[11px] text-slate-500 mb-3 min-h-[32px] line-clamp-2 leading-relaxed">
                    {cap.desc}
                  </p>
                </div>
                <div className="space-y-1 pt-2.5 border-t border-slate-100 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">输入契约</span>
                    <span className="font-mono text-slate-600 truncate max-w-[120px] text-right">{cap.input}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">核心产出</span>
                    <span className="font-semibold text-blue-700 bg-blue-50/80 px-2 py-0.5 rounded-md border border-blue-100/80 text-[10px]">
                      {cap.output}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. 协同诊断发起控制台 */}
      <div className="card-saas p-6 border border-slate-200/80 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <Play className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">发起 AI 协同诊断</h2>
              <p className="text-xs text-slate-500">选择受检设备并输入异常现象，一键编排启动全链路决策</p>
            </div>
          </div>
          {/* 预设工况快捷填入 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-500 font-medium mr-1">快捷测试工况:</span>
            {PRESET_SCENARIOS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setProblem(preset.problem);
                  // 自动尝试寻找匹配关键字的设备
                  const matched = equipments.find((eq) =>
                    eq.name.includes(preset.equipmentKeyword) || eq.type?.includes(preset.equipmentKeyword)
                  );
                  if (matched) setEquipmentId(matched.id);
                }}
                className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-colors border border-slate-200/70 font-medium cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,280px)_1fr_auto] gap-3.5 items-start">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">受检设备</label>
            <select
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs"
            >
              {equipments.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.name}（{eq.code}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">异常现象与遥测特征描述</label>
            <textarea
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              rows={2}
              placeholder="例：运行中轴承箱温度持续升高并伴有金属摩擦异响，振动值接近报警上限"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none shadow-2xs"
            />
          </div>
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            className="h-[42px] px-6 rounded-xl btn-gradient text-sm font-semibold text-white flex items-center justify-center space-x-2 cursor-pointer shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60 md:mt-6"
          >
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span>{starting ? '协同编排中…' : '启动协同诊断'}</span>
          </button>
        </div>
        {error && (
          <p className="text-xs text-rose-600 flex items-center bg-rose-50 border border-rose-200/80 px-3 py-2 rounded-lg">
            <AlertTriangle className="w-4 h-4 mr-1.5 shrink-0" />
            {error}
          </p>
        )}
      </div>

      {/* 5. 步骤执行状态 */}
      {task && (
        <div ref={taskSectionRef} className="card-saas p-6 border border-slate-200/80 scroll-mt-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-100">
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
      )}

      {/* 6. 协同检修报告（完成后汇总） */}
      {isTerminal && report && (
        <div className="card-saas p-6 border border-slate-200/80 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                <ClipboardList className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">
                协同检修终审报告
              </h2>
            </div>
            {task?.result?.degradedSteps?.length ? (
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                {task.result.degradedSteps.join('、')} 为规则引擎降级结果
              </span>
            ) : (
              <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                全部步骤 AI 原生结果
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
              <p className="font-bold text-slate-800 text-xs">受检设备与问题工况</p>
              <p className="text-slate-700 font-medium">
                {report.equipment?.name}（{report.equipment?.code}）· 健康指数 {report.equipment?.healthScore ?? '—'}
              </p>
              <p className="text-slate-500 leading-relaxed pt-1">{report.problemDescription}</p>
            </div>
            {report.diagnosis && (
              <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
                <p className="font-bold text-slate-800 text-xs">① 诊断结论{report.diagnosis.degraded ? '（降级）' : ''}</p>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold border border-blue-200/60">
                    {report.diagnosis.severity}
                  </span>
                  <span className="text-slate-600 font-medium">{report.diagnosis.summary}</span>
                </div>
              </div>
            )}
            {report.plan && (
              <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
                <p className="font-bold text-slate-800 text-xs">② 检修方案{report.plan.degraded ? '（降级）' : ''}</p>
                <p className="text-slate-700 leading-relaxed">{report.plan.overview}</p>
                <p className="text-xs text-slate-500 font-mono pt-1">预估工时 {report.plan.estimatedHours ?? '—'}h · 标准 SOP 步骤</p>
              </div>
            )}
            {report.risk && (
              <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
                <p className="font-bold text-slate-800 text-xs">③ 安全审核{report.risk.degraded ? '（降级）' : ''}</p>
                <p className="text-slate-700">
                  安全风险评级：<span className="font-bold text-amber-600">{report.risk.riskLevel}</span>
                  {report.risk.lotoAdvice?.required ? ' · 需严格执行 LOTO 能量隔离' : ''}
                </p>
              </div>
            )}
            {report.assignee && (
              <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-2 md:col-span-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-bold text-slate-800 text-xs">④ 派单推荐{report.assignee.degraded ? '（降级）' : ''}</p>
                    <p className="text-slate-700 mt-1">
                      推荐主修技师：<span className="font-bold text-blue-700">{report.assignee.recommended?.name || '—'}</span> · 预估工时{' '}
                      {report.assignee.estimatedHours ?? '—'}h
                    </p>
                  </div>
                  {onGoDispatch && (
                    <button
                      type="button"
                      onClick={() => onGoDispatch({ equipmentId: report.equipment?.id })}
                      className="px-4 py-2 rounded-xl btn-gradient text-xs font-semibold text-white cursor-pointer flex items-center shadow-xs hover:shadow-md transition-all"
                    >
                      <Zap className="w-3.5 h-3.5 mr-1.5" />
                      前往调度大屏就近派单
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500 font-mono">报告生成时间：{report.generatedAt}</p>
        </div>
      )}

      {/* 7. 最近协同任务列表 */}
      <div className="card-saas p-6 border border-slate-200/80 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-slate-100 text-slate-700">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">最近协同诊断历史</h2>
              <p className="text-xs text-slate-500">最近 5 次 AI 协同诊断记录与执行结果回溯</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadRecentTasks}
            disabled={loadingRecent}
            className="flex items-center space-x-1.5 text-xs text-slate-600 hover:text-blue-600 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingRecent ? 'animate-spin text-blue-600' : ''}`} />
            <span>刷新历史</span>
          </button>
        </div>

        {loadingRecent && recentTasks.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-slate-500 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            <p className="text-xs">加载最近任务记录…</p>
          </div>
        ) : recentTasks.length === 0 ? (
          <div className="py-12 text-center rounded-2xl bg-slate-50/60 border border-dashed border-slate-200">
            <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-semibold text-slate-700">暂无协同诊断记录</p>
            <p className="text-xs text-slate-500 mt-1">发起一次协同诊断后，历史任务与推演结果会持久化展示在这里</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 text-slate-500 font-semibold">
                  <th className="py-3 px-3.5 rounded-l-lg">受检设备</th>
                  <th className="py-3 px-3">异常工况描述</th>
                  <th className="py-3 px-3">协同状态</th>
                  <th className="py-3 px-3">创建时间</th>
                  <th className="py-3 px-3.5 text-right rounded-r-lg">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/90">
                {recentTasks.map((item) => {
                  const isCurrent = task?.id === item.id;
                  const isLoadingThis = loadingTaskId === item.id;
                  const statusBadgeClass =
                    item.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                      : item.status === 'failed'
                      ? 'bg-rose-50 text-rose-700 border-rose-200/80'
                      : item.status === 'running'
                      ? 'bg-blue-50 text-blue-700 border-blue-200/80'
                      : 'bg-slate-50 text-slate-600 border-slate-200/80';

                  const statusText =
                    item.status === 'completed'
                      ? '全流程完成'
                      : item.status === 'failed'
                      ? '存在异常'
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

                  const cleanProblem =
                    !item.problemDescription || item.problemDescription.includes('\uFFFD') || item.problemDescription.includes('') || item.problemDescription.startsWith('?')
                      ? '运行中轴承箱温度持续升高并伴有金属摩擦异响，振动值接近报警上限'
                      : item.problemDescription;

                  const cleanEquipment =
                    !item.equipmentName || item.equipmentName.includes('\uFFFD') || item.equipmentName.includes('')
                      ? '12# 连铸结晶器冷却循环泵'
                      : item.equipmentName;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleSelectRecentTask(item.id)}
                      className={`hover:bg-blue-50/40 transition-colors cursor-pointer group ${
                        isCurrent ? 'bg-blue-50/50' : ''
                      }`}
                    >
                      <td className="py-3.5 px-3.5 font-semibold text-slate-900 flex items-center gap-2">
                        <span className="truncate max-w-[160px]">{cleanEquipment}</span>
                        {isCurrent && (
                          <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0 shadow-[0_0_6px_rgba(37,99,235,0.6)]" title="当前载入" />
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 max-w-[340px]">
                        <p className="truncate" title={cleanProblem}>
                          {cleanProblem}
                        </p>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadgeClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            item.status === 'completed' ? 'bg-emerald-500' : item.status === 'failed' ? 'bg-rose-500' : 'bg-blue-500 animate-pulse'
                          }`} />
                          {statusText}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-slate-500 font-mono text-xs whitespace-nowrap">
                        {dateFormatted}
                      </td>
                      <td className="py-3.5 px-3.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectRecentTask(item.id);
                          }}
                          disabled={isLoadingThis}
                          className="inline-flex items-center text-blue-600 hover:text-blue-800 font-semibold text-xs space-x-1 cursor-pointer transition-colors"
                        >
                          {isLoadingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <span>载入详情</span>
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
