/**
 * 设备原型构建器域（自 equipment.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：16 份程序化原型配方（泵/压缩机/齿轮箱/减速机/电机/数控/机器人/
 * 换热/配电柜/通用）、配方零件表缓存（cachedRecipeParts）、合并静态几何缓存
 * （getMergedStaticGeo —— 供 buildEquipment 的实例化渲染走合并后的大几何）。
 *
 * 缓存键口径不变：`r:<配方id>|<lod>` 与 `p:<原型key>|<lod>`，切预设/布局不重建。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, boxY, cone, cyl, dome, makeParts, sph, HALF_PI, type RecipePart } from './parts';
import type { PrototypeKey } from './equipmentPrototype';

/**
 * 配方零件表缓存：build() 结果只与（配方 id，原型 key，几何 LOD 档）有关，
 * 与预设/布局/种子/设备状态全部无关（位置朝向走实例矩阵，颜色走 instanceColor）。
 * 因此切预设、调布局/种子时直接复用，不再重跑 16 份配方函数 ——
 * 预设切换只重建环境层，设备几何零重建。
 */
const RECIPE_CACHE = new Map<string, RecipePart[]>();

export function cachedRecipeParts(cacheKey: string, build: () => RecipePart[]): RecipePart[] {
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

export function getMergedStaticGeo(cacheKey: string, parts: RecipePart[]): THREE.BufferGeometry | null {
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

export const PROTOTYPE_BUILDERS: Record<PrototypeKey, () => RecipePart[]> = {
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
