/**
 * 修后验收与效果验证面板 —— 维修流程最后一环的操作台。
 *
 * 放在"待验收 / 已归档"工单的验收入口里，做四件事：
 *   1. 验收清单：5 项逐条录入「实测值」或「目视确认」，判定全部由服务端按标准快照复算，
 *      这里只展示服务端返回的 verdict —— 前端不自己算合格，也不把"无标准"算成合格。
 *   2. 修前/修后对比：修前取工单创建前 24h 的真实遥测最坏值（无数据就显示"未接入"，
 *      绝不补一个看起来合理的数），修后取本次实测值，并给出是否符合验收标准。
 *   3. 双签字：维修人 = 当前登录者；班组长 = 另一个具备 manager/admin 权限的人。
 *      两人签完由服务端关单（completed）。
 *   4. 关单后展示已生成的维修总结（已沉淀到案例库）。
 *
 * 交互按"戴手套"设计：所有可点区域 ≥ 44px，数值用数字键盘式大输入框，
 * 提交按钮整行高亮，不依赖 hover / 精细点击。
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Ruler,
  PenLine,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MinusCircle,
  ArrowRight,
  Users,
  Lock,
} from 'lucide-react';
import { acceptanceApi, type AcceptanceSessionData, type AcceptanceItem } from '../../api';
import type { UserProfile } from '../../types';

export interface AcceptancePanelProps {
  orderId: string;
  currentUser: UserProfile;
  /** 关单成功后回传刷新后的工单（父级据此更新列表/抽屉） */
  onClosed?: () => void;
}

const VERDICT_META: Record<
  AcceptanceItem['verdict'],
  { label: string; cls: string; icon: React.ReactNode }
