import React from 'react';
import {
  Loader2,
  ShieldCheck,
  FileSearch,
  ClipboardList,
  Sparkles,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { AiGenerationReview } from '../../api';
import { SOURCE_META, STATUS_META } from './adminReviewTypes';

interface AdminReviewsListProps {
  loading: boolean;
  reviews: AiGenerationReview[];
  statusFilter: 'pending' | 'approved' | 'rejected' | 'all';
  pendingCount: number;
  acting: boolean;
  onSelectReview: (review: AiGenerationReview) => void;
  onApprove: (id: string) => void;
  onOpenReject: (review: AiGenerationReview) => void;
  onNavigate?: (tab: string) => void;
}

export const AdminReviewsList: React.FC<AdminReviewsListProps> = ({
  loading,
  reviews,
  statusFilter,
  pendingCount,
  acting,
  onSelectReview,
  onApprove,
  onOpenReject,
  onNavigate,
}) => {
  if (loading) {
    return (
      <div className="glass-card p-4 shadow-sm">
        <div className="py-12 flex flex-col items-center text-slate-500 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
          加载审核列表…
        </div>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="glass-card p-4 shadow-sm">
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
          <p className="text-xs text-slate-500 max-w-md mx-auto mb-6">
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
      </div>
    );
  }

  return (
    <div className="glass-card p-4 shadow-sm">
      <div className="space-y-2.5">
        <p className="text-[11px] text-slate-500">
          共 {reviews.length} 条
          {statusFilter === 'pending' && pendingCount > 0 ? ` · 待处理 ${pendingCount} 条` : ''}
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
              onClick={() => onSelectReview(r)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-bold flex items-center">
                      <SIcon className="w-3 h-3 mr-1" />
                      {r.sourceTypeLabel || sm.label}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${st.cls} flex items-center`}
                    >
                      <StIcon className="w-3 h-3 mr-1" />
                      {st.label}
                    </span>
                    {(r.knowledgeSources || []).length > 0 && (
                      <span className="text-[10px] text-slate-500 flex items-center">
                        <BookOpen className="w-3 h-3 mr-0.5" />
                        知识库引用 {r.knowledgeSources.length} 篇
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-700 truncate">
                    {r.content?.overview ||
                      r.content?.summary ||
                      r.content?.title ||
                      JSON.stringify(r.content).slice(0, 80)}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500 font-mono truncate">
                    {r.aiEndpoint} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                    {r.reviewer ? ` · 审核人: ${r.reviewer}` : ''}
                  </p>
                </div>
                {r.status === 'pending' && (
                  <div
                    className="flex flex-col gap-1.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => onApprove(r.id)}
                      disabled={acting}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-60 flex items-center"
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      通过
                    </button>
                    <button
                      onClick={() => onOpenReject(r)}
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
    </div>
  );
};
