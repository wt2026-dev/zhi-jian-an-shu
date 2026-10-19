/**
 * 维修闭环 —— 3D 场景内工单操作（派单 / 接单 / 步骤勾选 / 完工上报 / 验收）。
 *
 * 2026-10-19 从 EquipmentScene.tsx 第五刀机械切出：只收「推进一张工单」的编排逻辑
 * 和它自己的状态（busy / error / 步骤勾选进度）。刻意**不收**的两样：
 *   - activeOrderCard：卡片属于「选中设备」的生命周期，handlePick / clearSelection /
 *     跨页深链三处都在写它，收进钩子只会变成宿主反向遥控钩子的第四个口。
 *   - focusDecorBaseRef：聚焦层五步卡底版由 handlePick 缓存，属场景数据层。
 * 引擎侧只开四扇门（setFocusDecorData / setDeviceRepairPhase / setDeviceRepairProgress /
 * playRepairRecovery），不 import scene.ts，免得这个钩子被三千行的引擎类型拖着走。
 *
 * 口径不动的部分：所有状态色只覆盖显示、台账只在验收后按「工单 completed → 设备 running」
 * 的既有规则并一条；接口失败一律写回卡片错误、不伪造成功。
 */
import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { dispatchApi, workOrderApi } from '../../api';
import type { Equipment, UserProfile, WorkOrder } from '../../types';
import { logger } from '../../utils/logger';
import type { FocusDecorData } from './focusSceneDecor';

/** 维修闭环需要的引擎门面：只有这四扇门，scene.ts 的其余能力对本钩子不可见。 */
export interface RepairSceneTarget {
  setFocusDecorData(data: FocusDecorData): void;
  setDeviceRepairPhase(deviceId: string, phase: 'repairing' | 'operating'): void;
  setDeviceRepairProgress(deviceId: string, ratio: number): void;
  playRepairRecovery(deviceId: string): void;
}

export interface WorkOrderActionsOptions {
  /** 当前弹出的检修卡片工单（状态留在宿主，见文件头） */
  activeOrderCard: WorkOrder | null;
  /** 操作工 / 无身份在场景内只读：任何处置动作被 guardReadOnly 拦下 */
  readOnly3D: boolean;
  currentUser: UserProfile | null;
  sceneRef: { current: RepairSceneTarget | null };
  /** 聚焦层数据快照（宿主在 handlePick 时缓存） */
  focusDecorBaseRef: { current: FocusDecorData | null };
  setActiveOrderCard: Dispatch<SetStateAction<WorkOrder | null>>;
  /** 选中设备的最近工单列表 */
  setRecentOrders: Dispatch<SetStateAction<WorkOrder[]>>;
  /** 3D 自己拉的那份设备台账（remote），验收后按既有口径并一条 running */
  setRemote: Dispatch<SetStateAction<Equipment[] | null>>;
  /** 全局上下文收口（AppDataContext），可选以沿用宿主原来的 `?.()` 写法 */
  contextUpdateWorkOrder?: (order: WorkOrder) => void;
  /** 重拉工单列表 → 指示环 */
  fetchWorkOrders: () => void;
}

