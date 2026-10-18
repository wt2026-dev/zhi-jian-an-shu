/**
 * 工单详情里的「现场维修过程留痕」面板 —— 拆解作业终端的档案回看端。
 *
 * 为什么需要它：现场记录（LOTO / 逐步留痕 / 测量 / 照片 / 自动完工）确实写进了
 * work_orders.repair_log.fieldLog，但工单详情过去只渲染 workHours / causeAnalysis /
 * resolutionSteps，档案有数据却没人能看见 —— 「以后能看完整记录」这条要求是断的。
 * 本面板把 fieldLog 原样读出来（只读，不做任何推算或补数）。
 *
 * 数据纪律：
 *   · 只渲染 order.repairLog.fieldLog 里真实存在的字段；没有整块隐藏（不造占位）；
 *   · 测量合格性用服务端已落的 ok（null = 该项点检标准无限值，如实显示"仅留痕"）；
 *   · 步骤记录的时间/用时是服务端 `elapsedMin`（距上一条留痕的间隔），文案照此说明，
 *     不把它包装成"本步耗时"；
 *   · 照片直链为真实落盘的 /uploads/ 资源。
 */
import React, { useMemo, useState } from 'react';
import {
  ShieldCheck,
  ListChecks,
  Ruler,
  Camera,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ImageOff,
} from 'lucide-react';
import type { FieldWorkLog } from '../../types';

export interface WorkOrderFieldLogPanelProps {
  /** 工单 repair_log 下的现场留痕；空对象/空记录时整个面板不渲染 */
  log: FieldWorkLog | null | undefined;
}

