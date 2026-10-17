/**
 * 拆解视图 · 零件寿命预警面板（黄色家族为主，与故障红色面板并列显示）。
 *
 * 数据全部来自后端 /equipments/:id/part-life-diagnostics —— 真实零件更换记录
 * （完工单 parts_used）× 真实运行时钟（上次更换 / install_date 起折算）；本组件
 * 只做展示与动作，不猜数据：
 *   · 顶部汇总：需更换 / 临近寿命各几个 + 建议保养时间 +「生成保养建议」建单入口；
 *   · 每个零件一张寿命卡：预计寿命（小时）/ 已使用 / 剩余寿命% / 健康状态，
 *     阈值出处（真实换次间隔均值 / 配置规则）原样标示；
 *   · 「定位查看」→ 宿主触发拆解页黄色（临近）/暗红（需更换）高亮 + 相机聚焦。
 */
import React from 'react';
import { Hourglass, Crosshair, CalendarClock, Battery } from 'lucide-react';
import type { ExplodedPartLifeDiagnostics } from '../../api';
import type { WorkOrderCreatePrefill, WorkOrderPriority } from '../../types';

export const PART_LIFE_STATUS_META: Record<string, { label: string; chip: string; ring: string }> = {
  replace: { label: '需更换', chip: 'bg-rose-500/20 text-rose-200 border-rose-500/60', ring: 'border-rose-500/50' },
  nearing: { label: '临近寿命', chip: 'bg-amber-400/20 text-amber-200 border-amber-400/60', ring: 'border-amber-400/50' },
  healthy: { label: '正常', chip: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/40', ring: 'border-emerald-400/30' },
  unknown: { label: '暂无口径', chip: 'bg-white/5 text-slate-400 border-white/15', ring: 'border-white/10' },
};

/** 把设备整批寿命预警转成「保养」建单预填（类型用既有枚举值：定期润滑维保） */
export function partLifeToCreatePrefill(life: ExplodedPartLifeDiagnostics): WorkOrderCreatePrefill {
  const replace = life.parts.filter((p) => p.status === 'replace');
  const nearing = life.parts.filter((p) => p.status === 'nearing');
  const due = [...replace, ...nearing];
  const counts = `需更换 ${replace.length} 个 · 临近寿命 ${nearing.length} 个`;
  const partLines = due.map((p) => `${p.posNo} ${p.name}：剩余 ${p.remainingPct ?? '—'}%（预计 ${p.expectedLifeHours ?? '—'}h/已用 ${p.usedHours ?? '—'}h${p.dueAt ? `，预计 ${new Date(p.dueAt).toLocaleDateString('zh-CN')} 用尽` : ''}）`);
  const fullDesc = [
    `【零件寿命预警】${life.deviceName}（${life.deviceCode}）：${counts}。`,
    ...partLines,
    `建议保养时间：${life.suggestedMaintenanceBefore ? new Date(life.suggestedMaintenanceBefore).toLocaleDateString('zh-CN') + ' 前' : '（无法推算，请现场评估）'}`,
    `数据说明：${life.dataNote}`,
  ].join('\n');
  return {
    equipmentId: life.deviceId,
    title: `【保养建议】${life.deviceName} 零件到期更换保养（${due.length} 个零件，${replace.length ? '含需更换' : '均临近寿命'}）`,
    faultType: '定期润滑维保',
    priority: (life.summary.replaceCount > 0 ? 'high' : 'medium') as WorkOrderPriority,
    description: fullDesc,
  };
}

interface ExplodedPartLifePanelProps {
  life: ExplodedPartLifeDiagnostics | null;
  onHighlightPart?: (posNo: string) => void;
  onCreateMaintenanceWorkOrder?: (prefill: WorkOrderCreatePrefill) => void;
}

function fmtHours(value: number | null): string {
  return value != null ? `${Math.round(value).toLocaleString()}h` : '—';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('zh-CN');
}

export const ExplodedPartLifePanel: React.FC<ExplodedPartLifePanelProps> = ({
  life,
  onHighlightPart,
  onCreateMaintenanceWorkOrder,
}) => {
  if (!life || life.parts.length === 0) return null;
  const dueCount = life.summary.replaceCount + life.summary.nearingCount;

  return (
    <div
      className="pointer-events-auto flex-none overflow-hidden rounded-xl border border-amber-400/30 bg-slate-950/92 text-slate-200 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur"
      data-testid="equipment3d-exploded-life-panel"
    >
      {/* ---- 面板头：预警汇总 ---- */}
      <div className="flex items-center justify-between gap-2 border-b border-amber-400/30 bg-amber-950/30 px-3 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Hourglass className="w-3.5 h-3.5 shrink-0 text-amber-300" />
          <span className="truncate text-[11px] font-bold">零件寿命预警</span>
        </div>
        <div className="shrink-0 flex items-center gap-1" data-testid="equipment3d-exploded-life-summary">
          {life.summary.replaceCount > 0 && (
            <span className="rounded border border-rose-500/60 bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-bold text-rose-200">
              需更换 {life.summary.replaceCount}
            </span>
          )}
          {life.summary.nearingCount > 0 && (
            <span className="rounded border border-amber-400/60 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-200">
              临近 {life.summary.nearingCount}
            </span>
          )}
          {dueCount === 0 && (
            <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
              全部正常
            </span>
          )}
        </div>
      </div>

      {/* ---- 数据诚实性说明 ---- */}
      <div className="border-b border-white/10 bg-slate-900/40 px-3 py-1.5 text-[9px] leading-relaxed text-slate-400" data-testid="equipment3d-exploded-life-note">
        {life.dataNote}
      </div>

      {/* ---- 建议保养时间 ---- */}
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-slate-900/30 px-3 py-1.5 text-[10px] text-amber-200" data-testid="equipment3d-exploded-life-schedule">
        <CalendarClock className="h-3 w-3 shrink-0" />
        {dueCount > 0
          ? <>建议保养：<b>{life.suggestedMaintenanceBefore ? fmtDate(life.suggestedMaintenanceBefore) : '由维保部门评估'}</b> 前安排</>
          : '当前无零件到期，无强制保养建议'}
      </div>

      {/* ---- 零件寿命卡（需更换/临近优先，与 parts 顺序一致） ---- */}
      <div className="flex max-h-[36vh] flex-col gap-2 overflow-y-auto px-3 py-2" data-testid="equipment3d-exploded-life-cards">
        {life.parts.map((part, i) => {
          const m = PART_LIFE_STATUS_META[part.status] ?? PART_LIFE_STATUS_META.unknown;
          return (
            <div key={part.posNo} className={`rounded-lg border bg-slate-900/50 px-2.5 py-2 ${m.ring}`} data-testid={`equipment3d-exploded-life-part-${i}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5" data-testid={`equipment3d-exploded-life-name-${i}`}>
                    <span className="font-mono text-[10px] font-bold text-amber-300">{part.posNo}</span>
                    <span className="truncate text-[11px] font-bold text-slate-100">{part.name}</span>
                  </div>
                </div>
                <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold ${m.chip}`} data-testid={`equipment3d-exploded-life-status-${i}`}>
                  {m.label}
                </span>
              </div>
              {/* 四要素：预计寿命 / 已使用 / 剩余% / 健康状态 */}
              <div className="mt-1 grid grid-cols-3 gap-1 text-[9px] text-slate-300" data-testid={`equipment3d-exploded-life-metric-${i}`}>
                <div className="rounded border border-white/10 bg-white/5 px-1.5 py-1">
                  <div className="text-slate-500">预计寿命</div>
                  <div className="font-mono text-[10px] text-slate-200">{fmtHours(part.expectedLifeHours)}</div>
                </div>
                <div className="rounded border border-white/10 bg-white/5 px-1.5 py-1">
                  <div className="text-slate-500">已使用</div>
                  <div className="font-mono text-[10px] text-slate-200">{fmtHours(part.usedHours)}</div>
                </div>
                <div className={`rounded border border-white/10 px-1.5 py-1 ${part.status === 'healthy' ? 'bg-emerald-400/10' : part.status === 'unknown' ? 'bg-white/5' : 'bg-amber-400/10'}`}>
                  <div className="text-slate-500">剩余</div>
                  <div className={`font-mono text-[10px] ${part.status === 'unknown' ? 'text-slate-400' : part.status === 'healthy' ? 'text-emerald-300' : part.status === 'nearing' ? 'text-amber-200' : 'text-rose-200'}`}>
                    {part.remainingPct != null ? `${part.remainingPct}%` : '—'}<span className="ml-1 text-[8px] text-slate-400">≈{fmtHours(part.remainingHours)}</span>
                  </div>
                </div>
              </div>
              {/* 阈值出处 / 更换时间 / 推算用尽日 */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-slate-400">
                <span>
                  {part.basis === 'real-replacement-intervals' ? '阈值：真实换次间隔均值' : part.basis === 'config-threshold' ? `阈值：${part.lifeRuleLabel ?? '配置规则'}` : '无寿命口径'}
                </span>
                <span>上次更换：{part.lastReplacedAt ? fmtDate(part.lastReplacedAt) : '无记录'}</span>
                {part.dueAt && <span>预计 {fmtDate(part.dueAt)} 用尽</span>}
              </div>
              {(part.status === 'nearing' || part.status === 'replace') && (
                <button
                  type="button"
                  onClick={() => onHighlightPart?.(part.posNo)}
                  className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded border border-amber-400/50 bg-amber-400/10 px-2 py-1 text-[9px] font-medium text-amber-200 transition hover:bg-amber-400/25 hover:text-amber-100 cursor-pointer"
                >
                  <Crosshair className="w-3 h-3" />
                  定位查看
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ---- 生成保养建议 → 预填保养工单 ---- */}
      <button
        type="button"
        disabled={dueCount === 0}
        onClick={() => onCreateMaintenanceWorkOrder?.(partLifeToCreatePrefill(life))}
        className={`inline-flex w-full items-center justify-center gap-1.5 border-t px-3 py-2 text-[10px] font-bold transition ${
          dueCount > 0
            ? 'items-center border-white/10 bg-amber-500/20 text-amber-200 hover:bg-amber-500/35 hover:text-amber-100 cursor-pointer'
            : 'border-white/10 bg-white/5 text-slate-500 cursor-not-allowed'
        }`}
        data-testid="equipment3d-exploded-life-create"
      >
        <Battery className="h-3 w-3" />
        生成保养建议{dueCount > 0 ? `（${dueCount} 个零件 · 预填保养工单）` : '（无到期零件）'}
      </button>
    </div>
  );
};
