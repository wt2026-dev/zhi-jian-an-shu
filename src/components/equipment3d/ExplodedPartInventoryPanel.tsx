/**
 * 拆解视图 · 备件库存联动面板（红色预警为主，与寿命/故障面板并列）。
 *
 * 数据全部来自后端 /equipments/:id/part-inventory —— spare_parts 真实台账；
 * 本组件只做展示与动作，不猜数据：
 *   · 顶部汇总：库存不足几个 / 总缺口多少件 + 数据诚实性说明；
 *   · 每个命中台账的零件一张库存卡：当前库存 / 预警阈值 / 存放位置 / 采购周期四要素；
 *   · 低库存（stock ≤ safe_stock，与备件页同口径）卡片红色标记「需要采购」；
 *   · 「一键生成采购申请」→ 跳备件库存页并预填采购入库单（提交即生成真实出入库流水）。
 */
import React from 'react';
import { PackageSearch, ShoppingCart, MapPin } from 'lucide-react';
import type {
  ExplodedPartInventoryDiagnostics,
  CatalogPartInventory,
  ExplodedPartInventoryMatch,
  SpareProcurePrefill,
} from '../../api';

interface ExplodedPartInventoryPanelProps {
  inventory: ExplodedPartInventoryDiagnostics | null;
  onOpenProcure?: (prefill: SpareProcurePrefill) => void;
}

/** 低库存零件 → 采购申请预填（含来源设备与拆解位号，真实上下文可溯源） */
export function inventoryToProcurePrefill(
  part: CatalogPartInventory,
  deviceName: string,
  deviceCode: string,
): SpareProcurePrefill {
  const inv = part.inventory as ExplodedPartInventoryMatch;
  return {
    partId: inv.id,
    partName: inv.name,
    unit: inv.unit,
    qty: inv.shortage > 0 ? inv.shortage : 1,
    note:
      `【采购申请】${deviceName}（${deviceCode}）拆解位号 ${part.posNo} ${part.name} 关联备件 ${inv.name}`
      + `低于预警阈值：当前 ${inv.stock} ${inv.unit} / 阈值 ${inv.safeStock} ${inv.unit}，现存放于 ${inv.location}。`
      + `请核实到货周期（${inv.purchaseLeadDays} 天）后安排采购入库（提交入库单后即生成真实库存流水）。`,
  };
}

function fmtDays(days: number): string {
  return `${days} 天`;
}

