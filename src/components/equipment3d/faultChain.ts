/**
 * 故障传播链层 —— 选中设备的超阈遥测读数标注（车间/聚焦层叠加物）。
 *
 * 口径红线：这些是真实读数的「观测」标注，不是已证实的部件级故障结论，
 * 节点之间不连线（有单测守护：children 里不许出现 fault-line/flow/node 或 Line）。
 *
 * 场景侧负责把设备 id 解析成世界坐标锚点与包围盒后传入；
 * 文字贴片由调用方注入 labelFactory（深色底板 + 彩色边线 + canvas 贴图方案），
 * 测试替身借此拦截文案断言。
 */

import * as THREE from 'three';
import { telemetryToStatus } from './statusMapping';

export interface FaultChainTelemetryPoint {
  temperature?: number;
  vibration?: number;
  pressure?: number;
  current?: number;
  loadRate?: number;
}

export interface FaultChainOrder {
  priority?: string;
  status?: string;
}

/** 设备锚点：slot 世界坐标 + 地形高度（场景侧解析）。 */
export interface FaultChainAnchor {
  x: number;
  y: number;
  z: number;
}

/** 设备包围盒（boxById 条目的子集）。 */
export interface FaultChainBox {
  h: number;
  centerX?: number;
  centerY?: number;
  centerZ?: number;
}

export type FaultLabelFactory = (text: string, accentColor: number, w: number, h: number) => THREE.Object3D;

/** 与 EquipmentScene.disposeGroup 同语义：共享几何不销毁，材质全销毁。 */
function disposeChildren(group: THREE.Object3D): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean; dispose?: () => void };
    if (mesh.isInstancedMesh && typeof mesh.dispose === 'function') mesh.dispose();
    const g = mesh.geometry as THREE.BufferGeometry | undefined;
    if (g && !g.userData?.shared) g.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (m) {
      const list = Array.isArray(m) ? m : [m];
      for (const mat of list) mat.dispose();
    }
  });
  group.clear();
}

export class FaultChain {
  readonly group = new THREE.Group();
  private nodes: THREE.Object3D[] = [];
  private lines: Array<{
    mesh: THREE.Line;
    mat: THREE.LineBasicMaterial;
    flowMat: THREE.MeshBasicMaterial;
  }> = [];
  private labels: THREE.Object3D[] = [];

  /**
   * 构建故障传播链3D（先整体清空旧内容；取最近一个遥测点判断超限项，
   * 无有限读数或无超限项时保持空层）。
   */
  build(
    eqId: string,
    anchor: FaultChainAnchor,
    box: FaultChainBox,
    telemetryPoints: FaultChainTelemetryPoint[] | null,
    createLabel: FaultLabelFactory,
  ): void {
    this.clear();

    // 取最近一个遥测点判断超限项
    const tp = telemetryPoints && telemetryPoints.length > 0 ? telemetryPoints[telemetryPoints.length - 1] : null;
    if (!tp) return;
    const nodeData: Array<{ text: string; color: number }> = [];
    const metrics = [
      ['temperature', '温度', '°C'],
      ['vibration', '振动', 'mm/s'],
      ['loadRate', '负载', '%'],
    ] as const;
    for (const [key, label, unit] of metrics) {
      const value = tp[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const severity = telemetryToStatus({ [key]: value });
      if (severity) nodeData.push({ text: `观测：${label} ${value}${unit}`, color: severity === 'warning' ? 0xf59e0b : 0xef4444 });
    }
    if (nodeData.length === 0) return;
    // 观测声明：这些是真实读数的标注，不是已证实的部件级故障结论，也不互相连线。
    nodeData.push({ text: '超阈读数观测 · 非部件故障结论', color: 0x94a3b8 });

    const boxH = box.h;
    const baseX = box.centerX ?? anchor.x;
    const baseY = (box.centerY ?? anchor.y + boxH + 0.8) + boxH / 2;
    const baseZ = box.centerZ ?? anchor.z;
    const spacing = 1.6;
    const offsetX = 2.2; // 设备侧向偏移
    const angleStep = nodeData.length > 1 ? Math.PI / (nodeData.length * 2 + 2) : 0;

    for (let i = 0; i < nodeData.length; i++) {
      const nd = nodeData[i];
      const angle = -Math.PI / 4 + angleStep * (i + 1);
      const nx = baseX + offsetX + i * spacing * Math.cos(angle);
      const ny = baseY + i * 0.6;
      const nz = baseZ + Math.sin(angle) * 0.4;

      // 文字标签（深色底板 + 彩色边线 + canvas 贴图，复用安全标签方案）
      const label = createLabel(nd.text, nd.color, 0.88, 0.24);
      label.position.set(nx, ny, nz);
      label.name = `fault-observation:${eqId}:${i}`;
      this.group.add(label);
      this.labels.push(label);
    }
  }

  /** 故障传播链动画（合并进现有 RAF 循环） */
  animate(time: number): void {
    if (this.lines.length === 0) return;

    for (let i = 0; i < this.lines.length; i++) {
      const { mat, flowMat } = this.lines[i];

      // 连线脉冲：透明度随正弦波波动
      mat.opacity = 0.45 + 0.35 * Math.sin(time * 3.0 + i * 1.2);

      // 流动粒子：在连线段内循环前进
      const t = (time * 0.5 + i * 0.35) % 1.0;
      flowMat.opacity = 0.5 + 0.4 * Math.sin(time * 4.0 + i * 2.0);
      // flow 位置由 nodePositions 插值驱动——因为节点位置不变，这里用脉冲透明度模拟流动
    }

    // 节点脉冲（呼吸灯效果）
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i] as THREE.Mesh;
      const mat = node.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.65 + 0.3 * Math.sin(time * 2.5 + i * 0.8);
      const s = 1.0 + 0.12 * Math.sin(time * 2.5 + i * 0.8);
      node.scale.setScalar(s);
    }
  }

  /** 清空故障链（选中设备切换或退出时调用） */
  clear(): void {
    disposeChildren(this.group);
    this.nodes = [];
    this.lines = [];
    this.labels = [];
  }
}
