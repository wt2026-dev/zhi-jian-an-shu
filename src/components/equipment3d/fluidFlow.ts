import * as THREE from 'three';
import { DEVICE_FLUID_TYPES, type FluidMedium } from './deviceProfiles';
import type { DeviceSlot } from './hall';

export interface FluidWaypoint {
  pos: [number, number, number];
  partKey?: string;
}

export interface DeviceFluidPath {
  deviceId: string;
  medium: FluidMedium;
  color: number;
  waypoints: FluidWaypoint[];
  isLoop: boolean;
}

// 预计算 10 台有介质设备的管路/油路流动骨架路径（来自设备 RecipePart 坐标）
export const FLUID_PATHS: Record<string, DeviceFluidPath> = {
  // eq-101: 1#离心水泵 —— 水介质，双竖直大弯管 + 蜗壳
  'eq-101': {
    deviceId: 'eq-101',
    medium: 'water',
    color: 0x38bdf8,
    isLoop: false,
    waypoints: [
      { pos: [-1.48, 5.26, 0], partKey: 'elbowS' },
      { pos: [-1.0, 5.26, 0], partKey: 'elbowS' },
      { pos: [-1.0, 3.8, 0], partKey: 'riserS' },
      { pos: [-1.0, 1.2, 0], partKey: 'riserS' },
      { pos: [-0.4, 1.06, 0], partKey: 'volute' },
      { pos: [0.4, 1.06, 0], partKey: 'volute' },
      { pos: [1.0, 1.2, 0], partKey: 'riserD' },
      { pos: [1.0, 3.8, 0], partKey: 'riserD' },
      { pos: [1.0, 5.26, 0], partKey: 'elbowD' },
      { pos: [1.48, 5.26, 0], partKey: 'elbowD' },
    ],
  },
  // eq-102: 2#空压机 —— 浅青色，进气管 -> 螺杆转子腔 -> 出气管
  'eq-102': {
    deviceId: 'eq-102',
    medium: 'air',
    color: 0x67e8f9,
    isLoop: false,
    waypoints: [
      { pos: [1.15, 3.6, 0], partKey: 'pipeIn' },
      { pos: [1.15, 2.5, 0], partKey: 'pipeIn' },
      { pos: [0.6, 1.68, 0.2], partKey: 'rotorA' },
      { pos: [0.0, 1.68, 0.2], partKey: 'rotorA' },
      { pos: [-0.6, 1.68, 0.2], partKey: 'rotorB' },
      { pos: [-1.15, 2.5, 0], partKey: 'pipeOut' },
      { pos: [-1.15, 3.6, 0], partKey: 'pipeOut' },
    ],
  },
  // eq-103: 3#减速箱 —— 金色润滑油，独立油站竖罐 -> 铜管 -> 箱体 -> 底座循环
  'eq-103': {
    deviceId: 'eq-103',
    medium: 'oil',
    color: 0xfbbf24,
    isLoop: true,
    waypoints: [
      { pos: [2.4, 4.0, 1.7], partKey: 'oilTank' },
      { pos: [1.8, 4.0, 1.3], partKey: 'oilPipeB' },
      { pos: [1.55, 2.8, 0.85], partKey: 'oilPipeB' },
      { pos: [1.55, 1.2, 0.85], partKey: 'oilPipeA' },
      { pos: [0.8, 1.2, 0.4], partKey: 'housing' },
      { pos: [0.0, 1.4, 0.0], partKey: 'housing' },
      { pos: [-0.6, 1.4, 0.0], partKey: 'housing' },
      { pos: [0.0, 0.8, 0.0], partKey: 'base' },
      { pos: [1.2, 0.6, 0.8], partKey: 'base' },
      { pos: [2.2, 0.6, 1.6], partKey: 'oilSkid' },
      { pos: [2.4, 1.5, 1.7], partKey: 'oilTank' },
      { pos: [2.4, 3.0, 1.7], partKey: 'oilTank' },
    ],
  },
  // eq-105: 5#多级泵 —— 水介质，进水管 -> 8 级多级长筒体 -> 出水管
  'eq-105': {
    deviceId: 'eq-105',
    medium: 'water',
    color: 0x38bdf8,
    isLoop: false,
    waypoints: [
      { pos: [-4.3, 1.5, 0], partKey: 'inPipe' },
      { pos: [-3.7, 1.5, 0], partKey: 'inPipe' },
      { pos: [-2.8, 1.5, 0], partKey: 'stage0' },
      { pos: [-1.4, 1.5, 0], partKey: 'stage2' },
      { pos: [0.0, 1.5, 0], partKey: 'stage4' },
      { pos: [1.4, 1.5, 0], partKey: 'stage6' },
      { pos: [2.1, 1.5, 0], partKey: 'stage7' },
      { pos: [3.7, 1.5, 0], partKey: 'outPipe' },
      { pos: [4.3, 1.5, 0], partKey: 'outPipe' },
    ],
  },
  // eq-106: 6#工艺空压机 —— 浅青色，进气导叶 -> 蜗壳剖分面 -> 顶部排气管
  'eq-106': {
    deviceId: 'eq-106',
    medium: 'air',
    color: 0x67e8f9,
    isLoop: false,
    waypoints: [
      { pos: [-3.4, 2.15, 0], partKey: 'inPipe' },
      { pos: [-2.2, 2.15, 0], partKey: 'inPipe' },
      { pos: [-1.4, 2.15, 0], partKey: 'inletCone' },
      { pos: [0.0, 2.15, 0], partKey: 'volute' },
      { pos: [0.85, 2.6, 0], partKey: 'outPipe' },
      { pos: [0.85, 4.0, 0], partKey: 'outPipe' },
      { pos: [0.85, 5.3, 0], partKey: 'outPipe' },
    ],
  },
  // eq-107: 7#减速机 —— 金色润滑油，齿轮箱内部飞溅循环
  'eq-107': {
    deviceId: 'eq-107',
    medium: 'oil',
    color: 0xfbbf24,
    isLoop: true,
    waypoints: [
      { pos: [-1.2, 1.2, 0.4], partKey: 'body' },
      { pos: [0.0, 1.6, 0.4], partKey: 'body' },
      { pos: [1.1, 2.1, 0.1], partKey: 'sight' },
      { pos: [1.2, 1.2, -0.4], partKey: 'body' },
      { pos: [0.0, 0.6, -0.4], partKey: 'body' },
      { pos: [-1.2, 0.6, 0.0], partKey: 'body' },
    ],
  },
  // eq-111: 11#板式换热器 —— 水介质，四角接管与板片组换热通道
  'eq-111': {
    deviceId: 'eq-111',
    medium: 'water',
    color: 0x38bdf8,
    isLoop: false,
    waypoints: [
      { pos: [-1.2, 2.5, -0.62], partKey: 'nozzle0' },
      { pos: [-0.72, 2.1, -0.3], partKey: 'plateHead' },
      { pos: [0.0, 1.85, -0.2], partKey: 'plate5' },
      { pos: [0.7, 2.5, -0.62], partKey: 'nozzle2' },
      { pos: [0.7, 2.5, 0.62], partKey: 'nozzle3' },
      { pos: [0.0, 2.1, 0.2], partKey: 'plate5' },
      { pos: [-0.72, 1.85, 0.3], partKey: 'plateHead' },
      { pos: [-1.2, 2.5, 0.62], partKey: 'nozzle1' },
    ],
  },
  // eq-112: 12#结晶器泵 —— 水介质，主通道与部件坐标（介质是否流动完全由真实遥测驱动）
  'eq-112': {
    deviceId: 'eq-112',
    medium: 'water',
    color: 0x38bdf8,
    isLoop: false,
    waypoints: [
      { pos: [-2.4, 1.5, 0], partKey: 'suction' },
      { pos: [-1.6, 1.5, 0], partKey: 'suction' },
      { pos: [-1.0, 1.5, 0], partKey: 'casing' },
      { pos: [-1.0, 2.4, 0], partKey: 'dischargeElbow' },
      { pos: [-1.0, 3.2, 0], partKey: 'discharge' },
      { pos: [-1.0, 4.4, 0], partKey: 'discharge' },
    ],
  },
  // eq-113: 13#制冷机组 —— 浅青色制冷剂，螺杆 -> 油分离器 -> 冷凝器
  'eq-113': {
    deviceId: 'eq-113',
    medium: 'air',
    color: 0x67e8f9,
    isLoop: false,
    waypoints: [
      { pos: [-1.8, 1.5, 0], partKey: 'screw' },
      { pos: [-0.8, 1.5, 0], partKey: 'screw' },
      { pos: [-0.35, 1.5, -0.4], partKey: 'pipeA' },
      { pos: [0.5, 1.8, -0.55], partKey: 'separator' },
      { pos: [1.2, 2.4, -0.2], partKey: 'pipeB' },
      { pos: [1.2, 2.9, 0.3], partKey: 'pipeC' },
      { pos: [0.4, 1.2, 0.85], partKey: 'condenser' },
      { pos: [-0.5, 0.95, 0.85], partKey: 'condenser' },
    ],
  },
  // eq-116: 16#热管换热器 —— 水/工质，风道 -> 竖直管束 -> 顶箱
  'eq-116': {
    deviceId: 'eq-116',
    medium: 'water',
    color: 0x38bdf8,
    isLoop: false,
    waypoints: [
      { pos: [-3.8, 1.5, 0], partKey: 'ductB' },
      { pos: [-2.5, 1.5, 0], partKey: 'ductA' },
      { pos: [-1.2, 1.8, 0], partKey: 'casing' },
      { pos: [-0.5, 2.8, 0.3], partKey: 'casingTrim' },
      { pos: [0.5, 2.8, -0.3], partKey: 'casingTrim' },
      { pos: [0.0, 3.62, 0], partKey: 'topHeader' },
      { pos: [1.5, 3.62, 0], partKey: 'topHeader' },
    ],
  },
};

