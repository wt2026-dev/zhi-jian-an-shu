/**
 * 「检修闯关」数字人角色 —— 加载 + **程序化**动作。
 *
 * ## 为什么不复用 `src/components/digital-human/DigitalHumanGLB.tsx`
 *
 * 1. 那个组件的动作来源是 `AnimationMixer` + 单个 clip。而 `asian_worker.glb` 里
 *    **只有一个动画片段，名叫 `Character Dying Action`**（实测：animations.length === 1）。
 *    组件里的 `SPEAK_CLIP_NAME = 'Armature|beszed'` 在这个资产上根本不存在，
 *    于是走 `animations[0]` 兜底 —— 即"说话时播放倒地动作"。这不是我要的庆祝/遗憾。
 * 2. 它只暴露 `speak/stop/setSpeaking/setPersona`，没有可扩展的动作入口。
 *
 * 因此本文件**直接加载 GLB 并程序化驱动骨骼**（0 新增美术资产，也不需要 3D 生成能力）。
 *
 * ## 两个必须知道的资产坑
 *
 * - **GLTFLoader 会把骨骼名里的冒号去掉**：GLB 里是 `mixamorig:Hips_01`，
 *   运行时是 `mixamorigHips_01`。（`DigitalHumanGLB.tsx` 的注释也记了这一点。）
 * - **骨骼名的数字后缀不可靠**：同一份资产里 `RightHandIndex1_00` 的后缀是 `00`
 *   （应为 `040`，导出时被截断了），而其余右手手指是 `_040`…`_054`。
 *   所以**一律用"去前缀 + 去尾号"的规范化名做匹配**，绝不硬编码后缀。
 *   （顺带一提：`DigitalHumanGLB.tsx` 的 BONE 表把右臂写成 `RightShoulder_019` /
 *    `RightArm_020` / `RightForeArm_021` / `RightHand_022`，与本资产实际的
 *    `_032/_033/_034/_035` 对不上 —— 那四条 `getObjectByName` 一直返回 undefined，
 *    即右臂的点头/摆臂逻辑其实从未生效。这也是我按规范化名匹配的另一个理由。）
 *
 * ## 骨骼克隆
 *
 * 本文件**不做 clone**：`SkinnedMesh` 用 `Object3D.clone()` 会共享 `Skeleton`，
 * 骨架绑定会错乱（需要 `SkeletonUtils.clone`）。游戏里同时只有一个数字人，
 * 直接加载使用即可，从根上绕开这个问题。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CharacterMood = 'idle' | 'celebrate' | 'regret';

export interface GameCharacter {
  readonly root: THREE.Group;
  /** 切换动作（内部做阻尼过渡，不会瞬移） */
  setMood(mood: CharacterMood): void;
  /** 逐帧驱动，elapsed 为场景累计秒数 */
  update(elapsed: number): void;
  /** 该角色是否为真实 GLB（false = 程序化兜底替身） */
  readonly isReal: boolean;
  /**
   * 模型**本地**前向的方位角（弧度，`atan2(x, z)` 口径；0 = 朝 +Z）。
   * 外部摆位一律写 `rotation.y = 目标方位角 - facing`，不要假设"角色默认朝 -Z"。
   */
  readonly facing: number;
  dispose(): void;
}

/** 统一到 1.78m —— 资产可能是厘米单位，双保险。 */
const TARGET_HEIGHT = 1.78;

/**
 * 骨骼规范化名：去掉 `mixamorig:` / `mixamorig` 前缀与结尾的 `_<数字>`。
 * 这样 `mixamorig:Hips_01` → `hips`，`mixamorig:RightHandIndex1_00` → `righthandindex1`。
 */
export function canonicalBoneName(raw: string): string {
  return raw
    .replace(/^mixamorig:?/i, '')
    .replace(/_\d+$/, '')
    .toLowerCase();
}

/** 从场景里按规范化名收集骨骼。 */
export function collectBones(root: THREE.Object3D): Map<string, THREE.Bone> {
  const map = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      const key = canonicalBoneName(o.name);
      if (key && !map.has(key)) map.set(key, o as THREE.Bone);
    }
  });
  return map;
}

