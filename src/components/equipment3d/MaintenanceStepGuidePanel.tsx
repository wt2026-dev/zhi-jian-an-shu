/**
 * 拆解视图侧栏「维修步骤指引」面板。
 *
 * 数据契约（真实 DB，禁止 mock）：
 *   步骤列表来自 `GET /api/v1/work-orders/:id/exploded-brief` 的 `steps` 字段 ——
 *   服务端直接切分工单实填的 work_orders.repair_log.resolutionSteps（真实工单文本），
 *   并把每步原文在拆解页真实 BOM 目录（extract 脚本生成）中匹配出目标零件位号。
 *   工单没填步骤 ⇒ steps 为空数组，本面板如实显示"未填写"，绝不退回硬编码假步骤
 *   （RepairStepCard 的 getDefaultProcedures 是 3D 场景内的演示兜底，这里明确不采用）。
 *
 * 进度口径：与 RepairStepCard 一致 —— 勾选进度是会话内状态（3D 里同样不落数据库，
 * 最终以完工上报 repair_log 落库），因此这里也不伪造持久化记录。
 */
import React, { useEffect, useState } from 'react';
import {
  ListChecks,
  Check,
  ChevronDown,
  Play,
  Wrench,
  CircleCheck,
  CircleDashed,
  Loader2,
} from 'lucide-react';
import type { ExplodedOrderStep } from '../../api';

export interface MaintenanceStepGuidePanelProps {
  orderId: string;
  steps: ExplodedOrderStep[] | null;
  /** 正在播放的步骤（1-based 索引；null = 无），用于行内"演示中"态 */
  activeStepIndex: number | null;
  /** 点击步骤：宿主在 iframe 里高亮该步目标零件并播放拆解动画 */
  onRunStep: (step: ExplodedOrderStep) => void;
  onCollapseChange?: (collapsed: boolean) => void;
  /** 初始是否折叠（默认展开；拆解视图打开时由宿主控制） */
  initialCollapsed?: boolean;
}

export const MaintenanceStepGuidePanel: React.FC<MaintenanceStepGuidePanelProps> = ({
  orderId,
  steps,
  activeStepIndex,
  onRunStep,
  onCollapseChange,
  initialCollapsed = false,
}) => {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  // 勾选完成态：会话内，换工单自动重置（真实步骤以完工上报落库，不做假持久化）
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());

  // 换工单：重置勾选与折叠
  useEffect(() => {
    setDoneSteps(new Set());
    setCollapsed(initialCollapsed);
  }, [orderId]);

  useEffect(() => {
    onCollapseChange?.(collapsed);
  }, [collapsed]);

  const total = steps?.length ?? 0;
  const done = Array.from(doneSteps).filter((i) => i >= 1 && i <= total).length;
  const allDone = total > 0 && done === total;

  if (collapsed) {
    return (
      <div className="pointer-events-auto self-start" data-testid="equipment3d-step-guide-collapsed">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-cyan-100 bg-slate-900/90 border border-cyan-500/40 hover:border-cyan-400 backdrop-blur shadow cursor-pointer"
        >
          <ListChecks className="h-3.5 w-3.5" />
          维修步骤指引{total > 0 ? ` · ${done}/${total}` : ''}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="equipment3d-step-guide-panel"
      className="pointer-events-auto flex min-h-0 w-full max-h-[38vh] flex-none flex-col overflow-hidden rounded-xl border border-cyan-500/30 bg-slate-950/92 text-slate-200 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-slate-900/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <span className="text-[12px] font-semibold text-white">维修步骤指引</span>
          {total > 0 && (
            <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300" data-testid="equipment3d-step-guide-progress">
              {done}/{total}
            </span>
          )}
        </div>
        <button type="button" onClick={() => setCollapsed(true)} title="收起" className="shrink-0 cursor-pointer text-slate-400 hover:text-white">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 进度条 */}
      {total > 0 && (
        <div className="h-1 w-full bg-slate-800">
          <div
            data-testid="equipment3d-step-guide-bar"
            className={`h-full transition-all duration-300 ${allDone ? 'bg-emerald-400' : 'bg-cyan-500'}`}
            style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
          />
        </div>
      )}

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-[11px] leading-relaxed">
        {steps === null && (
          <div className="flex items-center gap-2 py-4 text-slate-400" data-testid="equipment3d-step-guide-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
            正在读取工单检修步骤…
          </div>
        )}

        {steps !== null && total === 0 && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-2 text-amber-200" data-testid="equipment3d-step-guide-empty">
            这张工单还没有填写标准作业步骤（repair_log.resolutionSteps 为空）。
            <div className="mt-1 text-[9px] text-amber-200/70">步骤由技师在完工上报时录入，本面板如实反映，不支持假数据兜底。</div>
          </div>
        )}

        {allDone && (
          <div
            data-testid="equipment3d-step-guide-complete"
            className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-400/50 bg-emerald-500/15 px-2.5 py-2 text-emerald-300"
          >
            <CircleCheck className="h-4 w-4 shrink-0" />
            <span className="text-[12px] font-semibold">维修流程结束</span>
            <span className="text-[9px] text-emerald-200/70">全部 {total} 步已完成 · 请按规程办理完工上报</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5" data-testid="equipment3d-step-guide-steps">
          {(steps ?? []).map((step) => {
            const isDone = doneSteps.has(step.index);
            const isActive = activeStepIndex === step.index;
            return (
              <div
                key={step.index}
                data-testid={`equipment3d-step-guide-step-${step.index}`}
                className={`rounded-lg border px-2.5 py-2 transition ${
                  isActive
                    ? 'border-cyan-400/70 bg-cyan-500/15'
                    : isDone
                    ? 'border-emerald-400/30 bg-emerald-500/5'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                <div className="flex items-start gap-2">
                  {/* 勾选：纯会话态，不打 DB，不造假 */}
                  <button
                    type="button"
                    title={isDone ? '取消完成标记' : '标记为已完成'}
                    data-testid={`equipment3d-step-guide-check-${step.index}`}
                    onClick={() => {
                      setDoneSteps((prev) => {
                        const next = new Set(prev);
                        if (next.has(step.index)) next.delete(step.index);
                        else next.add(step.index);
                        return next;
                      });
                    }}
                    className="mt-0.5 shrink-0 cursor-pointer"
                  >
                    {isDone ? (
                      <CircleCheck className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <CircleDashed className="h-4 w-4 text-slate-500 hover:text-cyan-300" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono text-[10px] font-bold ${isDone ? 'text-emerald-300' : 'text-cyan-300'}`}>
                        步骤 {step.index}
                      </span>
                      {isDone && (
                        <span className="text-[9px] text-emerald-300/80">已完成</span>
                      )}
                      {isActive && <Play className="h-3 w-3 text-cyan-300" />}
                    </div>
                    <div className={`mt-0.5 ${isDone ? 'text-slate-400 line-through decoration-emerald-400/50' : 'text-slate-200'}`}>
                      {step.text}
                    </div>
                    {/* 该步骤在真实 BOM 中匹配到的目标零件（未匹配 = 如实说明） */}
                    {step.matchedPart ? (
                      <button
                        type="button"
                        data-testid={`equipment3d-step-guide-part-${step.index}`}
                        onClick={() => onRunStep(step)}
                        className="mt-1 inline-flex items-center gap-1 rounded border border-cyan-400/40 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MaintenanceStepGuidePanel;
