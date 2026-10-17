/**
 * LOTO 强制安全确认弹窗（拆解作业终端的作业闸门）。
 *
 * 为什么是弹窗而不是侧栏里一个勾选：工业维修规程要求"开始拆解操作之前"逐条确认，
 * 现场必须停下来打勾；四项里有任何一项没勾，「确认并开始作业」按钮不可点。
 *
 * 数据契约（真实，禁止 mock）：
 *   · 清单一律读 `field-session` 返回的 `lotoItems`（服务端 LOTO_CHECK_ITEMS 为唯一权威源），
 *     本组件不内置清单文本 —— 服务端确认时会按自己的清单重排并强制 confirmed:true，
 *     前端伪造 label 不会进档案；
 *   · 提交打 `POST /api/v1/work-orders/:id/field-actions/loto`，留档写工单
 *     repair_log.fieldLog.loto（确认人 / 确认时间 / 四项勾选状态）；
 *   · 未确认时服务端对所有写操作返回 403 FIELD_LOTO_REQUIRED，前端按钮同步置灰。
 *
 * 「暂不开始作业」是唯一的退出口：退出维修模式回到纯查看，不产生任何作业记录。
 */
import React, { useMemo, useState } from 'react';
import { ShieldCheck, Loader2, AlertTriangle, Check } from 'lucide-react';
import { ApiError, fieldOpsApi } from '../../api';
import type { FieldSessionData } from '../../api';

export interface FieldLotoConfirmDialogProps {
  /** 现场作业会话（清单与工单来源；null 时弹窗不渲染内容主体） */
  session: FieldSessionData | null;
  open: boolean;
  /** 关闭弹窗（确认成功或主动放弃作业都会走到这里） */
  onClose: () => void;
  /** 确认成功后把服务端返回的最新会话交还宿主 */
  onConfirmed: (session: FieldSessionData) => void;
  /** 放弃作业：宿主据此退出维修模式 */
  onDecline: () => void;
}

/**
 * 外壳只负责"打开才挂载"：内层每次打开都是全新实例，勾选与错误自然归零 ——
 * 留痕要求当场逐条确认，不能记住上次的勾（比在 effect 里 setState 重置更省一次渲染）。
 */
export const FieldLotoConfirmDialog: React.FC<FieldLotoConfirmDialogProps> = ({ open, session, ...rest }) => {
  if (!open) return null;
  return <LotoConfirmBody key={session?.order?.id ?? 'no-order'} session={session} {...rest} />;
};

