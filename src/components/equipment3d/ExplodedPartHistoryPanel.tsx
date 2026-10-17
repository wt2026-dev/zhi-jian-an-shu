/**
 * 拆解视图侧栏「零件维修历史」面板。
 *
 * 数据契约（真实 DB，禁止 mock）：
 *   数据来自 `GET /api/v1/equipments/:deviceId/parts/:partId/maintenance-history`
 *   —— 服务端聚合 work_orders.repair_log.parts_used（完工上报真实耗用备件）、
 *   spare_parts（真实备件台账）、spare_parts_movements（真实出入库流水）。
 *   数据库尚无以拆解位号为主键的零件台账 —— 统计只能由真实工单文本/备件记录推导：
 *   没有记录的字段如实显示"—"（loader 给出不编造的空态），绝不填充编造值。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Wrench, PackageSearch, ClipboardList, X, ChevronDown, History } from 'lucide-react';
import { explodedViewApi, type ExplodedPartHistory } from '../../api';

/** 会话内缓存（同一次拆解会话里，点同一个零件不重复请求；换会话自动失效） */
const historyCache = new Map<string, ExplodedPartHistory>();

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('zh-CN');
};

export interface ExplodedPartHistoryPanelProps {
  deviceId: string;
  posNo: string | null;
  onOpenWorkOrder?: (orderId: string) => void;
  onClose?: () => void;
}