/**
 * 反解"这个模型默认朝哪边"，返回本地前向的方位角（弧度，`atan2(x, z)` 口径，0 = +Z）。
 *
 * 为什么需要它：结算时数字人要面向镜头做庆祝/遗憾动作，我按 three.js 惯例想当然写了
 * `rotation.y = π + 相机方位角`（假定角色默认朝 -Z），实测**转了 180° 差**——
 * 截图里只有后脑勺在挥手。骨架里"脚踝 → 脚趾"的水平向量就是前向，直接量出来，别猜。
 * 缺骨骼（程序化替身没有骨架）时返回 0：替身是左右对称的，0 即 +Z。
 */
export function deriveFacing(boneMap: Map<string, THREE.Bone>): number {
  const foot = boneMap.get('leftfoot') ?? boneMap.get('rightfoot');
  const toe = boneMap.get('lefttoebase') ?? boneMap.get('righttoebase');
  if (!foot || !toe) return 0;
  const a = foot.getWorldPosition(new THREE.Vector3());
  const b = toe.getWorldPosition(new THREE.Vector3());
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.hypot(dx, dz) < 1e-5 ? 0 : Math.atan2(dx, dz);
}

/* ============================ 姿态定义 ============================ */

/**
 * 一组骨骼的**相对静止姿态**的欧拉偏移（弧度）。
 * 之所以存"偏移"而不是绝对姿态：加载时把每根骨骼的初始四元数记下来，
 * 每帧用 `rest * offset` 组合，这样无论资产的绑定姿态如何都不会翻车。
 *
 * ⚠️ 这里只放**躯干/颈/头/手指**。手臂不在表里 —— 手臂走 `armAims()` 的目标方向
 * （绑定姿态是抱胸，欧拉偏移推不出举手，见 `AIM_CHAIN` 上方注释）。
 */
type PoseMap = Record<string, [number, number, number]>;

/** 手指：握拳（四指卷曲）。拇指单独控制。 */
function curlFingers(side: 'right' | 'left', amount: number, thumbOpen: number): PoseMap {
  const sign = side === 'right' ? -1 : 1;
  const p: PoseMap = {};
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    for (let i = 1; i <= 3; i++) {
      p[`${side}hand${f}${i}`] = [0, 0, sign * amount * (i === 1 ? 1 : 0.85)];
    }
  }
  p[`${side}handthumb1`] = [0, 0, sign * thumbOpen];
  p[`${side}handthumb2`] = [0, 0, sign * thumbOpen * 0.5];
  return p;
}

/** 待机：轻微呼吸与重心浮动，不做大幅动作（手臂姿态见 `armAims`）。 */
function poseIdle(t: number): PoseMap {
  const breathe = Math.sin(t * 1.5);
  return {
    ...curlFingers('right', 0.28, 0.22),
    ...curlFingers('left', 0.28, 0.22),
    spine1: [0.012 * breathe, 0, 0],
    spine2: [0.01 * breathe, 0, 0],
    head: [0.02 * Math.sin(t * 0.9), 0.06 * Math.sin(t * 0.55), 0],
  };
}

/**
 * 庆祝：右臂高举 + 竖大拇指 + 挥手摆动，左臂自然下垂，身体轻微上下颠。
 * 手臂的举起/摆动全部由 `armAims('celebrate')` 给目标方向，这里只管躯干与手指。
 */
function poseCelebrate(t: number): PoseMap {
  const wave = Math.sin(t * 4.6);
  const bob = Math.abs(Math.sin(t * 2.6));
  return {
    // 竖大拇指：四指握拳，拇指伸出
    ...curlFingers('right', 1.35, -0.9),
    ...curlFingers('left', 0.35, 0.25),
    // 躯干与头：抬头、微微后仰、随挥手轻轻晃
    spine1: [-0.06 - 0.03 * bob, 0.05 * wave, 0],
    spine2: [-0.05, 0.04 * wave, 0],
    neck: [-0.05, 0, 0],
    head: [-0.06, 0.12 * wave, 0.04 * wave],
  };
}

