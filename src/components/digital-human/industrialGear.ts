/**
 * industrialGear.ts — 数字人"工业风装备"程序化装配
 *
 * 背景：三个 VRM（AvatarSample A/B/C）本身是三个不同的 VRoid 角色，
 * 但都偏日常休闲装，放在工业检修场景里辨识度不够。
 * 这里用**程序化几何**给每个角色挂上工业装备，实现"人设差异化 + 工业风"：
 *
 *   张工（机械总工）  → 蓝色安全帽 + 蓝色反光背心
 *   李工（电气工程师）→ 绿色安全帽 + 绿色反光背心
 *   小智（AI 巡检）   → 青色安全帽 + 青色反光背心
 *
 * ── 关键设计：尺寸必须"量"出来，不能拍脑袋写死 ──────────────────────
 * 第一版用固定比例（`torsoLen × 0.34` 估颅高、`torsoLen × 0.30` 估躯干半径）推导，
 * 实测**直接翻车**：安全帽整个陷进头发里，只剩帽檐在眉毛处露出一条横带；
 * 反光背心缩成胸前一个悬空的方盒子。原因是 VRoid 的发型体积远大于头骨，
 * 且三个模型的头身比差异很大。
 *
 * 现在改为**蒙皮感知的顶点采样**：用 `SkinnedMesh.getVertexPosition()`（three r152+，
 * 会应用骨骼变换）扫描真实网格顶点，在**头部/胸腔骨骼的局部坐标系**里量出
 * 头发外轮廓与躯干厚度，再据此定尺寸。换任何 VRM 都能自适应。
 *
 * 局部坐标约定（VRM normalized humanoid）：+Y 沿骨骼向上、+Z 为角色正面。
 */

import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';

/** 人设 → 工业装备配色 */
export interface GearPalette {
  /** 安全帽主色 */
  helmet: number;
  /** 反光背心主色 */
  vest: number;
  /** 反光条颜色 */
  stripe: number;
  /** 胸前徽章发光色 */
  badge: number;
  /** 人设标签（用于调试与无障碍） */
  label: string;
}

export const PERSONA_GEAR: Record<string, GearPalette> = {
  zhang: { helmet: 0x1d4ed8, vest: 0x2563eb, stripe: 0xe2e8f0, badge: 0x38bdf8, label: '张工·机械总工' },
  li:    { helmet: 0x15803d, vest: 0x16a34a, stripe: 0xe2e8f0, badge: 0x34d399, label: '李工·电气工程师' },
  zhi:   { helmet: 0x0e7490, vest: 0x06b6d4, stripe: 0xe2e8f0, badge: 0x67e8f9, label: '小智·AI 巡检' },
};

export function gearFor(personaId: string): GearPalette {
  return PERSONA_GEAR[personaId] || PERSONA_GEAR.zhang;
}

/* ────────────────────────── 材质 ────────────────────────── */

function pbr(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function emissive(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: 0.35,
    metalness: 0.1,
  });
}

/* ────────────────────────── 几何测量 ────────────────────────── */

/** 头部区域的实测尺寸（头骨骼局部坐标系） */
export interface HeadMeasure {
  /** 含头发在内的颅顶局部高度 */
  topY: number;
  /** 含头发在内的头部水平半径 */
  radius: number;
  /** 参与统计的顶点数（诊断用，证明测量确实跑了） */
  sampled: number;
  /** 分布诊断（验收脚本读取，用于判断"离群点是否被正确剔除"） */
  debug?: { p50: number; p90: number; p99: number; max: number };
}

/** 躯干区域的实测尺寸（胸腔骨骼局部坐标系） */
export interface TorsoMeasure {
  /** 躯干前后半深（不含手臂，|z| 统计天然排除体侧手臂） */
  halfDepth: number;
  /** 躯干顶部相对胸腔骨骼的局部高度 */
  topY: number;
  /** 躯干底部相对胸腔骨骼的局部高度（负值） */
  bottomY: number;
  /** 参与统计的顶点数（诊断用） */
  sampled: number;
  /** 分布诊断 */
  debug?: { p50: number; p90: number; p99: number; max: number };
}

