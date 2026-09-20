/**
 * 第 5 幕 · 现场检修 —— 相机俯冲进 3D 设备，按真实规程四步操作。
 *
 * 对应项目功能：3D 设备视图、检修闯关（顺序操作）、作业票管理 + LOTO。
 *
 * 数据红线：
 * - 四步的动作/工具/安全要点/验收标准全部来自 `buildRepairSteps`，源头是
 *   `maintenance_procedures` 的真实规程与第 4 幕的 AI 方案；**没有规程就没有这一幕**，
 *   界面如实禁用并说明原因，不用通用台词凑数。
 * - 作业票走 `POST /safety-permits`（真实 permitNo，状态待双人会签），隔离锁走
 *   `POST /loto-locks`（服务端要求关联票存在，锁号重复 409 拒绝，原话回显）。
 * - 接单前必须完成**双人会签**：监护节点由另一名真实账号（点检工程师/安全监护员）签署，
 *   终审节点由当前登录账号签署，两枚签名各自落库；服务端未生效票据禁止开工的联锁不改。
 * - 接单走 `POST /work-orders/:id/claim`（dispatched → in_progress）；第 4 幕没派工就接不了单，
 *   显示服务端拒绝原因，不偷偷绕过状态机。
 * - 备件消耗沿用第 4 幕的真实出库流水，本幕不重复扣库。
 * - 锁具释放受服务端安全联锁约束（设备仍有 in_progress 工单时不放锁），所以本幕只挂锁，
 *   释放留给第 7 幕完工之后。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppData } from '../../../context/AppDataContext';
import { useAuth } from '../../../context/AuthContext';
import { ApiError, safetyPermitApi, workOrderApi } from '../../../api';
import type { LotoLock, MaintenanceProcedure } from '../../../types';
import { cancelSpeech, speakChinese } from '../../digital-human/speech';
import { findProcedureForEquipment, fetchProcedures } from '../../game/gameData';
import { buildRepairSteps, judgeOrder, shuffledDeterministic } from '../campaignSteps';
import { countersignPermit, pickGuardianCandidate } from '../campaignPermitSign';
import { pickIncident } from '../campaignModel';
import { useActClock } from '../useActClock';
import type { ActProps } from '../actContract';
import { ActFooter, ApiNotice, Missing, Panel } from '../CampaignPanels';

/** 单步安全余量：同一失误会重置本步动作序列，总失误仍照常计分 */
const SAFETY_BUDGET = 3;

function errMsg(x: unknown): string {
  if (x instanceof ApiError || x instanceof Error) return x.message;
  return String(x);
}

/** 步骤标题去掉"第X步 · "前缀，只留动作名，供完成清单复用 */
function shortTitle(title: string): string {
  return title.replace(/^第.步 · /, '');
}

