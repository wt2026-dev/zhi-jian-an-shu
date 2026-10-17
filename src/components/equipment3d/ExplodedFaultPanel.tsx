/**
 * 拆解视图 · 故障定位详情面板（告警红色家系，与维修历史/步骤指引并列显示）。
 *
 * 数据全部来自后端 /equipments/:id/fault-diagnostics —— 真实 equipment_telemetry 遥测
 * 读数超过真实阈值后按「观察部位」口径落到拆解页位号；本组件只做展示与动作，不猜数据。
 *   · 每条超标指标一张卡：描述（指标+读数+阈值）、发生时间、严重程度、观察部位、建议处理方式；
 *   · 「定位查看」→ 宿主触发拆解页红色脉冲高亮 + 相机聚焦该位号（复用 BOM 行点击路径）；
 *   · 「创建维修工单」→ 带故障信息预填建单表单（经 App 深链切到工单页）。
 */
import React, { useMemo } from 'react';
import { AlertTriangle, Crosshair, FilePlus2, Clock3, Gauge } from 'lucide-react';
import type { ExplodedFaultDiagnostics, ExplodedFaultMetric } from '../../api';
import type { WorkOrderCreatePrefill, WorkOrderFaultType, WorkOrderPriority } from '../../types';

const SEVERITY_META: Record<string, { label: string; text: string; ring: string; chip: string }> = {
  warning: { label: '预警', text: 'text-amber-300', ring: 'border-amber-400/50', chip: 'bg-amber-400/15 text-amber-300 border-amber-400/40' },
  fault: { label: '故障', text: 'text-rose-300', ring: 'border-rose-500/60', chip: 'bg-rose-500/15 text-rose-300 border-rose-500/50' },
  critical: { label: '紧急', text: 'text-rose-200', ring: 'border-rose-500/80', chip: 'bg-rose-600/25 text-rose-200 border-rose-400/70' },
};

/** 指标 → 建单页 6 宫格故障主分类（口径与分类选择器一致） */
export function metricToFaultType(metric: string): WorkOrderFaultType {
  if (metric === 'vibration') return '机械振动';
  if (metric === 'temperature') return '轴承过热';
  return '结构磨损';
}

export function severityToPriority(severity: string): WorkOrderPriority {
  if (severity === 'critical') return 'urgent';
  if (severity === 'fault') return 'high';
  return 'medium';
}

/** 把一条真实故障转成建单预填载荷（标题/类型/优先级/描述全部有据可查） */
export function faultToCreatePrefill(fault: ExplodedFaultDiagnostics, metric: ExplodedFaultMetric): WorkOrderCreatePrefill {
  const primaryPart = metric.observationParts[0];
  const descLines = [
    `【遥测故障定位】${fault.deviceName}（${fault.deviceCode}）`,
    `${metric.metricLabel}最新读数 ${metric.value}${metric.unit}，达到「${SEVERITY_META[metric.severity].label}」等级（报警下限 ${metric.warningThreshold}${metric.unit}）。`,
    `经查发生时间：${metric.occurredAt ? new Date(metric.occurredAt).toLocaleString('zh-CN') : '最近 24h 窗口内无更早标记'}`,
    `关联观察部位：${primaryPart ? `${primaryPart.name}（${primaryPart.posNo}）` : '暂未定位到具体零件（该设备未建观察部位映射）'}${metric.observationParts.length > 1 ? ` 等 ${metric.observationParts.length} 处` : ''}`,
    `建议处理方式：${metric.suggestion}`,
    `数据说明：${fault.dataNote}`,
  ];
  return {
    equipmentId: fault.deviceId,
    title: `【遥测告警】${fault.deviceName} ${metric.metricLabel}超标（${metric.value}${metric.unit}·${SEVERITY_META[metric.severity].label}）`,
    faultType: metricToFaultType(metric.metric),
    priority: severityToPriority(metric.severity),
    description: descLines.join('\n'),
  };
}

interface ExplodedFaultPanelProps {
  fault: ExplodedFaultDiagnostics | null;
  /** 当前已被宿主红色脉冲高亮的位号（视觉反馈"已定位"） */
  highlightedPosNo: string | null;
  /** 点「定位查看」→ 宿主在拆解页 3D 网格上做红色脉冲 + 相机聚焦 */
  onHighlightPart?: (posNo: string) => void;
  /** 点「创建维修工单」→ 带真实故障信息预填建单表单 */
  onCreateWorkOrder?: (prefill: WorkOrderCreatePrefill) => void;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '未知';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

export const ExplodedFaultPanel: React.FC<ExplodedFaultPanelProps> = ({
  fault,
  highlightedPosNo,
  onHighlightPart,
  onCreateWorkOrder,
}) => {
  const worst = useMemo(() => fault?.faults[0] ?? null, [fault]);
  if (!fault) return null;
  const sev = worst ? SEVERITY_META[worst.severity] : null;

  return (
    <div
      className="pointer-events-auto flex-none overflow-hidden rounded-xl border bg-slate-950/92 text-slate-200 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur"
      data-testid="equipment3d-exploded-fault-panel"
    >
      {/* ---- 面板头：告警摘要 ---- */}
      <div className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${sev?.ring ?? 'border-white/10'} ${worst ? 'bg-rose-950/40' : 'bg-slate-900/60'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${worst ? sev!.text : 'text-slate-500'}`} />
          <span className="truncate text-[11px] font-bold">故障定位 {fault.faults.length > 0 ? '（未处理故障）' : '（无活动故障）'}</span>
        </div>
        {sev && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold border ${sev.chip}`} data-testid="equipment3d-exploded-fault-top-severity">
            {sev.label}
          </span>
        )}
      </div>

