import { Sparkles, AlertTriangle, Clock, PencilLine } from 'lucide-react';
import type { HumanRevisionRecord, LotoConfirmationItem, StageStepMeta } from './types';
import { fmtClock } from './stageEditSpecs';

export function StageStatusBadge({ status }: { status: StageStepMeta['status'] }) {
  const map = {
    completed: { text: '已人工确认', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200/80' },
    in_progress: { text: '进行中', cls: 'bg-blue-50 text-blue-700 border-blue-200/80' },
    pending: { text: '待开始', cls: 'bg-slate-50 text-slate-500 border-slate-200/80' },
  } as const;
  const m = map[status];
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${m.cls}`}>{m.text}</span>;
}

/** AI 预填状态条：引擎名、真实回写时间、ok/degraded 明示；degraded 不得伪装成成功 */
export function PrefillBanner({ stage, waitingPrefill }: { stage: StageStepMeta; waitingPrefill: boolean }) {
  const prefill = stage.aiPrefill || {};
  if (waitingPrefill) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600 flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-slate-400" />
        <span>该环节的 AI 预填仍在服务端排队（创建闭环后异步调用），结果回写后自动展示。</span>
      </div>
    );
  }
  if (!prefill.engine) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600">
        该环节不走 AI 预填：{prefill.content || '由现场人工完成后确认'}。
      </div>
    );
  }
  const degraded = prefill.status === 'degraded';
  return (
    <div
      className="relative overflow-hidden rounded-xl p-4 border"
      style={
        degraded
          ? { backgroundColor: 'rgba(244, 63, 94, 0.06)', borderColor: 'rgba(244, 63, 94, 0.35)' }
          : { backgroundColor: 'rgba(232, 163, 61, 0.08)', borderColor: 'rgba(232, 163, 61, 0.4)' }
      }
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 shadow-xs"
          style={{ backgroundColor: degraded ? '#E11D48' : '#E8A33D' }}
        >
          {degraded ? <AlertTriangle className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
        </div>
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded ${degraded ? 'text-rose-900 bg-rose-100' : 'text-amber-900'}`}
              style={degraded ? undefined : { backgroundColor: 'rgba(232, 163, 61, 0.25)' }}
            >
              {degraded ? 'AI 降级结果' : 'AI 已预填'}
            </span>
            <span className={`text-[11px] font-mono ${degraded ? 'text-rose-800' : 'text-amber-800'}`}>
              {prefill.engine}
              {fmtClock(prefill.generatedAt) ? ` · ${fmtClock(prefill.generatedAt)} 回写` : ''}
            </span>
          </div>
          {prefill.content && (
            <p className="text-xs sm:text-sm text-slate-800 font-medium leading-relaxed">{prefill.content}</p>
          )}
          {degraded && (
            <p className="text-[11px] text-rose-700 leading-relaxed">
              降级结果不作可信结论：下方字段可直接人工填写，确认时以人工填写值落库并在审计日志留痕。
            </p>
          )}
        </div>
      </div>
      {prefill.advice && (
        <pre className="mt-3 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap font-sans border-t border-slate-200/60 pt-2">
          {prefill.advice}
        </pre>
      )}
    </div>
  );
}

/** 服务端已持久化的人工修订（确认落库时写入的 humanRevised） */
export function RevisionRecordBanner({ revised }: { revised: HumanRevisionRecord }) {
  const fields: string[] = Array.isArray(revised?.fields) ? revised.fields : [];
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-[11px] text-blue-900 space-y-1">
      <div className="flex items-center gap-1.5 font-bold">
        <PencilLine className="w-3.5 h-3.5" />
        <span>已人工修订 · {revised?.by || '确认人'} · {revised?.at || ''}</span>
      </div>
      <p className="text-blue-800 leading-relaxed">
        修订字段：{fields.length ? fields.join('、') : '（无字段清单记录）'}；AI 原值保留在 ai_prefill_json.aiOriginal，可点「查看 AI 依据原文」比对。
      </p>
    </div>
  );
}

/** 归档环节的修订台账：哪些环节由人改过、改了什么、LOTO 谁登记 */
export function RevisionLedger({ stages, lotoItems }: { stages: StageStepMeta[]; lotoItems: LotoConfirmationItem[] }) {
  const revisedStages = stages.filter((s) => s.aiPrefill?.revised);
  const lotoEdited = lotoItems.filter((i) => i.editedBy);
  if (!revisedStages.length && !lotoEdited.length) return null;
  return (
    <div className="text-xs space-y-1 pt-1">
      <div className="font-semibold text-slate-800">人工修订台账</div>
      {revisedStages.map((s) => (
        <div key={s.id} className="text-slate-600 leading-relaxed">
          · 环节 {s.order}：{s.aiPrefill?.revised?.fields?.join('、') || '已修订'}（{s.aiPrefill?.revised?.by} {s.aiPrefill?.revised?.at}）
        </div>
      ))}
      {lotoEdited.map((i) => (
        <div key={i.id} className="text-slate-600 leading-relaxed">
          · LOTO「{i.point}」：{i.editedBy} {i.editedAt || ''} 现场登记
        </div>
      ))}
    </div>
  );
}