interface Particle {
  t: number;             // 沿路径进度 [0, 1)
  speed: number;         // 基础流动速度
  phase: number;         // 随机偏移
  pathIndex: number;     // 属于哪个设备路径
}

/** Caller-supplied measurements only; omitted/non-finite fields are unavailable, not defaults. */
export interface FluidTelemetry {
  status?: string;
  loadRate?: number;
  rpm?: number;
}

const finiteMeasurement = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Schematic animation rate, not measured flow or a hydraulic diagnosis. */
function schematicSpeed(data: FluidTelemetry | undefined): number {
  if (!data || (data.status !== 'running' && data.status !== 'warning')) return 0;
  const { loadRate, rpm } = data;
  // A reported zero/negative measurement must not be replaced by another positive signal.
  if ((loadRate !== undefined && loadRate <= 0) || (rpm !== undefined && rpm <= 0)) return 0;
  if (loadRate !== undefined && rpm !== undefined) {
    return Math.min(loadRate / 100, 2) * Math.min(rpm / 1500, 2);
  }
  if (loadRate !== undefined) return Math.min(loadRate / 100, 2);
  if (rpm !== undefined) return Math.min(rpm / 1500, 2);
  return 0;
}

const MAX_TOTAL_OVERVIEW_PARTICLES = 450; // ≤ 600
const MAX_ISOLATED_PARTICLES = 220;      // ≤ 400

