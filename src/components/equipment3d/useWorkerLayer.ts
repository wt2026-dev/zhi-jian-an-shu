/**
 * 人员动线域 hook（自 EquipmentScene.tsx 机械切出，纯移动不改行为）。
 *
 * 内聚在此：技师名单 15 秒轮询与轨迹缓存（每人最多 10 个点，去重）、
 * 「选中设备重建人员动线」effect（派工指引虚线在选中时即便总开关关闭也出现，
 * 技师人形与历史轨迹仍跟随总开关；清层前判断建过没有，避免顺带摘掉巡检数字人）。
 *
 * 坐标映射建立标记（coordMapReadyRef）与图层开关的 JSX 仍归 EquipmentScene。
 */
import { useEffect, useRef, useState } from 'react';
import { dispatchApi, type DutyTechnician } from '../../api';
import type { WorkOrder } from '../../types';
import type { EquipmentScene } from './scene';

export interface UseWorkerLayerOpts {
  sceneRef: React.MutableRefObject<EquipmentScene | null>;
  selectedId: string | null;
  recentOrders: WorkOrder[];
}

export function useWorkerLayer({ sceneRef, selectedId, recentOrders }: UseWorkerLayerOpts) {
  /** 默认关：技师轨迹 + 人形 + 指引虚线太密，需要时在「可视化图层」里开。
   *  例外：选中设备时该设备的派工指引虚线仍会出现（见下方人员动线 effect）。 */
  const [showWorkers, setShowWorkers] = useState(false);
  const [technicians, setTechnicians] = useState<DutyTechnician[]>([]);
  /** 轨迹缓存：Map<userId, {mapX,mapY}[]>（最多10个点） */
  const trajectoryRef = useRef<Map<string, Array<{ mapX: number; mapY: number }>>>(new Map());
  /** 人员动线层是否建过：没建过就别清（清一次会顺带把巡检数字人也摘掉） */
  const workerLayerBuiltRef = useRef(false);

  /* ---------- 1.6 人员动线轮询（15 秒） ---------- */
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetch = () => {
      dispatchApi.listTechnicians().then((r: any) => {
        if (!alive) return;
        const techs = Array.isArray(r?.technicians) ? r.technicians : [];
        setTechnicians(techs);
        // 更新轨迹缓存（只记录 online/idle 的位置）
        for (const t of techs) {
          if (t.onlineStatus === 'offline') continue;
          const prev = trajectoryRef.current.get(t.id) ?? [];
          // 避免重复点
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            if (last.mapX === t.mapX && last.mapY === t.mapY) continue;
          }
          const next = [...prev, { mapX: t.mapX, mapY: t.mapY }];
          if (next.length > 10) next.shift();
          trajectoryRef.current.set(t.id, next);
        }
      }).catch(() => { /* 失败静默，保留上次数据 */ });
    };

    fetch(); // 首次立即拉取
    timer = setInterval(fetch, 15000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  /* ---------- 1.7 选中设备时重建人员动线（含派工指引虚线） ---------- */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    // 选中设备时，即便"技师轨迹与指引线"总开关关着也要建这一层：
    // 需求口径是「选中哪台设备，就看它相关的那条链路」—— 聚焦层的派工指引虚线
    // （技师 → 设备）要照常出现。技师人形与历史轨迹仍跟随总开关
    // （scene 侧把指引虚线单独成层，见 scene.ts 的 guideGroup）。
    const needGuide = !!selectedId;
    if (!showWorkers && !needGuide) {
      if (workerLayerBuiltRef.current) {
        scene.clearWorkers();
        workerLayerBuiltRef.current = false;
      }
      scene.setWorkerVisible(false);
      return;
    }
    // 找当前选中设备工单的 assignee
    let assigneeId: string | null = null;
    let assigneeStatus: string | null = null;
    if (selectedId && recentOrders.length > 0) {
      // 优先找紧急/高优工单的 assignee
      const urgent = recentOrders.find(
        (o) => (o.priority === 'urgent' || o.priority === 'high') && o.assigneeId,
      );
      if (urgent) {
        assigneeId = urgent.assigneeId!;
        assigneeStatus = urgent.status;
      }
    }
    scene.buildWorkers(technicians, trajectoryRef.current, selectedId, assigneeId, assigneeStatus);
    workerLayerBuiltRef.current = true;
    scene.setWorkerVisible(showWorkers);
  }, [technicians, selectedId, recentOrders, showWorkers]);

  return { showWorkers, setShowWorkers, technicians, trajectoryRef, workerLayerBuiltRef };
}