/** 遗憾：低头、含胸、垂肩、双臂贴身，动作幅度很小。 */
function poseRegret(t: number): PoseMap {
  const sigh = Math.sin(t * 1.1);
  return {
    ...curlFingers('right', 0.5, 0.15),
    ...curlFingers('left', 0.5, 0.15),
    spine: [0.13, 0, 0],
    spine1: [0.1 + 0.02 * sigh, 0, 0],
    spine2: [0.08, 0, 0],
    neck: [0.16, 0, 0],
    head: [0.24, 0.05 * sigh, 0],
  };
}

function poseFor(mood: CharacterMood, t: number): PoseMap {
  if (mood === 'celebrate') return poseCelebrate(t);
  if (mood === 'regret') return poseRegret(t);
  return poseIdle(t);
}

/* ============================ 加载与驱动 ============================ */

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _align = new THREE.Quaternion();
const _v = new THREE.Vector3();

interface BoneState {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
}

/* ------------- 手臂"瞄准"姿态（与资产的骨骼局部轴约定完全无关） ------------- */

/**
 * 手臂姿态用"指向"而不是"欧拉偏移"，这是踩坑之后改的。
 *
 * 坑：这只 GLB 的**绑定姿态就是双手抱胸**（不是 T-pose / A-pose）。
 * 原来按"Mixamo 右臂沿局部 +X、绕 Z 负向即放下"的假设写欧拉偏移，
 * 实际 ±1 rad 只是在抱胸姿态附近晃 —— 三张姿态截图一对比，
 * 「庆祝」和「待机」几乎一模一样（都是抱着胸口），完全不像竖大拇指/挥手。
 *
 * 解法：只给一个**目标方向**，反解骨骼需要的旋转，与局部轴约定无关：
 *   offset = rest⁻¹ · P⁻¹ · align(restDir → target) · P · rest
 *   · restDir  = 载入时量出的"骨骼 → 子关节"方向（脚踝→脚趾同款思路，量出来别猜）
 *   · P        = 该骨骼父节点的朝向（载入时根节点未旋转 ⇒ 即相对根的朝向）
 *   · align    = 把 restDir 转到 target 的最小旋转
 */
type AimMap = Record<string, [number, number, number]>;

/** 可瞄准的骨骼 → 用来量静止方向的子关节 */
export const AIM_CHAIN: Array<[string, string]> = [
  ['rightarm', 'rightforearm'],
  ['rightforearm', 'righthand'],
  ['leftarm', 'leftforearm'],
  ['leftforearm', 'lefthand'],
];

export interface AimBone {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  restInv: THREE.Quaternion;
  /** 载入时父节点的朝向（相对根）；仅在父骨骼不在驱动列表里时当兜底 */
  parentRest: THREE.Quaternion;
  /** "骨骼 → 子关节"方向在**骨骼自身局部坐标**里的常量表示 */
  dirLocal: THREE.Vector3;
}

/**
 * 量出一根骨骼的"静止朝向"信息（骨骼 → 子关节）。
 * 调用前必须保证矩阵已刷新（`root.updateMatrixWorld(true)`）。
 */
export function measureAimBone(bone: THREE.Bone, child: THREE.Bone): AimBone | null {
  const dir = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()));
  if (dir.lengthSq() < 1e-8) return null;
  const rest = bone.quaternion.clone();
  const parentRest = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  const dirLocal = dir
    .normalize()
    .applyQuaternion(parentRest.clone().invert())
    .applyQuaternion(rest.clone().invert());
  return {
    bone,
    rest,
    restInv: rest.clone().invert(),
    parentRest,
    dirLocal: dirLocal.normalize(),
  };
}

