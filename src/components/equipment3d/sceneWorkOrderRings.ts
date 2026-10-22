/**
 * 工单状态指示环域（自 scene.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：设备级工单状态（pending / in_progress / completed）的共享圆环几何、
 * 红/黄/绿基础材质、按台账 id 落位重建、呼吸灯脉冲动画。状态映射由 React 层
 * 推过来（setWorkOrderIndicators），3D 层只消费。
 */
import * as THREE from 'three';
import type { EquipmentBuild } from './equipment';
import type { DeviceSlot, Hall } from './hall';

export type WorkOrderIndicatorStatus = 'pending' | 'in_progress' | 'completed';

export class SceneWorkOrderRings {
  // 工单状态指示环（共享几何体与红/黄/绿基础材质）
  private workOrderRingGeo: THREE.RingGeometry | null = null;
  private ringMatPending = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  private ringMatInProgress = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  private ringMatCompleted = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  private workOrderRings = new Map<string, { mesh: THREE.Mesh; status: WorkOrderIndicatorStatus; baseScale: number }>();
  private currentWorkOrderMap = new Map<string, WorkOrderIndicatorStatus>();

  constructor(private workOrderGroup: THREE.Group) {}

  init(): void {
    const geo = new THREE.RingGeometry(0.85, 1.0, 48);
    geo.rotateX(-Math.PI / 2);
    geo.userData.shared = true;
    this.workOrderRingGeo = geo;
  }

  /**
   * 设置工单状态指示环（设备级）
   * 映射表：equipmentId -> 'pending' | 'in_progress' | 'completed'
   */
  setWorkOrderIndicators(deviceStatusMap: Map<string, WorkOrderIndicatorStatus>): void {
    this.currentWorkOrderMap = new Map(deviceStatusMap);
  }

  /**
   * 释放域内资源（原 scene.dispose 中的环资源段，纯移动）：
   * 清实例表与状态映射、释放三种基础材质与共享几何。
   */
  dispose(): void {
    this.workOrderRings.clear();
    this.currentWorkOrderMap.clear();
    this.ringMatPending.dispose();
    this.ringMatInProgress.dispose();
    this.ringMatCompleted.dispose();
    if (this.workOrderRingGeo) {
      this.workOrderRingGeo.dispose();
      this.workOrderRingGeo = null;
    }
  }

  /**
   * 重建工单状态指示环实例
   */
  rebuildWorkOrderRings(equipment: EquipmentBuild | null, hall: Hall | null, slots: DeviceSlot[]): void {
    while (this.workOrderGroup.children.length > 0) {
      const child = this.workOrderGroup.children[0];
      this.workOrderGroup.remove(child);
    }
    this.workOrderRings.clear();

    if (!equipment || !hall || !this.workOrderRingGeo) return;

    this.currentWorkOrderMap.forEach((status, id) => {
      const idx = equipment?.indexById.get(id);
      if (typeof idx !== 'number' || !slots[idx]) return;

      const slot = slots[idx];
      const y = hall ? hall.reliefAt(slot.x, slot.z) : 0;

      let mat: THREE.MeshBasicMaterial;
      if (status === 'pending') {
        mat = this.ringMatPending;
      } else if (status === 'in_progress') {
        mat = this.ringMatInProgress;
      } else {
        mat = this.ringMatCompleted;
      }

      const mesh = new THREE.Mesh(this.workOrderRingGeo!, mat);
      mesh.position.set(slot.x, y + 0.05, slot.z);
      const baseScale = slot.radius * 2.25;
      mesh.scale.setScalar(baseScale);
      mesh.name = `workOrderRing_${id}`;
      this.workOrderGroup.add(mesh);
      this.workOrderRings.set(id, { mesh, status, baseScale });
    });
  }

  /**
   * 工单指示环脉冲动画（整合进已有 RAF 动画循环中）
   */
  animateWorkOrderRings(time: number): void {
    if (this.workOrderRings.size === 0) return;

    // 呼吸灯正弦波动：待检修(红)较快，检修中(黄)节奏更慢，已完成(绿)常亮
    const pendingPulse = Math.sin(time * 3.5);
    const inProgressPulse = Math.sin(time * 1.8);

    // 动态调整透明度（幅度克制，不刺眼）
    this.ringMatPending.opacity = 0.55 + 0.35 * pendingPulse;
    this.ringMatInProgress.opacity = 0.6 + 0.3 * inProgressPulse;
    this.ringMatCompleted.opacity = 0.85;

    const pendingScaleMult = 1.0 + 0.08 * pendingPulse;
    const progScaleMult = 1.0 + 0.05 * inProgressPulse;

    this.workOrderRings.forEach(({ mesh, status, baseScale }) => {
      if (status === 'pending') {
        mesh.scale.setScalar(baseScale * pendingScaleMult);
      } else if (status === 'in_progress') {
        mesh.scale.setScalar(baseScale * progScaleMult);
      } else {
        mesh.scale.setScalar(baseScale);
      }
    });
  }
}
