import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  FileSearch,
  Loader2,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  XCircle,
  BookOpen,
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

export const AdminAiReviewsView: React.FC = () => {
  const [reviews, setReviews] = useState<AiGenerationReview[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AiGenerationReview | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleApprove = async (id: string) => {
    setActing(true);
    try {
      await adminAiReviewApi.approve(id);
      setDetail((d) => (d && d.id === id ? { ...d, status: 'approved' } : d));
      await fetchList();
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
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '驳回失败');
    } finally {
      setActing(false);
    }
  };

  const pendingCount = statusFilter === 'pending' ? reviews.length : reviews.filter((r) => r.status === 'pending').length;

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
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {s === 'pending' ? '待审核' : s === 'approved' ? '已通过' : s === 'rejected' ? '已驳回' : '全部'}
              </button>
            ))}
          </div>
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
          <div className="py-12 text-center">
            <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
            <p className="text-xs text-slate-500">
              {statusFilter === 'pending' ? '暂无待审核的 AI 生成内容' : '暂无记录'}
            </p>
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