export interface GearMeasurement {
  personaId: string;
  torsoLen: number;
  head: HeadMeasure;
  torso: TorsoMeasure;
  /** 本次装配扫描的顶点总数 */
  sampledVertices: number;
}

/** 蒙皮后的网格世界包围盒（SkinnedMesh.computeBoundingBox 是蒙皮感知的） */
function meshWorldBox(mesh: THREE.SkinnedMesh): THREE.Box3 {
  mesh.computeBoundingBox();
  const b = (mesh.boundingBox ?? mesh.geometry.boundingBox)?.clone();
  if (!b) return new THREE.Box3();
  return b.applyMatrix4(mesh.matrixWorld);
}

/**
 * 扫描所有蒙皮网格顶点，把落在 [worldYMin, worldYMax] 区间内的点变换到
 * `bone` 的局部坐标系后交给回调。用世界 Y 区间预筛 + 网格包围盒预筛控制开销。
 *
 * ⚠️ 踩坑记录：`SkinnedMesh.getVertexPosition()` 返回的是**网格自身局部坐标系**的
 * 顶点（内部以 `bindMatrixInverse` 收尾），**不是世界坐标**。第一版漏了
 * `applyMatrix4(sm.matrixWorld)`，于是所有测量值被整体放大 2–3 倍 ——
 * 表现就是安全帽大成一顶蘑菇伞、反光背心胀成一个大桶。必须补上这一步。
 */
function scanVertices(
  root: THREE.Object3D,
  bone: THREE.Object3D,
  worldYMin: number,
  worldYMax: number,
  visit: (local: THREE.Vector3) => void,
): number {
  const invBone = new THREE.Matrix4().copy(bone.matrixWorld).invert();
  const tmp = new THREE.Vector3();
  let count = 0;

  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isMesh || !sm.geometry) return;
    const pos = sm.geometry.attributes?.position;
    if (!pos) return;

    // 网格级预筛：整个网格都不在 Y 区间内就跳过（省掉全部逐顶点蒙皮计算）
    const wb = meshWorldBox(sm);
    if (wb.isEmpty()) return;
    if (wb.max.y < worldYMin || wb.min.y > worldYMax) return;

    for (let i = 0; i < pos.count; i++) {
      if (typeof sm.getVertexPosition === 'function') {
        sm.getVertexPosition(i, tmp); // 含骨骼变换，但仍是网格局部坐标
      } else {
        tmp.fromBufferAttribute(pos, i);
      }
      tmp.applyMatrix4(sm.matrixWorld); // ← 网格局部 → 世界（漏掉这步会导致尺寸整体放大）
      if (tmp.y < worldYMin || tmp.y > worldYMax) continue;
      tmp.applyMatrix4(invBone);
      visit(tmp);
      count++;
    }
  });

  return count;
}

/** 百分位（升序），用于剔除发型/配饰等离群点，避免"取最大值"把尺寸撑爆 */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * 测量头部：含头发的外轮廓。
 *
 * 鲁棒性策略（由实测分布数据反推）：
 *  - 半径取 **p90** —— 三个模型的 p90 高度一致（0.108 / 0.108 / 0.102），
 *    而 p99 在带长发的模型上会被拉到 0.2~0.5（李工 max=0.499）；
 *  - 再用由 `topY`（颅顶高，三个模型都很稳：0.192~0.203）推导的**物理上下界**夹逼：
 *    人头半径不可能小于颅高的 52%，也不该大于 68%。
 *
 * 曾试过"最大间隙切分"来剔除长发离群点，实测失败：离群点不是干净的第二簇，
 * 而是 p90→max 之间稀疏散布的尾巴，最大空隙落在尾巴内部，切了等于没切。
 */
function measureHead(vrm: VRM, headBone: THREE.Object3D): HeadMeasure | null {
  const headWorldY = new THREE.Vector3().setFromMatrixPosition(headBone.matrixWorld).y;
  // 从下颌往下留 5cm 余量，确保把头骨 + 发型都覆盖到
  const yMin = headWorldY - 0.05;
  const ys: number[] = [];
  const rs: number[] = [];
  const n = scanVertices(vrm.scene, headBone, yMin, Infinity, (p) => {
    ys.push(p.y);
    rs.push(Math.hypot(p.x, p.z));
  });
  if (!n) return null;
  ys.sort((a, b) => a - b);
  rs.sort((a, b) => a - b);

  const topY = percentile(ys, 0.98);
  const raw = percentile(rs, 0.9);
  const radius = clamp(raw, topY * 0.52, topY * 0.68);
  if (topY <= 0.01 || radius <= 0.005) return null;
  return {
    topY,
    radius,
    sampled: n,
    debug: {
      p50: percentile(rs, 0.5), p90: raw,
      p99: percentile(rs, 0.99), max: rs[rs.length - 1],
    },
  };
}