      {/* ---- 数据诚实性说明 ---- */}
      <div className="border-b border-white/10 bg-slate-900/40 px-3 py-1.5 text-[9px] leading-relaxed text-slate-400" data-testid="equipment3d-exploded-fault-note">
        {fault.dataNote}
      </div>

      {fault.faults.length === 0 ? (
        <div className="px-3 py-2.5 text-[11px] text-slate-400" data-testid="equipment3d-exploded-fault-none">
          最新遥测读数均低于报警阈值，当前无超标指标，无需处理。
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-3 py-2" data-testid="equipment3d-exploded-fault-cards">
          {fault.faults.map((metric, i) => {
            const m = SEVERITY_META[metric.severity] ?? SEVERITY_META.warning;
            const primaryPart = metric.observationParts[0] ?? null;
            const isHighlighted = primaryPart != null && primaryPart.posNo === highlightedPosNo;
            return (
              <div key={`${metric.metric}-${i}`} className={`rounded-lg border bg-slate-900/50 px-2.5 py-2 ${m.ring}`}>
                {/* ① 故障描述 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5" data-testid={`equipment3d-exploded-fault-metric-${i}`}>
                      <Gauge className={`w-3 h-3 shrink-0 ${m.text}`} />
                      <span className="truncate text-[11px] font-bold text-slate-100">
                        {metric.value}{metric.unit} · {metric.metricLabel}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[9px] text-slate-400">
                      报警下限 {metric.warningThreshold}{metric.unit} · 超出范围即未处理
                    </div>
                  </div>
                  <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold ${m.chip}`}>
                    {m.label}
                  </span>
                </div>

                {/* ② 发生时间 */}
                <div className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-400" data-testid={`equipment3d-exploded-fault-time-${i}`}>
                  <Clock3 className="h-3 w-3 shrink-0" />
                  发生时间：{fmtTime(metric.occurredAt)}
                </div>

                {/* ③ 观察部位（真实拆解页位号） */}
                {primaryPart && (
                  <div className="mt-1.5 rounded border border-white/10 bg-white/5 px-2 py-1.5" data-testid={`equipment3d-exploded-fault-part-${i}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-[10px] font-bold text-amber-300">{primaryPart.posNo}</span>
                        <span className="ml-1.5 text-[10px] text-slate-200">{primaryPart.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onHighlightPart?.(primaryPart.posNo)}
                        className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium transition cursor-pointer ${
                          isHighlighted
                            ? 'bg-rose-500/25 text-rose-200 border border-rose-400/50'
                            : 'bg-slate-800 text-slate-300 border border-slate-600 hover:text-rose-200 hover:border-rose-400/50'
                        }`}
                      >
                        <Crosshair className="w-3 h-3" />
                        {isHighlighted ? '已脉冲定位' : '定位查看'}
                      </button>
                    </div>
                    {metric.observationParts.length > 1 && (
                      <div className="mt-1 line-clamp-1 text-[9px] text-slate-500">
                        关联观察点：{metric.observationParts.slice(1).map((p) => `${p.name}（${p.posNo}）`).join('、')}
                      </div>
                    )}
                  </div>
                )}

                {/* ④ 建议处理方式 */}
                <div className="mt-1.5 text-[10px] leading-relaxed text-slate-300" data-testid={`equipment3d-exploded-fault-suggestion-${i}`}>
                  <span className="font-bold text-slate-200">建议：</span>{metric.suggestion}
                </div>

                {/* ⑤ 创建维修工单（带真实故障信息预填建单表单） */}
                <button
                  type="button"
                  onClick={() => onCreateWorkOrder?.(faultToCreatePrefill(fault, metric))}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-400/60 bg-rose-600/25 px-2 py-1.5 text-[10px] font-bold text-rose-200 transition hover:bg-rose-600/40 hover:text-white cursor-pointer"
                  data-testid={`equipment3d-exploded-fault-create-${i}`}
                >
                  <FilePlus2 className="h-3 w-3" />
                  创建维修工单（预填故障信息）
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