/** 角色自身坐标系：前 / 上 / 右（都是根局部坐标） */
function selfBasis(facing: number): { f: THREE.Vector3; u: THREE.Vector3; r: THREE.Vector3 } {
  const f = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
  const u = new THREE.Vector3(0, 1, 0);
  // 面朝 f、头顶 u 的人，右手边是 f × u（用"面朝 +Z 时右手在 -X"验过）
  const r = new THREE.Vector3().crossVectors(f, u);
  return { f, u, r };
}

/**
 * 手臂目标方向：`[右分量, 上分量, 前分量]`，在**角色自身坐标系**里
 * （+右 = 角色自己的右手侧，与相机在哪无关）。
 */
export function armAims(mood: CharacterMood, t: number, facing: number): AimMap {
  const b = selfBasis(facing);
  // 归一化后再返回：调用方虽然也会归一化一次，但"表里存的就是单位向量"更好验证
  const toLocal = (right: number, up: number, fwd: number): [number, number, number] => {
    const v = new THREE.Vector3()
      .addScaledVector(b.r, right)
      .addScaledVector(b.u, up)
      .addScaledVector(b.f, fwd);
    if (v.lengthSq() < 1e-8) return [0, 1, 0];
    v.normalize();
    return [v.x, v.y, v.z];
  };

  if (mood === 'celebrate') {
    const wave = Math.sin(t * 4.6);
    // 右臂斜举到侧上方、随 wave 前后摆 = 挥手。
    // ⚠️ 上臂的"右"分量必须给足（≈0.88 ⇒ 离竖直 63°）：给成 0.62/0.72 时手臂举得
    // 太竖，前臂一竖直手就缩到头后面去了，镜头俯视下看起来像挠头而不是挥手。
    // 目标状态是"肘在肩外侧、手在肘外上方"，手要离开身体轮廓。
    return {
      rightarm: toLocal(0.88 + 0.05 * wave, 0.44, 0.14 + 0.22 * wave),
      rightforearm: toLocal(0.42 + 0.16 * wave, 0.9, 0.1 + 0.2 * wave),
      leftarm: toLocal(-0.42, -0.9, 0.12),
      leftforearm: toLocal(-0.18, -0.97, 0.06),
    };
  }
  if (mood === 'regret') {
    const sigh = 0.03 * Math.sin(t * 1.1);
    // 双臂贴身下垂、随叹气微微前后晃；低头含胸交给 spine/neck/head 的欧拉偏移
    return {
      rightarm: toLocal(0.26, -0.94 + sigh, 0.14),
      rightforearm: toLocal(0.12, -0.99, 0.05),
      leftarm: toLocal(-0.26, -0.94 + sigh, 0.14),
      leftforearm: toLocal(-0.12, -0.99, 0.05),
    };
  }
  // idle：自然垂手、轻微呼吸外摆
  const breathe = 0.025 * Math.sin(t * 1.5);
  return {
    rightarm: toLocal(0.2 + breathe, -0.96, 0.1),
    rightforearm: toLocal(0.08, -0.99, 0.05),
    leftarm: toLocal(-0.2 - breathe, -0.96, 0.1),
    leftforearm: toLocal(-0.08, -0.99, 0.05),
  };
}

const _pq = new THREE.Quaternion();
const _tv = new THREE.Vector3();
const _pv = new THREE.Vector3();

/**
 * 求"让这根骨骼的子关节指向 targetRoot"所需的局部偏移四元数。
 *
 * 推导（`parentQ` 是**本帧**父骨骼在根局部空间里的朝向）：
 *   骨骼在根空间的朝向 Q_bone = parentQ · rest · offset
 *   子关节方向 = Q_bone · dirLocal
 *   要求 = targetRoot  ⇒  q_bone · dirLocal = parentQ⁻¹ · targetRoot
 *   其中 q_bone = rest · offset ⇒ offset = rest⁻¹ · q_bone
 *
 * ⚠️ 必须用**本帧**的 parentQ，不能用在载入时量到的父节点朝向：
 * 上臂被抬起 ~60° 后，前臂的父节点朝向已经完全变了，
 * 拿静止时的父朝向去解前臂，前臂会指向一个错的方向（实测：手缩到头后面）。
 */