/**
 * 测量躯干：**只取正面（+z）**的前后半深。
 *
 * 关键洞察：长发 / 马尾垂在**身后**（-z），所以用正面统计天然免疫。
 * 再用 `torsoLen` 推导的物理上下界夹逼（躯干半深约为躯干长的 20%~38%）。
 */
function measureTorso(vrm: VRM, chestBone: THREE.Object3D, torsoLen: number): TorsoMeasure | null {
  const chestWorldY = new THREE.Vector3().setFromMatrixPosition(chestBone.matrixWorld).y;
  const yMin = chestWorldY - torsoLen * 0.62;
  const yMax = chestWorldY + torsoLen * 0.06;

  const frontZ: number[] = [];
  const allAbsZ: number[] = [];
  const ys: number[] = [];
  const n = scanVertices(vrm.scene, chestBone, yMin, yMax, (p) => {
    allAbsZ.push(Math.abs(p.z));
    if (p.z > 0) frontZ.push(p.z);
    ys.push(p.y);
  });
  if (!n) return null;

  frontZ.sort((a, b) => a - b);
  allAbsZ.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);

  // 正面采样点过少（极少数模型）时退回全体 |z| 的中位数。
  // 上界取 0.30×躯干长：李工的围巾/外套正面外扩会把 p95 顶得很高，
  // 0.38 的上界会做出一个 0.52m 宽的"大桶"，收到 0.30 才落在正常背心宽度。
  const raw = frontZ.length > 20 ? percentile(frontZ, 0.95) : percentile(allAbsZ, 0.5);
  const halfDepth = clamp(raw, torsoLen * 0.2, torsoLen * 0.3);
  if (halfDepth <= 0.005) return null;

  return {
    halfDepth,
    topY: percentile(ys, 0.98),
    bottomY: percentile(ys, 0.02),
    sampled: n,
    debug: {
      p50: percentile(allAbsZ, 0.5), p90: percentile(allAbsZ, 0.9),
      p99: percentile(allAbsZ, 0.99), max: allAbsZ[allAbsZ.length - 1],
    },
  };
}

/* ────────────────────────── 安全帽 ────────────────────────── */

/**
 * 安全帽：帽壳（半球）+ 帽檐（环形外沿）+ 前帽舌 + 顶部加强筋。
 * 尺寸必须覆盖**头发**（VRoid 发型体积远大于头骨），所以半径取
 * `max(颅高 × 0.55, 头半径 × 1.14)`，并把帽檐放在眉毛高度（颅高 52%）。
 */