export const ExplodedPartInventoryPanel: React.FC<ExplodedPartInventoryPanelProps> = ({
  inventory,
  onOpenProcure,
}) => {
  if (!inventory || inventory.parts.length === 0) return null;
  const hasLow = inventory.summary.lowCount > 0;

  return (
    <div
      className="pointer-events-auto flex-none overflow-hidden rounded-xl border bg-slate-950/92 text-slate-200 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur"
      style={{ borderColor: hasLow ? 'rgba(244, 63, 94, 0.35)' : 'rgba(255,255,255,0.08)' }}
      data-testid="equipment3d-exploded-inventory-panel"
    >
      {/* ---- 面板头：库存预警汇总 ---- */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2"
        style={{ backgroundColor: hasLow ? 'rgba(76, 5, 25, 0.35)' : 'rgba(15, 23, 42, 0.6)' }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <PackageSearch className="w-3.5 h-3.5 shrink-0 text-slate-300" />
          <span className="truncate text-[11px] font-bold">备件库存联动</span>
        </div>
        <div className="shrink-0" data-testid="equipment3d-exploded-inventory-summary">
          {hasLow ? (
            <span className="rounded border border-rose-500/60 bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-bold text-rose-200">
              库存不足 {inventory.summary.lowCount} · 缺口 {inventory.summary.totalShortage} 件
            </span>
          ) : (
            <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
              库存充足
            </span>
          )}
        </div>
      </div>

      {/* ---- 数据诚实性说明 ---- */}
      <div className="border-b border-white/10 bg-slate-900/40 px-3 py-1.5 text-[9px] leading-relaxed text-slate-400" data-testid="equipment3d-exploded-inventory-note">
        {inventory.dataNote}
      </div>

      {/* ---- 零件库存卡（低库存在前，顺序继承服务端 parts 排序） ---- */}
      <div className="flex max-h-[30vh] flex-col gap-2 overflow-y-auto px-3 py-2" data-testid="equipment3d-exploded-inventory-cards">
        {inventory.parts.map((part, i) => {
          const inv = part.inventory;
          if (!inv) {
            /* 未命中真实台账 → 如实"无备件记录"，不编造库存数字 */
            return (
              <div key={part.posNo} className="rounded-lg border border-white/10 bg-slate-900/40 px-2.5 py-2" data-testid={`equipment3d-exploded-inventory-part-${i}`}>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] font-bold text-slate-400">{part.posNo}</span>
                  <span className="truncate text-[11px] text-slate-300">{part.name}</span>
                </div>
                <div className="mt-1 text-[9px] text-slate-500">备件台账中暂无该零件的记录（如实显示，不编造）</div>
              </div>
            );
          }
          return (
            <div key={part.posNo} className={`rounded-lg border px-2.5 py-2 ${inv.low ? 'border-rose-500/50 bg-rose-950/25' : 'border-white/10 bg-slate-900/40'}`}
              data-testid={`equipment3d-exploded-inventory-part-${i}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5" data-testid={`equipment3d-exploded-inventory-name-${i}`}>
                    <span className="font-mono text-[10px] font-bold text-amber-300">{part.posNo}</span>
                    <span className="truncate text-[11px] font-bold text-slate-100">{part.name}</span>
                  </div>
                  <div className="mt-0.5 text-[9px] text-slate-400">
                    台账备件：{inv.name}{inv.spec ? ` · ${inv.spec}` : ''}
                  </div>
                </div>
                {inv.low ? (
                  <span className="shrink-0 rounded border border-rose-500/60 bg-rose-500/25 px-1 py-0.5 text-[9px] font-bold text-rose-200" data-testid={`equipment3d-exploded-inventory-status-${i}`}>
                    需要采购
                  </span>
                ) : (
                  <span className="shrink-0 rounded border border-emerald-400/40 bg-emerald-400/10 px-1 py-0.5 text-[9px] font-bold text-emerald-300" data-testid={`equipment3d-exploded-inventory-status-${i}`}>
                    库存充足
                  </span>
                )}
              </div>
              {/* 四要素：当前库存 / 预警阈值 / 存放位置 / 采购周期 */}
              <div className="mt-1 grid grid-cols-2 gap-1 text-[9px]" data-testid={`equipment3d-exploded-inventory-metric-${i}`}>
                <div className={`rounded border px-1.5 py-1 ${inv.low ? 'border-rose-500/40 bg-rose-500/10' : 'border-white/10 bg-white/5'}`}>
                  <div className="text-slate-500">当前库存{inv.low && <span className="ml-1 text-rose-300">（缺 {inv.shortage}）</span>}</div>
                  <div className={`font-mono text-[10px] ${inv.low ? 'text-rose-200' : 'text-slate-200'}`}>{inv.stock} {inv.unit}</div>
                </div>
                <div className="rounded border border-white/10 bg-white/5 px-1.5 py-1">
                  <div className="text-slate-500">预警阈值</div>
                  <div className="font-mono text-[10px] text-slate-200">≤ {inv.safeStock} {inv.unit}</div>
                </div>
                <div className="rounded border border-white/10 bg-white/5 px-1.5 py-1">
                  <div className="flex items-center gap-1 text-slate-500"><MapPin className="h-2.5 w-2.5" />存放位置</div>
                  <div className="truncate text-[10px] text-slate-200" title={inv.location}>{inv.location || '—'}</div>
                </div>
                <div className="rounded border border-white/10 bg-white/5 px-1.5 py-1">
                  <div className="text-slate-500">采购周期</div>
                  <div className="text-[10px] text-slate-200" title={`${inv.purchaseLeadLabel}（配置口径）`}>{fmtDays(inv.purchaseLeadDays)}</div>
                </div>
              </div>
              {inv.low && (
                <button
                  type="button"
                  onClick={() => onOpenProcure?.(inventoryToProcurePrefill(inventory.parts[i], inventory.deviceName, inventory.deviceCode))}
                  className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded border border-rose-400/60 bg-rose-600/25 px-2 py-1 text-[9px] font-bold text-rose-200 transition hover:bg-rose-600/40 hover:text-white cursor-pointer"
                  data-testid={`equipment3d-exploded-inventory-create-${i}`}
                  title={`跳转备件库存页预填采购入库单（当前 ${inv.stock} ${inv.unit} / 阈值 ${inv.safeStock} ${inv.unit}）`}
                >
                  <ShoppingCart className="w-3 h-3" />
                  一键生成采购申请（建议补 {inv.shortage} {inv.unit}·约 {fmtDays(inv.purchaseLeadDays)} 到货）
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