const KIND_META: Record<FieldWorkLog['events'][number]['kind'], { label: string; cls: string }> = {
  loto: { label: '安全确认', cls: 'bg-amber-500/20 text-amber-700 border-amber-500/40' },
  step: { label: '步骤', cls: 'bg-cyan-500/15 text-cyan-700 border-cyan-500/40' },
  measure: { label: '测量', cls: 'bg-violet-500/15 text-violet-700 border-violet-500/40' },
  photo: { label: '照片', cls: 'bg-sky-500/15 text-sky-700 border-sky-500/40' },
  complete: { label: '完工', cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40' },
  acceptance: { label: '验收', cls: 'bg-teal-500/15 text-teal-700 border-teal-500/40' },
  sign: { label: '签字', cls: 'bg-indigo-500/15 text-indigo-700 border-indigo-500/40' },
};

const STEP_LABEL: Record<'done' | 'skip' | 'issue', string> = {
  done: '已完成',
  skip: '已跳过',
  issue: '有问题',
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

export const WorkOrderFieldLogPanel: React.FC<WorkOrderFieldLogPanelProps> = ({ log }) => {
  const [timelineOpen, setTimelineOpen] = useState(true);

  const hasAny = Boolean(
    log &&
      (log.loto ||
        log.events?.length ||
        Object.keys(log.steps ?? {}).length ||
        log.measurements?.length ||
        log.partPhotos?.length ||
        log.completed)
  );

  /** 步骤按序号升序（key 为 1-based 字符串，必须按数值排，否则 "10" 会排在 "2" 前面） */
  const steps = useMemo(() => {
    const entries = Object.entries(log?.steps ?? {});
    return entries
      .map(([k, v]) => ({ index: Number(k), record: v }))
      .filter((x) => Number.isFinite(x.index))
      .sort((a, b) => a.index - b.index);
  }, [log?.steps]);

  const measurements = log?.measurements ?? [];
  const photos = log?.partPhotos ?? [];
  const abortive = measurements.filter((m) => m.ok === false).length;

  if (!hasAny || !log) return null;

  return (
    <div
      data-testid="work-order-field-log"
      className="bg-slate-800/60 p-4 rounded-xl border border-cyan-500/40 space-y-3 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-slate-200 flex items-center">
          <ListChecks className="w-4 h-4 mr-1.5 text-cyan-400" />
          现场维修过程留痕（拆解作业终端）
        </h4>
        <span className="text-[10px] text-slate-500">只读 · 数据来自 repair_log.fieldLog</span>
      </div>

      {/* 一行概览：四个真实计数，全部由留痕本身数出来 */}
      <div className="grid grid-cols-4 gap-1.5 text-center" data-testid="work-order-field-log-summary">
        <div className="rounded-lg bg-slate-900/70 border border-slate-700/60 py-1.5">
          <div className="font-mono text-[13px] font-bold text-white">{steps.length}</div>
          <div className="text-[9px] text-slate-500">步骤留痕</div>
        </div>
        <div className="rounded-lg bg-slate-900/70 border border-slate-700/60 py-1.5">
          <div className="font-mono text-[13px] font-bold text-cyan-300">{measurements.length}</div>
          <div className="text-[9px] text-slate-500">测量记录</div>
        </div>
        <div className="rounded-lg bg-slate-900/70 border border-slate-700/60 py-1.5">
          <div className={`font-mono text-[13px] font-bold ${abortive > 0 ? 'text-rose-500' : 'text-slate-300'}`}>
            {photos.length}
          </div>
          <div className="text-[9px] text-slate-500">现场照片</div>
        </div>
        <div className="rounded-lg bg-slate-900/70 border border-slate-700/60 py-1.5">
          <div className="font-mono text-[13px] font-bold text-amber-500">{log.events?.length ?? 0}</div>
          <div className="text-[9px] text-slate-500">时间线条目</div>
        </div>
      </div>

      {/* LOTO 安全确认留档 */}
      {log.loto ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50/60 p-2.5" data-testid="work-order-field-log-loto">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-amber-800 font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            LOTO 安全确认已留档
            <span className="font-normal text-amber-700">
              {log.loto.by?.name ?? '—'} · {fmtTime(log.loto.confirmedAt)}
            </span>
          </div>
          <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
            {log.loto.items.map((it) => (
              <li key={it.key} className="flex items-start gap-1 text-[10px] text-slate-600">
                <CheckCircle2 className={`w-3 h-3 mt-px shrink-0 ${it.confirmed ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span className={it.confirmed ? '' : 'line-through'}>{it.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700 border-dashed bg-slate-900/40 p-2 text-[10px] text-slate-500" data-testid="work-order-field-log-no-loto">
          本工单没有 LOTO 安全确认留档记录。
        </div>
      )}

      {/* 自动完工上报留档 */}
      {log.completed && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-50/60 p-2.5 text-[11px] text-emerald-800" data-testid="work-order-field-log-completed">
          <div className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            全部步骤记录完成，已自动提交完工上报
          </div>
          <div className="mt-0.5 text-emerald-700">
            上报时间 {fmtTime(log.completed.at)} · 实际维修人 {log.completed.by} · 工时 {log.completed.workHours} h · 完成 {log.completed.done} / 跳过 {log.completed.skipped}（共 {log.completed.total} 步）
          </div>
        </div>
      )}

      {/* 逐步留痕 */}
      {steps.length > 0 && (
        <div data-testid="work-order-field-log-steps">
          <div className="mb-1 text-[11px] font-semibold text-slate-300">逐步作业记录</div>
          <div className="space-y-1">
            {steps.map(({ index, record }) => (
              <div
                key={index}
                data-testid={`work-order-field-log-step-${index}`}
                className={`rounded-lg border p-2 ${
                  record.status === 'issue'
                    ? 'border-rose-500/40 bg-rose-50/50'
                    : record.status === 'skip'
                    ? 'border-slate-600 bg-slate-900/40'
                    : 'border-emerald-500/30 bg-emerald-50/40'
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                  <span className="font-mono font-bold text-slate-600">步骤 {index}</span>
                  <span
                    className={`rounded border px-1 py-px font-bold ${
                      record.status === 'issue'
                        ? 'border-rose-500/50 bg-rose-500/10 text-rose-700'
                        : record.status === 'skip'
                        ? 'border-slate-500/50 bg-slate-500/10 text-slate-600'
                        : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700'
                    }`}
                  >
                    {STEP_LABEL[record.status]}
                  </span>
                  <span className="text-slate-500">
                    {record.by?.name ?? '—'} · {fmtTime(record.at)}
                    {record.elapsedMin != null ? ` · 距上一条留痕 ${record.elapsedMin} 分钟` : ''}
                  </span>
                </div>
                {record.note && (
                  <div className="mt-1 rounded bg-amber-50 border border-amber-300/60 px-1.5 py-1 text-[10px] text-amber-800">
                    现场备注：{record.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 测量留痕 */}
      {measurements.length > 0 && (
        <div data-testid="work-order-field-log-measurements">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-300">
            <Ruler className="w-3.5 h-3.5 text-violet-500" />
            零件测量记录
          </div>
          <div className="mb-1 text-[9px] text-slate-500">
            比对口径：设备点检标准（部位级），非零件图纸公差；数值按录入时的位号留档。
          </div>
          <div className="space-y-1">
            {measurements.map((m) => (
              <div
                key={m.id}
                data-testid={`work-order-field-log-measure-${m.id}`}
                className={`rounded-lg border p-2 text-[10px] ${
                  m.ok === false ? 'border-rose-500/50 bg-rose-50/60' : 'border-slate-700 bg-slate-900/40'
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-mono font-bold text-cyan-700">{m.posNo}</span>
                  <span className="font-medium text-slate-700">{m.checkPoint}</span>
                  <span className="font-mono font-bold text-slate-800">
                    {m.value}
                    {m.unit ?? ''}
                  </span>
                  <span className="text-slate-500">
                    点检标准 {m.standard ?? '—'}
                    {m.minLimit != null || m.maxLimit != null
                      ? `（${m.minLimit ?? '—'} ~ ${m.maxLimit ?? '—'}${m.unit ?? ''}）`
                      : ''}
                  </span>
                  {m.ok === null ? (
                    <span
                      data-testid={`fieldlog-result-${m.id}`}
                      data-result="only-record"
                      className="rounded border border-slate-500/40 bg-slate-500/10 px-1 font-bold text-slate-600"
                    >
                      仅留痕
                    </span>
                  ) : m.ok ? (
                    <span
                      data-testid={`fieldlog-result-${m.id}`}
                      data-result="pass"
                      className="rounded border border-emerald-500/50 bg-emerald-500/10 px-1 font-bold text-emerald-700"
                    >
                      合格
                    </span>
                  ) : (
                    <span
                      data-testid={`fieldlog-result-${m.id}`}
                      data-result="over-limit"
                      className="inline-flex items-center gap-0.5 rounded border border-rose-500/60 bg-rose-500/15 px-1 font-bold text-rose-700"
                    >
                      <AlertTriangle className="w-2.5 h-2.5" />
                      超标准差
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-slate-500">
                  录入 {m.by?.name ?? '—'} · {fmtTime(m.at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 现场照片 */}
      {photos.length > 0 && (
        <div data-testid="work-order-field-log-photos">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-300">
            <Camera className="w-3.5 h-3.5 text-sky-500" />
            零件现场照片
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {photos.map((p) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                data-testid={`work-order-field-log-photo-${p.id}`}
                className="group relative overflow-hidden rounded-lg border border-slate-600 bg-slate-900"
                title={`${p.posNo} · ${p.by?.name ?? ''} · ${fmtTime(p.at)}`}
              >
                <img
                  src={p.url}
                  alt={`${p.posNo} 现场照片`}
                  className="h-20 w-full object-cover transition group-hover:opacity-90"
                  loading="lazy"
                  onError={(e) => {
                    // 资源被清理时如实露图裂，不装作有图
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                    const sib = (e.currentTarget as HTMLImageElement).nextElementSibling;
                    if (sib instanceof HTMLElement) sib.style.display = 'flex';
                  }}
                />
                <span className="hidden h-20 w-full items-center justify-center text-slate-500">
                  <ImageOff className="w-4 h-4" />
                </span>
                <span className="absolute bottom-0 left-0 right-0 truncate bg-slate-950/80 px-1 py-0.5 font-mono text-[9px] text-cyan-300">
                  {p.posNo}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 全过程时间线 */}
      {(log.events?.length ?? 0) > 0 && (
        <div className="pt-1 border-t border-slate-700" data-testid="work-order-field-log-timeline">
          <button
            type="button"
            onClick={() => setTimelineOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg bg-slate-900/60 border border-slate-700/60 px-2 py-1.5 text-[10px] text-slate-300 hover:bg-slate-900 cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-cyan-500" />
              全过程时间线（{log.events.length} 条）
            </span>
            {timelineOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          {timelineOpen && (
            <ol className="mt-1.5 space-y-1" data-testid="work-order-field-log-timeline-list">
              {log.events.map((ev, i) => {
                const meta = KIND_META[ev.kind] ?? { label: ev.kind, cls: 'bg-slate-500/15 text-slate-600 border-slate-500/40' };
                return (
                  <li key={`${ev.at}-${i}`} className="flex items-start gap-1.5 text-[10px] leading-snug">
                    <span className="mt-0.5 font-mono shrink-0 text-cyan-700">{fmtTime(ev.at)}</span>
                    <span className={`mt-px shrink-0 rounded border px-1 font-bold ${meta.cls}`}>{meta.label}</span>
                    <span className="text-slate-600">
                      {ev.by ? <span className="text-slate-500">{ev.by}：</span> : null}
                      {ev.text}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkOrderFieldLogPanel;