export function createHardHat(color: number, head: HeadMeasure): THREE.Group {
  const g = new THREE.Group();
  g.name = 'industrial-hardhat';

  const { topY, radius: headR } = head;
  const r = Math.max(topY * 0.55, headR * 1.14); // 帽壳半径：必须罩住头发
  const brimY = topY * 0.52;                     // 帽檐落在眉毛上方

  const shellMat = pbr(color, 0.32, 0.12);       // 工程塑料：略光滑、低金属
  const trimMat = pbr(new THREE.Color(color).multiplyScalar(0.72).getHex(), 0.5, 0.08);
  const ribMat = pbr(new THREE.Color(color).multiplyScalar(1.18).getHex(), 0.3, 0.15);

  // ① 帽壳：上半球，略压扁并前后拉长（更贴近真实安全帽轮廓）
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(r, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.5),
    shellMat,
  );
  shell.scale.set(1.0, 0.92, 1.08);
  shell.position.y = brimY;
  g.add(shell);

  // ② 帽檐：沿赤道的一圈外沿
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.16, r * 1.16, r * 0.10, 32, 1, false),
    trimMat,
  );
  brim.scale.set(1.0, 1.0, 1.14);
  brim.position.y = brimY - r * 0.03;
  g.add(brim);

  // ③ 前帽舌：向前伸出的一块扁板
  const visor = new THREE.Mesh(new THREE.BoxGeometry(r * 1.02, r * 0.08, r * 0.46), trimMat);
  visor.position.set(0, brimY - r * 0.02, r * 1.12);
  visor.rotation.x = 0.12;
  g.add(visor);

  // ④ 顶部加强筋（纵向一道 + 横向两道）——安全帽最强的识别特征
  const ribLong = new THREE.Mesh(new THREE.BoxGeometry(r * 0.16, r * 0.14, r * 1.55), ribMat);
  ribLong.position.set(0, brimY + r * 0.40, 0);
  g.add(ribLong);

  for (const z of [-0.36, 0.36]) {
    const ribCross = new THREE.Mesh(new THREE.BoxGeometry(r * 1.24, r * 0.12, r * 0.15), ribMat);
    ribCross.position.set(0, brimY + r * 0.58 - Math.abs(z) * r * 0.30, z * r * 0.86);
    g.add(ribCross);
  }

  return g;
}

/* ────────────────────────── 反光背心 ────────────────────────── */

/**
 * 反光背心：贴合躯干的椭圆筒身（正面开襟）+ 两道高反光条 + 两条肩带。
 *
 * ⚠️ 迭代记录：第一版用"开口圆柱（CylinderGeometry open-ended）"，
 * 渲染出来是个**上下硬切边的水桶**套在胸前，完全不像衣服。
 * 根因是圆柱上下沿是水平硬边、且半径恒定。
 * 现在改用 `LatheGeometry` + **两端内收的轮廓线**（下摆 0.90→1.00、肩部 1.00→0.82），
 * 再把截面按实测前后半深做椭圆化，观感才落到"穿在身上的背心"。
 */
export function createSafetyVest(palette: GearPalette, torso: TorsoMeasure, torsoLen: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'industrial-vest';

  const radiusZ = torso.halfDepth * 1.06;  // 前后：略大于实测
  const radiusX = torso.halfDepth * 1.45;  // 左右：人体躯干宽 ≈ 深 × 1.45
  const top = torso.topY + torsoLen * 0.02;
  const bottom = torso.bottomY + torsoLen * 0.08;
  const height = Math.max(top - bottom, torsoLen * 0.3);

  /** 归一化半径轮廓：f=0 下摆，f=1 肩部；两端内收以消除硬边 */
  const profile = (f: number): number => {
    if (f < 0.12) return 0.90 + 0.10 * (f / 0.12);
    if (f > 0.78) return 1.0 - 0.18 * ((f - 0.78) / 0.22);
    return 1.0;
  };

  const vestMat = pbr(palette.vest, 0.62, 0.03);
  vestMat.side = THREE.DoubleSide;
  const stripeMat = emissive(palette.stripe, 0.42);

  const gap = Math.PI * 0.30;      // 正面开襟角度
  const phiStart = gap / 2;        // LatheGeometry 的 phi=0 指向 +Z（正面）
  const phiLength = Math.PI * 2 - gap;

  // ① 筒身：轮廓线采样后绕 Y 旋转成形
  const STEPS = 14;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const f = i / STEPS;
    pts.push(new THREE.Vector2(radiusX * profile(f), bottom + height * f));
  }
  const shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 36, phiStart, phiLength), vestMat);
  shell.scale.z = radiusZ / radiusX; // 椭圆化
  g.add(shell);

  // ② 反光条：两道（上胸 / 腰部），半径略外扩避免 Z-fighting
  for (const f of [0.34, 0.70]) {
    const y0 = bottom + height * (f - 0.055);
    const y1 = bottom + height * (f + 0.055);
    const r = radiusX * profile(f) * 1.028;
    const band = new THREE.Mesh(
      new THREE.LatheGeometry(
        [new THREE.Vector2(r, y0), new THREE.Vector2(r, y1)],
        36,
        phiStart,
        phiLength,
      ),
      stripeMat,
    );
    band.scale.z = radiusZ / radiusX;
    g.add(band);
  }

  // ③ 肩带：从背心肩部向上搭过肩膀
  for (const sx of [-1, 1]) {
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(radiusX * 0.26, torsoLen * 0.26, radiusZ * 0.5),
      vestMat,
    );
    strap.position.set(sx * radiusX * 0.44, top + torsoLen * 0.05, radiusZ * 0.34);
    strap.rotation.z = sx * 0.18;
    g.add(strap);
  }

  return g;
}

