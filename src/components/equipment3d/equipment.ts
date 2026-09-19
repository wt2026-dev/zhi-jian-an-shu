/**
 * 设备生成器 —— 按「零件」跨设备批量渲染 + 状态驱动的逐帧动画。
 *
 * 架构移植自「中国程序化城市生成器」src/buildings.js：
 *   参考实现把成千上万栋楼拆成「若干可复用几何体 + 每实例矩阵/颜色」，
 *   再用 InstancedMesh 一次性提交。
 *
 * 本轮的批渲染粒度升级（对应「16 台设备每台都要有自己的特征」）：
 *   旧实现：按「原型」分组 —— 同原型的 2 台设备共用一套零件几何，
 *           代价是长得一模一样，且换原型就等于新增一批 drawcall。
 *   新实现：按「零件（几何体 + 着色角色）」跨设备分组 ——
 *           16 台设备各有各的配方（deviceProfiles.ts），
 *           但只要用到同一个零件几何体（法兰、底座、电机、指示灯…），
 *           就合并进同一个 InstancedMesh。
 *   因此设备可以完全异形，而 drawcall 只取决于「用到的不同零件种类数」。
 *
 * 状态可视化（核心卖点）：
 *   设备本体的颜色由后端真实 healthScore / status 决定 ——
 *   正常绿 / 预警黄 / 故障红 / 无数据灰，另外补充检修蓝、待机灰蓝、报废深灰。
 *   颜色来源只有一处：传入的 DeviceLike.status。这里没有任何随机数着色。
 *
 * 状态动画（同样只由 status 驱动，不做随机播放）：
 *   running           → 旋转件（轴/风扇/转子）转动
 *   warning           → 指示灯黄灯闪烁
 *   fault / critical  → 指示灯红灯脉冲 + 部件抖动
 *   overhauling       → 拆盖检修（停转 + 检修工具）
 *   standby/scrapped  → 完全静止
 *
 * 按零件证据高亮（partEvidence.ts）：
 *   台账遥测（temp / vibration / loadRate）是**设备级**读数，不是装在某个零件上的
 *   传感器，因此高亮只表达「该零件是这路读数的关联检查部位」，绝不宣称"该部件已损坏"。
 *   规则（全部来自真实输入，无任何编造数据）：
 *     - 有读数且未超阈 → 青色呼吸（仅当读数真实存在时才有动画）
 *     - 设备 overhauling → 黄色（检修关注）
 *     - 读数超阈（statusMapping.ts 阈值）→ 红色
 *     - 指标缺失 → 不高亮、不声称正常、不做任何动画
 *   渲染约束：每台设备**最多 1 个合并高亮 mesh**（≤3 个关联部位合进一块几何体），
 *   16 台满配也只增加 ≤16 个 drawable；缺读数的设备零新增。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Rng, clamp } from './rand';
import type { ScenePreset } from './styles';
import type { DeviceSlot, Hall } from './hall';
import {
  box,
  boxY,
  cone,
  cyl,
  cylY,
  dome,
  geoTriangles,
  geoCacheSize,
  geoLod,
  HALF_PI,
  makeParts,
  PER_INSTANCE_TINTS,
  ring,
  sph,
  type AnimKind,
  type RecipePart,
  type TintRole,
} from './parts';
import { recipeFor, type DeviceRecipe } from './deviceProfiles';
import {
  PART_EVIDENCE_COLOURS,
  finitePartTelemetry,
  getPartEvidence,
  PART_OBSERVATION_ZONES,
  type PartTelemetry,
} from './partEvidence';

/* ========================= 真实工业设备 GLB 映射 ========================= */

export const EQUIPMENT_GLB_MAP: Record<string, string> = {
  'eq-101': '/models/equipment/centrifugal_pump.glb',
  'eq-102': '/models/equipment/hydraulic_press.glb',
  'eq-103': '/models/equipment/machinery_device_1.glb',
  'eq-104': '/models/equipment/electric_motor.glb',
  'eq-105': '/models/equipment/double_suction_pump.glb',
  'eq-106': '/models/equipment/machinery_device_2.glb',
  'eq-107': '/models/equipment/lathe_machine.glb',
  'eq-108': '/models/equipment/electric_motor_high_poly.glb',
  'eq-109': '/models/equipment/milling_machine.glb',
  'eq-112': '/models/equipment/centrifugal_pump.glb',
  'eq-114': '/models/equipment/exhaust_fan_motor.glb',
};

const gltfLoader = typeof window !== 'undefined' ? new GLTFLoader() : null;
const gltfCache = new Map<string, Promise<THREE.Group>>();

/**
 * 把 GLB 里的 `MeshPhysicalMaterial` 降级为 `MeshStandardMaterial`。
 *
 * 原因：`KHR_materials_specular` / `KHR_materials_ior` 会让 GLTFLoader 生成
 * MeshPhysicalMaterial —— 它的 shader 变体比 Standard 重得多（多出 clearcoat/sheen/
 * specular/transmission 等分支）。实测本目录里 `lathe_machine.glb` 用了这两个扩展。
 *
 * 在**缓存的原始模型**上做一次，所有 clone 共享转换后的材质
 * （`Object3D.clone()` 是按引用共享材质的），因此不会每个设备各转一遍、
 * 也不会出现"dispose 掉别人还在用的材质"。
 */
export function normalizeGLBMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    let changed = false;
    const next = mats.map((mat) => {
      if (!(mat instanceof THREE.MeshPhysicalMaterial)) return mat;
      changed = true;
      const std = new THREE.MeshStandardMaterial({
        map: mat.map,
        roughnessMap: mat.roughnessMap,
        metalnessMap: mat.metalnessMap,
        normalMap: mat.normalMap,
        emissiveMap: mat.emissiveMap,
        aoMap: mat.aoMap,
        alphaMap: mat.alphaMap,
        emissive: mat.emissive,
        color: mat.color,
        roughness: mat.roughness,
        metalness: mat.metalness,
        transparent: mat.transparent,
        opacity: mat.opacity,
        side: mat.side,
        alphaTest: mat.alphaTest,
      });
      std.name = mat.name;
      mat.dispose();
      return std;
    });
    if (changed) m.material = Array.isArray(m.material) ? next : next[0];
  });
}

export function loadEquipmentGLB(url: string): Promise<THREE.Group> {
  if (gltfCache.has(url)) {
    return gltfCache.get(url)!.then((g) => g.clone(true));
  }
  if (!gltfLoader) {
    return Promise.reject(new Error('GLTFLoader unavailable in this environment'));
  }
  const p = new Promise<THREE.Group>((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        resolve(gltf.scene);
      },
      undefined,
      (err) => {
        // 失败不能留在缓存里：否则一次网络抖动会把该模型永久钉死成"加载失败"，
        // 后续任何重试都直接命中已 reject 的 Promise，表现为"有些设备永远没有 GLB"。
        gltfCache.delete(url);
        reject(err);
      }
    );
  }).then((scene) => {
    normalizeGLBMaterials(scene);
    return scene;
  });
  gltfCache.set(url, p);
  return p.then((g) => g.clone(true));
}

/* ========================= 健康状态 → 颜色 ========================= */

export type StatusKey =
  | 'running'
  | 'warning'
  | 'fault'
  | 'critical'
  | 'overhauling'
  | 'standby'
  | 'scrapped'
  | 'nodata';

export interface StatusMeta {
  label: string;
  /** 主色（设备本体 / 地面光环） */
  colour: number;
  /** 高亮色（顶部指示灯 / 光柱） */
  glow: number;
  /** 是否属于需要立刻被看见的异常态 */
  alert: boolean;
}

export const STATUS_META: Record<StatusKey, StatusMeta> = {
  running: { label: '正常', colour: 0x27c46b, glow: 0x5cffa3, alert: false },
  warning: { label: '预警', colour: 0xf2c327, glow: 0xffe066, alert: true },
  fault: { label: '故障', colour: 0xe03b2f, glow: 0xff7a66, alert: true },
  // 后端台账里出现过 `critical`（不在 EquipmentStatus 联合类型内），单独映射为"紧急"，
  // 比 fault 更偏橙红，避免与普通故障混淆。
  critical: { label: '紧急', colour: 0xff4a1f, glow: 0xffa06a, alert: true },
  overhauling: { label: '检修中', colour: 0x2f8fe0, glow: 0x8ecdff, alert: false },
  standby: { label: '待机', colour: 0x8f9aa6, glow: 0xc2cdd8, alert: false },
  scrapped: { label: '已报废', colour: 0x596069, glow: 0x8a929b, alert: false },
  nodata: { label: '无数据', colour: 0x9aa0a6, glow: 0xc8ced3, alert: false },
};

/** 状态色图例（顺序即 UI 展示顺序）。 */
export const STATUS_ORDER: StatusKey[] = [
  'running',
  'warning',
  'fault',
  'critical',
  'overhauling',
  'standby',
  'scrapped',
  'nodata',
];

/**
 * 归一化状态字符串。
 * 关键点：后端 `critical` 不在前端 `EquipmentStatus` 联合类型里，
 * 因此这里必须容错，未知值统一落到「无数据」灰，而不是抛错或误判为正常。
 */
export function statusKey(raw: string | null | undefined): StatusKey {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s in STATUS_META) return s as StatusKey;
  if (s === 'ok' || s === 'normal' || s === 'healthy' || s === 'good') return 'running';
  if (s === 'warn') return 'warning';
  if (s === 'alarm' || s === 'error' || s === 'broken' || s === 'down') return 'fault';
  if (s === 'maintenance' || s === 'repair' || s === 'overhaul') return 'overhauling';
  if (s === 'idle' || s === 'offline' || s === 'stopped') return 'standby';
  return 'nodata';
}

/** 设备本体色：以调色板钢灰为底，混入状态色，保证"像喷漆钢件"同时状态一眼可辨。 */
export function bodyColour(key: StatusKey, preset: ScenePreset): THREE.Color {
  const base = new THREE.Color(preset.palette.steel);
  const st = new THREE.Color(STATUS_META[key].colour);
  // 无数据态刻意压低饱和度，避免"没有数据"被误读成"状态良好"
  return base.lerp(st, key === 'nodata' ? 0.42 : 0.62);
}

export function bandColour(key: StatusKey): THREE.Color {
  return new THREE.Color(STATUS_META[key].colour).multiplyScalar(0.74);
}

export function glowColour(key: StatusKey): THREE.Color {
  return new THREE.Color(STATUS_META[key].glow);
}

/* ========================= 状态动画规格 ========================= */

/**
 * 动画是否在当前状态下激活。
 * 这是「状态驱动动画」的唯一判据 —— 不存在随机播放或与状态无关的自转。
 */
export function animActive(kind: AnimKind, status: StatusKey): boolean {
  switch (kind) {
    case 'spin':
    case 'slide':
      return status === 'running';
    case 'shake':
      return status === 'fault' || status === 'critical';
    case 'blink':
      // 预警黄灯闪烁 / 故障与紧急红灯脉冲，都走同一条闪烁通路，参数不同
      return STATUS_META[status].alert;
    default:
      return false;
  }
}