export function aimOffset(a: AimBone, targetRoot: THREE.Vector3, parentQ: THREE.Quaternion, out: THREE.Quaternion): void {
  _pq.copy(parentQ).invert();
  _tv.copy(targetRoot).applyQuaternion(_pq);
  _align.setFromUnitVectors(a.dirLocal, _tv.normalize());
  out.copy(_align).premultiply(a.restInv);
}

/** 程序化替身：GLB 加载失败时的兜底，绝不白屏。 */
function buildProxyCharacter(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x2f6fa8, roughness: 0.6, metalness: 0.2 });
  const head = new THREE.MeshStandardMaterial({ color: 0xd9a06a, roughness: 0.8, metalness: 0.05 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.5, metalness: 0.1, emissive: 0x0e4a56 });
  const legs = new THREE.MeshStandardMaterial({ color: 0x22303f, roughness: 0.8, metalness: 0.1 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = false;
    g.add(m);
    return m;
  };
  add(new THREE.CapsuleGeometry(0.2, 0.42, 4, 12), body, 0, 1.08, 0);
  add(new THREE.CapsuleGeometry(0.19, 0.3, 4, 12), vest, 0, 1.12, 0.02);
  add(new THREE.SphereGeometry(0.135, 16, 12), head, 0, 1.6, 0);
  add(new THREE.CylinderGeometry(0.075, 0.085, 0.72, 10), legs, -0.1, 0.42, 0);
  add(new THREE.CylinderGeometry(0.075, 0.085, 0.72, 10), legs, 0.1, 0.42, 0);
  return g;
}

/**
 * 加载数字人角色。永不 reject —— 失败时返回程序化替身，保证场景里一定有"人"。
 */