const LotoConfirmBody: React.FC<Omit<FieldLotoConfirmDialogProps, 'open'>> = ({
  session,
  onClose,
  onConfirmed,
  onDecline,
}) => {
  const items = useMemo(() => session?.lotoItems ?? [], [session?.lotoItems]);
  const orderId = session?.order?.id ?? null;
  /** 已确认过：不再要求重复确认，只展示留档 */
  const already = Boolean(session?.loto);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = useMemo(
    () => items.length > 0 && items.every((i) => checked.has(i.key)),
    [items, checked]
  );

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setError(null);
  };

  const submit = async () => {
    if (!orderId || !allChecked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fieldOpsApi.confirmLoto(
        orderId,
        items.map((i) => ({ key: i.key, label: i.label, confirmed: true }))
      );
      onConfirmed(res);
    } catch (err: unknown) {
      const e = err as ApiError;
      setError(e?.message || '安全确认提交失败，请检查网络后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="equipment3d-loto-dialog"
      className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="LOTO 安全确认"
    >
      <div className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-amber-400/50 bg-slate-950/97 shadow-[0_20px_60px_rgba(0,0,0,0.8)]">
        {/* 头部 */}
        <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-500/15 px-4 py-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-amber-300" />
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-amber-100">开始维修前请确认安全措施已到位</div>
            <div className="truncate text-[10px] text-amber-200/80">
              {session?.order ? `${session.order.orderNo} · ${session.order.title}` : '未关联工单'}
            </div>
          </div>
        </div>

        <div className="px-4 py-3">
          {already ? (
            <div className="rounded-lg border border-emerald-400/50 bg-emerald-500/12 px-3 py-2.5 text-[11px] text-emerald-200" data-testid="equipment3d-loto-already">
              <div className="flex items-center gap-1.5 font-semibold">
                <Check className="h-3.5 w-3.5" />
                本工单 LOTO 安全确认已完成
              </div>
              <div className="mt-1 text-emerald-200/85">
                确认人 {session?.loto?.by?.name ?? '—'} · {session?.loto ? new Date(session.loto.confirmedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}
              </div>
              <div className="mt-1 text-[9px] text-emerald-200/60">留档位置：工单 repair_log.fieldLog.loto（可追溯，不重复生成）。</div>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="equipment3d-loto-items">
              {items.map((item) => {
                const on = checked.has(item.key);
                return (
                  <li key={item.key}>
                    {/* 整行即点击热区（戴手套好点），勾选框只是视觉状态 */}
                    <button
                      type="button"
                      data-testid={`equipment3d-loto-item-${item.key}`}
                      aria-pressed={on}
                      onClick={() => toggle(item.key)}
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition ${
                        on
                          ? 'cursor-pointer border-emerald-400/60 bg-emerald-500/15'
                          : 'cursor-pointer border-white/15 bg-white/5 hover:border-amber-400/50'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
                          on ? 'border-emerald-400 bg-emerald-500/30' : 'border-slate-500 bg-slate-900'
                        }`}
                      >
                        {on && <Check className="h-4 w-4 text-emerald-200" />}
                      </span>
                      <span className={`text-[12px] font-medium ${on ? 'text-emerald-100' : 'text-slate-200'}`}>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-rose-400/35 bg-rose-500/10 px-2.5 py-2 text-[10px] leading-snug text-rose-200" data-testid="equipment3d-loto-warning">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>四项全部确认后才能开始拆解作业；确认记录（确认人、确认时间、四项状态）随工单留档，未完成前步骤 / 测量 / 照片记录均被服务端拒绝。</span>
          </div>

          {!already && (
            <div className="mt-2 text-[10px] text-slate-400" data-testid="equipment3d-loto-count">
              已确认 {checked.size}/{items.length} 项
            </div>
          )}

          {error && (
            <div className="mt-2 rounded-lg border border-rose-400/50 bg-rose-500/15 px-2.5 py-2 text-[11px] text-rose-200" data-testid="equipment3d-loto-error">
              {error}
            </div>
          )}

          {session?.blockedReason && !session.canOperate && (
            <div className="mt-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[10px] text-slate-400" data-testid="equipment3d-loto-blocked">
              {session.blockedReason}
            </div>
          )}
        </div>

        {/* 底部：唯一的继续路径是完成确认；放弃则退出维修模式 */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-slate-900/80 px-4 py-3">
          <button
            type="button"
            data-testid="equipment3d-loto-decline"
            onClick={onDecline}
            className="rounded-lg border border-white/15 px-3 py-2.5 text-[11px] text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            暂不开始作业
          </button>
          {already ? (
            <button
              type="button"
              data-testid="equipment3d-loto-close"
              onClick={onClose}
              className="rounded-lg border border-emerald-400/60 bg-emerald-500/25 px-4 py-2.5 text-[12px] font-bold text-emerald-100 hover:bg-emerald-500/40 cursor-pointer"
            >
              继续作业
            </button>
          ) : (
            <button
              type="button"
              data-testid="equipment3d-loto-confirm"
              disabled={!allChecked || busy || !orderId}
              onClick={() => void submit()}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-[12px] font-bold transition ${
                allChecked && !busy && orderId
                  ? 'cursor-pointer border-emerald-400/70 bg-emerald-500/30 text-emerald-50 hover:bg-emerald-500/45'
                  : 'border-white/10 bg-white/5 text-slate-600'
              }`}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? '留档中…' : '确认全部四项并开始作业'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FieldLotoConfirmDialog;
