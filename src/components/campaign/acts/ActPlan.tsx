/**
 * 第 4 幕 · 制定方案 —— AI 生成检修方案，人决定派谁、领哪些备件。
 *
 * 对应项目功能：AI 生成方案、工单派工、备件管理。
 *
 * 数据红线：
 * - 方案与推荐人来自 `/api/v1/ai/generate-maintenance-plan` 与 `/ai/recommend-assignee`，
 *   降级时如实标注；方案没给的字段显示"方案未给出"，不补默认值。
 * - 派工走 `POST /work-orders/:id/dispatch` 真改工单状态（created → dispatched），
 *   带 version 走乐观锁；被状态机拒绝时显示服务端原话，不静默重试。
 * - 备件只认备件库里真实存在的条目（按名称匹配），匹配不到就显示"库内无此项"，
 *   宁可少扣库存也不造流水。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../../../context/AppDataContext';
import { useAuth } from '../../../context/AuthContext';
import { aiApi, ApiError, sparePartsApi, workOrderApi, type AiAssigneeRecommendation, type AiMaintenancePlan } from '../../../api';
import type { SparePart, UserProfile } from '../../../types';
import { cancelSpeech, speakChinese } from '../../digital-human/speech';
import { pickIncident } from '../campaignModel';
import { useActClock } from '../useActClock';
import type { ActProps } from '../actContract';
import { ActFooter, ApiNotice, Missing, Panel } from '../CampaignPanels';

/** 备件匹配：AI 给的名字 → 备件库真实条目（先全等，再互相包含） */
function matchPart(name: string, parts: SparePart[]): SparePart | null {
  const key = name.replace(/\s/g, '');
  if (!key) return null;
  const exact = parts.find((p) => p.name.replace(/\s/g, '') === key);
  if (exact) return exact;
  const loose = parts.find((p) => p.name.includes(name) || name.includes(p.name));
  return loose ?? null;
}

function errMsg(x: unknown): string {
  if (x instanceof ApiError || x instanceof Error) return x.message;
  return String(x);
}

type LogEntry = { kind: 'dispatch' | 'part'; text: string };

/** 操作流水：只回显真实接口的返回/拒绝原因，不拼假消息 */
function Journal({ entries, kind }: { entries: LogEntry[]; kind: LogEntry['kind'] }) {
  const lines = entries.filter((e) => e.kind === kind);
  if (!lines.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {lines.map((e, i) => (
        <li key={`${i}-${e.text.slice(0, 10)}`} className="text-[10px] leading-relaxed text-cyan-200/90">
          {e.text}
        </li>
      ))}
    </ul>
  );
}