export async function loadGameCharacter(url: string): Promise<GameCharacter> {
  let root: THREE.Group;
  const bones: BoneState[] = [];
  const aimBones: AimBone[] = [];
  let isReal = false;
  /** 模型本地前向方位角，由骨架量出；程序化替身（无骨架）保持 0 */
  let facing = 0;

  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    root = gltf.scene as unknown as THREE.Group;
    isReal = true;

    // 归一化到 1.78m
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const h = size.y;
    if (Number.isFinite(h) && h > 0.01 && Math.abs(h - TARGET_HEIGHT) > 0.03) {
      root.scale.setScalar(TARGET_HEIGHT / h);
      root.updateMatrixWorld(true);
    }
    // 让脚底落在 y=0
    const box2 = new THREE.Box3().setFromObject(root);
    root.position.y -= box2.min.y;

    const boneMap = collectBones(root);
    const wanted = new Set<string>();
    for (const key of [
      'hips', 'spine', 'spine1', 'spine2', 'neck', 'head',
      'rightshoulder', 'rightarm', 'rightforearm', 'righthand',
      'leftshoulder', 'leftarm', 'leftforearm', 'lefthand',
    ]) wanted.add(key);
    for (const side of ['right', 'left']) {
      for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        for (let i = 1; i <= 3; i++) wanted.add(`${side}hand${f}${i}`);
      }
    }
    for (const key of wanted) {
      const bone = boneMap.get(key);
      if (bone) bones.push({ bone, rest: bone.quaternion.clone() });
    }

    // 骨架已就位 ⇒ 量出模型本地前向（必须先刷新世界矩阵，否则读到的是加载时的旧值）
    root.updateMatrixWorld(true);
    facing = deriveFacing(boneMap);

    // 量出各手臂骨骼的静止朝向（骨骼 → 子关节）与父节点朝向，供"瞄准"姿态反解
    for (const [parentKey, childKey] of AIM_CHAIN) {
      const bone = boneMap.get(parentKey);
      const child = boneMap.get(childKey);
      if (!bone || !child) continue;
      const measured = measureAimBone(bone, child);
      if (measured) aimBones.push(measured);
    }

    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // 蒙皮网格的包围盒不随骨骼更新，默认会被视锥剔除成"人突然消失"
      if ((m as unknown as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
    });
  } catch {
    root = buildProxyCharacter();
  }

  const restPos = root.position.clone();
  let mood: CharacterMood = 'idle';
  let disposed = false;
  // 阻尼权重：切换动作时平滑过渡，避免姿态瞬移
  let weight = 0;
  /** 上一次 update 的场景累计秒数，用来算真实的帧间隔 */
  let lastElapsed = -1;
  /** 本帧各骨骼在根局部空间里的朝向（复用对象，避免每帧分配） */
  const frameQuat = new Map<THREE.Bone, THREE.Quaternion>();
  const identity = new THREE.Quaternion();

  return {
    root,
    get isReal() {
      return isReal;
    },
    get facing() {
      return facing;
    },
    setMood(next: CharacterMood) {
      if (next === mood) return;
      mood = next;
      weight = 0; // 从静止姿态重新混入
    },
    update(elapsed: number) {
      if (disposed) return;
      const pose = poseFor(mood, elapsed);
      // ⚠️ 过渡必须按**时间**推进，不能按帧（原来是每帧 +0.06）：
      // 那是帧率相关的 —— 60fps 下 0.28s 混完，软渲染 ~1fps 下要 17s 才混完，
      // 结果庆祝动作前十几秒只是"手臂半抬"，看起来像抱着胸口而不是挥手。
      // 上限 0.25s 是为了长时间掉帧/切标签回来后能直接到位，而不是慢慢爬。
      const dt = lastElapsed < 0 ? 0 : Math.min(0.25, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;
      weight = Math.min(1, weight + dt / 0.35);
      const aims = armAims(mood, elapsed, facing);
      // 本帧各骨骼在根局部空间里的朝向。`bones` 是**自上而下**的顺序（见 wanted 列表），
      // 所以轮到子骨骼时父骨骼的朝向已经算好了 —— 手臂瞄准必须依赖这个（见 aimOffset 注释）。
      for (const { bone, rest } of bones) {
        const key = canonicalBoneName(bone.name);
        const aim = aims[key];
        const aimBone = aim ? aimBones.find((a) => a.bone === bone) : undefined;
        const parentQ = bone.parent ? frameQuat.get(bone.parent as THREE.Bone) : undefined;
        let useRest = false;
        if (aim && aimBone) {
          _v.set(aim[0], aim[1], aim[2]);
          if (_v.lengthSq() < 1e-8) {
            // 目标向量退化 ⇒ 保持静止姿态。**不能 continue**：下面还要给 frameQuat 记账，
            // 跳过后子骨骼会拿不到父节点本帧的朝向（见 aimOffset 注释）。
            useRest = true;
          } else {
            aimOffset(aimBone, _v.normalize(), parentQ ?? aimBone.parentRest, _q);
          }
        } else {
          useRest = true;
        }
        if (useRest) {
          const off = pose[key];
          _e.set(off ? off[0] : 0, off ? off[1] : 0, off ? off[2] : 0);
          _q.setFromEuler(_e);
        }
        // rest * offset，并随 weight 从 rest 平滑过渡过去
        const target = rest.clone().multiply(_q);
        bone.quaternion.slerpQuaternions(rest, target, weight);
        let q = frameQuat.get(bone);
        if (!q) {
          q = new THREE.Quaternion();
          frameQuat.set(bone, q);
        }
        q.copy(parentQ ?? identity).multiply(bone.quaternion);
      }
      // 庆祝时整个人轻微上下颠，替身也适用
      const bob = mood === 'celebrate' ? Math.abs(Math.sin(elapsed * 2.6)) * 0.06 : 0;
      root.position.y = restPos.y + bob;
    },
    dispose() {
      disposed = true;
      if (!isReal) {
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mm) => mm?.dispose());
        });
      }
      // 真实 GLB 的几何/材质是本文件独占加载的（不走 loadEquipmentGLB 的共享缓存），可以释放
      if (isReal) {
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mm) => mm?.dispose());
        });
      }
      root.parent?.remove(root);
    },
  };
}