export function ActRepair(props: ActProps) {
  const { run, stage, currentUser, finish, countMistake } = props;
  const { equipments } = useAppData();
  const { allUsers } = useAuth();
  const elapsed = useActClock();

  const [procedure, setProcedure] = useState<MaintenanceProcedure | null>(null);
  const [procChecked, setProcChecked] = useState(false);
  const [permitNo, setPermitNo] = useState<string | null>(null);
  const [permitId, setPermitId] = useState<string | null>(null);
  const [permitDeadline, setPermitDeadline] = useState<string | null>(null);
  const [signedBy, setSignedBy] = useState<{ guardian: string; supervisor: string } | null>(null);
  const [lock, setLock] = useState<LotoLock | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [stepErrors, setStepErrors] = useState(0);
  const [errors, setErrors] = useState(0);
  const [doneTitles, setDoneTitles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const operatorName = currentUser?.name ?? '';
  /** 第二签署人：台账里真实存在的监护员账号，没有就没有双人会签，本幕不开工 */
  const guardian = useMemo(() => pickGuardianCandidate(allUsers, currentUser?.id), [allUsers, currentUser?.id]);
  const incident = useMemo(() => run.incident ?? pickIncident(equipments), [run.incident, equipments]);
  const equipment = incident?.equipment ?? null;
  const steps = useMemo(() => buildRepairSteps({ procedure, plan: run.plan }), [procedure, run.plan]);
  const step = steps[stepIdx] ?? null;
  /** 动作顺序按 stepKey 确定性打乱（不用 Math.random，便于复现与单测） */
  const pool = useMemo(() => (step ? shuffledDeterministic(step.actions, `${equipment?.id ?? 'na'}:${step.kind}`) : []), [step, equipment?.id]);
  const safetyLeft = Math.max(0, SAFETY_BUDGET - stepErrors);
  const allDone = steps.length > 0 && stepIdx >= steps.length;

  const pushLog = useCallback((text: string) => setLog((prev) => [...prev.slice(-5), text]), []);

  // 进场：聚焦本台设备并俯冲；离场把舞台交回工厂俯瞰
  useEffect(() => {
    if (!equipment) return;
    stage.setFocused(equipment.id);
    stage.dive(equipment.id);
    void speakChinese(`到现场了。${equipment.name}，按规程四步走：断电挂牌、拆解、更换、复装。`, { gender: 'male', maxChars: 160 });
    return () => {
      stage.setFocused(null);
      stage.setFaultSpots(null);
      cancelSpeech();
    };
  }, [equipment, stage]);

  // 规程匹配复用检修闯关的纯逻辑，保证"这台设备能不能演"与关卡地图同一口径
  useEffect(() => {
    if (!equipment) return;
    let alive = true;
    void fetchProcedures().then((list) => {
      if (!alive) return;
      setProcedure(findProcedureForEquipment(equipment, list));
      setProcChecked(true);
    });
    return () => {
      alive = false;
    };
  }, [equipment]);

  // 服务端按**设备**做开工联锁：该设备任意一张未结案作业票（待审批/已过期）都会拦住接单。
  // 上一局中断留下的票不会自动消失，进场先查出来如实报，免得玩家对着 409 猜原因。
  const [stalePermits, setStalePermits] = useState<string[]>([]);
  useEffect(() => {
    if (!equipment) return;
    let alive = true;
    void safetyPermitApi
      .list({})
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        setStalePermits(
          list
            .filter((p) => p?.equipmentId === equipment.id && !['closed', 'rejected'].includes(String(p?.status)))
            .map((p) => `${p.permitNo}（${p.status === 'pending_approval' ? '待会签' : p.status}）`)
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [equipment]);

  /** 开票 + 挂隔离锁：两步都成功才算"已隔离"，任一失败回显服务端原话 */
  const lockOut = useCallback(async () => {
    if (!equipment || !operatorName || busy) return;
    setBusy(true);
    try {
      // 有效期必须是可 Date.parse 的 ISO 截止时间：服务端 requireValidPermit 对"当日20:00前"
      // 这类人话直接判"有效期不明确"并拒绝开工，窗口按第 4 幕 AI 方案的预计工时给。
      const planHours = Number(run.plan?.estimatedHours);
      const hours = Number.isFinite(planHours) && planHours > 0 ? planHours : 4;
      const deadline = new Date(Date.now() + hours * 3600 * 1000);
      const deadlineText = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(deadline);
      const permit = await safetyPermitApi.create({
        permitType: '停电检修作业票',
        riskLevel: '较大风险 (Level 2)',
        title: `${equipment.name} 检修能量隔离`,
        equipmentId: equipment.id,
        equipmentName: equipment.name,
        workshop: equipment.workshop,
        location: equipment.location || equipment.workshop,
        validUntil: deadline.toISOString(),
        precautions: run.plan?.safetyMeasures?.ppe ?? [],
        hazards: run.plan?.safetyMeasures?.highRiskNotes ?? [],
      });
      const no = String(permit?.permitNo ?? '');
      if (!no) throw new ApiError(500, { message: '作业票接口未返回 permitNo' });
      setPermitNo(no);
      setPermitId(String(permit?.id ?? ''));
      setPermitDeadline(deadlineText);
      const point = run.plan?.safetyMeasures?.lotoPoints?.[0] ?? steps[0]?.actions[0] ?? `${equipment.name} 动力电源`;
      const registered = await safetyPermitApi.registerLotoLock({
        lockNo: `LOTO-${no}`,
        permitNo: no,
        pointName: String(point),
        energySource: '电能（动力电源）',
        location: equipment.location || equipment.workshop,
      });
      setLock(registered);
      pushLog(`作业票 ${no} 已提交待会签（有效期 ${deadlineText}，按预计工时 ${hours}h 给窗口），隔离锁 ${registered?.lockNo ?? `LOTO-${no}`} 登记入册。`);
      void speakChinese(`隔离锁已挂上。`, { gender: 'male', maxChars: 40 });
    } catch (err) {
      setErrors((n) => n + 1);
      countMistake();
      pushLog(`挂锁未完成：${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, countMistake, equipment, operatorName, pushLog, run.plan, steps]);

  /**
   * 双人会签：监护节点由另一名真实监护员账号签署，终审节点由当前登录账号签署。
   * 失败只回显服务端原话，不计入操作失误（这是账号权限/环境问题，不是玩家操作错）。
   */
  const countersign = useCallback(async () => {
    if (!permitId || !lock || !guardian || busy) return;
    setBusy(true);
    try {
      const res = await countersignPermit({
        permitId,
        guardian,
        guardianComment: `现场核实：${equipment?.name ?? ''} 动力电源已断开并挂隔离锁 ${lock.lockNo}，监护条件合格。`,
        supervisorComment: `能量隔离与劳保措施复核通过，准许 ${operatorName} 进场开工。`,
      });
      setSignedBy({ guardian: res.guardianName, supervisor: res.supervisorName || operatorName });
      pushLog(`双人会签完成：监护 ${res.guardianName} · 终审 ${res.supervisorName || operatorName}，票据状态 ${res.permitStatus}。`);
      void speakChinese('作业票已生效，可以开工。', { gender: 'male', maxChars: 40 });
    } catch (err) {
      pushLog(`会签未通过：${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, equipment, guardian, lock, operatorName, permitId, pushLog]);

  /** 接单：dispatched → in_progress，真改工单状态（票据未生效时服务端直接 409） */
  const claimOrder = useCallback(async () => {
    if (!run.workOrderId || !operatorName || busy) return;
    setBusy(true);
    try {
      const fresh = await workOrderApi.getById(run.workOrderId);
      const next = await workOrderApi.claim(fresh.id, { operatorName, version: fresh.version });
      setClaimed(true);
      setOrderMsg(`工单 ${next?.orderNo ?? fresh.orderNo ?? ''} 进入检修中，现场负责人 ${operatorName}。`);
    } catch (err) {
      setErrors((n) => n + 1);
      countMistake();
      setOrderMsg(`接单被拒绝：${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, countMistake, operatorName, run.workOrderId]);

  /** 点一条动作：顺序对就入列；顺序错扣一点安全余量，归零则重排本步 */
  const tap = useCallback(
    (action: string) => {
      if (!step) return;
      if (!lock) {
        pushLog('先在上方开票挂锁：未做能量隔离不得开始任何一步。');
        return;
      }
      if (action !== step.actions[picked.length]) {
        setErrors((n) => n + 1);
        countMistake();
        const nextStepErrors = stepErrors + 1;
        if (nextStepErrors >= SAFETY_BUDGET) {
          setStepErrors(0);
          setPicked([]);
          pushLog(`「${action}」顺序不对，安全余量用尽 —— ${step.title} 重做。`);
        } else {
          setStepErrors(nextStepErrors);
          pushLog(`「${action}」不是当前该做的动作，记一次失误。`);
        }
        return;
      }
      const nextPicked = [...picked, action];
      if (nextPicked.length < step.actions.length) {
        setPicked(nextPicked);
        return;
      }
      if (!judgeOrder(step, nextPicked)) {
        setPicked([]);
        pushLog(`${step.title} 顺序校验未通过，重排本步。`);
        return;
      }
      setDoneTitles((prev) => [...prev, shortTitle(step.title)]);
      setPicked([]);
      setStepErrors(0);
      setStepIdx((i) => i + 1);
      void speakChinese(`${shortTitle(step.title)}完成。`, { gender: 'male', maxChars: 40 });
    },
    [countMistake, lock, picked, pushLog, step, stepErrors]
  );

  const next = () => {
    cancelSpeech();
    const ratio = steps.length ? doneTitles.length / steps.length : 0;
    const clean = errors === 0 ? 1 : Math.max(0.3, 1 - errors * 0.15);
    finish(
      {
        actId: 'repair',
        // 未走完四步时按完成率打折，不用"点完了"冒充一次通过
        firstTryRate: Math.min(clean, ratio),
        mistakes: errors,
        seconds: elapsed(),
      },
      {
        procedure,
        lotoLockNo: lock?.lockNo ?? null,
        permitId,
        permitNo,
        // 备件沿用第 4 幕真实出库流水，本幕不重复写
        partsUsed: run.partsUsed,
      }
    );
  };

  if (!equipment) {
    return (
      <Panel title="现场检修" accent="rose">
        <ApiNotice kind="empty" text="前序幕次没有选定设备，本幕没有作业现场。" />
      </Panel>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Panel title="作业许可与能量隔离" accent="rose" right={<span className="text-[10px] text-slate-500">/safety-permits · /approve · /loto-locks</span>}>
        <div className="space-y-0.5">
          <div className="text-[11px]">
            作业票：{permitNo ? (
              signedBy ? (
                <span className="font-semibold text-emerald-300">
                  {permitNo} · 已生效（监护 {signedBy.guardian} / 终审 {signedBy.supervisor}）
                </span>
              ) : (
                <span className="font-semibold text-amber-200">{permitNo}（待双人会签）</span>
              )
            ) : (
              <Missing text="未开票" />
            )}
            {permitDeadline && <span className="ml-1 text-[10px] text-slate-500">有效期至 {permitDeadline}</span>}
          </div>
          <div className="text-[11px]">
            隔离锁：{lock ? <span className="font-semibold text-emerald-300">{lock.lockNo} · {lock.status}</span> : <Missing text="未登记" />}
          </div>
          <div className="text-[11px]">
            工单：{claimed ? <span className="font-semibold text-emerald-300">检修中（已接单）</span> : run.workOrderId ? <Missing text="未接单" /> : <Missing text="第 2 幕未开单" />}
          </div>
        </div>
        {!operatorName && (
          <div className="mt-1">
            <ApiNotice kind="empty" text="未登录：开票、挂锁、接单全部禁用（不代填操作人）。" />
          </div>
        )}
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={lockOut}
            disabled={!operatorName || !!lock || busy}
            className="rounded-md border border-rose-400/45 bg-rose-400/12 px-2 py-1 text-[11px] font-bold text-rose-100 hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            {lock ? '已挂隔离锁' : '开票并挂隔离锁'}
          </button>
          <button
            type="button"
            onClick={countersign}
            disabled={!operatorName || !lock || !!signedBy || !permitId || busy}
            className="rounded-md border border-amber-400/45 bg-amber-400/12 px-2 py-1 text-[11px] font-bold text-amber-100 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            {signedBy ? '已双人会签' : '双人会签放行'}
          </button>
          <button
            type="button"
            onClick={claimOrder}
            disabled={!operatorName || !run.workOrderId || claimed || !lock || !signedBy || busy}
            className="rounded-md border border-emerald-400/45 bg-emerald-400/12 px-2 py-1 text-[11px] font-bold text-emerald-100 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-slate-600/50 disabled:bg-slate-700/20 disabled:text-slate-500"
          >
            {claimed ? '已接单' : '接单开工'}
          </button>
        </div>
        {!lock && operatorName && (
          <div className="mt-1 text-[10px] leading-relaxed text-slate-500">先开票挂锁：高危作业须先做能量隔离，再走监护确认与主管终审两个节点。</div>
        )}
        {lock && !signedBy && (
          <div className="mt-1 text-[10px] leading-relaxed text-amber-200/80">
            {guardian
              ? `监护节点须由另一名真实账户签署（本局取台账里的「${guardian.name} · ${guardian.roleTitle}」），终审由当前登录的 ${operatorName} 签；同账户签两处会被服务端拒绝。票据未生效前接单按钮保持禁用。`
              : '用户台账里没有可用的监护员/安全总监账号：没有第二签署人就做不出真实的双人会签，接单只能被安全联锁拒绝。'}
          </div>
        )}
        {orderMsg && <div className="mt-1 text-[10px] leading-relaxed text-cyan-200/90">{orderMsg}</div>}
        {stalePermits.length > 0 && (
          <div className="mt-1 text-[10px] leading-relaxed text-rose-200/80">
            该设备还有 {stalePermits.length} 张未结案作业票：{stalePermits.join('、')}。服务端按设备做开工联锁，任意一张待会签或已过期的票都会拦住接单，须先在"安全管理"页会签生效或驳回。
          </div>
        )}
        <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
          隔离锁须待本台工单离开"检修中"后才允许释放（服务端安全联锁），第 7 幕完工后再办。
        </div>
        {log.length > 0 && (
          <ul className="mt-1 space-y-0.5 border-t border-white/10 pt-1">
            {log.map((line, i) => (
              <li key={`${i}-${line.slice(0, 10)}`} className="text-[10px] leading-relaxed text-slate-300">
                {line}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={`按规程操作（${Math.min(stepIdx + 1, steps.length)}/${steps.length}）`}
        accent="cyan"
        right={
          <span className="flex items-center gap-1 text-[10px]">
            安全余量
            {Array.from({ length: SAFETY_BUDGET }).map((_, i) => (
              <span key={i} className={`h-2 w-2 rounded-full ${i < safetyLeft ? 'bg-emerald-400' : 'bg-rose-500/70'}`} />
            ))}
          </span>
        }
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {!procChecked && <div className="py-2 text-center text-[11px] text-cyan-300/80">正在匹配该设备的标准化规程…</div>}
        {procChecked && !procedure && (
          <ApiNotice kind="empty" text={`台账里「${equipment.category}／${equipment.name}」没有匹配到标准化检修规程 —— 没有规程就不演"按规程检修"，本幕无题可做。`} />
        )}
        {procChecked && procedure && steps.length === 0 && (
          <ApiNotice kind="empty" text={`规程《${procedure.title}》的步骤拆不出可排序的动作序列（每步需 ≥3 段），本幕无题可做。`} />
        )}

        {step && (
          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold text-cyan-100">{step.title}</span>
              <span className="text-[9px] text-slate-500">
                {step.source === 'loto-standard' ? 'LOTO 通用四步（非设备台账）' : step.source === 'ai-plan' ? '动作取自 AI 方案' : '动作取自真实规程'}
              </span>
            </div>
            <p className="text-[11px] text-slate-300">{step.prompt}</p>
            {step.tools.length > 0 && <div className="text-[10px] text-slate-400">工器具：{step.tools.join('、')}</div>}
            <div className="rounded-md border border-amber-400/25 bg-amber-400/6 px-2 py-1 text-[10px] text-amber-100/90">安全要点：{step.safety}</div>
            <div className="text-[10px] text-emerald-300/80">验收：{step.acceptance}</div>
            {step.kind === 'replace' && (
              <div className="text-[10px] text-slate-400">
                备件：
                {step.parts.length
                  ? step.parts.map((p) => `${p.name}×${p.qty}`).join('、')
                  : '本步无登记备件消耗（第 4 幕未领料或方案未列备件）'}
              </div>
            )}
            <div className="grid grid-cols-1 gap-1 pt-1">
              {pool.map((action) => {
                const order = picked.indexOf(action);
                const used = order >= 0;
                return (
                  <button
                    key={action}
                    type="button"
                    onClick={() => tap(action)}
                    disabled={used || !lock}
                    className={`rounded-md border px-2 py-1 text-left text-[11px] leading-snug ${
                      used
                        ? 'border-emerald-400/45 bg-emerald-400/10 text-emerald-100'
                        : 'border-white/12 bg-white/2 text-slate-200 hover:border-cyan-400/45'
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    {used && <span className="hud-tabular-nums mr-1.5 text-emerald-300">{order + 1}</span>}
                    {action}
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-slate-500">{lock ? '按正确顺序逐条点击；点错一次扣一点安全余量。' : '未完成能量隔离，动作清单只读。'}</div>
          </div>
        )}

        {doneTitles.length > 0 && <div className="mt-1.5 text-[10px] text-slate-400">已完成：{doneTitles.join(' → ')}</div>}

        {allDone && (
          <div className="mt-1.5 rounded-md border border-emerald-400/35 bg-emerald-400/8 px-2.5 py-2 text-[11px] text-emerald-100">
            四步走完。
            <div className="mt-1 text-[10px] text-emerald-200/70">
              全程失误 {errors} 次；{run.partsUsed.length ? `消耗备件 ${run.partsUsed.map((p) => `${p.name}×${p.quantity}`).join('、')}；` : '本单无备件消耗；'}
              接下来交给 AI 视觉质检复核。
            </div>
          </div>
        )}
      </Panel>

      <ActFooter
        hint={
          !procedure
            ? '本幕无规程可依据，记录后继续走后面的幕次。'
            : allDone
              ? '现场作业完成，进入第 6 幕上传完工照片。'
              : `已完成 ${doneTitles.length}/${steps.length} 步；未走完也能推进，本幕得分按完成率计。`
        }
        busy={busy}
        primary={{ text: allDone ? '进入第 6 幕 · AI 质检' : '结束本幕并继续', onClick: next }}
      />
    </div>
  );
}