> = {
  pass: {
    label: '合格',
    cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  fail: {
    label: '超标',
    cls: 'bg-rose-500/15 text-rose-700 border-rose-500/40',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  unconfigured: {
    label: '未配置·未判定',
    cls: 'bg-slate-500/15 text-slate-600 border-slate-500/40',
    icon: <MinusCircle className="w-3.5 h-3.5" />,
  },
  pending: {
    label: '待录入',
    cls: 'bg-amber-500/15 text-amber-700 border-amber-500/40',
    icon: <Ruler className="w-3.5 h-3.5" />,
  },
};

function fmt(v: number | null | undefined, unit: string | null | undefined): string {
  return v == null ? '—' : `${v}${unit ?? ''}`;
}

function limitText(item: Pick<AcceptanceItem, 'minLimit' | 'maxLimit' | 'unit'>): string {
  const u = item.unit ?? '';
  if (item.minLimit != null && item.maxLimit != null) return `${item.minLimit}${u} ~ ${item.maxLimit}${u}`;
  if (item.maxLimit != null) return `≤ ${item.maxLimit}${u}`;
  if (item.minLimit != null) return `≥ ${item.minLimit}${u}`;
  return '未配置';
}

export const AcceptancePanel: React.FC<AcceptancePanelProps> = ({ orderId, currentUser, onClosed }) => {
  const [session, setSession] = useState<AcceptanceSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 每项的输入草稿（itemKey -> 输入框文本），提交成功后清空 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [summaryRef, setSummaryRef] = useState<{ knowledgeId: string; title: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await acceptanceApi.get(orderId);
      setSession(data);
      if (data.summary) setSummaryRef({ knowledgeId: data.summary.knowledgeId, title: data.summary.title });
    } catch (e: any) {
      setError(e?.message || '加载验收会话失败');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = session?.items ?? [];
  const autoItems = items.filter((i) => i.judgedBy === 'auto');
  const manualItems = items.filter((i) => i.judgedBy === 'manual');

  const unsigned = useMemo(
    () => (session?.signatures ?? []).length === 0,
    [session?.signatures]
  );

  /** 当前用户是否就是本次维修的执行人（决定能否签「维修人」） */
  const isRepairer = useMemo(() => {
    const r = session?.repairer;
    if (!r) return true; // 老工单解析不出执行人 ⇒ 不拦（拦了会把历史数据卡死）
    if (!r.name && !r.id) return true;
    const myId = (currentUser as any)?.id as string | undefined;
    if (r.id && myId) return r.id === myId;
    return !!r.name && r.name === currentUser.name;
  }, [currentUser, session?.repairer]);

  /** 当前用户能否签班组长（角色够格 且 不是维修人本人） */
  const canSignTeamlead = useMemo(() => {
    const role = (currentUser as any)?.role as string | undefined;
    if (!['manager', 'admin'].includes(String(role))) return false;
    const tech = (session?.signatures ?? []).find((s) => s.step === 'technician');
    if (!tech) return true;
    const myId = (currentUser as any)?.id as string | undefined;
    return tech.userId ? tech.userId !== myId : tech.name !== currentUser.name;
  }, [currentUser, session?.signatures]);

  async function submitItem(item: AcceptanceItem) {
    const isManual = item.judgedBy === 'manual';
    const raw = (drafts[item.itemKey] ?? '').trim();
    if (!isManual) {
      if (!raw) {
        setNotice(`请先填写「${item.itemLabel}」的实测值`);
        return;
      }
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        setNotice('实测值必须是数字');
        return;
      }
    }
    setBusyKey(item.itemKey);
    setNotice(null);
    try {
      const next = await acceptanceApi.check(orderId, {
        itemKey: item.itemKey,
        value: isManual ? null : Number(raw),
        confirmed: isManual ? true : undefined,
      });
      setSession(next);
      setDrafts((d) => ({ ...d, [item.itemKey]: '' }));
    } catch (e: any) {
      setNotice(e?.message || '提交失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function doSign(step: 'technician' | 'teamlead') {
    setSigning(true);
    setNotice(null);
    try {
      const next = await acceptanceApi.sign(orderId, { step });
      setSession(next);
      if (next.justClosed) {
        setNotice('验收关单成功：双签字完成，工单已归档，维修总结已沉淀到案例库。');
        onClosed?.();
      } else {
        setNotice(step === 'technician' ? '维修人签字已记录，请班组长复核签字。' : '签字已记录。');
      }
    } catch (e: any) {
      setNotice(e?.message || '签字失败');
    } finally {
      setSigning(false);
    }
  }

  if (loading) {
    return (
      <div data-testid="acceptance-panel" className="flex items-center gap-2 text-xs text-slate-500 py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> 正在读取修后验收数据…
      </div>
    );
  }

  if (error || !session) {
    return (
      <div data-testid="acceptance-panel" className="text-xs text-rose-600 py-6 text-center">
        {error || '未取得验收会话'}
      </div>
    );
  }

  const closed = Boolean(session.closedAt);

  return (
    <div data-testid="acceptance-panel" className="space-y-4">
      {/* 结论条 */}
      <div
        data-testid="acceptance-verdict-bar"
        data-state={closed ? 'closed' : session.allPassed ? 'ready' : 'incomplete'}
        className={`rounded-xl border px-3 py-2.5 text-xs flex items-start gap-2 ${
          closed
            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-800'
            : session.allPassed
              ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-800'
              : 'bg-amber-500/10 border-amber-500/40 text-amber-800'
        }`}
      >
        {closed ? <Lock className="w-4 h-4 mt-0.5 shrink-0" /> : <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />}
        <div className="space-y-1">
          <div className="font-semibold">
            {closed
              ? `已验收关单 · ${new Date(session.closedAt!).toLocaleString('zh-CN', { hour12: false })}`
              : session.canAccept
                ? session.allPassed
                  ? '验收项已齐备，等待双签字关单'
                  : `还有 ${session.pending} 项待录入${session.failed ? `、${session.failed} 项超标` : ''}`
                : '当前不可验收'}
          </div>
          {!closed && !session.canAccept && session.blockedReason && <div>{session.blockedReason}</div>}
          {closed && <div className="text-[11px] opacity-80">验收与签字记录只读，可在下方回看。</div>}
          {/* 未配置项必须显式说明，不能让人以为"全绿" */}
          {session.unconfigured > 0 && (
            <div data-testid="acceptance-unconfigured-note" className="text-[11px] opacity-90">
              其中 {session.unconfigured} 项无验收标准（未配置），已如实记为「未判定」，不计入合格也不判为超标。
            </div>
          )}
        </div>
      </div>

      {/* 1. 验收清单 */}
      <section className="space-y-2">
        <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <Ruler className="w-4 h-4 text-cyan-600" /> 修后验收清单
          <span className="font-normal text-slate-400">（共 {items.length} 项，判定由服务端按验收标准复算）</span>
        </h4>

        {autoItems.map((item) => {
          const meta = VERDICT_META[item.verdict];
          const unit = item.unit ?? '';
          return (
            <div
              key={item.itemKey}
              data-testid={`acceptance-item-${item.itemKey}`}
              data-verdict={item.verdict}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-800 leading-snug">{item.itemLabel}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    验收标准：<span className="font-mono">{limitText(item)}</span>
                    <span className="mx-1.5 text-slate-300">|</span>
                    来源：{item.standardSource}
                  </div>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold ${meta.cls}`}>
                  {meta.icon}
                  {meta.label}
                </span>
              </div>

              {item.note && <div className="text-[11px] text-slate-500 leading-relaxed">{item.note}</div>}

              {!closed && session.canAccept ? (
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1">
                    <input
                      inputMode="decimal"
                      value={drafts[item.itemKey] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [item.itemKey]: e.target.value }))}
                      placeholder={item.record ? `上次 ${fmt(item.record.value, item.unit)}` : '实测值'}
                      aria-label={`${item.itemLabel} 实测值`}
                      className="w-full h-12 min-h-[44px] px-3 pr-10 rounded-lg border border-slate-300 bg-slate-50 text-base font-semibold text-slate-900 focus:outline-none focus:border-cyan-500 focus:bg-white"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{unit}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitItem(item)}
                    disabled={busyKey === item.itemKey}
                    className="h-12 min-h-[44px] min-w-[88px] px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"
                  >
                    {busyKey === item.itemKey ? '提交中…' : '记录'}
                  </button>
                </div>
              ) : (
                <div className="text-xs text-slate-600">
                  实测值：<span className="font-mono font-semibold">{fmt(item.record?.value, item.unit)}</span>
                  {item.record?.at && (
                    <span className="text-slate-400 ml-2">
                      {new Date(item.record.at).toLocaleString('zh-CN', { hour12: false })} · {item.record.by?.name ?? '—'}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {manualItems.map((item) => {
          const meta = VERDICT_META[item.verdict];
          return (
            <div
              key={item.itemKey}
              data-testid={`acceptance-item-${item.itemKey}`}
              data-verdict={item.verdict}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-800 leading-snug">{item.itemLabel}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    判定方式：现场确认（{item.metric === 'visual' ? '目视 / 听音' : '防护装置动作检查'}）
                    <span className="mx-1.5 text-slate-300">|</span>
                    来源：{item.standardSource}
                  </div>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold ${meta.cls}`}>
                  {meta.icon}
                  {meta.label}
                </span>
              </div>
              {!closed && session.canAccept ? (
                <button
                  type="button"
                  onClick={() => void submitItem(item)}
                  disabled={busyKey === item.itemKey}
                  className="w-full h-12 min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"
                >
                  {busyKey === item.itemKey ? '提交中…' : item.verdict === 'pass' ? '已确认 · 再次确认' : '现场确认无误'}
                </button>
              ) : (
                <div className="text-xs text-slate-600">
                  {item.record?.at
                    ? `已确认 · ${new Date(item.record.at).toLocaleString('zh-CN', { hour12: false })} · ${item.record.by?.name ?? '—'}`
                    : '未确认'}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* 2. 修前 / 修后对比 */}
      <section className="space-y-2">
        <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <ArrowRight className="w-4 h-4 text-violet-600" /> 修前 / 修后效果对比
        </h4>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-semibold px-3 py-2">指标</th>
                <th className="text-right font-semibold px-3 py-2">修前（最坏值）</th>
                <th className="text-right font-semibold px-3 py-2">修后（实测）</th>
                <th className="text-right font-semibold px-3 py-2">验收标准</th>
              </tr>
            </thead>
            <tbody>
              {session.baselines.map((b) => {
                const std = items.find((i) => i.metric === b.metric);
                const postRecord = std?.record ?? null;
                const pre = b.samples > 0 ? fmt(b.preMax, b.unit) : '未接入';
                const post = postRecord ? fmt(postRecord.value, postRecord.unit) : '未录入';
                return (
                  <tr
                    key={b.metric}
                    data-testid={`acceptance-compare-${b.metric}`}
                    data-pre-samples={b.samples}
                    className="border-t border-slate-100"
                  >
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {b.label}
                      {b.samples === 0 && (
                        <span className="ml-1 text-[10px] text-slate-400">（工单前 24h 无遥测样本）</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${b.samples > 0 ? 'text-slate-700' : 'text-slate-400'}`}>
                      {pre}
                      {b.samples > 0 && b.overLimitSamples != null && b.overLimitSamples > 0 && (
                        <span className="ml-1 text-[10px] text-rose-500">超报警线 {b.overLimitSamples}/{b.samples}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{post}</td>
                    <td className="px-3 py-2 text-right text-slate-600 font-mono">
                      {std ? limitText(std) : '未配置'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          修前取工单创建前 24 小时的真实遥测最坏值；没有样本时显示「未接入」，不做推算或补齐。
          修后为本次现场实测值；「验收标准」与上方清单同源（acceptance_standards）。
        </p>
      </section>

      {/* 3. 双签字 */}
      <section className="space-y-2">
        <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-indigo-600" /> 验收签字（维修人 + 班组长，两人）
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <SignatureCard
            step="technician"
            title="维修人签字"
            hint="由执行本次维修的人签字，身份取当前登录账号"
            signature={session.signatures.find((s) => s.step === 'technician') ?? null}
          />
          <SignatureCard
            step="teamlead"
            title="班组长签字"
            hint="需车间主管 / 总工权限，且不能与维修人同一人"
            signature={session.signatures.find((s) => s.step === 'teamlead') ?? null}
          />
        </div>

        {!closed && session.canAccept && (
          <div className="space-y-2 pt-1">
            {!session.allPassed && (
              <div className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                需先完成全部验收项（且无超标）才能签字。
              </div>
            )}
            {session.allPassed && session.nextSigner === 'technician' && (
              <button
                type="button"
                data-testid="acceptance-sign-technician"
                onClick={() => void doSign('technician')}
                disabled={signing || !isRepairer}
                className="w-full h-12 min-h-[44px] rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer flex items-center justify-center gap-2"
              >
                <PenLine className="w-4 h-4" />
                {signing ? '签署中…' : `维修人签字确认（${currentUser.name}）`}
              </button>
            )}
            {session.allPassed && session.nextSigner === 'technician' && !isRepairer && (
              <div data-testid="acceptance-not-repairer" className="text-[11px] text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">
                「维修人」签名需由本次维修的执行人
                {session.repairer?.name ? `（${session.repairer.name}）` : ''}
                签署；当前登录账号不是该工单的维修人，无法代签。
              </div>
            )}
            {session.allPassed && session.nextSigner === 'teamlead' && (
              <button
                type="button"
                data-testid="acceptance-sign-teamlead"
                onClick={() => void doSign('teamlead')}
                disabled={signing || !canSignTeamlead}
                className="w-full h-12 min-h-[44px] rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer flex items-center justify-center gap-2"
              >
                <PenLine className="w-4 h-4" />
                {signing ? '签署中…' : `班组长复核签字（${currentUser.name}）`}
              </button>
            )}
            {session.allPassed && session.nextSigner === 'teamlead' && !canSignTeamlead && (
              <div className="text-[11px] text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">
                你当前不是班组长角色，或与已签字的维修人相同，不能执行班组长签字 —— 请由车间主管 / 总工账号复核。
              </div>
            )}
          </div>
        )}

        {unsigned && !closed && (
          <p className="text-[11px] text-slate-500">签字顺序：先维修人，后班组长；两人签完服务端自动关单归档。</p>
        )}
      </section>

      {/* 4. 维修总结 */}
      {summaryRef && (
        <section className="space-y-2">
          <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-emerald-600" /> 维修总结（已沉淀案例库）
          </h4>
          <div
            data-testid="acceptance-summary"
            data-knowledge-id={summaryRef.knowledgeId}
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-xs text-slate-700 space-y-1"
          >
            <div className="font-semibold text-slate-800">{summaryRef.title}</div>
            <div className="text-[11px] text-slate-500">
              案例编号 <span className="font-mono">{summaryRef.knowledgeId}</span>
              {session.summary?.createdAt &&
                ` · 生成于 ${new Date(session.summary.createdAt).toLocaleString('zh-CN', { hour12: false })}`}
            </div>
            <div className="text-[11px] text-slate-500">
              可在「知识库 → 维修案例」检索到本次故障的完整处理过程与修前修后对比。
            </div>
          </div>
        </section>
      )}

      {notice && (
        <div
          data-testid="acceptance-notice"
          className="text-xs rounded-lg px-3 py-2 bg-slate-100 border border-slate-200 text-slate-700"
        >
          {notice}
        </div>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed">{session.dataNote}</p>
    </div>
  );
};

const SignatureCard: React.FC<{
  step: 'technician' | 'teamlead';
  title: string;
  hint: string;
  signature: { name: string; roleTitle?: string; signedAt: string; signatureHash: string } | null;
}> = ({ step, title, hint, signature }) => (
  <div
    data-testid={`acceptance-signature-${step}`}
    data-signed={signature ? 'yes' : 'no'}
    className={`rounded-xl border px-3 py-2.5 min-h-[92px] ${
      signature ? 'bg-indigo-500/5 border-indigo-500/40' : 'bg-slate-50 border-dashed border-slate-300'
    }`}
  >
    <div className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
      {signature ? <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" /> : <PenLine className="w-3.5 h-3.5 text-slate-400" />}
      {title}
    </div>
    {signature ? (
      <div className="mt-1 space-y-0.5">
        <div className="text-sm font-bold text-slate-900">{signature.name}</div>
        <div className="text-[11px] text-slate-500">{signature.roleTitle || '—'}</div>
        <div className="text-[10px] text-slate-400 font-mono">
          {new Date(signature.signedAt).toLocaleString('zh-CN', { hour12: false })} · {signature.signatureHash}
        </div>
      </div>
    ) : (
      <div className="mt-1 text-[11px] text-slate-400 leading-snug">{hint}</div>
    )}
  </div>
);

export default AcceptancePanel;
