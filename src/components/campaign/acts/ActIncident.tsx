/**
 * 第 2 幕 · 故障来袭 —— 报警 + 3D 定位 + **真实建单**。
 *
 * 对应项目功能：工单系统、故障定位、3D 设备视图。
 *
 * 数据红线：
 * - 报警设备与文案由 `pickIncident` 从真实台账算出（第 1 幕点的就是它），读数缺失时明说"未接入"。
 * - 工单走 `POST /api/v1/work-orders` 真入库；命中服务端 15 分钟防重复拦截时，
 *   **复用那条在处理中的真实工单**，不 `forceSubmit` 绕过去刷第二条。
 * - 设备台账状态一个字都不改（用户拍板口径），报警只体现在工单侧。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppData } from '../../../context/AppDataContext';
import { ApiError, workOrderApi } from '../../../api';
import { buildHuntSpots, worstSpot } from '../../game/levelPlay';
import { cancelSpeech, speakChinese } from '../../digital-human/speech';
import { pickIncident, type ActOutcome } from '../campaignModel';
import { useActClock } from '../useActClock';
import type { ActProps } from '../actContract';
import { ActFooter, AlarmBanner, ApiNotice, DataRow, Missing, Panel } from '../CampaignPanels';

const ACTIVE_STATUSES = ['created', 'dispatched', 'in_progress'];

/** 本幕只关心"哪张单、什么状态"，不复制整份工单结构 */
interface OrderRef {
  id: string;
  orderNo: string;
  status: string;
}