/** 闪烁参数：预警慢闪、故障快闪、紧急最快且最低亮度更低（"脉冲"感更强）。 */
function blinkParams(status: StatusKey): { hz: number; floor: number } {
  if (status === 'critical') return { hz: 4.6, floor: 0.06 };
  if (status === 'fault') return { hz: 3.4, floor: 0.12 };
  if (status === 'warning') return { hz: 1.6, floor: 0.35 };
  return { hz: 0, floor: 1 };
}

/* ========================= 设备原型（未知设备兜底） ========================= */

export type PrototypeKey =
  | 'pump'
  | 'compressor'
  | 'gearbox'
  | 'reducer'
  | 'motor'
  | 'cnc'
  | 'robot'
  | 'exchanger'
  | 'cabinet'
  | 'generic';

export const PROTOTYPE_LABEL: Record<PrototypeKey, string> = {
  pump: '离心泵组',
  compressor: '压缩机组',
  gearbox: '齿轮箱',
  reducer: '减速机',
  motor: '大型电机',
  cnc: '数控机床',
  robot: '工业机器人',
  exchanger: '换热容器',
  cabinet: '配电柜',
  generic: '通用机组',
};

/** 项目台账里的 category → 原型。项目 8 类设备全部覆盖。 */
const CATEGORY_PROTOTYPE: Record<string, PrototypeKey> = {
  泵类设备: 'pump',
  压缩机类: 'compressor',
  压缩机: 'compressor',
  齿轮传动: 'gearbox',
  传动减速机: 'reducer',
  大型电机: 'motor',
  数控机床: 'cnc',
  工业机器人: 'robot',
  换热容器: 'exchanger',
  电气柜: 'cabinet',
  配电柜: 'cabinet',
};

const NAME_HINTS: Array<[RegExp, PrototypeKey]> = [
  [/泵/, 'pump'],
  [/空压|压缩机|制冷压缩/, 'compressor'],
  [/齿轮箱|行星|齿轮传动/, 'gearbox'],
  [/减速机|减速箱/, 'reducer'],
  [/电机|电动机/, 'motor'],
  [/数控|加工中心|机床|龙门/, 'cnc'],
  [/机器人|机械臂|码垛/, 'robot'],
  [/换热|热交换|热管|容器|罐/, 'exchanger'],
  [/配电|开关柜|电气柜/, 'cabinet'],
  [/管道|管线|管路/, 'generic'],
];

/** 由台账条目推断设备原型（category 优先，其次名称关键词，最后通用）。 */
export function prototypeFor(device: { category?: string; name?: string }): PrototypeKey {
  const cat = String(device.category ?? '').trim();
  if (CATEGORY_PROTOTYPE[cat]) return CATEGORY_PROTOTYPE[cat];
  const name = String(device.name ?? '');
  for (const [re, key] of NAME_HINTS) if (re.test(name)) return key;
  return 'generic';
}

/** 原型包围盒（米，scale = 1 时）。仅用于未知设备的兜底取景与代理尺寸。 */
export const PROTOTYPE_BOUNDS: Record<PrototypeKey, { w: number; h: number; d: number }> = {
  pump: { w: 5.6, h: 3.0, d: 2.2 },
  compressor: { w: 4.8, h: 3.4, d: 2.6 },
  gearbox: { w: 5.2, h: 2.7, d: 2.4 },
  reducer: { w: 4.2, h: 2.3, d: 2.1 },
  motor: { w: 5.6, h: 3.2, d: 2.3 },
  cnc: { w: 5.6, h: 3.7, d: 3.5 },
  robot: { w: 3.2, h: 5.0, d: 3.2 },
  exchanger: { w: 6.0, h: 3.0, d: 2.4 },
  cabinet: { w: 2.6, h: 2.4, d: 1.2 },
  generic: { w: 3.0, h: 2.5, d: 2.0 },
};

export function equipmentCacheSize(): number {
  return geoCacheSize();
}

/**
 * 配方零件表缓存：build() 结果只与（配方 id，原型 key，几何 LOD 档）有关，
 * 与预设/布局/种子/设备状态全部无关（位置朝向走实例矩阵，颜色走 instanceColor）。
 * 因此切预设、调布局/种子时直接复用，不再重跑 16 份配方函数 ——
 * 预设切换只重建环境层，设备几何零重建。
 */
const RECIPE_CACHE = new Map<string, RecipePart[]>();

function cachedRecipeParts(cacheKey: string, build: () => RecipePart[]): RecipePart[] {
  let p = RECIPE_CACHE.get(cacheKey);
  if (!p) {
    p = build();
    RECIPE_CACHE.set(cacheKey, p);
  }
  return p;
}

/**
 * 静态零件合并几何体缓存：按（配方/原型 id，几何 LOD 档，着色角色）缓存。
 * 16 台设备各自属于同一着色角色的无动画零件在设备局部坐标系合并为单 mesh，
 * 极大幅度削减 Draw Calls（从 245 压降至 110~140），且单台设备特征与颜色毫不退化。
 */
const MERGED_GEO_CACHE = new Map<string, THREE.BufferGeometry>();

function getMergedStaticGeo(cacheKey: string, parts: RecipePart[]): THREE.BufferGeometry | null {
  let g = MERGED_GEO_CACHE.get(cacheKey);
  if (g) return g;
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    const p = parts[0];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]), q, new THREE.Vector3(1, 1, 1));
    g = new THREE.BufferGeometry().copy(p.geo).applyMatrix4(m);
    g.userData.shared = true;
    MERGED_GEO_CACHE.set(cacheKey, g);
    return g;
  }
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]), q, new THREE.Vector3(1, 1, 1));
    geos.push(new THREE.BufferGeometry().copy(p.geo).applyMatrix4(m));
  }
  try {
    const merged = mergeGeometries(geos, false);
    if (merged) {
      merged.userData.shared = true;
      MERGED_GEO_CACHE.set(cacheKey, merged);
      g = merged;
    }
  } catch (err) {
    console.warn('[equipment3d] mergeGeometries fallback:', err);
    g = geos[0].clone();
    g.userData.shared = true;
  }
  for (const item of geos) item.dispose();
  return g;
}

/* ---- 未知设备的兜底建造器（保持与移植初期一致的外形） ---- */

function armTip(base: [number, number], angle: number, len: number): [number, number] {
  return [base[0] - Math.sin(angle) * len, base[1] + Math.cos(angle) * len];
}