export const ExplodedPartHistoryPanel: React.FC<ExplodedPartHistoryPanelProps> = ({
  deviceId,
  posNo,
  onOpenWorkOrder,
  onClose,
}) => {
  const [data, setData] = useState<ExplodedPartHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // 竞态保护：只接受最后一次请求的数据
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!posNo) {
      setData(null);
      setError(null);
      return;
    }
    const key = `${deviceId}#${posNo}`;
    const cached = historyCache.get(key);
    if (cached) setData(cached);
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    explodedViewApi
      .getPartHistory(deviceId, posNo)
      .then((result) => {
        if (seq !== requestSeqRef.current) return;
        historyCache.set(key, result);
        setData(result);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeqRef.current) return;
        if (!cached) setData(null);
        const msg = err instanceof Error ? err.message : String(err);
        setError(`维修历史接口不可用：${msg.slice(0, 120)}`);
      })
      .finally(() => {
        if (seq === requestSeqRef.current) setLoading(false);
      });
  }, [deviceId, posNo]);

  if (!posNo) return null;

  if (collapsed) {
    return (
      <div className="pointer-events-auto self-start" data-testid="exploded-part-history-collapsed">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-cyan-100 bg-slate-900/90 border border-cyan-500/40 hover:border-cyan-400 backdrop-blur shadow cursor-pointer"
        >
          <History className="w-3.5 h-3.5" />
          零件维修历史{posNo ? ` · ${posNo}` : ''}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="exploded-part-history-panel"
      className="pointer-events-auto flex min-h-0 w-full max-h-[36vh] flex-none flex-col overflow-hidden rounded-xl border border-cyan-500/30 bg-slate-950/92 text-slate-200 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur"
    >
      {/* 头部 */}
      <div className="flex items-start justify-between gap-2 border-b border-white/10 bg-slate-900/80 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300">{posNo}</span>
            <span className="flex items-center gap-1 text-[12px] font-semibold text-white" data-testid="exploded-part-history-name">
              {data?.part?.name ?? (loading ? '查询中…' : posNo)}
            </span>
            <button type="button" onClick={() => setCollapsed(true)} title="收起" className="cursor-pointer text-slate-400 hover:text-white">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          {data?.part?.spec && (
            <div className="mt-0.5 truncate text-[10px] text-slate-400">规格 · {data.part.spec}</div>
          )}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} title="关闭" className="cursor-pointer shrink-0 text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-[11px] leading-relaxed">
        {loading && !data && (
          <div className="flex items-center gap-2 py-6 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
            正在查询零件维修历史…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-2 text-amber-200" data-testid="exploded-part-history-error">
            {error}
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-3">
            {/* 核心统计 */}
            <div className="grid grid-cols-2 gap-1.5" data-testid="exploded-part-history-stats">
              <StatTile label="真实更换次数" value={data.stats.replacementCount > 0 ? `${data.stats.replacementCount} 次` : '—'} sub={data.stats.replacementCount > 0 ? '完工单 real parts_used' : '暂无完工更换记录'} />
              <StatTile label="上次更换" value={fmtDate(data.stats.lastReplacedAt)} sub={data.stats.lastReplacedAt ? '真实完工时间' : '暂无记录'} />
              <StatTile
                label="平均更换间隔"
                value={data.stats.avgLifeDays !== null ? `${data.stats.avgLifeDays} 天` : '—'}
                sub={data.stats.avgLifeDays !== null ? '相邻两次更换均值' : '不足 2 次更换，不可统计'}
              />
              <StatTile label="平均维修工时" value={data.stats.avgWorkHours !== null ? `${data.stats.avgWorkHours} h` : '—'} sub={data.stats.avgWorkHours !== null ? '完工上报 workHours' : '无完工工时记录'} />
            </div>

            {/* 命中的真实备件台账 */}
            {data.matchedSparePart && (
              <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2" data-testid="exploded-part-spare">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-cyan-300"><PackageSearch className="h-3 w-3" />配套备件台账（真实库存）</div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-200">{data.matchedSparePart.name}</span>
                  <span className={`font-mono ${data.matchedSparePart.stock <= data.matchedSparePart.safeStock ? 'text-amber-300' : 'text-emerald-300'}`}>
                    库存 {data.matchedSparePart.stock} {data.matchedSparePart.unit}
                    {data.matchedSparePart.stock <= data.matchedSparePart.safeStock ? '（低于安全线）' : ''}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">货位 {data.matchedSparePart.location || '—'} · 型号 {data.matchedSparePart.model || data.matchedSparePart.spec || '—'}</div>
              </div>
            )}

            {/* 更换记录 */}
            <div data-testid="exploded-part-replacements">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-cyan-300"><Wrench className="h-3 w-3" />更换记录（真实完工单）</div>
              {data.replacements.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {data.replacements.map((r) => (
                    <button
                      key={r.workOrderId}
                      type="button"
                      onClick={() => onOpenWorkOrder?.(r.workOrderId)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-left transition hover:border-cyan-400/50 hover:bg-cyan-500/10 cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-cyan-300">{r.orderNo}</span>
                        <span className="text-[10px] text-slate-400">{fmtDate(r.replacedAt)}{r.qty != null ? ` · ${r.qty} 件` : ''}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-200">{r.title}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500">暂无该零件的完工更换记录（真实工单库中没有匹配条目）</div>
              )}
            </div>

            {/* 关联的真实工单 */}
            <div data-testid="exploded-part-related-orders">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-cyan-300"><ClipboardList className="h-3 w-3" />关联检修工单（{data.stats.relatedOrderCount}）</div>
              {data.relatedWorkOrders.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {data.relatedWorkOrders.slice(0, 8).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => onOpenWorkOrder?.(o.id)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left transition hover:border-cyan-400/50 hover:bg-cyan-500/10 cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-cyan-300">{o.orderNo}</span>
                        <span className="text-[10px] text-slate-400">{statusLabel(o.status)}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-200">{o.title}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500">没有文本命中的历史工单（如实反映，不补零）</div>
              )}
            </div>

            {/* 出入库流水 */}
            {data.spareMovements.length > 0 && (
              <div data-testid="exploded-part-movements">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-cyan-300"><PackageSearch className="h-3 w-3" />备件出入库流水</div>
                <div className="flex flex-col gap-1">
                  {data.spareMovements.slice(0, 6).map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded border border-white/5 bg-white/[0.03] px-2 py-1">
                      <span className="text-[10px] text-slate-400">{fmtDate(m.createdAt)}</span>
                      <span className={m.type === 'out' ? 'text-[10px] text-amber-300' : 'text-[10px] text-emerald-300'}>{m.type === 'out' ? '领用' : '入库'} ×{m.quantity}</span>
                      <span className="truncate text-[10px] text-slate-400">{m.relatedWorkOrderNo ? m.relatedWorkOrderNo : m.notes.slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-white/10 pt-1.5 text-[9px] text-slate-500">{data.dataNote}</div>
          </div>
        )}

        {!loading && !error && !data && (
          <div className="py-6 text-slate-500">选择零件后此处显示真实维修历史</div>
        )}
      </div>
    </div>
  );
};

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
      <div className="text-[9px] tracking-wide text-slate-400">{label}</div>
      <div className="text-[13px] font-semibold text-white tabular-nums">{value}</div>
      <div className="text-[9px] text-slate-500">{sub}</div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  created: '待检修', dispatched: '已派发', in_progress: '检修中',
  pending_acceptance: '待验收', completed: '已完成', cancelled: '已取消',
};
function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export default ExplodedPartHistoryPanel;