export class FluidFlowSystem {
  points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private positions: Float32Array;
  private colors: Float32Array;

  private activeDeviceIds: string[] = [];
  private deviceSlots: Map<string, { x: number; y: number; z: number; angle: number; scale: number }> = new Map();
  private deviceTelemetry: Map<string, FluidTelemetry> = new Map();

  private particles: Particle[] = [];

  private isolationId: string | null = null;
  private isVisible = true;
  private explodedGroup: THREE.Group | null = null;
  private explodedDeviceId: string | null = null;

  // 临时数学计算量
  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpPos = new THREE.Vector3();
  private tmpColor = new THREE.Color();

  constructor() {
    const totalMax = Math.max(MAX_TOTAL_OVERVIEW_PARTICLES, MAX_ISOLATED_PARTICLES);
    this.positions = new Float32Array(totalMax * 3);
    this.colors = new Float32Array(totalMax * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.PointsMaterial({
      size: 0.32,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'fluidFlowPoints';
    this.points.userData.visualization = 'schematic';
    this.points.userData.description = '介质路径示意：由负载/转速驱动，不代表实测流量或泄漏诊断';
    this.points.frustumCulled = false;
  }

  /** 更新场景内设备槽位与空间布局（当设备构建完成或位置调整时调用） */
  updateSlots(
    slots: DeviceSlot[],
    devices: Array<{ id: string }>,
    reliefAt: (x: number, z: number) => number,
    equipmentScale = 1
  ): void {
    this.deviceSlots.clear();
    this.activeDeviceIds = [];

    for (let i = 0; i < devices.length; i++) {
      const id = devices[i].id;
      const s = slots[i];
      if (!s) continue;
      // 只有在介质白名单内的设备才分配粒子；电机/CNC/机器人严格不分配
      if (!DEVICE_FLUID_TYPES[id] || !FLUID_PATHS[id]) continue;

      const y = reliefAt(s.x, s.z);
      this.deviceSlots.set(id, {
        x: s.x,
        y,
        z: s.z,
        angle: s.angle,
        scale: equipmentScale,
      });
      this.activeDeviceIds.push(id);
    }

    this.rebuildParticles();
  }

  /** 状态与遥测更新：来自设备台账、回放或覆盖（仅真实数值，缺测不补默认值） */
  setDeviceTelemetry(deviceId: string, data: FluidTelemetry): void {
    this.deviceTelemetry.set(deviceId, {
      status: data.status,
      loadRate: finiteMeasurement(data.loadRate),
      rpm: finiteMeasurement(data.rpm),
    });
    // Invalidate stale rendered flow until the next scene update evaluates this snapshot.
    this.geometry.setDrawRange(0, 0);
  }

  /** 开关控制 */
  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.points.visible = visible;
  }

  /** 独占模式控制 */
  setIsolation(deviceId: string | null): void {
    this.isolationId = deviceId;
    if (deviceId) {
      this.material.size = 0.72; // 独占模式放大粒子更醒目
      this.material.opacity = 0.95;
    } else {
      this.material.size = 0.32;
      this.material.opacity = 0.88;
    }
    this.rebuildParticles();
  }

  /** 拆解视图状态 */
  setExploded(deviceId: string | null, isExploded: boolean, explodedGroup: THREE.Group | null): void {
    if (isExploded && deviceId) {
      this.explodedDeviceId = deviceId;
      this.explodedGroup = explodedGroup;
    } else {
      this.explodedDeviceId = null;
      this.explodedGroup = null;
    }
  }

  /** 重建粒子分布 */
  private rebuildParticles(): void {
    this.particles = [];

    if (this.isolationId) {
      // 独占模式：仅为选中设备分配高密度粒子
      if (!FLUID_PATHS[this.isolationId]) {
        this.geometry.setDrawRange(0, 0);
        return;
      }
      const count = MAX_ISOLATED_PARTICLES;
      for (let i = 0; i < count; i++) {
        this.particles.push({
          t: i / count,
          speed: 0.15 + (i % 5) * 0.01,
          phase: Math.random() * Math.PI * 2,
          pathIndex: this.activeDeviceIds.indexOf(this.isolationId),
        });
      }
    } else {
      // 总览模式：10 台设备均分粒子
      if (!this.activeDeviceIds.length) {
        this.geometry.setDrawRange(0, 0);
        return;
      }
      const perDevice = Math.floor(MAX_TOTAL_OVERVIEW_PARTICLES / this.activeDeviceIds.length);
      for (let dIdx = 0; dIdx < this.activeDeviceIds.length; dIdx++) {
        for (let i = 0; i < perDevice; i++) {
          this.particles.push({
            t: i / perDevice,
            speed: 0.16 + (i % 4) * 0.015,
            phase: Math.random() * Math.PI * 2,
            pathIndex: dIdx,
          });
        }
      }
    }

    // Allocation is not telemetry evidence; only update() may expose eligible particles.
    this.geometry.setDrawRange(0, 0);
  }

  /** 帧更新循环（由 scene.ts 的 update(dt) 同步调用，零额外 RAF 开销） */
  update(dt: number, animTime: number): void {
    if (!this.isVisible) return;

    let writeIdx = 0;
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = this.geometry.attributes.color as THREE.BufferAttribute;

    // 1. 更新主管道粒子
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const devId = this.activeDeviceIds[p.pathIndex];
      if (!devId) continue;

      const path = FLUID_PATHS[devId];
      const slot = this.deviceSlots.get(devId);
      if (!path || !slot) continue;

      const speedScale = schematicSpeed(this.deviceTelemetry.get(devId));
      // No measured flow sensor: this is a schematic cue only. Missing telemetry or
      // fault/standby/unknown status suppresses the cue, not evidence of a blockage.
      if (speedScale <= 0) continue;
      p.t = (p.t + dt * p.speed * speedScale) % 1;

      // 根据进度 t 获取折线路径上的插值坐标
      this.interpolatePath(path, p.t, slot, devId, this.tmpPos);

      // 加一点细微横截面抖动，使粒子在管道截面内有分布感
      const wobble = 0.04;
      this.positions[writeIdx * 3] = this.tmpPos.x + Math.sin(animTime * 3 + p.phase) * wobble;
      this.positions[writeIdx * 3 + 1] = this.tmpPos.y + Math.cos(animTime * 4 + p.phase) * wobble;
      this.positions[writeIdx * 3 + 2] = this.tmpPos.z + Math.sin(animTime * 2.5 + p.phase) * wobble;

      // Schematic medium color; status does not diagnose fluid damage.
      this.tmpColor.setHex(path.color);
      this.colors[writeIdx * 3] = this.tmpColor.r;
      this.colors[writeIdx * 3 + 1] = this.tmpColor.g;
      this.colors[writeIdx * 3 + 2] = this.tmpColor.b;

      writeIdx++;
    }

    // 隐藏剩余缓冲区粒子
    for (let i = writeIdx; i < this.positions.length / 3; i++) {
      this.positions[i * 3 + 1] = -9999;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, writeIdx);
  }

  /** 计算路径插值位置（无缝适配独占、旋转与拆解视图位移） */
  private interpolatePath(
    path: DeviceFluidPath,
    t: number,
    slot: { x: number; y: number; z: number; angle: number; scale: number },
    deviceId: string,
    out: THREE.Vector3
  ): void {
    const pts = path.waypoints;
    if (pts.length < 2) {
      out.set(slot.x, slot.y, slot.z);
      return;
    }

    // 映射进度到线段索引
    const segmentCount = path.isLoop ? pts.length : pts.length - 1;
    const scaledT = t * segmentCount;
    const indexA = Math.floor(scaledT) % pts.length;
    const indexB = (indexA + 1) % pts.length;
    const segT = scaledT - Math.floor(scaledT);

    const wpA = pts[indexA];
    const wpB = pts[indexB];

    // 获取考虑拆解视图后的世界坐标
    this.getWaypointWorldPos(wpA, slot, deviceId, this.tmpV1);
    this.getWaypointWorldPos(wpB, slot, deviceId, this.tmpV2);

    out.lerpVectors(this.tmpV1, this.tmpV2, segT);
  }

  /** 获取单路径点的世界坐标（关键：拆解视图时与部件 Mesh 空间绑定） */
  private getWaypointWorldPos(
    wp: FluidWaypoint,
    slot: { x: number; y: number; z: number; angle: number; scale: number },
    deviceId: string,
    out: THREE.Vector3
  ): void {
    // 1. 基准世界变换（无拆解时）
    out.set(wp.pos[0] * slot.scale, wp.pos[1] * slot.scale, wp.pos[2] * slot.scale);
    out.applyAxisAngle(THREE.Object3D.DEFAULT_UP, slot.angle);
    out.x += slot.x;
    out.y += slot.y;
    out.z += slot.z;

    // 2. 若当前设备处于拆解视图，且该点绑定了拆解部件，加上部件展开位移！
    if (this.explodedDeviceId === deviceId && this.explodedGroup && wp.partKey) {
      const explodedMesh = this.explodedGroup.getObjectByName(`exploded_${wp.partKey}`);
      if (explodedMesh) {
        // 在 ExplodedView 中，mesh.position 从 originalMatrix 位置 lerp 到 targetPos
        // 所以 mesh.position 相对于初始位置的位移就是爆炸位移量
        const origX = explodedMesh.userData?.origX ?? explodedMesh.position.x;
        // 如果没有 userData 缓存，可以直接从 mesh 当前 position 获得位移
        // 实际上 ExplodedView 在创建时设置了 mesh.position.setFromMatrixPosition(part.originalMatrix)
        if (explodedMesh.userData?.origWorldPos) {
          const delta = explodedMesh.position.clone().sub(explodedMesh.userData.origWorldPos);
          out.add(delta);
        } else if (explodedMesh.parent) {
          // mesh 展开后的位置直接反映其空间位置
          // 加上沿 unfold 轴的偏移
          const dy = explodedMesh.position.y - out.y;
          if (Math.abs(dy) > 0.05) {
            out.y += dy * 0.85;
          }
        }
      }
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
