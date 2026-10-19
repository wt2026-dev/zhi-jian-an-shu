/**
 * cameraFraming.ts — 单设备聚焦取景数学（纯函数，无 three 场景依赖）。
 *
 * 从 scene.ts 的 frameIsolated 抽出（CameraRig 拆解第一步）：
 * 取景是纯几何计算，抽出后可以直接对"任意纵横比角点适配""俯角 33°""防贴脸
 * 半径下限"写单元测试，不必再拉起整个 3200 行场景类。
 *
 * 反解思路（为什么不是 d = h/(2·FILL·tan(fov/2))）：
 * 那个公式假设屏幕竖直方向只由设备高度决定，只有在相机水平正视时成立。
 * 本场景相机是俯视的（phi≈1.0，仰角约 33°），设备的**长度**也会"倒"进
 * 屏幕竖直方向。所以这里把包围盒 8 个角变换到世界坐标，按相机基向量
 * (right/up) 反解每个角要求的最小距离取最大值——对俯角、设备朝向、
 * 透视全部成立（含 targetY 高度偏移的折算）。
 */

import * as THREE from 'three';

export interface FramingBox {
  w: number;
  h: number;
  d: number;
  x: number;
  z: number;
  /** 设备底面高度 */
  y?: number;
  centerX?: number;
  centerY?: number;
  centerZ?: number;
}

export interface FramingCameraParams {
  /** 垂直视场角（度） */
  fov: number;
  aspect: number;
  near: number;
}

export interface FramingOptions {
  /** 槽位朝向角（设备绕 Y 轴） */
  slotAngle?: number;
  /** 对准点高度（传入时取景中心按其折算；聚焦机位居中口径下通常不传） */
  targetY?: number;
  /** 保留当前方位/俯仰（只调距离） */
  preserveAngles?: boolean;
  currentPhi?: number;
  currentTheta?: number;
  minPhi?: number;
  maxPhi?: number;
  /** 包围盒占画面的目标比例（角点 NDC 上限）。缺省 0.9 ≈ 设备占高度 55%。 */
  fill?: number;
}

export interface FramingResult {
  target: THREE.Vector3;
  minRadius: number;
  maxRadius: number;
  radius: number;
  phi: number;
  theta: number;
  /** 包围盒外接球半径（供轨道限位复用） */
  boundingRadius: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function computeIsolatedFraming(
  box: FramingBox,
  cam: FramingCameraParams,
  opts: FramingOptions = {},
): FramingResult {
  const o = {
    slotAngle: opts.slotAngle ?? 0,
    fill: opts.fill ?? 0.9,
    minPhi: opts.minPhi ?? 0.06,
    maxPhi: opts.maxPhi ?? 1.52,
  };

  const vHalf = (cam.fov * Math.PI) / 360;
  const tanV = Math.tan(vHalf);
  const tanH = tanV * Math.max(0.001, cam.aspect);

  // 俯仰：默认 1.0 rad ≈ 33° 俯角（25-35° 观感区间），保证基座与顶部同框
  const phi = opts.preserveAngles && opts.currentPhi !== undefined
    ? clamp(opts.currentPhi, o.minPhi, o.maxPhi)
    : clamp(1.0, o.minPhi, o.maxPhi);
  const theta = opts.preserveAngles && opts.currentTheta !== undefined
    ? opts.currentTheta
    : o.slotAngle + 0.6;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  // u = 目标 → 相机 的单位向量
  const ux = sinPhi * Math.sin(theta);
  const uy = cosPhi;
  const uz = sinPhi * Math.cos(theta);
  // 相机基向量（与 three.js lookAt(worldUp=(0,1,0)) 一致）
  let rx = uz;
  let rz = -ux;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ry = 0;
  const upx = uy * rz - uz * ry;
  const upy = uz * rx - ux * rz;
  const upz = ux * ry - uy * rx;

  const hw = box.w / 2;
  const hd = box.d / 2;
  const yMid = box.h / 2;
  const baseCenterY = box.centerY ?? box.y + yMid;
  const dy = opts.targetY === undefined ? 0 : opts.targetY - baseCenterY;

  const denomV = o.fill * tanV;
  const denomH = o.fill * tanH;

  const a = o.slotAngle;
  const ca = Math.cos(a);
  const sa = Math.sin(a);

  let need = 0;
  for (const lx of [-hw, hw]) {
    for (const ly of [0, box.h]) {
      for (const lz of [-hd, hd]) {
        const px = lx * ca + lz * sa;
        const pz = -lx * sa + lz * ca;
        const py = ly - yMid - dy;
        const pU = px * ux + py * uy + pz * uz;
        const pR = px * rx + pz * rz;
        const pUp = px * upx + py * upy + pz * upz;
        const r = pU + Math.max(Math.abs(pR) / denomH, Math.abs(pUp) / denomV);
        if (r > need) need = r;
      }
    }
  }

  const minRadius = Math.max(cam.near * 2, Math.min(box.w, box.h, box.d) * 0.6);
  const maxRadius = Math.max(need * 3, minRadius * 4);
  // 轨道半径下限：外接球半径 1.8 倍（防贴脸）；上限仅在自动取景偏近时生效
  const boundingRadius = 0.5 * Math.sqrt(box.w * box.w + box.h * box.h + box.d * box.d);
  const radius = clamp(Math.max(need, boundingRadius * 1.8), minRadius, maxRadius);

  return {
    target: new THREE.Vector3(box.centerX ?? box.x, baseCenterY + dy, box.centerZ ?? box.z),
    minRadius,
    maxRadius,
    radius,
    phi,
    theta,
    boundingRadius,
  };
}

/**
 * 厂房/预设整体取景距离（自 scene.ts 的 fitDistance 抽出，同为纯几何）。
 *
 * 为什么不用「包围球 / sin(fov/2)」：本场景是扁而宽的厂房，包围球半径会被
 * 水平跨度撑大，导致垂直方向严重留白（实测原预设距离 118 时厂房只占画面 15%）。
 * 这里分别求水平、垂直两个方向所需距离取较大者。
 */
export function computeFitDistance(params: {
  /** 相机垂直视场角（度） */
  fov: number;
  aspect: number;
  /** 厂房水平半跨（halfX/halfZ 的合成对角） */
  halfX: number;
  halfZ: number;
  /** 厂房结构高度 */
  structureHeight: number;
  /** 预设的取景意图距离（退化为倍率：120 ≈ 1.0，保留各预设"想更近/更远"的意图） */
  presetDistance: number;
}): number {
  const vHalf = (params.fov * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.4, params.aspect));
  const halfW = Math.hypot(params.halfX, params.halfZ) * 0.86;
  const halfH = Math.max(6, params.structureHeight) * 0.5;
  const dH = halfW / Math.tan(hHalf);
  const dV = halfH / Math.tan(vHalf);
  const k = clamp(params.presetDistance / 120, 0.8, 1.4);
  return Math.max(dH, dV) * 1.3 * k;
}