export function ActIncident(props: ActProps) {
  const { run, stage, currentUser, finish } = props;
  const { equipments, workOrders, loadAllBackendData } = useAppData();
  const elapsed = useActClock();
  const [errors, setErrors] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderRef | null>(null);

  // run.incident 由壳在第 1 幕结束时写好；直接刷新页面重进时兜底重算一次
  const incident = useMemo(() => run.incident ?? pickIncident(equipments), [run.incident, equipments]);
  const equipment = incident?.equipment ?? null;

  const spots = useMemo(() => (equipment ? buildHuntSpots(equipment) : []), [equipment]);
  const worst = worstSpot(spots);

  /** 该设备已有在处理中的真实工单 —— 直接续上，不再造第二条 */
  const existing = useMemo(
    () =>
      equipment
        ? workOrders.find((w) => w.equipmentId === equipment.id && ACTIVE_STATUSES.includes(String(w.status))) ?? null
        : null,
    [equipment, workOrders]
  );

  useEffect(() => {
    if (!equipment || !incident) return;
    stage.setFocused(equipment.id);
    stage.setMood('regret');
    stage.setFaultSpots(
      worst ? [{ key: worst.key, label: worst.label, abnormal: true, reading: worst.reading }] : []
    );
    void speakChinese(`报警了。${incident.brief}。先确认位置，再开报修单。`, { gender: 'male', maxChars: 160 });
    return () => cancelSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment?.id]);

  const onCreated = useCallback(
    (wo: OrderRef, reused: boolean) => {
      setOrder(wo);
      setNotice(
        reused
          ? `设备已有处理中的真实工单 ${wo.orderNo}（${wo.status}），主线续用它，不再重复开单。`
          : `报修单已入库：${wo.orderNo}，当前状态 ${wo.status}。`
      );
      void speakChinese(reused ? `这台设备本来就有工单在跑，我们接着处理 ${wo.orderNo}。` : `工单 ${wo.orderNo} 已生成，等待派工。`, {
        gender: 'male',
        maxChars: 120,
      });
      void loadAllBackendData().catch(() => undefined);
    },
    [loadAllBackendData]
  );

  const creatorName = currentUser?.name || '检修主管';

  const createOrder = useCallback(async () => {
    if (!equipment || !incident || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (existing) {
        onCreated(existing, true);
        return;
      }
      const wo = await workOrderApi.create({
        title: incident.orderTitle,
        equipmentId: equipment.id,
        faultType: incident.faultType,
        priority: incident.priority,
        description: `${incident.brief}（来自《智检修士》主线第 2 幕；报警依据为台账状态与已落库遥测，无阈值指标不参与判定。）`,
        creator: creatorName,
        // 同一条主线可能反复进第 2 幕（重来/刷新），幂等键避免刷出多条同因工单
        idempotencyKey: `campaign-${equipment.id}-${incident.abnormalLabel ?? 'status'}`,
      });
      onCreated(wo, false);
    } catch (err) {
      setErrors((n) => n + 1);
      if (err instanceof ApiError && err.data?.code === 'DUPLICATE_WORK_ORDER' && err.data.existingOrder) {
        const eo = err.data.existingOrder;
        onCreated({ id: eo.id, orderNo: eo.orderNo, status: eo.status }, true);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setNotice(msg);
    } finally {
      setBusy(false);
    }
  }, [busy, creatorName, equipment, existing, incident, onCreated]);

  const next = () => {
    const seconds = elapsed();
    const outcome: ActOutcome = {
      actId: 'incident',
      firstTryRate: errors === 0 ? 1 : Math.max(0.3, 1 - errors * 0.35),
      mistakes: errors,
      seconds,
    };
    stage.setFocused(null);
    stage.setFaultSpots(null);
    stage.setMood('idle');
    finish(outcome, { incident, workOrderId: order?.id ?? null, orderNo: order?.orderNo ?? null });
  };

  if (!incident || !equipment) {
    return (
      <div className="flex h-full flex-col gap-2">
        <Panel title="故障来袭" accent="rose">
          <ApiNotice kind="empty" text="真实台账里当前没有可报警的设备（状态正常、遥测读数都在阈值内）。主线不编造故障，请等设备状态变化后再来。" />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <AlarmBanner
        title={`${equipment.name} · ${incident.abnormalLabel ?? '台账状态'} 报警`}
        detail={incident.brief}
        source={`设备台账 ${equipment.code}（${equipment.workshop || equipment.location || '位置未登记'}）+ 已落库遥测`}
      />

      <Panel title="故障定位 · 3D 设备视图" accent="cyan" right={<span className="text-[10px] text-slate-500">{equipment.model}</span>}>
        <DataRow label="设备" value={equipment.name} />
        <DataRow label="类别 / 车间" value={`${equipment.category} · ${equipment.workshop || <Missing text="未登记" />}`} />
        <DataRow label="安装位置" value={equipment.location || <Missing text="未登记" />} />
        <DataRow label="健康分" value={typeof equipment.healthScore === 'number' ? equipment.healthScore : <Missing />} tone={(equipment.healthScore ?? 100) < 60 ? 'bad' : 'warn'} />
        <DataRow label="下次检修计划" value={equipment.nextInspectionDate || <Missing text="未排期" />} />
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 border-t border-white/8 pt-1.5">
          {spots.map((s) => (
            <DataRow
              key={s.key}
              label={s.label}
              value={s.reading ?? <Missing />}
              tone={s.abnormal ? 'bad' : s.severity === 'normal' ? 'good' : 'default'}
            />
          ))}
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          电流/电压/压力无阈值口径，只展示读数不判异常；未接入的测点保持"未接入"。
        </div>
      </Panel>

      <ActFooter
        hint={
          order
            ? notice ?? ''
            : existing
              ? `该设备已有处理中的真实工单 ${existing.orderNo}（${existing.status}）。`
              : notice
                ? `开单未成功：${notice}`
                : '确认位置与读数后开具报修工单，工单会真实写入系统并进入派单流程。'
        }
        busy={busy}
        primary={order ? { text: '进入第 3 幕 · AI 诊断', onClick: next } : { text: existing ? '续用处理中的工单' : '开具报修工单', onClick: createOrder }}
        secondary={
          order
            ? undefined
            : {
                text: '不开单，直接看 AI 怎么判',
                onClick: () => {
                  const seconds = elapsed();
                  finish({ actId: 'incident', firstTryRate: 0.5, mistakes: 1, seconds }, { incident, workOrderId: null, orderNo: null });
                },
              }
        }
      />
    </div>
  );
}
