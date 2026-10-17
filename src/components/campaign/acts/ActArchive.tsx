/**
 * 第 7 幕 · 归档复盘 —— 完工上报、验收签字、解锁、沉淀知识，然后结算。
 *
 * 对应项目功能：工单闭环、知识沉淀（AI 贡献待审核）、数据统计。
 *
 * 数据红线：
 * - 完工走 `POST /work-orders/:id/complete`（in_progress → pending_acceptance），
 *   验收走 `/accept`（→ completed 或退回 in_progress），都带 version 乐观锁；
 *   被状态机拒绝时回显服务端原话，不用 `transitionStatus` 硬拧状态。
 * - 验收结论默认沿用第 6 幕 AI 判定；AI 没给结论时由玩家二选一，界面标明是谁的结论。
 * - 隔离锁释放走 `POST /loto-locks/:id/release`，服务端安全联锁会在工单仍"检修中"时拒绝，
 *   这一幕把拒绝原因如实显示，不假装解锁成功。
 * - 作业票注销走 `POST /safety-permits/:id/close`：设备仍有 in_progress 工单、或关联锁未
 *   全部释放并填写现场说明时，服务端拒绝注销。票必须在本幕结掉——服务端按设备维度做开工
 *   联锁，一张过期未注销的票会让该设备以后每次都开不了工。
 * - 实测得到的动作顺序是硬约束：完工上报 → 释放隔离锁 → 注销作业票 → 验收签字。
 *   `/accept` 前设备若还有未注销的票，服务端直接 409，所以四个按钮按这条链依次放行。
 * - 知识沉淀写 `/ai/contributions`（待审核），不直接改知识库正文；文案只用本单真实数据拼。
 * - 复盘面板的每个数字都来自本局已发生的真实调用与本地成绩，不补任何估算值。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppData } from '../../../context/AppDataContext';
import { aiApi, ApiError, safetyPermitApi, workOrderApi } from '../../../api';
import type { LotoLock } from '../../../types';
import { cancelSpeech, speakChinese } from '../../digital-human/speech';
import { pickIncident } from '../campaignModel';
import { useActClock } from '../useActClock';
import type { ActProps } from '../actContract';
import { ActFooter, ApiNotice, DataRow, Missing, Panel } from '../CampaignPanels';

function errMsg(x: unknown): string {
  if (x instanceof ApiError || x instanceof Error) return x.message;
  return String(x);
}

export function ActArchive(props: ActProps) {
  const { run, outcomes, currentUser, finish, countMistake } = props;
  const { equipments } = useAppData();
  const elapsed = useActClock();

  const [errors, setErrors] = useState(0);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [completed, setCompleted] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [passChoice, setPassChoice] = useState<boolean>(run.qcPass !== false);
  const [score, setScore] = useState(5);
  const [lock, setLock] = useState<LotoLock | null>(null);
  const [lockReleased, setLockReleased] = useState(false);
  const [permitClosed, setPermitClosed] = useState(false);
  const [contributed, setContributed] = useState<string | null>(null);

  const operatorName = currentUser?.name ?? '';
  const incident = useMemo(() => run.incident ?? pickIncident(equipments), [run.incident, equipments]);
  const equipment = incident?.equipment ?? null;

  const pushLog = useCallback((text: string) => setLog((prev) => [...prev.slice(-6), text]), []);

  /** 本单真实过程文本：只拼已经拿到的接口结果，没有就写"未获取" */
  const causeAnalysis = useMemo(() => {
    const bits = [
      incident ? `报警依据：${incident.brief}${incident.abnormalReading ? `（实测 ${incident.abnormalReading}）` : ''}` : '',
      run.diagnosis?.summary ? `AI 诊断：${String(run.diagnosis.summary)}` : '',
      run.diagnosis?.probableCauses?.length ? `可能原因：${run.diagnosis.probableCauses.slice(0, 3).join('；')}` : '',
    ].filter(Boolean);
    return bits.join(' ｜ ') || '本单未获取 AI 诊断结论，原因分析为现场目视判断。';
  }, [incident, run.diagnosis]);

  const resolutionSteps = useMemo(() => {
    const proc = run.procedure?.steps?.map((s, i) => `${i + 1}) ${s.name}`).join(' ');
    const parts = run.partsUsed.length ? `更换备件：${run.partsUsed.map((p) => `${p.name}×${p.quantity}`).join('、')}。` : '本单无备件消耗。';
    const qc = run.qcVerdict ? `AI 视觉复核：${run.qcVerdict}。` : '未做 AI 视觉复核。';
    return `${proc ? `按规程《${run.procedure?.title}》执行：${proc}。` : '未按标准化规程（规程未匹配）。'}${parts}${qc}${run.lotoLockNo ? `能量隔离锁 ${run.lotoLockNo}。` : '未登记能量隔离锁。'}`;
  }, [run.lotoLockNo, run.partsUsed, run.procedure, run.qcVerdict]);

  // 进幕时把当前锁具台账拉出来，释放要有真实 id
  useEffect(() => {
    if (!run.lotoLockNo) return;
    let alive = true;
    void safetyPermitApi
      .getLotoLocks({})
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        setLock(list.find((l) => l.lockNo === run.lotoLockNo) ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [run.lotoLockNo]);

  useEffect(() => {
    void speakChinese('最后一幕：完工上报、验收签字、把经验留下。', { gender: 'male', maxChars: 60 });
    return () => cancelSpeech();
  }, []);

  const completeOrder = useCallback(async () => {
    if (!run.workOrderId || !operatorName || busy) return;
    setBusy(true);
    try {
      const fresh = await workOrderApi.getById(run.workOrderId);
      const totalSeconds = outcomes.reduce((s, o) => s + o.seconds, 0) + elapsed();
      const hours = Math.max(0.5, Math.round((totalSeconds / 3600) * 10) / 10);
      const wo = await workOrderApi.complete(fresh.id, {
        causeAnalysis,
        resolutionSteps,
        partsUsed: run.partsUsed.map((p) => ({ name: p.name, qty: p.quantity })),
        workHours: hours,
        completionPhotos: run.qcImageUrl ? [run.qcImageUrl] : [],
        operatorName,
        remark: '《智检修士》七幕主线归档：本单数据由主线各幕真实接口调用汇总。',
        version: fresh.version,
      });
      setCompleted(true);
      pushLog(`完工上报成功，工单 ${wo?.orderNo ?? fresh.orderNo ?? ''} 进入待验收。`);
    } catch (err) {
      setErrors((n) => n + 1);
      countMistake();
      pushLog(`完工上报被拒绝：${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, causeAnalysis, countMistake, elapsed, operatorName, outcomes, pushLog, resolutionSteps, run.partsUsed, run.qcImageUrl, run.workOrderId]);

  const acceptOrder = useCallback(async () => {
    if (!run.workOrderId || !operatorName || busy) return;
    setBusy(true);
    try {
      const fresh = await workOrderApi.getById(run.workOrderId);
      const wo = await workOrderApi.accept(fresh.id, {
        inspectorName: operatorName,
        pass: passChoice,
        score,
        comment: `第 7 幕验收。AI 复核结论：${run.qcVerdict ?? '未做视觉复核'}；现场失误 ${outcomes.reduce((s, o) => s + o.mistakes, 0)} 次。`,
        version: fresh.version,
      });
      setAccepted(true);
      pushLog(passChoice ? `验收通过，工单 ${wo?.orderNo ?? ''} 已归档。` : `验收判为不合格，工单 ${wo?.orderNo ?? ''} 退回检修中。`);
    } catch (err) {
      setErrors((n) => n + 1);
      countMistake();
      pushLog(`验收被拒绝：${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, countMistake, operatorName, outcomes, passChoice, pushLog, run.qcVerdict, run.workOrderId, score]);

  const releaseLock = useCallback(async () => {
    if (!lock || !operatorName || busy) return;
    setBusy(true);
    try {
      const released = await safetyPermitApi.releaseLotoLock(lock.id, {
        unlockRemark: `《智检修士》主线第 7 幕：验收后解除能量隔离（${run.orderNo ?? '未开单'}）`,
      });
      setLockReleased(true);
      if (released) setLock(released);
      pushLog(`隔离锁 ${lock.lockNo} 已释放。`);
    } catch (err) {
      setErrors((n) => n + 1);
      countMistake();
      pushLog(`释放被安全联锁拒绝：${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, countMistake, lock, operatorName, pushLog, run.orderNo]);

  /**
   * 注销作业票 = LOTO 闭环的最后一步。服务端两道联锁：设备不得有 in_progress 工单、
   * 关联锁必须全部已释放且填了现场释放说明，任一不满足就直接拒绝，界面回显原话。
   */
  const closePermit = useCallback(async () => {
    if (!run.permitId || !operatorName || busy || permitClosed) return;
    setBusy(true);
    try {
      const res = await safetyPermitApi.close(run.permitId, {
        closeRemark: `《智检修士》主线第 7 幕：${run.orderNo ?? '本单'} 工完料净场地清，隔离锁 ${run.lotoLockNo ?? '无'} 已释放，作业票注销闭环。`,
      });
      setPermitClosed(true);
      pushLog(`作业票 ${run.permitNo ?? ''} 已注销（服务端状态 ${res?.status ?? 'closed'}）。`);
    } catch (err) {
      setErrors((n) => n + 1);
      countMistake();
      pushLog(`注销作业票被拒绝：${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, countMistake, operatorName, permitClosed, pushLog, run.lotoLockNo, run.orderNo, run.permitId, run.permitNo]);

  const deposit = useCallback(async () => {
    if (!equipment || !operatorName || busy || contributed) return;
    setBusy(true);
    const title = `${equipment.name}／${incident?.faultType ?? '故障检修'} 检修案例`;
    try {
      const res = await aiApi.submitContribution({
        title,
        type: '检修案例',
        equipment: equipment.name,
        summary: causeAnalysis,
        solution: resolutionSteps,
      });
      if (!res?.success) throw new ApiError(500, { message: res?.message || '贡献接口未返回 success' });
      setContributed(title);
      pushLog(`经验已提交为知识贡献（${res.id ?? '待审核'}），需在知识库审核页采纳后才对外可见。`);
    } catch (err) {
      setErrors((n) => n + 1);
      countMistake();
      pushLog(`知识沉淀失败：${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, causeAnalysis, countMistake, contributed, equipment, incident?.faultType, operatorName, pushLog, resolutionSteps]);

  const settle = () => {
    finish(
      {
        actId: 'archive',
        firstTryRate: errors === 0 ? 1 : Math.max(0.3, 1 - errors * 0.3),
        mistakes: errors,
        seconds: elapsed(),
      },
      { contributionTitle: contributed }
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Panel title="工单闭环" accent="emerald" right={<span className="text-[10px] text-slate-500">/complete · /accept · /loto-locks/release · /safety-permits/close</span>}>
        <DataRow label="工单" value={run.orderNo ?? (run.workOrderId ? '已取得 id' : '未开单')} tone={run.orderNo ? 'good' : 'bad'} />
        <DataRow label="设备" value={equipment?.name ?? '未选定'} />
        <DataRow label="主修人" value={run.assigneeName ?? '未派工'} />
        <div className="mt-1 grid grid-cols-1 gap-1">
          <button
            type="button"
            onClick={completeOrder}
            disabled={!run.workOrderId || !operatorName || completed || busy}
            className="rounded-md border border-emerald-400/45 bg-emerald-400/12 px-2 py-1 text-[11px] font-bold text-emerald-100 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            {completed ? '已完工上报' : '完工上报（技师）'}
          </button>
          <button
            type="button"
            onClick={releaseLock}
            disabled={!lock || lockReleased || !operatorName || !completed || busy}
            className="rounded-md border border-rose-400/45 bg-rose-400/12 px-2 py-1 text-[11px] font-bold text-rose-100 hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            {lockReleased ? '隔离锁已释放' : run.lotoLockNo ? `释放隔离锁 ${run.lotoLockNo}` : '本幕未登记隔离锁，无需释放'}
          </button>
          <button
            type="button"
            onClick={closePermit}
            disabled={!run.permitId || !operatorName || permitClosed || (!!lock && !lockReleased) || busy}
            className="rounded-md border border-amber-400/45 bg-amber-400/12 px-2 py-1 text-[11px] font-bold text-amber-100 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            {permitClosed ? '作业票已注销' : run.permitNo ? `注销作业票 ${run.permitNo}` : '本单没有真实作业票可注销'}
          </button>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
            <span>验收结论</span>
            <button
              type="button"
              onClick={() => setPassChoice(true)}
              className={`rounded border px-1.5 py-0.5 ${passChoice ? 'border-emerald-400/60 bg-emerald-400/12 text-emerald-100' : 'border-white/12 text-slate-300'}`}
            >
              合格
            </button>
            <button
              type="button"
              onClick={() => setPassChoice(false)}
              className={`rounded border px-1.5 py-0.5 ${!passChoice ? 'border-rose-400/60 bg-rose-400/12 text-rose-100' : 'border-white/12 text-slate-300'}`}
            >
              退回返工
            </button>
            <span className="ml-auto text-slate-500">
              {run.qcPass === null ? 'AI 未给结论：由你判定' : `AI 判${run.qcPass ? '合格' : '返工'}，默认沿用`}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            评分
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScore(s)}
                className={`hud-tabular-nums h-5 w-5 rounded border ${s <= score ? 'border-amber-400/60 bg-amber-400/15 text-amber-100' : 'border-white/12 text-slate-500'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={acceptOrder}
            disabled={
              !run.workOrderId ||
              !operatorName ||
              !completed ||
              (!!lock && !lockReleased) ||
              (!!run.permitId && !permitClosed) ||
              accepted ||
              busy
            }
            className="rounded-md border border-cyan-400/45 bg-cyan-400/12 px-2 py-1 text-[11px] font-bold text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            {accepted ? '已验收签字' : '质检验收签字（质检员）'}
          </button>
          {!accepted && (
            <div className="text-[10px] text-slate-500">
              {completed && !!lock && !lockReleased
                ? '服务端联锁：隔离锁未释放不得验收。'
                : completed && !!run.permitId && !permitClosed
                  ? '服务端联锁：作业票未注销不得验收归档，先结清现场收尾两步。'
                  : '验收是闭环最后一步：完工 → 释放隔离锁 → 注销作业票 → 验收签字。'}
            </div>
          )}
          {run.permitId && !permitClosed && (
            <div className="text-[10px] text-slate-500">
              {!!lock && !lockReleased
                ? '先释放隔离锁再注销：服务端要求票关联的锁全部解锁并填写现场说明。'
                : '作业票不结清，该设备下一次开工会被"未生效/已过期的作业票"联锁拦住。'}
            </div>
          )}
          {!run.lotoLockNo && (
            <ApiNotice kind="empty" text="第 5 幕没有挂上真实隔离锁：这一幕就没有解锁动作，LOTO 台账里也不会有本单记录。" />
          )}
          {lock && !lockReleased && <div className="text-[10px] text-slate-500">锁具状态：{lock.status}（工单仍有"检修中"记录时服务端会拒绝释放）</div>}
        </div>
        {log.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 border-t border-white/10 pt-1.5">
            {log.map((line, i) => (
              <li key={`${i}-${line.slice(0, 10)}`} className="text-[10px] leading-relaxed text-slate-300">
                {line}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="经验沉淀" accent="cyan" right={<span className="text-[10px] text-slate-500">/ai/contributions</span>} className="min-h-0 flex-1 overflow-y-auto">
        <div className="text-[11px] font-semibold text-slate-200">{equipment ? `${equipment.name}／${incident?.faultType ?? '故障检修'}` : '未选定设备'}</div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">原因：{causeAnalysis}</p>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">处置：{resolutionSteps}</p>
        <button
          type="button"
          onClick={deposit}
          disabled={!equipment || !operatorName || !!contributed || busy}
          className="mt-1.5 w-full rounded-md border border-cyan-400/45 bg-cyan-400/12 px-2 py-1 text-[11px] font-bold text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
        >
          {contributed ? '已提交待审核' : '提交为知识贡献（待审核）'}
        </button>
        {contributed && <div className="mt-1 text-[10px] text-emerald-300">贡献条目：{contributed}</div>}
      </Panel>

      <Panel title="本单复盘" accent="amber">
        <DataRow label="累计用时" value={`${Math.floor(elapsed() / 60)} 分 ${elapsed() % 60} 秒`} />
        <DataRow label="前面各幕得分" value={outcomes.length ? `${outcomes.length} 幕已记分` : <Missing text="无" />} />
        <DataRow label="主线失误合计" value={`${outcomes.reduce((s, o) => s + o.mistakes, 0) + errors} 次`} tone={outcomes.reduce((s, o) => s + o.mistakes, 0) + errors ? 'bad' : 'good'} />
        <DataRow label="备件消耗" value={run.partsUsed.length ? run.partsUsed.map((p) => `${p.name}×${p.quantity}`).join('、') : '本单无'} />
        <div className="mt-1 text-[10px] text-slate-500">点"完成本单并结算"后，成绩按本地档案累计（等级/经验/成就只存浏览器）。</div>
      </Panel>

      <ActFooter
        hint={
          !run.workOrderId
            ? '本单没开过工：只能做知识沉淀，工单闭环没发生。'
            : accepted
              ? '闭环已完成，可以结算了。'
              : '建议先完工上报再验收签字（不做完也能结算，得分会低）。'
        }
        busy={busy}
        primary={{ text: '完成本单并结算', onClick: settle }}
      />
    </div>
  );
}