/* ────────────────────────── 胸章 ────────────────────────── */

/** 角色专属工业发光徽章（深灰金属托盘 + 发光外环 + 常亮原点） */
export function createChestBadge(color: number, scale = 1): THREE.Group {
  const group = new THREE.Group();
  group.name = 'industrial-badge';

  const baseGeo = new THREE.CylinderGeometry(0.022 * scale, 0.022 * scale, 0.004 * scale, 6);
  baseGeo.rotateX(Math.PI / 2);
  const baseMesh = new THREE.Mesh(
    baseGeo,
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.25 }),
  );
  group.add(baseMesh);

  const ringMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.010 * scale, 0.018 * scale, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  ringMesh.position.z = 0.003 * scale;
  group.add(ringMesh);

  const dotMesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.0045 * scale, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  dotMesh.position.z = 0.0035 * scale;
  group.add(dotMesh);

  return group;
}

/* ────────────────────────── 装配 ────────────────────────── */

/** 最近一次装配的测量结果（诊断 / 单测断言用） */
let lastMeasurement: GearMeasurement | null = null;
export function getLastGearMeasurement(): GearMeasurement | null {
  return lastMeasurement;
}

/**
 * 把工业装备挂到 VRM 骨骼上。
 * 必须在 `applyNaturalPose(vrm)` **之后**调用（姿态会影响骨骼世界坐标）。
 *
 * @returns 装配测量结果；关键骨骼缺失或测量失败时返回 null（调用方应视为"没装装备"）
 */
export function attachIndustrialGear(vrm: VRM, personaId: string): GearMeasurement | null {
  const hum = vrm.humanoid;
  if (!hum) return null;

  const palette = gearFor(personaId);
  vrm.scene.updateMatrixWorld(true);

  const head = hum.getNormalizedBoneNode(VRMHumanBoneName.Head);
  const hips = hum.getNormalizedBoneNode(VRMHumanBoneName.Hips);
  const chest =
    hum.getNormalizedBoneNode(VRMHumanBoneName.UpperChest) ||
    hum.getNormalizedBoneNode(VRMHumanBoneName.Chest);

  if (!head || !hips || !chest) return null;

  const headWorldY = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).y;
  const hipsWorldY = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld).y;
  const torsoLen = Math.max(Math.abs(headWorldY - hipsWorldY), 0.18);

  const headM = measureHead(vrm, head);
  const torsoM = measureTorso(vrm, chest, torsoLen);

  if (!headM || !torsoM) {
    lastMeasurement = null;
    return null;
  }

  // ── 安全帽：直接挂在 Head 骨骼（尺寸按实测发型外轮廓）──
  head.add(createHardHat(palette.helmet, headM));

  // ── 反光背心 + 胸章：挂在胸腔骨骼 ──
  chest.add(createSafetyVest(palette, torsoM, torsoLen));

  const badge = createChestBadge(palette.badge, Math.max(torsoLen * 2.4, 1));
  badge.position.set(torsoM.halfDepth * 0.9, torsoM.topY * 0.55, torsoM.halfDepth * 1.05);
  chest.add(badge);

  lastMeasurement = {
    personaId,
    torsoLen,
    head: headM,
    torso: torsoM,
    sampledVertices: headM.sampled + torsoM.sampled,
  };
  return lastMeasurement;
}

/** 移除已装配的工业装备（切换人设时避免叠加） */
export function detachIndustrialGear(root: THREE.Object3D): void {
  const doomed: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (
      o.name === 'industrial-hardhat' ||
      o.name === 'industrial-vest' ||
      o.name === 'industrial-badge'
    ) {
      doomed.push(o);
    }
  });
  for (const d of doomed) {
    d.parent?.remove(d);
    d.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mm) => mm?.dispose());
      }
    });
  }
}
