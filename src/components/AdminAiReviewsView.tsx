import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileSearch,
  GitBranch,
  Loader2,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { adminAiReviewApi, AiGenerationReview } from '../api';

const SOURCE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  maintenance_plan: { label: '检修方案', icon: WrenchIcon },
  safety_risk: { label: '作业风险评估', icon: ShieldCheck },
  report: { label: 'AI 报告', icon: FileSearch },
  work_order_draft: { label: '工单草稿', icon: ClipboardList },
};

function WrenchIcon({ className }: { className?: string }) {
  return <span className={className}>🔧</span>;
}

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { label: '待审核', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
  approved: { label: '已通过', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  rejected: { label: '已驳回', cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: XCircle },
};

interface AdminAiReviewsViewProps {
  onNavigate?: (tab: string) => void;
}

const STAT_CARDS = [
  {
    key: 'pending' as const,
    label: '待审核',
    desc: '待管理员核验的 AI 产物',
    icon: Clock,
    activeCls: 'border-amber-400 bg-amber-50/50 ring-1 ring-amber-300',
    badgeCls: 'bg-amber-100 text-amber-700 border border-amber-200',
    countCls: 'text-amber-600',
    iconBg: 'bg-amber-100 text-amber-700',
  },
  {
    key: 'approved' as const,
    label: '已通过',
    desc: '已核验准入，正式生效',
    icon: CheckCircle2,
    activeCls: 'border-emerald-400 bg-emerald-50/50 ring-1 ring-emerald-300',
    badgeCls: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    countCls: 'text-emerald-600',
    iconBg: 'bg-emerald-100 text-emerald-700',
  },
  {
    key: 'rejected' as const,
    label: '已驳回',
    desc: '已退回修正或存在异常',
    icon: XCircle,
    activeCls: 'border-rose-400 bg-rose-50/50 ring-1 ring-rose-300',
    badgeCls: 'bg-rose-100 text-rose-700 border border-rose-200',
    countCls: 'text-rose-600',
    iconBg: 'bg-rose-100 text-rose-700',
  },
  {
    key: 'all' as const,
    label: '全部内容',
    desc: '全量 AI 生成审核记录',
    icon: ScanSearch,
    activeCls: 'border-blue-400 bg-blue-50/50 ring-1 ring-blue-300',
    badgeCls: 'bg-blue-100 text-blue-700 border border-blue-200',
    countCls: 'text-blue-600',
    iconBg: 'bg-blue-100 text-blue-700',
  },
];

const REVIEW_PROCESS_STEPS = [
  {
    step: '1',
    title: 'AI 生成内容',
    desc: '大模型生成方案/评估/报告/工单草案',
    icon: Sparkles,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    step: '2',
    title: '进入审核台',
    desc: '自动挂起队列，状态标记为 pending',
    icon: Clock,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    step: '3',
    title: '管理员核验溯源',
    desc: '核实知识库 SOP 引用与现场工况',
    icon: BookOpen,
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
  {
    step: '4',
    title: '通过 / 驳回',
    desc: '通过：内容正式可用；驳回：填原因修正',
    icon: ShieldCheck,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
];

/** 美化渲染生成内容 JSON（键值中文化 + 数组/对象缩进） */
const KEY_LABELS: Record<string, string> = {
  overview: '方案概述', steps: '检修步骤', safetyMeasures: '安全措施', lotoPoints: 'LOTO 能量隔离点',
  ppe: '防护装备 (PPE)', highRiskNotes: '高危作业提示', tools: '工具清单', spareParts: '备件清单',
  qualityCheckpoints: '质检要点', estimatedHours: '预估工时(h)', workers: '建议人数',
  riskLevel: '风险等级', riskReason: '评级理由', hazardIdentifications: '危害辨识', jsaMeasures: 'JSA 控制措施',
  ppeList: '必备 PPE', lotoAdvice: 'LOTO 建议', approvalFocusPoints: '审批关注点',
  summary: '摘要', highlights: '工作亮点', problems: '存在问题', statistics: '关键指标',
  topIssues: '重点问题', suggestions: '改进建议', markdown: '报告正文',
};

function renderContent(value: any, depth = 0): React.ReactNode {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const s = String(value);
    if (s.length > 120 && (s.includes('\n') || depth >= 1)) {
      return <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{s}</p>;
    }
    return <span className="text-xs text-slate-700">{s}</span>;
  }
  if (Array.isArray(value)) {
    if (value.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
      return (
        <ul className="space-y-1 text-xs text-slate-600">
          {value.map((v, i) => (
            <li key={i} className="flex items-start space-x-1.5">
              <span className="text-blue-400 mt-0.5 shrink-0">•</span>
              <span>{String(v)}</span>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="p-2 rounded-lg bg-slate-50 border border-slate-100">
            {typeof v === 'object' && v !== null ? renderContent(v, depth + 1) : renderContent(v, depth + 1)}
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    return (
      <div className={depth === 0 ? 'space-y-3' : 'space-y-2'}>
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
              {KEY_LABELS[k] || k}
            </p>
            {renderContent(v, depth + 1)}
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export const AdminAiReviewsView: React.FC<AdminAiReviewsViewProps> = ({ onNavigate }) => {
  const [reviews, setReviews] = useState<AiGenerationReview[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [counts, setCounts] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    all: 0,
  });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AiGenerationReview | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = async () => {
    try {
      const allList = await adminAiReviewApi.list();
      const list = allList || [];
      setCounts({
        pending: list.filter((r) => r.status === 'pending').length,
        approved: list.filter((r) => r.status === 'approved').length,
        rejected: list.filter((r) => r.status === 'rejected').length,
        all: list.length,
      });
    } catch {
      // 容错处理
    }
  };

  const fetchList = async () => {
    setLoading(true);
    try {
      const list = await adminAiReviewApi.list(statusFilter === 'all' ? undefined : (statusFilter as any));
      setReviews(list || []);
      setError(null);
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '审核列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCounts();
  }, []);

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleApprove = async (id: string) => {
    setActing(true);
    try {
      await adminAiReviewApi.approve(id);
      setDetail((d) => (d && d.id === id ? { ...d, status: 'approved' } : d));
      await fetchList();
      fetchCounts();
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '审核通过失败');
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!detail || !rejectNote.trim()) return;
    setActing(true);
    try {
      await adminAiReviewApi.reject(detail.id, rejectNote.trim());
      setRejectOpen(false);
      setRejectNote('');
      setDetail((d) => (d ? { ...d, status: 'rejected' } : d));
      await fetchList();
      fetchCounts();
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '驳回失败');
    } finally {
      setActing(false);
    }
  };

  const pendingCount = counts.pending;

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto">
      {/* 页头 */}
      <div className="glass-card p-5 shadow-sm mb-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center">
              <ScanSearch className="w-5 h-5 mr-2 text-blue-600" />
              AI 生成内容审核台
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              AI 生成的检修方案 / 风险评估 / 报告在正式使用前需管理员审核；支持知识库溯源
            </p>
          </div>
          <div className="flex items-center space-x-1.5">
            {(['pending', 'approved', 'rejected', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  statusFilter === s
                    ? 'bg-blue-50 border-blue-300 text-blue-700 font-semibold'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {s === 'pending' ? '待审核' : s === 'approved' ? '已通过' : s === 'rejected' ? '已驳回' : '全部'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4 个统计卡（可点切换筛选） */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {STAT_CARDS.map((card) => {
          const Icon = card.icon;
          const isSelected = statusFilter === card.key;
          const count = counts[card.key];
          return (
            <div
              key={card.key}
              onClick={() => setStatusFilter(card.key)}
              className={`glass-card p-4 shadow-xs border transition-all cursor-pointer select-none relative overflow-hidden ${
                isSelected
                  ? card.activeCls
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg ${card.iconBg}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${card.badgeCls}`}>
                  {count} 条
                </span>
              </div>
              <div className="mt-1">
                <span className="text-xs font-bold text-slate-700">{card.label}</span>
                <div className={`text-2xl font-extrabold font-mono tracking-tight mt-0.5 ${card.countCls}`}>
                  {count}
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                <span>{card.desc}</span>
                {isSelected && (
                  <span className="font-semibold text-blue-600">当前筛选</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 审核流程说明条 */}
      <div className="glass-card p-4 shadow-sm mb-4 border border-blue-100/70 bg-gradient-to-r from-blue-50/20 via-white/50 to-indigo-50/20">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 flex-wrap gap-2">
          <div className="flex items-center space-x-2">
            <div className="p-1 rounded-md bg-blue-100 text-blue-700">
              <GitBranch className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-xs font-bold text-slate-800">AI 生成内容全生命周期审核流程</h2>
          </div>
          <span className="text-[10px] text-slate-500 font-medium">人机协同 · 双重核验 · 知识库溯源</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 relative">
          {REVIEW_PROCESS_STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div
                key={step.step}
                className="p-3 rounded-xl border border-slate-200 bg-white/90 relative flex flex-col justify-between shadow-xs"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                      步骤 {step.step}
                    </span>
                    <div className={`p-1 rounded-md ${step.bg}`}>
                      <Icon className={`w-3.5 h-3.5 ${step.color}`} />
                    </div>
                  </div>
                  <div className="font-bold text-xs text-slate-800">{step.title}</div>
                  <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{step.desc}</p>
                </div>
                {idx < REVIEW_PROCESS_STEPS.length - 1 && (
                  <div className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-white border border-slate-200 shadow-xs items-center justify-center text-slate-400">
                    <ArrowRight className="w-2.5 h-2.5" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="mb-3 text-xs text-rose-600 flex items-center">
          <XCircle className="w-3.5 h-3.5 mr-1" />
          {error}
        </p>
      )}

      {/* 审核列表 */}
      <div className="glass-card p-4 shadow-sm">
        {loading ? (
          <div className="py-12 flex flex-col items-center text-slate-400 text-xs">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
            加载审核列表…
          </div>
        ) : reviews.length === 0 ? (
          <div className="py-10 px-4 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800 mb-1">
              {statusFilter === 'pending'
                ? '暂无待审核的 AI 生成内容'
                : statusFilter === 'approved'
                ? '暂无已通过的审核记录'
                : statusFilter === 'rejected'
                ? '暂无已驳回的审核记录'
                : '暂无任何 AI 生成内容记录'}
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mb-6">
              所有工业大模型生成的关键作业与风控内容均需管理员双人或专职核验，当前筛选分类下无条目。
            </p>

            {/* 4 类受控内容规则卡片 */}
            <div className="max-w-3xl mx-auto text-left rounded-xl bg-slate-50/80 border border-slate-200 p-4 mb-5">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200 flex-wrap gap-2">
                <div className="flex items-center space-x-2">
                  <FileSearch className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-bold text-slate-800">
                    以下 4 类 AI 生成内容会自动进入审核台
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 font-medium bg-white px-2 py-0.5 rounded border border-slate-200">
                  生成后先入 pending，管理员审核通过后才可正式使用
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-3 rounded-lg bg-white border border-slate-200 flex items-start space-x-2.5">
                  <span className="text-base mt-0.5">🔧</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 flex items-center flex-wrap gap-1">
                      <span>检修方案</span>
                      <span className="font-mono text-[10px] text-blue-600 bg-blue-50 px-1 rounded border border-blue-100">
                        generate-maintenance-plan
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      SOP 检修工序、预估工时与工器具清单，核验后方可执行检修。
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-white border border-slate-200 flex items-start space-x-2.5">
                  <ShieldCheck className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 flex items-center flex-wrap gap-1">
                      <span>作业风险评估</span>
                      <span className="font-mono text-[10px] text-amber-600 bg-amber-50 px-1 rounded border border-amber-100">
                        safety-risk-assessment
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      JSA 作业危害辨识与 LOTO 隔离建议，核验后准予开具作业票。
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-white border border-slate-200 flex items-start space-x-2.5">
                  <FileSearch className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 flex items-center flex-wrap gap-1">
                      <span>AI 报告</span>
                      <span className="font-mono text-[10px] text-indigo-600 bg-indigo-50 px-1 rounded border border-indigo-100">
                        generate-report
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      机组巡检、周月度技术分析报表，核验后正式沉淀归档知识库。
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-white border border-slate-200 flex items-start space-x-2.5">
                  <ClipboardList className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 flex items-center flex-wrap gap-1">
                      <span>工单草稿</span>
                      <span className="font-mono text-[10px] text-purple-600 bg-purple-50 px-1 rounded border border-purple-100">
                        AI 工单生成
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      由现场语音转写或异常描述抽取的工单草案，核验后派发执行。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 操作引导按钮 */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => onNavigate?.('ai_pipeline')}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold hover:bg-blue-100 hover:border-blue-300 transition-all cursor-pointer shadow-xs group"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                <span>去 AI 协同发起一次诊断，产生待审内容</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1.5 text-blue-500 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[11px] text-slate-400">
              共 {reviews.length} 条{statusFilter === 'pending' && pendingCount > 0 ? ` · 待处理 ${pendingCount} 条` : ''}
            </p>
            {reviews.map((r) => {
              const sm = SOURCE_META[r.sourceType] || { label: r.sourceType, icon: Sparkles };
              const st = STATUS_META[r.status] || STATUS_META.pending;
              const SIcon = sm.icon;
              const StIcon = st.icon;
              return (
                <div
                  key={r.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                  onClick={() => setDetail(r)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-bold flex items-center">
                          <SIcon className="w-3 h-3 mr-1" />
                          {r.sourceTypeLabel || sm.label}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${st.cls} flex items-center`}>
                          <StIcon className="w-3 h-3 mr-1" />
                          {st.label}
                        </span>
                        {(r.knowledgeSources || []).length > 0 && (
                          <span className="text-[10px] text-slate-400 flex items-center">
                            <BookOpen className="w-3 h-3 mr-0.5" />
                            知识库引用 {r.knowledgeSources.length} 篇
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-slate-700 truncate">
                        {r.content?.overview || r.content?.summary || r.content?.title || JSON.stringify(r.content).slice(0, 80)}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400 font-mono truncate">
                        {r.aiEndpoint} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                        {r.reviewer ? ` · 审核人: ${r.reviewer}` : ''}
                      </p>
                    </div>
                    {r.status === 'pending' && (
                      <div className="flex flex-col gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleApprove(r.id)}
                          disabled={acting}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-60 flex items-center"
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          通过
                        </button>
                        <button
                          onClick={() => {
                            setDetail(r);
                            setRejectOpen(true);
                          }}
                          disabled={acting}
                          className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 text-[11px] font-semibold cursor-pointer disabled:opacity-60 flex items-center"
                        >
                          <XCircle className="w-3 h-3 mr-1" />
                          驳回
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 详情抽屉 */}
      {detail && (
        <div className="fixed inset-0 z-[90] flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={() => { setDetail(null); setRejectOpen(false); }}>
          <aside
            className="h-full w-full max-w-lg bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center">
                  <FileSearch className="w-4 h-4 mr-1.5 text-blue-600" />
                  生成内容详情
                </h3>
                <p className="text-[10px] text-slate-400 font-mono mt-1">
                  {detail.aiEndpoint} · {new Date(detail.createdAt).toLocaleString('zh-CN')}
                </p>
              </div>
              <button
                onClick={() => { setDetail(null); setRejectOpen(false); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 生成内容全文 */}
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center">
                  <Sparkles className="w-3 h-3 mr-1 text-blue-500" />
                  AI 生成内容全文
                </p>
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
                  {renderContent(detail.content)}
                </div>
              </div>

              {/* 知识库引用片段 */}
              {(detail.knowledgeRefs || []).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center">
                    <BookOpen className="w-3 h-3 mr-1 text-blue-500" />
                    知识库溯源（检索命中 {detail.knowledgeRefs.length} 篇）
                  </p>
                  <div className="space-y-2">
                    {detail.knowledgeRefs.map((k) => (
                      <div key={k.id} className="p-2.5 rounded-lg bg-blue-50/50 border border-blue-100 text-xs">
                        <p className="font-semibold text-blue-900">《{k.title}》</p>
                        <p className="text-[10px] text-slate-500">{k.category}</p>
                        {k.excerpt && <p className="mt-1 text-[11px] text-slate-600">{k.excerpt}…</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 审核信息 */}
              {detail.status !== 'pending' && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs">
                  <p className="font-bold text-slate-600">
                    {detail.status === 'approved' ? '已通过' : '已驳回'} · 审核人 {detail.reviewer || '—'}
                  </p>
                  {detail.reviewNote && <p className="text-slate-500 mt-1">审核意见：{detail.reviewNote}</p>}
                  {detail.reviewedAt && (
                    <p className="text-[10px] text-slate-400 font-mono mt-1">
                      {new Date(detail.reviewedAt).toLocaleString('zh-CN')}
                    </p>
                  )}
                </div>
              )}

              {/* 驳回原因输入 */}
              {rejectOpen && detail.status === 'pending' && (
                <div className="p-3 rounded-xl border border-rose-200 bg-rose-50/60">
                  <p className="text-xs font-bold text-rose-700 mb-2">驳回原因（必填）</p>
                  <textarea
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    rows={3}
                    placeholder="例：检修步骤与设备实际工况不符，缺少验电环节"
                    className="w-full px-3 py-2 rounded-lg border border-rose-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-200 resize-none"
                  />
                  <button
                    onClick={handleReject}
                    disabled={acting || !rejectNote.trim()}
                    className="mt-2 w-full py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center"
                  >
                    {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <XCircle className="w-3.5 h-3.5 mr-1" />}
                    确认驳回
                  </button>
                </div>
              )}
            </div>

            {/* 抽屉底：待审核操作 */}
            {detail.status === 'pending' && !rejectOpen && (
              <div className="p-3 border-t border-slate-200 flex gap-2">
                <button
                  onClick={() => handleApprove(detail.id)}
                  disabled={acting}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center"
                >
                  {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                  审核通过（内容可正式使用）
                </button>
                <button
                  onClick={() => setRejectOpen(true)}
                  disabled={acting}
                  className="flex-1 py-2.5 rounded-lg bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center"
                >
                  <XCircle className="w-3.5 h-3.5 mr-1" />
                  驳回
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};
