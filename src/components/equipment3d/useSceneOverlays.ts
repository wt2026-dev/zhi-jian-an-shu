/**
 * 场景数据叠层域 hook（自 EquipmentScene.tsx 机械切出，纯移动不改行为）。
 *
 * 内聚在此：安全许可证 + LOTO 锁具拉取与安全边界 3D 重建（含开关即时生效）、
 * 故障定位环开关推送、全量遥测预取（48h）与超限观测故障链构建、
 * 坐标映射建立（挂载一次性）。
 *
 * 开关 state 本体（showSafetyBoundary / showFaultLocator）与图层 JSX 仍归 EquipmentScene；
 * allTelemetryRef 返回给宿主（拆解视图退出时要复用预取缓存重建故障链）。
 */
import { useEffect, useRef } from 'react';
import { equipmentApi, safetyPermitApi, dispatchApi } from '../../api';
import { logger } from '../../utils/logger';
import type { Equipment, WorkOrder } from '../../types';
import type { TelemetryHistory } from './DeviceAnalysisPanel';
import type { EquipmentScene } from './scene';

export interface UseSceneOverlaysOpts {
  sceneRef: React.MutableRefObject<EquipmentScene | null>;
  equipments: Equipment[];
  showSafetyBoundary: boolean;
  showFaultLocator: boolean;
  ready: boolean;
  selectedId: string | null;
  telemetry: TelemetryHistory | null;
  recentOrders: WorkOrder[];
  cardLoading: boolean;
  isolationId: string | null;
}

export function useSceneOverlays({
  sceneRef,
  equipments,
  showSafetyBoundary,
  showFaultLocator,
  ready,
  selectedId,
  telemetry,
  recentOrders,
  cardLoading,
  isolationId,
}: UseSceneOverlaysOpts) {
  /** 预取全量遥测缓存（16 台最新48h），避免每次选中都重拉 */
  const allTelemetryRef = useRef<Map<string, any[]>>(new Map());
  const safetyDataRef = useRef<Map<string, { permits: any[]; locks: any[] }>>(new Map());
  /** 坐标映射是否已建立 */
  const coordMapReadyRef = useRef(false);

  /* ---------- 1.2 拉取安全许可证 + LOTO 锁具 → 安全边界3D数据 ---------- */
  useEffect(() => {
    let alive = true;
    async function fetch() {
      try {
        const [permits, locks] = await Promise.all([
          safetyPermitApi.list({}),
          safetyPermitApi.getLotoLocks({ status: 'locked' }),
        ]);
        if (!alive) return;
        const pArr = Array.isArray(permits) ? permits : [];
        const lArr = Array.isArray(locks) ? locks : [];

        // permitNo → equipmentId 映射（LOTO 锁具通过 permitNo 关联许可证，许可证再关联设备）
        const permitToEq = new Map<string, string>();
        for (const p of pArr) {
          if (p.permitNo && p.equipmentId) permitToEq.set(p.permitNo, p.equipmentId);
        }

        const map = new Map<string, { permits: typeof pArr; locks: typeof lArr }>();
        for (const p of pArr) {
          if (!p.equipmentId) continue;
          if (!map.has(p.equipmentId)) map.set(p.equipmentId, { permits: [], locks: [] });
          map.get(p.equipmentId)!.permits.push(p);
        }
        for (const lk of lArr) {
          const eqId = lk.permitNo ? permitToEq.get(lk.permitNo) : undefined;
          if (!eqId) continue;
          if (!map.has(eqId)) map.set(eqId, { permits: [], locks: [] });
          map.get(eqId)!.locks.push(lk);
        }
        safetyDataRef.current = map;
        sceneRef.current?.buildSafetyBoundaries(map);
        sceneRef.current?.setSafetyBoundaryVisible(showSafetyBoundary);
      } catch {
        logger.warn('[equipment3d] 安全数据获取失败，跳过安全边界');
      }
    }
    fetch();
    return () => { alive = false; };
  }, [equipments]);

  /** 安全边界开关切换时即时更新场景 */
  useEffect(() => {
    sceneRef.current?.setSafetyBoundaryVisible(showSafetyBoundary);
  }, [showSafetyBoundary]);

  /**
   * 故障定位环开关：随开关即时生效。
   * 依赖里带上 ready —— 场景是异步构建的，首帧 ready 之前 sceneRef 还是 null；
   * 重建（换画质/预设）后也要把当前开关状态重新推一次，否则会回到默认可见。
   */
  useEffect(() => {
    sceneRef.current?.setFaultLocatorVisible(showFaultLocator);
  }, [showFaultLocator, ready]);

  /* ---------- 1.3 预取全量遥测 → 超限观测缓存 ---------- */
  useEffect(() => {
    if (equipments.length === 0) return;
    let alive = true;
    // 并发拉取16台最新48h遥测（任一失败不影响其它）
    Promise.allSettled(
      equipments.map((eq) =>
        equipmentApi.getTelemetryHistory(eq.id, 48).then((r) => {
          const pts = (r as any)?.points;
          if (alive && Array.isArray(pts)) allTelemetryRef.current.set(eq.id, pts);
        }),
      ),
    ).catch(() => { /* swallow */ });
    return () => { alive = false; };
  }, [equipments]);

  /* ---------- 1.4 选中设备时构建超限观测（设备详情层除外） ---------- */
  useEffect(() => {
    const scene = sceneRef.current;
    // 「场景密度优先」口径：单台聚焦（设备详情层）里不允许任何 3D 飘字，
    // 超限观测链的浮空文字标签只在车间层展示。
    if (!selectedId || !scene || cardLoading || isolationId) {
      scene?.clearFaultChain();
      return;
    }
    // 等 telemetry + recentOrders 就绪后再构建
    const pts = allTelemetryRef.current.get(selectedId) ?? null;
    if (pts && pts.length > 0) {
      scene.buildFaultChain(selectedId, pts, recentOrders);
    } else if (telemetry?.points && telemetry.points.length > 0) {
      scene.buildFaultChain(selectedId, telemetry.points, recentOrders);
    } else {
      scene.clearFaultChain();
    }
  }, [selectedId, telemetry, recentOrders, cardLoading, isolationId]);

  /* ---------- 1.5 建立坐标映射（挂载时一次性） ---------- */
  useEffect(() => {
    if (coordMapReadyRef.current) return;
    dispatchApi.board().then((r: any) => {
      if (r?.equipmentPoints && Array.isArray(r.equipmentPoints)) {
        sceneRef.current?.setCoordMap(r.equipmentPoints);
        coordMapReadyRef.current = true;
      }
    }).catch(() => { /* 静默 */ });
  }, []);

  return { allTelemetryRef };
}