export function useWorkOrderActions({
  activeOrderCard,
  readOnly3D,
  currentUser,
  sceneRef,
  focusDecorBaseRef,
  setActiveOrderCard,
  setRecentOrders,
  setRemote,
  contextUpdateWorkOrder,
  fetchWorkOrders,
}: WorkOrderActionsOptions) {
  const [orderActionBusy, setOrderActionBusy] = useState(false);
  const [orderActionError, setOrderActionError] = useState<string | null>(null);
  /** 检修步骤勾选进度（工单 id → 已勾数），重新选中设备不丢进度 */
  const stepProgressRef = useRef<Map<string, number>>(new Map());

  const operatorName = useMemo(
    () => (currentUser ? `${currentUser.name} (${currentUser.roleTitle})` : undefined),
    [currentUser]
  );

  /** 只读模式统一闸门：操作工在 3D 场景内只能浏览，任何处置动作在此被拦下 */
  const guardReadOnly = useCallback(() => {
    if (!readOnly3D) return false;
    setOrderActionError('当前角色仅可浏览 3D 场景，不能操作设备或推进工单，请切换角色');
    return true;
  }, [readOnly3D]);

  /** 选中状态变化时清空上一张卡片的报错（宿主 resetSelectionVisuals 用） */
  const clearOrderActionError = useCallback(() => setOrderActionError(null), []);

  /** 工单操作成功后的统一收口：当前卡片 + 选中设备工单列表 + 全局上下文 + 指示环 */
  const applyOrderUpdate = useCallback(
    (updated: WorkOrder) => {
      setActiveOrderCard((prev) => (prev && prev.id === updated.id ? updated : prev));
      setRecentOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      contextUpdateWorkOrder?.(updated);
      fetchWorkOrders();
    },
    [setActiveOrderCard, setRecentOrders, contextUpdateWorkOrder, fetchWorkOrders]
  );

  /** 刷新聚焦层五步卡片的工单状态（底版快照在 handlePick 时缓存） */
  const refreshFocusDecorOrder = useCallback(
    (order: WorkOrder | null) => {
      const base = focusDecorBaseRef.current;
      if (!base || !sceneRef.current) return;
      sceneRef.current.setFocusDecorData({
        ...base,
        workOrder: order ? { orderNo: order.orderNo, status: order.status, faultType: order.faultType } : null,
      });
    },
    [focusDecorBaseRef, sceneRef]
  );

  const handleOrderDispatch = useCallback(async () => {
    const order = activeOrderCard;
    if (!order || orderActionBusy) return;
    if (guardReadOnly()) return;
    setOrderActionBusy(true);
    setOrderActionError(null);
    try {
      const rec = await dispatchApi.recommend(order.id);
      const top = rec?.recommendations?.[0]?.technician;
      if (!top?.id) throw new Error('调度推荐未返回可用技师');
      const res = await dispatchApi.assign({ workOrderId: order.id, userId: top.id });
      applyOrderUpdate((res?.workOrder ?? (res as unknown)) as WorkOrder);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOrderActionError(`派单失败：${msg}`);
      logger.warn('[equipment3d] 场景内派单失败:', err);
    } finally {
      setOrderActionBusy(false);
    }
  }, [activeOrderCard, orderActionBusy, applyOrderUpdate]);

  const handleOrderClaim = useCallback(async () => {
    const order = activeOrderCard;
    if (!order || orderActionBusy) return;
    if (guardReadOnly()) return;
    setOrderActionBusy(true);
    setOrderActionError(null);
    try {
      const updated = await workOrderApi.claim(order.id, { operatorName, version: order.version });
      applyOrderUpdate(updated);
      const eqId = order.equipmentId || (order as any).equipment_id;
      // 接单即进场：设备状态切"检修中"蓝（只覆盖显示，台账不动）
      if (eqId) sceneRef.current?.setDeviceRepairPhase(eqId, 'repairing');
      refreshFocusDecorOrder(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOrderActionError(`接单失败：${msg}`);
      logger.warn('[equipment3d] 场景内接单失败:', err);
    } finally {
      setOrderActionBusy(false);
    }
  }, [activeOrderCard, orderActionBusy, operatorName, applyOrderUpdate, refreshFocusDecorOrder]);

  const handleOrderComplete = useCallback(
    async (payload: { causeAnalysis: string; workHours: number; resolutionSteps: string }) => {
      const order = activeOrderCard;
      if (!order || orderActionBusy) return;
      if (guardReadOnly()) return;
      setOrderActionBusy(true);
      setOrderActionError(null);
      try {
        const updated = await workOrderApi.complete(order.id, {
          causeAnalysis: payload.causeAnalysis,
          resolutionSteps: payload.resolutionSteps,
          workHours: payload.workHours,
          completionPhotos: [],
          operatorName,
          version: order.version,
        });
        applyOrderUpdate(updated);
        const eqId = order.equipmentId || (order as any).equipment_id;
        // 修复完成：定位标红转绿淡出 + 设备复转 + 相机缓推
        if (eqId) sceneRef.current?.playRepairRecovery(eqId);
        refreshFocusDecorOrder(updated);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setOrderActionError(`完工上报失败：${msg}`);
        logger.warn('[equipment3d] 场景内完工上报失败:', err);
      } finally {
        setOrderActionBusy(false);
      }
    },
    [activeOrderCard, orderActionBusy, operatorName, applyOrderUpdate, refreshFocusDecorOrder]
  );

  const handleOrderAccept = useCallback(async () => {
    const order = activeOrderCard;
    if (!order || orderActionBusy) return;
    if (guardReadOnly()) return;
    setOrderActionBusy(true);
    setOrderActionError(null);
    try {
      const updated = await workOrderApi.accept(order.id, {
        inspectorName: operatorName,
        pass: true,
        score: 5,
        comment: '现场复测合格，具备复机条件',
        version: order.version,
      });
      applyOrderUpdate(updated);
      const eqId = order.equipmentId || (order as any).equipment_id;
      // 台账同步：沿用 AppDataContext「工单 completed → 设备 running」的既有口径，
      // 并把 running 合并进 3D 自己拉的 remote 台账，消除"验收完切回 3D 还是故障色"的时滞。
      if (eqId) {
        setRemote((prev) =>
          prev ? prev.map((e) => (e.id === eqId ? { ...e, status: 'running' } : e)) : prev
        );
        sceneRef.current?.setDeviceRepairPhase(eqId, 'operating');
      }
      refreshFocusDecorOrder(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOrderActionError(`验收失败：${msg}`);
      logger.warn('[equipment3d] 场景内验收失败:', err);
    } finally {
      setOrderActionBusy(false);
    }
  }, [activeOrderCard, orderActionBusy, operatorName, applyOrderUpdate, refreshFocusDecorOrder]);

  /** 步骤勾选 → 3D 故障定位标逐层减淡（勾一步消一层） */
  const handleStepProgress = useCallback(
    (checked: number, total: number) => {
      const order = activeOrderCard;
      if (!order) return;
      if (guardReadOnly()) return;
      stepProgressRef.current.set(order.id, checked);
      const eqId = order.equipmentId || (order as any).equipment_id;
      if (eqId) sceneRef.current?.setDeviceRepairProgress(eqId, total > 0 ? checked / total : 0);
    },
    [activeOrderCard]
  );

  return {
    orderActionBusy,
    orderActionError,
    clearOrderActionError,
    stepProgressRef,
    handleOrderDispatch,
    handleOrderClaim,
    handleOrderComplete,
    handleOrderAccept,
    handleStepProgress,
  };
}