export function ActPlan(props: ActProps) {
  const { run, currentUser, finish } = props;
  const { equipments } = useAppData();
  const { allUsers } = useAuth();
  const elapsed = useActClock();

  const [plan, setPlan] = useState<AiMaintenancePlan | null>(null);
  const [planDegraded, setPlanDegraded] = useState(false);
  const [suggest, setSuggest] = useState<AiAssigneeRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState(0);
  const [settled, setSettled] = useState(false);
  const [stock, setStock] = useState<SparePart[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [log, setLog] = useState<Array<{ kind: 'dispatch' | 'part'; text: string }>>([]);
  const [dispatched, setDispatched] = useState(false);
  const [issued, setIssued] = useState<Array<{ name: string; quantity: number }>>([]);
  const abortRef = useRef(false);

  /** 写接口要求填操作人；未登录时不做任何写操作（下面所有按钮都禁用） */
  const operatorName = currentUser?.name ?? '';

  const incident = useMemo(() => run.incident ?? pickIncident(equipments), [run.incident, equipments]);
  const equipment = incident?.equipment ?? null;
  const busy = !settled && !!equipment;
  const faultDescription = incident ? `${incident.brief}${incident.abnormalReading ? `（实测 ${incident.abnormalReading}）` : ''}` : '';

  useEffect(() => {
    abortRef.current = false;
    return () => {
      abortRef.current = true;
    };
  }, []);

  // 方案 + 推荐人 + 备件库存三件事并行拉，任一失败只影响它自己那一栏
  useEffect(() => {
    if (!equipment) return;
    let alive = true;
    void (async () => {
      const [planRes, sugRes, stockRes] = await Promise.allSettled([
        aiApi.generateMaintenancePlan({ equipmentId: equipment.id, faultDescription, workOrderId: run.workOrderId ?? undefined }),
        aiApi.recommendAssignee({ equipmentId: equipment.id, faultDescription, priority: incident?.priority }),
        sparePartsApi.list(),
      ]);
      if (!alive || abortRef.current) return;
      if (planRes.status === 'fulfilled' && planRes.value.success && planRes.value.plan) {
        setPlan(planRes.value.plan);
        setPlanDegraded(planRes.value.degraded === true);
      } else {
        const reason = planRes.status === 'fulfilled' ? planRes.value.message || planRes.value.error || '未返回方案' : errMsg(planRes.reason);
        setError(`检修方案未生成：${reason}`);
        setErrors((n) => n + 1);
      }
      if (sugRes.status === 'fulfilled' && sugRes.value.success) setSuggest(sugRes.value.recommendation ?? null);
      if (stockRes.status === 'fulfilled' && Array.isArray(stockRes.value)) setStock(stockRes.value);
      setSettled(true);
    })();
    return () => {
      alive = false;
    };
  }, [equipment, faultDescription, incident?.priority, run.workOrderId]);

  useEffect(() => {
    if (!plan) return;
    void speakChinese(`方案出来了：${String(plan.overview ?? '').slice(0, 70)} 预计 ${(plan.estimatedHours ?? 0) || '未给出'} 工时。`, { gender: 'male', maxChars: 160 });
  }, [plan]);

  /** 可派人选：真实用户表里的技术岗，按在手工单数排轻重 */
  const candidates = useMemo<UserProfile[]>(() => {
    const pool = allUsers.filter((u) => ['technician', 'manager', 'admin'].includes(String(u.role)));
    return [...pool].sort((a, b) => (a.currentTasksCount ?? 0) - (b.currentTasksCount ?? 0));
  }, [allUsers]);

  const recommendedId = suggest?.recommended?.id ?? null;
  const estimatedHours = plan?.estimatedHours;
  const spareRows = useMemo(() => {
    const list = plan?.spareParts ?? [];
    return list.map((p) => {
      const hit = matchPart(String(p.name ?? ''), stock);
      return { name: String(p.name ?? ''), spec: String(p.spec ?? ''), qty: Number(p.qty) || 1, part: hit };
    });
  }, [plan, stock]);

  const pushLog = useCallback((kind: 'dispatch' | 'part', text: string) => {
    setLog((prev) => [...prev.slice(-7), { kind, text }]);
  }, []);

  const dispatch = useCallback(async () => {
    if (!run.workOrderId || !assignee || !operatorName) return;
    const user = candidates.find((u) => u.id === assignee);
    if (!user) return;
    try {
      const fresh = await workOrderApi.getById(run.workOrderId);
      await workOrderApi.dispatch(fresh.id, {
        assigneeId: user.id,
        assigneeName: user.name,
        dispatcher: operatorName,
        estimatedHours,
        version: fresh.version,
      });
      setDispatched(true);
      pushLog('dispatch', `已派给 ${user.name}（${user.roleTitle || user.role}），工单进入待接单。`);
      void speakChinese(`派工完成，${user.name} 接单。`, { gender: 'male', maxChars: 60 });
    } catch (err) {
      setErrors((n) => n + 1);
      pushLog('dispatch', `派工被拒绝：${errMsg(err)}`);
    }
  }, [assignee, candidates, estimatedHours, operatorName, pushLog, run.workOrderId]);

  /** 领料：只对备件库里真实存在、且库存够的条目写一条出库流水 */
  const takeParts = useCallback(async () => {
    if (!run.workOrderId || !picked.length || !operatorName) return;
    const results: string[] = [];
    const taken: Array<{ name: string; quantity: number }> = [];
    for (const key of picked) {
      const row = spareRows.find((r) => r.name === key);
      if (!row?.part) {
        results.push(`${key}：备件库内无此项，未扣库`);
        continue;
      }
      if (row.part.stock < row.qty) {
        results.push(`${key}：库存 ${row.part.stock}${row.part.unit || '件'}，不足 ${row.qty}，未扣库`);
        setErrors((n) => n + 1);
        continue;
      }
      try {
        await sparePartsApi.inOut(row.part.id, {
          type: 'out',
          quantity: row.qty,
          operatorName,
          relatedWorkOrderId: run.workOrderId,
          notes: `《智检修士》主线第 4 幕领料（${run.orderNo ?? run.workOrderId}）`,
        });
        results.push(`${key} ×${row.qty} 已出库（真实备件 ${row.part.name}）`);
        taken.push({ name: key, quantity: row.qty });
      } catch (err) {
        setErrors((n) => n + 1);
        results.push(`${key}：出库失败 —— ${errMsg(err)}`);
      }
    }
    if (taken.length) setIssued((prev) => [...prev, ...taken]);
    results.forEach((text) => pushLog('part', text));
    void sparePartsApi.list().then((list) => Array.isArray(list) && setStock(list)).catch(() => undefined);
  }, [operatorName, picked, pushLog, run.orderNo, run.workOrderId, spareRows]);

  const next = () => {
    const outcome = {
      actId: 'plan' as const,
      firstTryRate: errors === 0 ? 1 : Math.max(0.3, 1 - errors * 0.3),
      mistakes: errors,
      seconds: elapsed(),
    };
    cancelSpeech();
    finish(outcome, {
      plan,
      planDegraded,
      assigneeId: assignee,
      assigneeName: candidates.find((u) => u.id === assignee)?.name ?? null,
      partsUsed: issued,
    });
  };

  if (!equipment) {
    return (
      <Panel title="制定方案" accent="rose">
        <ApiNotice kind="empty" text="前序幕次没有选定报警设备，方案生成缺少标的。" />
      </Panel>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Panel title="AI 检修方案" accent="cyan" right={<span className="text-[10px] text-slate-500">/ai/generate-maintenance-plan</span>} className="min-h-0 flex-1 overflow-y-auto">
        {busy && <div className="py-3 text-center text-[11px] text-cyan-300/80">正在生成方案与推荐主修人…</div>}
        {!busy && error && !plan && <ApiNotice kind="error" text={`${error}（无方案时本幕不做人工兜底）`} />}
        {plan && (
          <div className="space-y-1.5">
            {planDegraded && <ApiNotice kind="degraded" text="模型标记为降级，方案需工程师复核后执行。" />}
            <p className="text-[11px] leading-relaxed text-slate-200">{plan.overview || <Missing text="方案未给概述" />}</p>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded border border-cyan-400/30 bg-cyan-400/6 px-1.5 py-0.5 text-cyan-200">
                工时 {plan.estimatedHours ?? <Missing text="未估" />}
              </span>
              <span className="rounded border border-cyan-400/30 bg-cyan-400/6 px-1.5 py-0.5 text-cyan-200">
                人数 {plan.workers ?? <Missing text="未估" />}
              </span>
              <span className="rounded border border-white/12 px-1.5 py-0.5 text-slate-300">
                工序 {plan.steps?.length ?? 0} 项
              </span>
            </div>
            {plan.steps?.length ? (
              <ol className="space-y-1 border-t border-white/10 pt-1.5">
                {plan.steps.map((s, i) => (
                  <li key={`${s.step}-${i}`} className="text-[11px] leading-relaxed">
                    <span className="hud-tabular-nums mr-1 text-cyan-300">{s.step ?? i + 1}.</span>
                    {s.operation}
                    {s.qualityStandard ? <span className="ml-1 text-[10px] text-emerald-300/75">验收：{s.qualityStandard}</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {plan.tools?.length ? (
              <div className="text-[10px] text-slate-400">工器具：{plan.tools.map((t) => (t.spec ? `${t.name}(${t.spec})` : t.name)).join('、')}</div>
            ) : (
              <div className="text-[10px] text-slate-500">方案未给出工器具清单。</div>
            )}
            {plan.safetyMeasures?.lotoPoints?.length || plan.safetyMeasures?.ppe?.length ? (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/6 px-2 py-1.5 text-[10px] text-amber-100/90">
                {plan.safetyMeasures.lotoPoints?.length ? <div>隔离点：{plan.safetyMeasures.lotoPoints.join('、')}</div> : null}
                {plan.safetyMeasures.ppe?.length ? <div>劳保：{plan.safetyMeasures.ppe.join('、')}</div> : null}
                {plan.safetyMeasures.highRiskNotes?.length ? <div>高风险：{plan.safetyMeasures.highRiskNotes.join('、')}</div> : null}
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="派工" accent="emerald">
        {!run.workOrderId && <ApiNotice kind="empty" text="第 2 幕没有真实开单，派工没有可流转的工单。这一幕只能看方案，不改工单状态。" />}
        {!operatorName && <ApiNotice kind="empty" text="当前会话未登录，派工与领料按钮已禁用（不代填操作人）。" />}
        <div className="mt-1 space-y-1">
          {candidates.map((u) => {
            const isRec = recommendedId === u.id;
            const on = assignee === u.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setAssignee(u.id)}
                disabled={dispatched || !run.workOrderId}
                className={`w-full rounded-md border px-2 py-1 text-left text-[11px] disabled:cursor-not-allowed disabled:opacity-60 ${
                  on ? 'border-emerald-400/60 bg-emerald-400/12 text-emerald-100' : 'border-white/10 bg-white/2 text-slate-300 hover:border-emerald-400/40'
                }`}
              >
                <span className="font-semibold">{u.name}</span>
                <span className="ml-1.5 text-[10px] text-slate-400">{u.roleTitle || u.role}</span>
                {isRec && <span className="ml-1.5 rounded border border-cyan-400/40 bg-cyan-400/10 px-1 text-[9px] text-cyan-200">AI 推荐</span>}
                <span className="hud-tabular-nums float-right text-[10px] text-slate-500">在办 {u.currentTasksCount ?? 0}</span>
              </button>
            );
          })}
          {!candidates.length && <ApiNotice kind="empty" text="用户表里没有可派的技术岗账号。" />}
        </div>
        {suggest?.recommended && (
          <div className="mt-1 text-[10px] leading-relaxed text-slate-400">
            推荐理由：{suggest.recommended.reason}
            {suggest.estimatedHours ? ` · 建议工时 ${suggest.estimatedHours}h` : ''}
          </div>
        )}
        <Journal entries={log} kind="dispatch" />
        <div className="mt-1.5 flex gap-2">
          <button
            type="button"
            onClick={dispatch}
            disabled={!run.workOrderId || !assignee || dispatched}
            className="flex-1 rounded-md border border-emerald-400/45 bg-emerald-400/12 px-2 py-1 text-[11px] font-bold text-emerald-100 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            {dispatched ? '已派工' : '派工（真实改工单状态）'}
          </button>
          <button
            type="button"
            onClick={takeParts}
            disabled={!run.workOrderId || !picked.length || !operatorName}
            className="flex-1 rounded-md border border-amber-400/45 bg-amber-400/12 px-2 py-1 text-[11px] font-bold text-amber-100 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            领料出库（{picked.length} 项）
          </button>
        </div>
      </Panel>

      <Panel title="备件核对与领料" accent="amber">
        {spareRows.length === 0 && <ApiNotice kind="empty" text="方案未列出备件，本幕不扣库存。" />}
        <ul className="space-y-1">
          {spareRows.map((r) => (
            <li key={r.name} className="flex items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={picked.includes(r.name)}
                disabled={!r.part || !run.workOrderId}
                onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, r.name] : prev.filter((n) => n !== r.name)))}
                className="h-3 w-3 accent-amber-400"
              />
              <span className="min-w-0 flex-1 truncate">
                {r.name}
                {r.spec ? <span className="ml-1 text-[10px] text-slate-500">{r.spec}</span> : null}
                <span className="ml-1 text-[10px] text-slate-500">×{r.qty}</span>
              </span>
              <span className={`hud-tabular-nums shrink-0 text-[10px] ${!r.part ? 'text-slate-500' : r.part.stock < r.qty ? 'text-rose-300' : 'text-emerald-300'}`}>
                {r.part ? `库存 ${r.part.stock}${r.part.unit || ''}` : '库内无此项'}
              </span>
            </li>
          ))}
        </ul>
        <Journal entries={log} kind="part" />
        {issued.length > 0 && (
          <div className="mt-1 text-[10px] text-emerald-300">本幕已出库：{issued.map((p) => `${p.name}×${p.quantity}`).join('、')}</div>
        )}
      </Panel>

      <ActFooter
        hint={
          !plan
            ? '方案缺失也能继续，第 5 幕会退回按真实规程操作。'
            : dispatched || !run.workOrderId
              ? '进入第 5 幕：俯冲进 3D 设备，按规程四步检修。'
              : '建议先派工再进现场检修（不派工也能往下走）。'
        }
        busy={busy}
        primary={{ text: '进入第 5 幕 · 现场检修', onClick: next }}
        secondary={
          plan && !dispatched && run.workOrderId && !assignee
            ? { text: '跳过派工', onClick: () => pushLog('dispatch', '已跳过派工：工单仍停在待派单状态。') }
            : undefined
        }
      />
    </div>
  );
}