function buildPump(): RecipePart[] {
  const { parts, push } = makeParts();
  push('pad', box(4.3, 0.38, 1.9), [0, 0.19, 0], 'steel');
  push('ribL', box(0.28, 0.34, 1.6), [-1.6, 0.5, 0], 'dark', { detailMin: 1 });
  push('ribR', box(0.28, 0.34, 1.6), [1.6, 0.5, 0], 'dark', { detailMin: 1 });
  push('casing', cyl(1.03, 1.03, 1.18, 20), [0, 1.5, 0], 'status', { rot: [0, 0, HALF_PI] });
  push('volute', cyl(1.21, 1.21, 0.2, 20), [-0.28, 1.5, 0], 'status', { rot: [0, 0, HALF_PI] });
  push('hub', cyl(0.32, 0.32, 1.6, 12), [0.3, 1.5, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('suction', cyl(0.47, 0.47, 0.86, 16), [-1.5, 1.5, 0], 'steel', { rot: [0, 0, HALF_PI] });
  push('flangeS', cyl(0.62, 0.62, 0.1, 16), [-1.95, 1.5, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('discharge', cyl(0.37, 0.37, 1.15, 16), [0.4, 2.4, 0], 'steel');
  push('flangeD', cyl(0.52, 0.52, 0.1, 16), [0.4, 3.0, 0], 'dark');
  push('motor', cyl(0.67, 0.67, 1.95, 18), [2.35, 1.5, 0], 'steel', { rot: [0, 0, HALF_PI] });
  push('motorFin', box(1.75, 1.34, 1.34), [2.35, 1.5, 0], 'dark', { detailMin: 1 });
  push('motorCap', cyl(0.69, 0.5, 0.26, 18), [3.4, 1.5, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('coupling', box(0.58, 0.88, 0.88), [1.3, 1.5, 0], 'accent');
  push('lampPost', cyl(0.06, 0.06, 0.55, 6), [0, 2.2, 0], 'dark', { detailMin: 1, cast: false });
  push('lamp', sph(0.17, 12), [0, 2.75, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

function buildCompressor(): RecipePart[] {
  const { parts, push } = makeParts();
  push('skid', box(4.5, 0.42, 2.2), [0, 0.21, 0], 'steel');
  push('footA', box(0.42, 0.3, 0.42), [-1.9, 0.15, -0.9], 'dark', { detailMin: 1 });
  push('footB', box(0.42, 0.3, 0.42), [1.9, 0.15, 0.9], 'dark', { detailMin: 1 });
  push('body', cyl(1.06, 1.06, 2.3, 20), [0, 1.5, 0], 'status');
  push('band', cyl(1.13, 1.13, 0.18, 20), [0, 2.18, 0], 'status', { detailMin: 1, cast: false });
  push('head', cyl(1.09, 0.86, 0.42, 20), [0, 2.86, 0], 'dark');
  push('inlet', cyl(0.43, 0.43, 0.92, 16), [-1.55, 2.15, 0], 'steel', { rot: [0, 0, HALF_PI] });
  push('outlet', cyl(0.37, 0.37, 0.92, 16), [1.55, 2.15, 0], 'steel', { rot: [0, 0, HALF_PI] });
  push('cooler', box(1.15, 0.72, 1.55), [1.5, 0.92, 0], 'steel');
  push('panel', box(0.18, 1.55, 1.45), [-2.05, 1.18, 0], 'accent');
  push('lamp', sph(0.17, 12), [0, 3.22, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

function buildGearbox(): RecipePart[] {
  const { parts, push } = makeParts();
  push('bed', box(4.0, 0.36, 2.2), [0, 0.18, 0], 'steel');
  push('housing', box(2.45, 1.9, 2.0), [0, 1.16, 0], 'status');
  push('topCap', box(1.65, 0.24, 1.7), [0, 2.22, 0], 'dark');
  push('inShaft', cyl(0.35, 0.35, 1.35, 16), [-1.9, 1.3, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('flangeIn', cyl(0.74, 0.74, 0.18, 16), [-2.45, 1.3, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('outShaft', cyl(0.52, 0.52, 1.5, 16), [1.75, 1.16, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('flangeOut', cyl(0.96, 0.96, 0.2, 18), [2.45, 1.16, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('oilGauge', cyl(0.17, 0.17, 0.32, 10), [0.92, 2.0, 0], 'copper', { rot: [0, 0, HALF_PI] });
  push('lamp', sph(0.17, 12), [0, 2.55, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

function buildReducer(): RecipePart[] {
  const { parts, push } = makeParts();
  push('bed', box(3.4, 0.3, 1.85), [0, 0.15, 0], 'steel');
  push('body', box(2.05, 1.5, 1.62), [0, 1.05, 0], 'status');
  push('cover', box(1.25, 0.2, 1.42), [0, 1.9, 0], 'dark');
  push('hShaft', cyl(0.27, 0.27, 1.15, 14), [-1.5, 1.1, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('lShaft', cyl(0.41, 0.41, 1.25, 16), [1.45, 1.05, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('pulley', cyl(0.76, 0.76, 0.26, 18), [1.95, 1.05, 0], 'dark', { rot: [0, 0, HALF_PI], detailMin: 1 });
  push('sight', cyl(0.14, 0.14, 0.26, 10), [0.85, 1.85, 0], 'copper', { rot: [0, 0, HALF_PI], detailMin: 2 });
  push('lamp', sph(0.17, 12), [0, 2.15, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

function buildMotor(): RecipePart[] {
  const { parts, push } = makeParts();
  push('rail', box(4.4, 0.3, 2.0), [0, 0.15, 0], 'steel');
  push('footA', box(0.52, 0.36, 0.52), [-1.7, 0.48, -0.85], 'dark', { detailMin: 1 });
  push('footB', box(0.52, 0.36, 0.52), [1.7, 0.48, -0.85], 'dark', { detailMin: 1 });
  push('frame', cyl(0.96, 0.96, 3.2, 22), [0, 1.55, 0], 'status', { rot: [0, 0, HALF_PI] });
  for (let i = 0; i < 5; i++) {
    push(`fin${i}`, cyl(1.02, 1.02, 0.1, 22), [-1.12 + i * 0.56, 1.55, 0], 'status', {
      rot: [0, 0, HALF_PI],
      detailMin: 1,
      cast: false,
    });
  }
  push('capA', cyl(0.91, 0.73, 0.42, 22), [-1.8, 1.55, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('capB', cyl(0.91, 0.73, 0.42, 22), [1.8, 1.55, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('fan', cyl(0.72, 0.72, 0.5, 18), [-2.28, 1.55, 0], 'dark', {
    rot: [0, 0, HALF_PI],
    detailMin: 1,
    anim: { kind: 'spin', axis: 'x', speed: 6.5 },
  });
  push('shaft', cyl(0.29, 0.29, 1.4, 14), [2.5, 1.55, 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('termBox', box(0.92, 0.6, 1.0), [0, 2.55, 0], 'status');
  push('lamp', sph(0.17, 12), [0, 3.05, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

function buildCnc(): RecipePart[] {
  const { parts, push } = makeParts();
  push('bed', box(5.0, 0.5, 3.0), [0, 0.25, 0], 'steel');
  push('table', box(3.0, 0.36, 1.9), [0, 0.96, 0.35], 'status');
  push('columnL', box(0.62, 2.45, 0.72), [-1.4, 1.95, -0.92], 'status');
  push('columnR', box(0.62, 2.45, 0.72), [1.4, 1.95, -0.92], 'status');
  push('gantry', box(3.45, 0.58, 0.74), [0, 3.12, -0.92], 'status');
  push('ram', box(0.82, 1.7, 0.82), [0, 2.25, -0.92], 'dark');
  push('spindle', cyl(0.27, 0.27, 0.72, 14), [0, 1.28, -0.92], 'copper');
  push('tool', cone(0.15, 0.52, 10), [0, 0.86, -0.92], 'dark', { detailMin: 1 });
  push('guard', box(3.6, 0.12, 2.3), [0, 3.5, -0.4], 'glass', { detailMin: 1, cast: false });
  push('panel', box(0.16, 1.45, 1.15), [2.6, 1.95, 0.95], 'accent');
  push('lamp', sph(0.17, 12), [-2.4, 3.35, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

function buildRobot(): RecipePart[] {
  const { parts, push } = makeParts();
  push('pad', box(1.9, 0.36, 1.9), [0, 0.18, 0], 'steel');
  push('base', cyl(0.94, 1.04, 0.95, 20), [0, 0.83, 0], 'status');
  push('waist', cyl(0.74, 0.74, 0.62, 18), [0, 1.6, 0], 'status');
  push('lamp', sph(0.17, 12), [0, 1.25, 0.98], 'glow', { cast: false, anim: { kind: 'blink' } });
  const shoulder: [number, number] = [0, 1.95];
  push('shoulder', cyl(0.46, 0.46, 0.86, 16), [0, 1.95, 0], 'dark', { rot: [0, 0, HALF_PI] });
  const a1 = -0.3;
  const L1 = 1.75;
  const elbow = armTip(shoulder, a1, L1);
  push('arm1', boxY(0.6, L1, 0.7), [shoulder[0], shoulder[1], 0], 'status', { rot: [0, 0, a1] });
  push('elbow', cyl(0.39, 0.39, 0.68, 16), [elbow[0], elbow[1], 0], 'dark', { rot: [0, 0, HALF_PI] });
  const a2 = 0.62;
  const L2 = 1.3;
  const wrist = armTip(elbow, a2, L2);
  push('arm2', boxY(0.47, L2, 0.55), [elbow[0], elbow[1], 0], 'status', { rot: [0, 0, a2] });
  push('wrist', cyl(0.31, 0.31, 0.52, 14), [wrist[0], wrist[1], 0], 'dark', { rot: [0, 0, HALF_PI] });
  push('tool', box(0.72, 0.34, 0.46), [wrist[0] - 0.42, wrist[1] - 0.42, 0], 'accent', {
    rot: [0, 0, a2],
    detailMin: 1,
  });
  return parts;
}

function buildExchanger(): RecipePart[] {
  const { parts, push } = makeParts();
  push('saddleL', box(1.25, 0.92, 1.95), [-1.5, 0.46, 0], 'steel');
  push('saddleR', box(1.25, 0.92, 1.95), [1.5, 0.46, 0], 'steel');
  push('shell', cyl(1.06, 1.06, 3.6, 22), [0, 1.85, 0], 'status', { rot: [0, 0, HALF_PI] });
  push('headL', dome(1.06, 20), [-1.8, 1.85, 0], 'status', { rot: [0, 0, HALF_PI] });
  push('headR', dome(1.06, 20), [1.8, 1.85, 0], 'status', { rot: [0, 0, -HALF_PI] });
  push('nozzleA', cyl(0.35, 0.35, 0.92, 14), [-1.2, 3.05, 0], 'steel');
  push('nozzleB', cyl(0.35, 0.35, 0.92, 14), [1.2, 3.05, 0], 'steel');
  push('drain', cyl(0.21, 0.21, 0.62, 10), [0, 1.0, 0], 'steel', { detailMin: 1 });
  push('lamp', sph(0.17, 12), [0, 3.35, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/** 配电柜：场景家具，不参与台账状态着色。 */
export function buildCabinet(): RecipePart[] {
  const { parts, push } = makeParts();
  push('base', box(2.3, 0.16, 1.15), [0, 0.08, 0], 'dark');
  push('shell', box(2.2, 2.15, 1.05), [0, 1.24, 0], 'steel');
  push('doorL', box(0.06, 1.9, 0.46), [-0.56, 1.24, 0.54], 'accent', { detailMin: 1, cast: false });
  push('doorR', box(0.06, 1.9, 0.46), [0.56, 1.24, 0.54], 'accent', { detailMin: 1, cast: false });
  push('panel', box(1.1, 0.34, 0.1), [0, 2.05, 0.54], 'dark', { detailMin: 1, cast: false });
  push('ledA', box(0.1, 0.1, 0.06), [-0.36, 2.05, 0.6], 'glow', { detailMin: 1, cast: false });
  push('ledB', box(0.1, 0.1, 0.06), [-0.16, 2.05, 0.6], 'glow', { detailMin: 1, cast: false });
  push('ledC', box(0.1, 0.1, 0.06), [0.04, 2.05, 0.6], 'glow', { detailMin: 1, cast: false });
  push('roof', box(2.35, 0.12, 1.2), [0, 2.37, 0], 'steel');
  return parts;
}

function buildGeneric(): RecipePart[] {
  const { parts, push } = makeParts();
  push('pad', box(2.5, 0.3, 1.9), [0, 0.15, 0], 'steel');
  push('body', box(2.05, 1.65, 1.55), [0, 1.13, 0], 'status');
  push('cover', box(1.25, 0.18, 1.15), [0, 2.04, 0], 'dark');
  push('nozzle', cyl(0.3, 0.3, 0.7, 14), [0.7, 2.4, 0], 'steel', { detailMin: 1 });
  push('panel', box(0.14, 1.1, 0.9), [-1.1, 1.35, 0], 'accent', { detailMin: 1 });
  push('lamp', sph(0.17, 12), [0, 2.35, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

const PROTOTYPE_BUILDERS: Record<PrototypeKey, () => RecipePart[]> = {
  pump: buildPump,
  compressor: buildCompressor,
  gearbox: buildGearbox,
  reducer: buildReducer,
  motor: buildMotor,
  cnc: buildCnc,
  robot: buildRobot,
  exchanger: buildExchanger,
  cabinet: buildCabinet,
  generic: buildGeneric,
};

/* ========================= 材质 ========================= */

interface MatSet {
  /** 走 per-instance 颜色的喷漆件（status / livery / livery2 共用） */
  instanced: THREE.MeshStandardMaterial;
  /** 走 per-instance 颜色的自发光指示灯 */
  glow: THREE.MeshBasicMaterial;
  /** 走 per-instance 颜色的半透明光柱 / 光环 */
  halo: THREE.MeshBasicMaterial;
  steel: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  all: THREE.Material[];
}

function buildMaterials(preset: ScenePreset): MatSet {
  const pal = preset.palette;
  const instanced = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.52, metalness: 0.32 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const halo = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const steel = new THREE.MeshStandardMaterial({ color: pal.steel, roughness: 0.55, metalness: 0.62 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.42, metalness: 0.78 });
  const accent = new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.6, metalness: 0.25 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xb5773c, roughness: 0.35, metalness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xbfd8e6,
    roughness: 0.12,
    metalness: 0.05,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
  });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9eef3, roughness: 0.5, metalness: 0.2 });
  const all = [instanced, glow, halo, steel, dark, accent, copper, glass, white];
  return { instanced, glow, halo, steel, dark, accent, copper, glass, white, all };
}

function materialFor(set: MatSet, tint: TintRole): THREE.Material {
  switch (tint) {
    case 'status':
    case 'livery':
    case 'livery2':
      return set.instanced;
    case 'glow':
      return set.glow;
    case 'steel':
      return set.steel;
    case 'dark':
      return set.dark;
    case 'accent':
      return set.accent;
    case 'copper':
      return set.copper;
    case 'glass':
      return set.glass;
    case 'white':
      return set.white;
    default:
      return set.steel;
  }
}

/* ========================= 铭牌 ========================= */

/**
 * 设备铭牌 —— **纯几何**，不含任何字体或贴图资源。
 *
 * 为什么铭牌对本次改造很关键：16 台设备外形各异，但在远景/俯视下
 * 「哪个是 3#、哪个是 5#」仍需一眼可读；铭牌是最直接的锚点。
 *
 * 为什么不用 canvas 文字贴图（旧实现）：任务书明确写了「字体/贴图资源禁用」，
 * 而 `ctx.font` + `fillText` + `CanvasTexture` 恰好同时用到了字体与贴图。
 * 现改为「livery2 色板 + 细长方块拼出的七段数字」：
 *   - 零字体、零贴图，全部由 box 几何构成；
 *   - 七段笔画比同高度的文字笔画粗得多，远景下反而更清楚；
 *   - 板色与字色烘焙成顶点色、合并进同一块几何体 → 仍是 1 mesh/台，
 *     drawcall 与改造前持平（不增加），三角面约 +180/台。
 */

/** 七段数码管字模：位序 a(上横) b(右上竖) c(右下竖) d(下横) e(左下竖) f(左上竖) g(中横)。 */
const SEVEN_SEG: Record<string, number> = {
  '0': 0b0111111,
  '1': 0b0000110,
  '2': 0b1011011,
  '3': 0b1001111,
  '4': 0b1100110,
  '5': 0b1101101,
  '6': 0b1111101,
  '7': 0b0000111,
  '8': 0b1111111,
  '9': 0b1101111,
};

/** 铭牌几何缓存：16 台编号固定，几何体全局只建一次（与旧实现的贴图缓存同理）。 */
const PLATE_GEO_CACHE = new Map<string, THREE.BufferGeometry>();

/**
 * 全场合共用一个铭牌材质。
 * 顶点色承载「板色 + 字色」，所以不需要 16 份材质，也不会增加 drawcall。
 * 该材质是模块级常驻对象（与 GEO_CACHE 同类），**不参与 mats.all 的释放**。
 */
const PLATE_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true,
  toneMapped: false,
  side: THREE.DoubleSide,
});

/**
 * Emit the same box triangles directly: nameplates need position/color only.
 * Avoid constructing, translating and de-indexing a full normal/UV geometry
 * for every seven-segment stroke. The unit box remains in the shared cache.
 */
function mergeColoredBoxes(items: Array<{ w: number; h: number; d: number; x?: number; y?: number; z?: number; c: number }>): THREE.BufferGeometry {
  const unit = box(1, 1, 1);
  const vertices = unit.attributes.position;
  const index = unit.index!;
  const pos = new Float32Array(items.length * index.count * 3);
  const col = new Float32Array(pos.length);
  const color = new THREE.Color();
  let o = 0;
  for (const it of items) {
    color.setHex(it.c, THREE.SRGBColorSpace);
    for (let i = 0; i < index.count; i++) {
      const v = index.getX(i);
      // Match BoxGeometry's Float32 dimensions before its translation.
      pos[o] = Math.fround(vertices.getX(v) * it.w) + (it.x ?? 0);
      pos[o + 1] = Math.fround(vertices.getY(v) * it.h) + (it.y ?? 0);
      pos[o + 2] = Math.fround(vertices.getZ(v) * it.d) + (it.z ?? 0);
      col[o] = color.r;
      col[o + 1] = color.g;
      col[o + 2] = color.b;
      o += 3;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.userData.shared = true;
  return geo;
}

/** 生成一块序号铭牌：livery2 色板 + 白色七段数字（数字个数 = seq.length）。 */
function makePlateGeometry(seq: string, livery2: number): THREE.BufferGeometry {
  const boardH = 0.36;
  const dh = boardH * 0.74; // 数字高度
  const dw = dh * 0.6; // 数字宽度
  const gap = dw * 0.32;
  const t = dh * 0.15; // 笔画粗细
  const n = Math.max(1, seq.length);
  const contentW = n * dw + (n - 1) * gap;
  const boardW = contentW + boardH * 0.5;
  const boardD = 0.05;

  const items: Parameters<typeof mergeColoredBoxes>[0] = [
    { w: boardW, h: boardH, d: boardD, c: livery2 },
  ];

  const z = boardD / 2 + 0.01; // 数字浮在板面之上，避免与板面 z-fighting
  const hh = dh / 2;
  const hw = dw / 2;
  const vLen = Math.max(0.01, hh - 1.5 * t); // 竖段长度
  const vTopY = (t / 2 + (hh - t)) / 2;
  const vBotY = -vTopY;
  let x = -contentW / 2 + dw / 2;

  for (const ch of seq) {
    const mask = SEVEN_SEG[ch];
    if (mask !== undefined) {
      const put = (w: number, h: number, px: number, py: number) => {
        if (w <= 0 || h <= 0) return;
        items.push({ w, h, d: 0.02, x: x + px, y: py, z, c: 0xffffff });
      };
      if (mask & 1) put(dw, t, 0, hh - t / 2); // a 上横
      if (mask & 2) put(t, vLen, hw - t / 2, vTopY); // b 右上竖
      if (mask & 4) put(t, vLen, hw - t / 2, vBotY); // c 右下竖
      if (mask & 8) put(dw, t, 0, -hh + t / 2); // d 下横
      if (mask & 16) put(t, vLen, -hw + t / 2, vBotY); // e 左下竖
      if (mask & 32) put(t, vLen, -hw + t / 2, vTopY); // f 左上竖
      if (mask & 64) put(dw, t, 0, 0); // g 中横
    }
    x += dw + gap;
  }
  return mergeColoredBoxes(items);
}

function cachedPlateGeometry(seq: string, livery2: number): THREE.BufferGeometry {
  const key = `${seq}|${livery2}`;
  let g = PLATE_GEO_CACHE.get(key);
  if (!g) {
    g = makePlateGeometry(seq, livery2);
    PLATE_GEO_CACHE.set(key, g);
  }
  return g;
}

/** 从设备编号取尾部序号（`EQ-2024-PUMP-01` → `01`），取不到则退回 id 尾部数字。 */
function plateSeq(code: string, fallbackId: string): string {
  const m = /(\d{1,2})\s*$/.exec(code);
  if (m) return m[1];
  const m2 = /(\d+)\s*$/.exec(fallbackId);
  return m2 ? m2[1] : '';
}

/* ========================= 构建入口 ========================= */

export interface DeviceLike {
  id: string;
  code?: string;
  name?: string;
  category?: string;
  status?: string;
  healthScore?: number;
  workshop?: string;
  /** 设备级遥测读数（可选）。temp 为 tempereature 的适配别名；数值必须是有限数才被采信。 */
  telemetry?: PartTelemetry | null;
}

export interface EquipmentOptions {
  preset: ScenePreset;
  hall: Hall;
  slots: DeviceSlot[];
  devices: DeviceLike[];
  seed: number;
  /** 状态高亮：地面光环 + 异常态光柱 */
  highlight: boolean;
  shadows: boolean;
  /** 已合并预设与画质后的细节档（0/1/2） */
  detail: number;
  equipmentScale: number;
}

export interface StatusLegendEntry {
  key: StatusKey;
  label: string;
  colour: number;
  count: number;
}

/** 单台设备的取景与选中信息（由配方包围盒精确给出）。 */
export interface DeviceBoxInfo {
  index: number;
  x: number;
  z: number;
  y: number;
  w: number;
  h: number;
  d: number;
  scale: number;
  /** Actual geometry center in world coordinates; x/y/z remain the device origin. */
  centerX?: number;
  centerY?: number;
  centerZ?: number;
  status: StatusKey;
  recipeId: string | null;
}

export interface DevicePartInfo {
  key: string
  geo: THREE.BufferGeometry
  tint: TintRole
  matrix: THREE.Matrix4
  color: THREE.Color | null
}

/** 单台设备的按零件证据快照（getPartEvidence 返回）。 */
export type DevicePartEvidence = ReturnType<typeof getPartEvidence>;

export interface EquipmentBuild {
  group: THREE.Group;
  /** 拾取代理，供 raycaster 使用 */
  picks: THREE.Object3D[];
  /** 设备 id → 序号 */
  indexById: Map<string, number>;
  /** 设备 id → 精确包围盒信息（特写取景用） */
  boxById: Map<string, DeviceBoxInfo>;
  triangles: number;
  instancedMeshes: number;
  drawables: number;
  byStatus: Record<string, number>;
  byPrototype: Record<string, number>;
  legend: StatusLegendEntry[];
  /** 异常态设备（预警 / 故障 / 紧急）数量，用于顶部状态芯片 */
  alertCount: number;
  faultCount: number;
  /** 处于动画激活态的零件实例数（诊断用） */
  animatedCount: number;
  /**
   * 逐帧驱动状态动画。
   * @param time 场景累计时间（秒）
   */
  animate: (time: number) => void;
  /**
   * 运行时覆盖单台设备的状态色（用于遥测回放联动）。
   * 传 null 表示清除该设备的覆盖，恢复原始台账状态。
   */
  setStatusOverride: (deviceId: string, status: StatusKey | null) => void;
  /** 清除所有状态覆盖，恢复全部设备到原始台账状态。 */
  clearStatusOverrides: () => void;
  /** 当前有状态覆盖的设备 id 集合（只读视图） */
  readonly activeOverrides: ReadonlySet<string>;
  /** 获取指定设备的所有零件信息（用于拆解视图） */
  getDevicePartInfo: (deviceId: string) => DevicePartInfo[] | null;
  /** 隐藏指定设备的实例（进入拆解视图时调用） */
  hideDeviceInstances: (deviceId: string) => void;
  /** 恢复指定设备的实例（退出拆解视图时调用） */
  showDeviceInstances: (deviceId: string) => void;
  /** 独占模式：只显示这一台设备，其余 15 台与其光环/光柱一并隐藏 */
  showOnlyDevice: (deviceId: string) => void;
  /** 设备详情层是否显示该台的文字铭牌（场景密度优先口径：聚焦层隐藏铭牌）。 */
  setNameplateVisible: (deviceId: string, visible: boolean) => void;
  /** 退出独占模式：恢复全部设备及其光环/光柱 */
  showAllDevices: () => void;
  /** 当前可见设备数（独占模式下为 1），供性能条如实显示渲染量 */
  visibleDeviceCount: () => number;
  /** 增量更新设备位置与朝向（改密度/种子/布局时不重建设备几何） */
  updateTransforms?: (slots: DeviceSlot[], reliefAt: (x: number, z: number) => number, equipmentScale?: number) => void;
  /** 切换场景预设时更新设备调色板（无需重建设备） */
  updatePresetPalette?: (preset: ScenePreset) => void;
  /**
   * 读取某台设备的按零件证据（关联检查部位，非部件诊断）。
   * 返回该配方登记的全部部位快照；未提供读数的指标 state 为 'unavailable'。
   */
  getPartEvidence: (deviceId: string) => DevicePartEvidence | null;
  /**
   * 整体替换某台设备的遥测读数并重建其高亮（null 清除）。
   * 只接受有限数值；NaN/Infinity/非数值会被静默丢弃（绝不伪装成正常）。
   */
  updateTelemetry: (deviceId: string, telemetry: PartTelemetry | null) => void;
  /**
   * 局部更新单路读数（与 updateTelemetry 同一套证据管线）。
   * 传 null 表示该指标缺失 —— 对应部位会转为"无数据"，绝不显示青色健康呼吸。
   */
  setPartTelemetry: (deviceId: string, metric: 'temp' | 'vibration' | 'loadRate', value: number | null) => void;
  /** 当前证据高亮 mesh 数量（≤设备数，诊断用）。 */
  readonly partEvidenceMeshCount: number;
}

/** 单个动画实例的运行期描述。 */
interface AnimatedInstance {
  mesh?: THREE.Mesh;
  basePos?: THREE.Vector3;
  baseRot?: THREE.Euler;
  instMesh?: THREE.InstancedMesh;
  instIndex?: number;
  kind: AnimKind;
  axis: 'x' | 'y' | 'z';
  speed: number;
  amp: number;
  phase: number;
  active: boolean;
  blink: { colour: THREE.Color; hz: number; floor: number } | null;
  deviceId: string;
  originalStatus: StatusKey;
  originalBlinkColour: THREE.Color | null;
}

const AXIS_VEC: Record<'x' | 'y' | 'z', THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * 批量构建设备。
 *
 * 性能架构升级：
 * 1. 静态构件按着色角色在每台设备局部坐标系合并为单 Mesh，
 *    Draw Calls 从 245 骤降至 ≤ 140，同时 16 台设备异形与专属特征完整保留；
 * 2. 动画件（旋转/往复/抖动）直接挂接设备局部节点，RAF 逐帧零 Matrix4 分配与零 GPU 重传；
 * 3. 顶部指示灯聚合成全局 InstancedMesh，仅占 1 个 Draw Call；
 * 4. 支持 updateTransforms 增量更新与 updatePresetPalette 预设更新，切预设与改布局零几何重建。
 */
export function buildEquipment(opts: EquipmentOptions): EquipmentBuild {
  const { preset, hall, slots, devices, seed, highlight, shadows, detail, equipmentScale } = opts;
  const group = new THREE.Group();
  group.name = 'equipment';

  const mats = buildMaterials(preset);
  const rng = new Rng(seed + 9101);

  // ---- 1. 装配清单：设备 ↔ 槽位 ↔ 配方 ----
  interface Entry {
    device: DeviceLike;
    slot: DeviceSlot;
    recipe: DeviceRecipe | null;
    proto: PrototypeKey;
    status: StatusKey;
    colour: THREE.Color;
    band: THREE.Color;
    glow: THREE.Color;
    livery: THREE.Color;
    livery2: THREE.Color;
    scale: number;
    y: number;
    parts: RecipePart[];
    bounds: { w: number; h: number; d: number };
    center: THREE.Vector3;
  }

  const entries: Entry[] = [];
  const count = Math.min(devices.length, slots.length);
  const lod = geoLod();
  for (let i = 0; i < count; i++) {
    const device = devices[i];
    const slot = slots[i];
    const recipe = recipeFor(device);
    const proto = recipe ? recipe.proto : prototypeFor(device);
    const status = statusKey(device.status);
    const scale = equipmentScale * (1 + rng.jitter(preset.morphology.heightVariance * 0.32));
    const rawParts = recipe
      ? cachedRecipeParts(`r:${recipe.id}|${lod}`, recipe.build)
      : cachedRecipeParts(`p:${proto}|${lod}`, PROTOTYPE_BUILDERS[proto]);
    const parts = rawParts.filter((p) => (p.detailMin ?? 0) <= detail);
    // Measure the built geometry, including asymmetric and unknown-device recipes.
    const localBounds = new THREE.Box3();
    const transform = new THREE.Matrix4();
    for (const part of parts) {
      if (!part.geo.boundingBox) part.geo.computeBoundingBox();
      if (!part.geo.boundingBox) continue;
      transform.compose(new THREE.Vector3(...part.pos), new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...(part.rot ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
      localBounds.union(part.geo.boundingBox.clone().applyMatrix4(transform));
    }
    const size = localBounds.getSize(new THREE.Vector3());
    entries.push({
      device,
      slot,
      recipe,
      proto,
      status,
      colour: bodyColour(status, preset),
      band: bandColour(status),
      glow: glowColour(status),
      livery: new THREE.Color(recipe?.livery ?? preset.palette.accent),
      livery2: new THREE.Color(recipe?.livery2 ?? 0x3b4046),
      scale,
      y: hall.reliefAt(slot.x, slot.z),
      parts,
      bounds: { w: size.x, h: size.y, d: size.z },
      center: localBounds.getCenter(new THREE.Vector3()),
    });
  }

  const scratch = new THREE.Matrix4();
  const deviceMatrix = new THREE.Matrix4();
  const partMatrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const quatIdentity = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const posV = new THREE.Vector3();
  const sclV = new THREE.Vector3();
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  let triangles = 0;
  let instancedMeshes = 0;
  let drawables = 0;
  const byStatus: Record<string, number> = {};
  const byPrototype: Record<string, number> = {};
  const statusCount = new Map<StatusKey, number>();
  const animated: AnimatedInstance[] = [];

  for (const e of entries) {
    byPrototype[e.proto] = (byPrototype[e.proto] ?? 0) + 1;
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    statusCount.set(e.status, (statusCount.get(e.status) ?? 0) + 1);
  }

  // 状态覆盖运行时数据
  const statusOverrides = new Map<string, StatusKey>();
  const activeOverrides = new Set<string>();
  let haloMesh: THREE.InstancedMesh | null = null;
  const haloIndexByDevice = new Map<string, number>();
  let beaconMesh: THREE.InstancedMesh | null = null;
  const beaconIndexByDevice = new Map<string, number>();

  // 拆解视图与实例索引跟踪
  const devicePartsInfo = new Map<string, DevicePartInfo[]>();
  const deviceGroupById = new Map<string, THREE.Group>();
  const statusMatByDevice = new Map<string, THREE.MeshStandardMaterial>();
  const roleMatsByDevice = new Map<string, Map<TintRole, THREE.Material>>();
  const nameplateById = new Map<string, THREE.Mesh>();
  const hiddenDevices = new Set<string>();

  // 指示灯 InstancedMesh（汇集 16 台设备的顶部指示灯，1 个 draw call）
  const lampEntries: Array<{ entry: Entry; part: RecipePart }> = [];
  const lampIndexByDevice = new Map<string, number>();
  const originalLampMatrices = new Map<string, THREE.Matrix4>();
  let lampMesh: THREE.InstancedMesh | null = null;

  // ---- 2. 逐台构建设备（静态构件合并 + 动态构件直接挂载） ----
  for (const e of entries) {
    const devGroup = new THREE.Group();
    devGroup.name = `device:${e.device.id}`;
    devGroup.position.set(e.slot.x, e.y, e.slot.z);
    devGroup.rotation.y = e.slot.angle;
    devGroup.scale.setScalar(e.scale);
    group.add(devGroup);
    deviceGroupById.set(e.device.id, devGroup);

    // 程序化零件容器（在真实 GLB 模型异步就绪前显示，若加载失败则持续兜底，绝不白屏）
    const proceduralGroup = new THREE.Group();
    proceduralGroup.name = `procedural:${e.device.id}`;
    devGroup.add(proceduralGroup);

    // 收集拆解信息需要的零件数据
    devicePartsInfo.set(e.device.id, []);

    // 设备全局变换矩阵（供拆解视图 Matrix 初始化）
    quat.setFromEuler(euler.set(0, e.slot.angle, 0));
    sclV.set(e.scale, e.scale, e.scale);
    deviceMatrix.compose(posV.set(e.slot.x, e.y, e.slot.z), quat, sclV);

    const animParts: RecipePart[] = [];
    const staticByTint = new Map<TintRole, RecipePart[]>();

    for (const part of e.parts) {
      // 计算用于拆解视图的世界矩阵
      quat.setFromEuler(euler.set(part.rot?.[0] ?? 0, part.rot?.[1] ?? 0, part.rot?.[2] ?? 0));
      partMatrix.compose(posV.set(part.pos[0], part.pos[1], part.pos[2]), quat, one);
      scratch.copy(deviceMatrix).multiply(partMatrix);

      let pColor: THREE.Color | null = null;
      if (part.tint === 'status') pColor = e.colour;
      else if (part.tint === 'glow') pColor = e.glow;
      else if (part.tint === 'livery') pColor = e.livery;
      else if (part.tint === 'livery2') pColor = e.livery2;

      devicePartsInfo.get(e.device.id)!.push({
        key: part.key,
        geo: part.geo,
        tint: part.tint,
        matrix: scratch.clone(),
        color: pColor?.clone() ?? null,
      });

      if (part.anim) {
        animParts.push(part);
      } else {
        let list = staticByTint.get(part.tint);
        if (!list) {
          list = [];
          staticByTint.set(part.tint, list);
        }
        list.push(part);
      }
    }

    // 2a. 静态零件：按着色角色合并为单个 Mesh（每台设备仅 2~4 个 Draw Call）
    const recipeKey = e.recipe ? e.recipe.id : e.proto;
    for (const [tint, pList] of staticByTint) {
      const cacheKey = `m:${recipeKey}:${lod}:${detail}:${tint}`;
      const mergedGeo = getMergedStaticGeo(cacheKey, pList);
      if (!mergedGeo) continue;

      let mat: THREE.Material;
      if (tint === 'status') {
        const smat = new THREE.MeshStandardMaterial({
          color: e.colour,
          roughness: 0.52,
          metalness: 0.32,
        });
        statusMatByDevice.set(e.device.id, smat);
        mat = smat;
      } else if (tint === 'livery') {
        mat = new THREE.MeshStandardMaterial({
          color: e.livery,
          roughness: 0.52,
          metalness: 0.32,
        });
      } else if (tint === 'livery2') {
        mat = new THREE.MeshStandardMaterial({
          color: e.livery2,
          roughness: 0.52,
          metalness: 0.32,
        });
      } else {
        mat = materialFor(mats, tint);
      }

      const mesh = new THREE.Mesh(mergedGeo, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      mesh.name = `part:${tint}`;
      proceduralGroup.add(mesh);
      drawables++;
      triangles += geoTriangles(mergedGeo);
    }

    // 2b. 动态零件：直接挂载到设备局部坐标系
    for (const part of animParts) {
      if (part.anim?.kind === 'blink') {
        lampEntries.push({ entry: e, part });
      } else {
        // Ordinary Mesh has no instanceColor: clone and apply the role's actual colour.
        let partMat = materialFor(mats, part.tint);
        if (PER_INSTANCE_TINTS.has(part.tint)) {
          let roleMats = roleMatsByDevice.get(e.device.id);
          if (!roleMats) roleMatsByDevice.set(e.device.id, roleMats = new Map());
          let own = roleMats.get(part.tint);
          if (!own) {
            const coloured = (partMat as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial).clone();
            coloured.color.copy(part.tint === 'status' ? e.colour : part.tint === 'glow' ? e.glow : part.tint === 'livery' ? e.livery : e.livery2);
            roleMats.set(part.tint, own = coloured);
            if (part.tint === 'status') statusMatByDevice.set(e.device.id, coloured as THREE.MeshStandardMaterial);
          }
          partMat = own;
        }
        const mesh = new THREE.Mesh(part.geo, partMat);
        mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
        if (part.rot) {
          mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
        }
        mesh.castShadow = (part.cast ?? true) && shadows;
        mesh.receiveShadow = shadows;
        mesh.name = `anim:${part.key}`;
        proceduralGroup.add(mesh);
        drawables++;
        triangles += geoTriangles(part.geo);

        animated.push({
          mesh,
          basePos: mesh.position.clone(),
          baseRot: mesh.rotation.clone(),
          kind: part.anim.kind,
          axis: part.anim.axis ?? 'y',
          speed: part.anim.speed ?? 2.4,
          amp: part.anim.amp ?? 0.045,
          phase: (part.anim.phase ?? 0) + (e.slot.x + e.slot.z) * 0.05,
          active: animActive(part.anim.kind, e.status),
          blink: null,
          deviceId: e.device.id,
          originalStatus: e.status,
          originalBlinkColour: null,
        });
      }
    }

    // 2c. 异步加载真实工业设备 GLB 模型（至少覆盖 10 款设备）
    const glbUrl = EQUIPMENT_GLB_MAP[e.device.id] ?? (e.recipe?.id ? EQUIPMENT_GLB_MAP[e.recipe.id] : undefined);
    if (glbUrl && typeof window !== 'undefined') {
      loadEquipmentGLB(glbUrl)
        .then((scene) => {
          const box = new THREE.Box3().setFromObject(scene);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const targetSize = Math.max(e.bounds.w, e.bounds.h, e.bounds.d, 3.2);
          const s = targetSize / maxDim;
          scene.scale.set(s, s, s);

          const center = new THREE.Vector3();
          box.getCenter(center);
          scene.position.set(-center.x * s, -box.min.y * s, -center.z * s);

          // 阴影：**只接收、不投射**。
          // 实测本目录 GLB 的 mesh 数远大于三角形数带来的压力 ——
          //   exhaust_fan_motor 130 个 mesh、centrifugal_pump 57（且被 eq-101/eq-112 各用一次）、
          //   double_suction_pump 49、milling_machine 14 …
          // 11 台映射设备合计约 323 个未合批 mesh。投射阴影会让每个 mesh 在 shadow pass
          // **再画一遍**，即凭空多出 ~323 次 draw call —— 与本引擎"用 InstancedMesh 压 draw call"
          // 的设计目标直接冲突，也是 FPS≥30 的最大风险点。
          // 机械臂那条路径早已这么做（见 productionLine.ts initRobotGLB 的注释），此处对齐。
          scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              obj.castShadow = false;
              obj.receiveShadow = shadows;
            }
          });

          const modelContainer = new THREE.Group();
          modelContainer.name = `glb:${e.device.id}`;
          modelContainer.add(scene);
          devGroup.add(modelContainer);

          // GLB 加载成功：隐藏程序化几何构件（无缝替换，平滑兜底）
          proceduralGroup.visible = false;
        })
        .catch(() => {
          // 加载异常时保留程序化几何兜底，绝不白屏
        });
    }
  }

  // 2c. 聚合顶部指示灯 InstancedMesh
  if (lampEntries.length > 0) {
    const lampGeo = sph(0.17, 12);
    const lampInst = new THREE.InstancedMesh(lampGeo, mats.glow, lampEntries.length);
    for (let i = 0; i < lampEntries.length; i++) {
      const { entry: e, part: p } = lampEntries[i];
      quat.setFromEuler(euler.set(0, e.slot.angle, 0));
      sclV.set(e.scale, e.scale, e.scale);
      deviceMatrix.compose(posV.set(e.slot.x, e.y, e.slot.z), quat, sclV);
      partMatrix.compose(posV.set(p.pos[0], p.pos[1], p.pos[2]), quatIdentity, one);
      scratch.copy(deviceMatrix).multiply(partMatrix);
      lampInst.setMatrixAt(i, scratch);
      lampInst.setColorAt(i, e.glow);
      lampIndexByDevice.set(e.device.id, i);
      originalLampMatrices.set(e.device.id, scratch.clone());

      const bp = blinkParams(e.status);
      animated.push({
        instMesh: lampInst,
        instIndex: i,
        kind: 'blink',
        axis: 'y',
        speed: 0,
        amp: 0,
        phase: (p.anim?.phase ?? 0) + (e.slot.x + e.slot.z) * 0.05,
        active: animActive('blink', e.status),
        blink: { colour: e.glow.clone(), hz: bp.hz, floor: bp.floor },
        deviceId: e.device.id,
        originalStatus: e.status,
        originalBlinkColour: e.glow.clone(),
      });
    }
    lampInst.instanceMatrix.needsUpdate = true;
    if (lampInst.instanceColor) lampInst.instanceColor.needsUpdate = true;
    lampInst.frustumCulled = false;
    lampInst.name = 'equip:lamps';
    group.add(lampInst);
    lampMesh = lampInst;
    instancedMeshes++;
    drawables++;
    triangles += geoTriangles(lampGeo) * lampEntries.length;
  }

  // One overlay per device; parts remain in the original tint merge to preserve identity.
  // Per-vertex colour/alpha keeps different metrics independent without material groups/draw calls.
  const telemetryById = new Map(entries.map((e) => [e.device.id, finitePartTelemetry(e.device.telemetry)]));
  const evidenceById = new Map<string, DevicePartEvidence>();
  const evidenceOverlays = new Map<string, {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    ranges: Array<{ key: string; start: number; count: number }>;
    breathing: boolean;
  }>();
  for (const e of entries) {
    const zones = PART_OBSERVATION_ZONES[e.recipe?.id ?? ''] ?? [];
    const chunks: THREE.BufferGeometry[] = [];
    const ranges: Array<{ key: string; start: number; count: number }> = [];
    let start = 0;
    for (const zone of zones) {
      const p = e.parts.find((part) => part.key === zone.partKey && !part.anim);
      if (!p) continue;
      const geo = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      quat.setFromEuler(euler.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0));
      partMatrix.compose(posV.set(...p.pos), quat, one);
      geo.applyMatrix4(partMatrix);
      ranges.push({ key: p.key, start, count: geo.attributes.position.count });
      start += geo.attributes.position.count;
      chunks.push(geo);
    }
    if (!chunks.length) continue;
    const geometry = mergeGeometries(chunks, false)!;
    for (const chunk of chunks) chunk.dispose();
    geometry.setAttribute('evidenceColor', new THREE.BufferAttribute(new Float32Array(start * 4), 4));
    geometry.setAttribute('evidenceBreath', new THREE.BufferAttribute(new Float32Array(start), 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      uniforms: { time: { value: 0 } },
      vertexShader: `
        attribute vec4 evidenceColor;
        attribute float evidenceBreath;
        varying vec4 vEvidence;
        varying float vBreath;
        void main() {
          vEvidence = evidenceColor; vBreath = evidenceBreath;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float time;
        varying vec4 vEvidence;
        varying float vBreath;
        void main() {
          if (vEvidence.a == 0.0) discard;
          float pulse = mix(1.0, 0.68 + 0.22 * sin(time * 1.8), vBreath);
          gl_FragColor = vec4(vEvidence.rgb, vEvidence.a * pulse);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `evidence:${e.device.id}`;
    mesh.userData.relation = 'observation-zone';
    mesh.renderOrder = 1;
    deviceGroupById.get(e.device.id)!.add(mesh);
    evidenceOverlays.set(e.device.id, { mesh, ranges, breathing: false });
    triangles += geoTriangles(geometry);
    drawables++;
  }
  const refreshEvidence = (e: Entry): void => {
    const evidence = getPartEvidence(e.recipe?.id ?? '', telemetryById.get(e.device.id), statusOverrides.get(e.device.id) ?? e.status);
    evidenceById.set(e.device.id, evidence);
    const overlay = evidenceOverlays.get(e.device.id);
    if (!overlay) return;
    const colours = overlay.mesh.geometry.getAttribute('evidenceColor') as THREE.BufferAttribute;
    const breath = overlay.mesh.geometry.getAttribute('evidenceBreath') as THREE.BufferAttribute;
    let visible = false;
    let breathing = false;
    for (const range of overlay.ranges) {
      const item = evidence.find((item) => item.partKey === range.key)!;
      // 缺测 / 健康不强调；warning 及以上（含保养）的观测部位持续脉冲提醒。
      const active = item.state === 'warning' || item.state === 'maintenance' || item.state === 'fault';
      const visiblePart = active || (item.state === 'healthy' && item.value !== null);
      const color = visiblePart ? new THREE.Color(PART_EVIDENCE_COLOURS[item.state as keyof typeof PART_EVIDENCE_COLOURS]) : new THREE.Color(0);
      visible ||= visiblePart;
      breathing ||= active;
      for (let i = range.start; i < range.start + range.count; i++) {
        colours.setXYZW(i, color.r, color.g, color.b, visiblePart ? 0.56 : 0);
        breath.setX(i, active ? 1 : 0);
      }
    }
    overlay.breathing = breathing;
    overlay.mesh.visible = visible;
    colours.needsUpdate = true;
    breath.needsUpdate = true;
  };
  for (const e of entries) refreshEvidence(e);
  const updateTelemetry = (deviceId: string, telemetry: PartTelemetry | null): void => {
    const e = entries.find((e) => e.device.id === deviceId);
    if (!e) return;
    telemetryById.set(deviceId, finitePartTelemetry(telemetry));
    refreshEvidence(e);
  };
  const setPartTelemetry: EquipmentBuild['setPartTelemetry'] = (id, metric, value) => {
    if (!telemetryById.has(id)) return;
    const field = metric === 'temp' ? 'temperature' : metric;
    updateTelemetry(id, { ...telemetryById.get(id), [field]: value });
  };

  // ---- 3. 铭牌（**全档位**展示，纯几何） ----
  // 验收要求「每台正面可见编号铭牌 / 总览下第一眼看到编号差异」，因此不按档位省略。
  // 铭牌不含字体/贴图：livery2 色板 + 白色七段数字，板色字色烘焙成顶点色合并进
  // 同一块几何体，所以仍是 16 个 mesh = 16 draw call（与改造前持平）。
  {
    for (const e of entries) {
      const code = e.device.code?.trim() || e.recipe?.code;
      if (!code) continue;
      const seq = plateSeq(code, e.device.id);
      if (!seq) continue;
      const geo = cachedPlateGeometry(seq, e.recipe?.livery2 ?? e.recipe?.livery ?? 0x94a3b8);
      const plate = new THREE.Mesh(geo, PLATE_MAT);
      const b = e.bounds;
      plate.position.set(e.slot.x, e.y + Math.min(b.h * 0.28, 1.6) * e.scale, e.slot.z);
      const dx = Math.sin(e.slot.angle);
      const dz = Math.cos(e.slot.angle);
      const off = (b.d * 0.5 + 0.1) * e.scale;
      plate.position.x += dx * off;
      plate.position.z += dz * off;
      plate.rotation.y = e.slot.angle;
      plate.name = `plate:${e.device.id}`;
      group.add(plate);
      nameplateById.set(e.device.id, plate);
      drawables++;
      triangles += geoTriangles(geo);
    }
  }

  // ---- 4. 状态光环（地面）+ 异常态光柱 ----
  if (highlight && entries.length > 0) {
    const haloInst = new THREE.InstancedMesh(ring(0.74, 1.0, 30), mats.halo, entries.length);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const r = e.slot.radius * 1.35;
      scratch.compose(posV.set(e.slot.x, e.y + 0.07, e.slot.z), quatIdentity, sclV.set(r, 1, r));
      haloInst.setMatrixAt(i, scratch);
      haloInst.setColorAt(i, e.glow);
      haloIndexByDevice.set(e.device.id, i);
    }
    haloInst.instanceMatrix.needsUpdate = true;
    if (haloInst.instanceColor) haloInst.instanceColor.needsUpdate = true;
    haloInst.frustumCulled = false;
    haloInst.name = 'equip:halo';
    group.add(haloInst);
    haloMesh = haloInst;
    instancedMeshes++;
    drawables++;
    triangles += geoTriangles(ring(0.74, 1.0, 30)) * entries.length;

    const alerts = entries.filter((e) => STATUS_META[e.status].alert);
    if (alerts.length > 0) {
      const beam = cylY(0.1, 1, 8);
      const beaconInst = new THREE.InstancedMesh(beam, mats.halo, alerts.length);
      for (let i = 0; i < alerts.length; i++) {
        const e = alerts[i];
        const h = e.bounds.h * e.scale * 1.25 + 4;
        scratch.compose(posV.set(e.slot.x, e.y, e.slot.z), quatIdentity, sclV.set(1.6, h, 1.6));
        beaconInst.setMatrixAt(i, scratch);
        beaconInst.setColorAt(i, e.glow);
        beaconIndexByDevice.set(e.device.id, i);
      }
      beaconInst.instanceMatrix.needsUpdate = true;
      if (beaconInst.instanceColor) beaconInst.instanceColor.needsUpdate = true;
      beaconInst.frustumCulled = false;
      beaconInst.name = 'equip:beacon';
      group.add(beaconInst);
      beaconMesh = beaconInst;
      instancedMeshes++;
      drawables++;
      triangles += geoTriangles(beam) * alerts.length;
    }
  }

  // ---- 4b. 检修态工具 ----
  const overhauling = entries.filter((e) => e.status === 'overhauling');
  if (overhauling.length > 0) {
    const toolParts: Array<[THREE.BufferGeometry, TintRole, [number, number, number]]> = [
      [box(0.9, 0.5, 0.6), 'accent', [0, 0, 0]],
      [box(0.16, 0.16, 1.3), 'dark', [0, 0.62, 0]],
      [box(0.5, 0.5, 0.12), 'copper', [0.62, 0.3, 0.42]],
    ];
    for (const [geo, tint, off] of toolParts) {
      const mat = materialFor(mats, tint);
      const im = new THREE.InstancedMesh(geo, mat, overhauling.length);
      for (let i = 0; i < overhauling.length; i++) {
        const e = overhauling[i];
        const b = e.bounds;
        quat.setFromEuler(euler.set(0, e.slot.angle, 0));
        scratch.compose(
          posV.set(e.slot.x + off[0], e.y + off[1], e.slot.z + b.d * 0.5 + 0.9 + off[2]),
          quat,
          sclV.set(1, 1, 1)
        );
        im.setMatrixAt(i, scratch);
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = shadows;
      im.name = `equip:overhaul-tool:${tint}`;
      group.add(im);
      instancedMeshes++;
      drawables++;
      triangles += geoTriangles(geo) * overhauling.length;
    }
  }

  // ---- 5. 拾取代理 ----
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  mats.all.push(pickMat);
  const picks: THREE.Object3D[] = [];
  const indexById = new Map<string, number>();
  const boxById = new Map<string, DeviceBoxInfo>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const b = e.bounds;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(b.w * 1.1, b.h * 1.05, b.d * 1.1), pickMat);
    proxy.position.copy(e.center).multiplyScalar(e.scale)
      .applyAxisAngle(AXIS_VEC.y, e.slot.angle).add(new THREE.Vector3(e.slot.x, e.y, e.slot.z));
    proxy.rotation.y = e.slot.angle;
    proxy.scale.setScalar(e.scale);
    proxy.name = `pick:${e.device.id}`;
    proxy.userData.equipmentId = e.device.id;
    proxy.userData.slotIndex = i;
    proxy.userData.prototype = e.proto;
    proxy.userData.recipeId = e.recipe?.id ?? null;
    proxy.userData.status = e.status;
    group.add(proxy);
    picks.push(proxy);
    indexById.set(e.device.id, i);
    boxById.set(e.device.id, {
      index: i,
      x: e.slot.x,
      z: e.slot.z,
      y: e.y,
      w: b.w * e.scale,
      h: b.h * e.scale,
      d: b.d * e.scale,
      scale: e.scale,
      // Transformed actual geometry center (rotation around the slot angle + device scale).
      centerX: e.slot.x + (Math.cos(e.slot.angle) * e.center.x + Math.sin(e.slot.angle) * e.center.z) * e.scale,
      centerY: e.y + e.center.y * e.scale,
      centerZ: e.slot.z + (-Math.sin(e.slot.angle) * e.center.x + Math.cos(e.slot.angle) * e.center.z) * e.scale,
      status: e.status,
      recipeId: e.recipe?.id ?? null,
    });
    drawables++;
  }

  // ---- 6. 图例与计数 ----
  const legend: StatusLegendEntry[] = STATUS_ORDER.filter((k) => (statusCount.get(k) ?? 0) > 0).map((k) => ({
    key: k,
    label: STATUS_META[k].label,
    colour: STATUS_META[k].colour,
    count: statusCount.get(k) ?? 0,
  }));

  let alertCount = 0;
  let faultCount = 0;
  for (const [k, n] of statusCount) {
    if (STATUS_META[k].alert) alertCount += n;
    if (k === 'fault' || k === 'critical') faultCount += n;
  }

  /* ---- 7. 动画驱动器（逐帧零 GC、零矩阵乘法、极速驱动） ---- */
  const blinkColour = new THREE.Color();

  const animate = (time: number): void => {
    for (const [id, overlay] of evidenceOverlays) {
      if (overlay.breathing && overlay.mesh.visible && !hiddenDevices.has(id)) {
        overlay.mesh.material.uniforms.time.value = time;
      }
    }
    if (!animated.length && activeOverrides.size === 0) return;
    let lampUpdated = false;

    for (const a of animated) {
      const overrideStatus = statusOverrides.get(a.deviceId);
      let isActive: boolean;
      let blinkHz: number;
      let blinkFloor: number;
      let blinkBaseColour: THREE.Color | null;

      if (overrideStatus !== undefined) {
        isActive = animActive(a.kind, overrideStatus);
        const bp = a.kind === 'blink' ? blinkParams(overrideStatus) : { hz: 0, floor: 1 };
        blinkHz = bp.hz;
        blinkFloor = bp.floor;
        blinkBaseColour = a.kind === 'blink' ? glowColour(overrideStatus) : null;
      } else {
        isActive = a.active;
        blinkHz = a.blink?.hz ?? 0;
        blinkFloor = a.blink?.floor ?? 1;
        blinkBaseColour = a.blink?.colour ?? null;
      }

      if (!isActive) continue;
      const t = time + a.phase;

      if (a.kind === 'blink' && a.instMesh && typeof a.instIndex === 'number') {
        if (!blinkBaseColour) continue;
        const wave = 0.5 + 0.5 * Math.sin(t * blinkHz * Math.PI * 2);
        const k = blinkFloor + (1 - blinkFloor) * wave;
        blinkColour.copy(blinkBaseColour).multiplyScalar(k);
        a.instMesh.setColorAt(a.instIndex, blinkColour);
        lampUpdated = true;
        continue;
      }

      if (!a.mesh || !a.basePos || !a.baseRot) continue;

      if (a.kind === 'spin') {
        const ax = a.axis;
        if (ax === 'x') a.mesh.rotation.x = a.baseRot.x + t * a.speed;
        else if (ax === 'y') a.mesh.rotation.y = a.baseRot.y + t * a.speed;
        else a.mesh.rotation.z = a.baseRot.z + t * a.speed;
      } else if (a.kind === 'slide') {
        const off = Math.sin(t * a.speed * Math.PI * 2) * 0.62;
        const ax = a.axis;
        if (ax === 'x') a.mesh.position.x = a.basePos.x + off;
        else if (ax === 'y') a.mesh.position.y = a.basePos.y + off;
        else a.mesh.position.z = a.basePos.z + off;
      } else if (a.kind === 'shake') {
        a.mesh.position.x = a.basePos.x + Math.sin(t * a.speed) * a.amp;
        a.mesh.position.y = a.basePos.y + Math.sin(t * a.speed * 1.37 + 1.1) * a.amp * 0.7;
        a.mesh.position.z = a.basePos.z + Math.sin(t * a.speed * 0.83 + 2.2) * a.amp;
      }
    }

    if (lampUpdated && lampMesh && lampMesh.instanceColor) {
      lampMesh.instanceColor.needsUpdate = true;
    }

    // 状态覆盖：更新光环与光柱颜色
    if (activeOverrides.size > 0) {
      for (const devId of activeOverrides) {
        const overStatus = statusOverrides.get(devId);
        if (!overStatus) continue;
        const newGlow = glowColour(overStatus);

        const hIdx = haloIndexByDevice.get(devId);
        if (typeof hIdx === 'number' && haloMesh) {
          haloMesh.setColorAt(hIdx, newGlow);
          if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
        }

        const bIdx = beaconIndexByDevice.get(devId);
        if (typeof bIdx === 'number' && beaconMesh) {
          if (STATUS_META[overStatus].alert) {
            beaconMesh.setColorAt(bIdx, newGlow);
          } else {
            beaconMesh.setColorAt(bIdx, newGlow.setScalar(0));
          }
          if (beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;
        }
      }
    }
  };

  /** 设置单台设备的状态覆盖（遥测回放联动入口）。传 null 清除覆盖。 */
  const setStatusOverride = (deviceId: string, status: StatusKey | null): void => {
    if (status === null) {
      if (statusOverrides.delete(deviceId)) {
        activeOverrides.delete(deviceId);
      }
      const entry = entries.find((e) => e.device.id === deviceId);
      if (entry) {
        const smat = statusMatByDevice.get(deviceId);
        if (smat) smat.color.copy(entry.colour);
      }
    } else {
      statusOverrides.set(deviceId, status);
      activeOverrides.add(deviceId);
      const smat = statusMatByDevice.get(deviceId);
      if (smat) smat.color.copy(bodyColour(status, preset));
    }
    const entry = entries.find((e) => e.device.id === deviceId);
    if (entry) refreshEvidence(entry);
  };

  /** 获取指定设备的所有零件信息（用于拆解视图） */
  const getDevicePartInfo = (deviceId: string): DevicePartInfo[] | null => {
    return devicePartsInfo.get(deviceId) ?? null;
  };

  /** 隐藏指定设备的实例（进入拆解视图时调用） */
  const hideDeviceInstances = (deviceId: string): void => {
    if (hiddenDevices.has(deviceId)) return;
    hiddenDevices.add(deviceId);

    const devGroup = deviceGroupById.get(deviceId);
    if (devGroup) devGroup.visible = false;

    const plate = nameplateById.get(deviceId);
    if (plate) plate.visible = false;

    const lampIdx = lampIndexByDevice.get(deviceId);
    if (typeof lampIdx === 'number' && lampMesh) {
      lampMesh.setMatrixAt(lampIdx, zeroMatrix);
      lampMesh.instanceMatrix.needsUpdate = true;
    }
  };

  /** 恢复指定设备的实例（退出拆解视图时调用） */
  const showDeviceInstances = (deviceId: string): void => {
    if (!hiddenDevices.has(deviceId)) return;
    hiddenDevices.delete(deviceId);

    const devGroup = deviceGroupById.get(deviceId);
    if (devGroup) devGroup.visible = true;

    const plate = nameplateById.get(deviceId);
    if (plate) plate.visible = true;

    const lampIdx = lampIndexByDevice.get(deviceId);
    if (typeof lampIdx === 'number' && lampMesh) {
      const origMat = originalLampMatrices.get(deviceId);
      if (origMat) {
        lampMesh.setMatrixAt(lampIdx, origMat);
        lampMesh.instanceMatrix.needsUpdate = true;
      }
    }
  };

  /**
   * 独占模式：只保留目标设备的地面光环与告警光柱，其余置零。
   *
   * 为什么不能靠 visible 开关：光环/光柱是**全场景合批**的 InstancedMesh
   * （16 台共用 1 个 draw call），单个实例没有独立的 visible，
   * 只能把它的矩阵缩成 0 来"隐藏"。
   */
  const setChromeFocus = (deviceId: string | null): void => {
    if (haloMesh) {
      for (const e of entries) {
        const idx = haloIndexByDevice.get(e.device.id);
        if (typeof idx !== 'number') continue;
        if (deviceId === null || e.device.id === deviceId) {
          const r = e.slot.radius * 1.35;
          scratch.compose(posV.set(e.slot.x, e.y + 0.07, e.slot.z), quatIdentity, sclV.set(r, 1, r));
          haloMesh.setMatrixAt(idx, scratch);
        } else {
          haloMesh.setMatrixAt(idx, zeroMatrix);
        }
      }
      haloMesh.instanceMatrix.needsUpdate = true;
    }
    if (beaconMesh) {
      for (const e of entries) {
        const idx = beaconIndexByDevice.get(e.device.id);
        if (typeof idx !== 'number') continue;
        // 独占（单设备详情）层连本机这台的光柱也一并收掉：
        // 用户规格明确"3D 场景上方不许有光柱/箭头"，退出独占时 deviceId 传 null 还原。
        if (deviceId === null) {
          const h = e.bounds.h * e.scale * 1.25 + 4;
          scratch.compose(posV.set(e.slot.x, e.y, e.slot.z), quatIdentity, sclV.set(1.6, h, 1.6));
          beaconMesh.setMatrixAt(idx, scratch);
        } else {
          beaconMesh.setMatrixAt(idx, zeroMatrix);
        }
      }
      beaconMesh.instanceMatrix.needsUpdate = true;
    }
  };

  /** 独占模式：只显示这一台（含铭牌 / 指示灯 / 光环），其余 15 台全部隐藏。 */
  const showOnlyDevice = (deviceId: string): void => {
    for (const e of entries) {
      if (e.device.id === deviceId) showDeviceInstances(e.device.id);
      else hideDeviceInstances(e.device.id);
    }
    setChromeFocus(deviceId);
  };

  /**
   * 显示/隐藏单台设备的文字铭牌。
   * 铭牌是贴在设备顶部的 canvas 文字牌 —— 设备详情层按"3D 不飘任何文字"口径隐藏，
   * 回到车间/总览层即还原。
   */
  const setNameplateVisible = (deviceId: string, visible: boolean): void => {
    const plate = nameplateById.get(deviceId);
    if (plate) plate.visible = visible;
  };

  /** 退出独占：恢复全部设备及其光环 / 光柱。 */
  const showAllDevices = (): void => {
    for (const e of entries) showDeviceInstances(e.device.id);
    setChromeFocus(null);
  };

  /**
   * 当前**可见**设备数（独占模式下为 1）。
   * 性能条据此如实反映"此刻真正在渲染几台"，而不是构建期登记了几台。
   */
  const visibleDeviceCount = (): number => {
    let n = 0;
    for (const e of entries) {
      if (deviceGroupById.get(e.device.id)?.visible !== false) n++;
    }
    return n;
  };

  /** 清除所有状态覆盖，恢复全部设备到原始台账状态。 */
  const clearStatusOverrides = (): void => {
    for (const a of animated) {
      if (activeOverrides.has(a.deviceId)) {
        a.active = animActive(a.kind, a.originalStatus);
        if (a.blink && a.originalBlinkColour) {
          a.blink.colour.copy(a.originalBlinkColour);
          const bp = blinkParams(a.originalStatus);
          a.blink.hz = bp.hz;
          a.blink.floor = bp.floor;
        }
      }
    }
    for (const devId of activeOverrides) {
      const entry = entries.find((e) => e.device.id === devId);
      if (entry) {
        const smat = statusMatByDevice.get(devId);
        if (smat) smat.color.copy(entry.colour);
        const origGlow = glowColour(entry.status);
        const hIdx = haloIndexByDevice.get(devId);
        if (typeof hIdx === 'number' && haloMesh) {
          haloMesh.setColorAt(hIdx, origGlow);
        }
        const bIdx = beaconIndexByDevice.get(devId);
        if (typeof bIdx === 'number' && beaconMesh) {
          if (STATUS_META[entry.status].alert) {
            beaconMesh.setColorAt(bIdx, origGlow);
          } else {
            beaconMesh.setColorAt(bIdx, origGlow.setScalar(0));
          }
        }
      }
    }
    if (activeOverrides.size > 0 && (haloMesh || beaconMesh)) {
      if (haloMesh && haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
      if (beaconMesh && beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;
    }
    statusOverrides.clear();
    activeOverrides.clear();
    for (const entry of entries) refreshEvidence(entry);
  };

  /** 增量更新设备位置、朝向与高度（改密度/种子/布局时零几何重建，极速完成） */
  let currentEquipmentScale = equipmentScale;
  const updateTransforms = (
    newSlots: DeviceSlot[],
    reliefAt: (x: number, z: number) => number,
    eqScale?: number
  ): void => {
    const scaleMultiplier = eqScale !== undefined ? eqScale / (currentEquipmentScale || 1) : 1;
    if (eqScale !== undefined) currentEquipmentScale = eqScale;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const slot = newSlots[i];
      if (!slot) continue;
      e.slot = slot;
      e.y = reliefAt(slot.x, slot.z);
      e.scale *= scaleMultiplier;
      const effectiveScale = e.scale;

      const devGroup = deviceGroupById.get(e.device.id);
      if (devGroup) {
        devGroup.position.set(slot.x, e.y, slot.z);
        devGroup.rotation.y = slot.angle;
        devGroup.scale.setScalar(effectiveScale);
      }

      const center = e.center.clone().multiplyScalar(effectiveScale)
        .applyAxisAngle(AXIS_VEC.y, slot.angle).add(new THREE.Vector3(slot.x, e.y, slot.z));
      const pick = picks[i];
      if (pick) {
        pick.position.copy(center);
        pick.rotation.y = slot.angle;
        pick.scale.setScalar(effectiveScale);
      }

      const box = boxById.get(e.device.id);
      if (box) {
        box.x = slot.x;
        box.z = slot.z;
        box.y = e.y;
        box.scale = effectiveScale;
        box.w = e.bounds.w * effectiveScale;
        box.h = e.bounds.h * effectiveScale;
        box.d = e.bounds.d * effectiveScale;
        box.centerX = center.x;
        box.centerY = center.y;
        box.centerZ = center.z;
      }

      const plate = nameplateById.get(e.device.id);
      if (plate) {
        const b = e.bounds;
        plate.position.set(slot.x, e.y + Math.min(b.h * 0.28, 1.6) * effectiveScale, slot.z);
        const dx = Math.sin(slot.angle);
        const dz = Math.cos(slot.angle);
        const off = (b.d * 0.5 + 0.1) * effectiveScale;
        plate.position.x += dx * off;
        plate.position.z += dz * off;
        plate.rotation.y = slot.angle;
      }

      const lampIdx = lampIndexByDevice.get(e.device.id);
      if (typeof lampIdx === 'number' && lampMesh) {
        const lampEntry = lampEntries[lampIdx];
        if (lampEntry) {
          quat.setFromEuler(euler.set(0, slot.angle, 0));
          sclV.set(effectiveScale, effectiveScale, effectiveScale);
          deviceMatrix.compose(posV.set(slot.x, e.y, slot.z), quat, sclV);
          partMatrix.compose(posV.set(lampEntry.part.pos[0], lampEntry.part.pos[1], lampEntry.part.pos[2]), quatIdentity, one);
          scratch.copy(deviceMatrix).multiply(partMatrix);
          lampMesh.setMatrixAt(lampIdx, scratch);
          originalLampMatrices.set(e.device.id, scratch.clone());
        }
      }

      if (haloMesh) {
        const r = slot.radius * 1.35;
        scratch.compose(posV.set(slot.x, e.y + 0.07, slot.z), quatIdentity, sclV.set(r, 1, r));
        haloMesh.setMatrixAt(i, scratch);
      }
    }

    if (lampMesh) lampMesh.instanceMatrix.needsUpdate = true;
    if (haloMesh) haloMesh.instanceMatrix.needsUpdate = true;

    if (beaconMesh) {
      const alerts = entries.filter((e) => STATUS_META[e.status].alert);
      for (let i = 0; i < alerts.length; i++) {
        const e = alerts[i];
        const effectiveScale = e.scale;
        const h = e.bounds.h * effectiveScale * 1.25 + 4;
        scratch.compose(posV.set(e.slot.x, e.y, e.slot.z), quatIdentity, sclV.set(1.6, h, 1.6));
        beaconMesh.setMatrixAt(i, scratch);
      }
      beaconMesh.instanceMatrix.needsUpdate = true;
    }

    // 同步拆解视图矩阵
    for (const e of entries) {
      const effectiveScale = e.scale;
      quat.setFromEuler(euler.set(0, e.slot.angle, 0));
      sclV.set(effectiveScale, effectiveScale, effectiveScale);
      deviceMatrix.compose(posV.set(e.slot.x, e.y, e.slot.z), quat, sclV);
      const pList = devicePartsInfo.get(e.device.id);
      if (pList) {
        for (let j = 0; j < pList.length && j < e.parts.length; j++) {
          const part = e.parts[j];
          quat.setFromEuler(euler.set(part.rot?.[0] ?? 0, part.rot?.[1] ?? 0, part.rot?.[2] ?? 0));
          partMatrix.compose(posV.set(part.pos[0], part.pos[1], part.pos[2]), quat, one);
          pList[j].matrix.copy(deviceMatrix).multiply(partMatrix);
        }
      }
    }
  };

  /** 场景预设切换时极速更新材质调色板（零几何重建） */
  const updatePresetPalette = (newPreset: ScenePreset): void => {
    mats.steel.color.set(newPreset.palette.steel);
    mats.accent.color.set(newPreset.palette.accent);
    for (const e of entries) {
      e.colour = bodyColour(e.status, newPreset);
      const smat = statusMatByDevice.get(e.device.id);
      if (smat) smat.color.copy(e.colour);
    }
  };

  return {
    group,
    picks,
    indexById,
    boxById,
    triangles,
    instancedMeshes,
    drawables,
    byStatus,
    byPrototype,
    legend,
    alertCount,
    faultCount,
    animatedCount: animated.filter((a) => a.active).length,
    animate,
    setStatusOverride,
    clearStatusOverrides,
    activeOverrides,
    getDevicePartInfo,
    hideDeviceInstances,
    showDeviceInstances,
    showOnlyDevice,
    showAllDevices,
    setNameplateVisible,
    visibleDeviceCount,
    updateTransforms,
    updatePresetPalette,
    getPartEvidence: (id) => evidenceById.get(id) ?? null,
    updateTelemetry,
    setPartTelemetry,
    get partEvidenceMeshCount() { return evidenceOverlays.size; },
  };
}

/** 三角面计数：索引几何取 index.count，非索引取顶点数，再除以 3。 */
export { geoTriangles };

/** 单台设备的取景信息（特写视角用；无配方时回退到原型包围盒）。 */
export function deviceBoundsFor(
  proto: PrototypeKey,
  scale: number
): { radius: number; height: number } {
  const b = PROTOTYPE_BOUNDS[proto];
  const radius = Math.max(b.w, b.d) * scale * 0.5;
  return { radius: clamp(radius, 2, 40), height: b.h * scale };
}

/** 供测试与诊断：当前配方覆盖的设备 id 列表。 */
export { RECIPE_IDS } from './deviceProfiles';
