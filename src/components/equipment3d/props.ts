/**
 * 场景道具生成器。
 *
 * 结构移植自「中国程序化城市生成器」src/props.js：
 *   参考实现用一个 PropBuilder 把立交 / 缆车 / 牌坊 / 树木等道具批量塞进城市；
 *   这里换成车间与场站真正需要的东西 —— 安全护栏、防撞柱、警示牌、配电柜、
 *   设备之间的连接管道、露天罐区围堰、消防点。
 *
 * 与参考实现一致的取舍：
 *   1) 道具一律「避让设备」—— 生成前先做一次 keep-out 判定，避免穿模；
 *   2) 几何体全部走模块级缓存（userData.shared），重建时不会被 dispose 掉；
 *   3) 所有道具经 Batcher 按「几何体 + 材质」聚合成 InstancedMesh，
 *      道具再多也不会让 drawcall 随数量线性增长。
 */

import * as THREE from 'three';
import { Rng, clamp } from './rand';
import type { ScenePreset } from './styles';
import type { DeviceSlot, Hall } from './hall';
import { geoTriangles, type DeviceLike } from './equipment';
import { statusKey, STATUS_META } from './equipmentStatus';

/* ========================= 几何缓存 ========================= */

const GEO = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = GEO.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    GEO.set(key, g);
  }
  return g;
}

const gBox = (w: number, h: number, d: number) =>
  geo(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));

const gBoxY = (w: number, h: number, d: number) =>
  geo(`by:${w}:${h}:${d}`, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return g;
  });

/** 轴沿 Y、原点在底面，供立管使用。 */
const gCylY = (r: number, h: number, seg = 10) =>
  geo(`cy:${r}:${h}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.translate(0, h / 2, 0);
    return g;
  });

/** 轴沿 X 的单位长圆柱（长度 1），配合 scale.x = 实际长度使用。 */
const gCylX = (r: number, seg = 10) =>
  geo(`cx:${r}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, 1, seg);
    g.rotateZ(Math.PI / 2);
    return g;
  });

const gSph = (r: number, seg = 10) =>
  geo(`s:${r}:${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg / 2))));

const gCone = (r: number, h: number, seg = 10) =>
  geo(`k:${r}:${h}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));

const gPlane = (w: number, h: number) =>
  geo(`p:${w}:${h}`, () => {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateX(-Math.PI / 2);
    return g;
  });

export function propsCacheSize(): number {
  return GEO.size;
}

/* ========================= 批量收集器 ========================= */

interface Bucket {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  list: THREE.Matrix4[];
  cast: boolean;
}

/**
 * 按 (几何体, 材质) 聚合实例。
 * 与参考实现里 `emitBox` 攒数组、最后一次性建 InstancedMesh 是同一思路。
 */
class Batcher {
  private buckets = new Map<string, Bucket>();

  add(
    geoKey: string,
    geometry: THREE.BufferGeometry,
    matKey: string,
    material: THREE.Material,
    matrix: THREE.Matrix4,
    cast = true
  ): void {
    const key = `${geoKey}|${matKey}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { geo: geometry, mat: material, list: [], cast };
      this.buckets.set(key, b);
    }
    b.list.push(matrix.clone());
  }

  toGroup(name: string, shadows: boolean): { group: THREE.Group; triangles: number; meshes: number } {
    const group = new THREE.Group();
    group.name = name;
    let triangles = 0;
    let meshes = 0;
    for (const [key, b] of this.buckets) {
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.list.length);
      for (let i = 0; i < b.list.length; i++) im.setMatrixAt(i, b.list[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadows && b.cast;
      im.receiveShadow = shadows;
      im.frustumCulled = false;
      im.name = `${name}:${key}`;
      group.add(im);
      triangles += geoTriangles(b.geo) * b.list.length;
      meshes++;
    }
    return { group, triangles, meshes };
  }
}

/* ========================= 道具构建 ========================= */

export interface PropsOptions {
  preset: ScenePreset;
  hall: Hall;
  slots: DeviceSlot[];
  devices: DeviceLike[];
  seed: number;
  shadows: boolean;
  detail: number;
  equipmentScale: number;
}

export interface PropsBuild {
  group: THREE.Group;
  triangles: number;
  meshes: number;
  count: number;
}

interface MatSet {
  steel: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  pipe: THREE.MeshStandardMaterial;
  all: THREE.Material[];
}

function buildMaterials(preset: ScenePreset): MatSet {
  const pal = preset.palette;
  const steel = new THREE.MeshStandardMaterial({ color: pal.steel, roughness: 0.6, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x363b41, roughness: 0.45, metalness: 0.7 });
  const yellow = new THREE.MeshStandardMaterial({ color: pal.lane, roughness: 0.7, metalness: 0.1 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd0342a, roughness: 0.6, metalness: 0.15 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe6e7e3, roughness: 0.75, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.6, metalness: 0.3 });
  const pipe = new THREE.MeshStandardMaterial({ color: pal.pipe, roughness: 0.42, metalness: 0.72 });
  return { steel, dark, yellow, red, white, accent, pipe, all: [steel, dark, yellow, red, white, accent, pipe] };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();

/** 生成一个「位置 + 绕 Y 朝向 + 缩放」的矩阵。 */
function trs(x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _q.setFromEuler(_e.set(0, ry, 0));
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** 生成一个「轴沿 Y 的圆柱先转到 X 方向、再绕 Y 转到任意水平方位」的矩阵。 */
function trsPipeX(x: number, y: number, z: number, angleY: number, length: number, thickness = 1): THREE.Matrix4 {
  const qAlign = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleY);
  const qAxis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  qAlign.multiply(qAxis);
  return new THREE.Matrix4().compose(
    _v.set(x, y, z),
    qAlign,
    _s.set(length, thickness, thickness)
  );
}

export function buildProps(opts: PropsOptions): PropsBuild {
  const { preset, hall, slots, devices, seed, shadows, detail, equipmentScale } = opts;
  const rng = new Rng(seed + 3313);
  const mats = buildMaterials(preset);
  const b = new Batcher();
  const pal = preset.palette;
  const h = preset.hall;
  let count = 0;

  // ---- 设备避让区：道具不得与设备重叠 ----
  const keepOut = slots.map((s) => ({ x: s.x, z: s.z, r: s.radius * 1.15 }));
  const blocked = (x: number, z: number, pad = 0.5): boolean =>
    keepOut.some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < (k.r + pad) ** 2);

  const ground = (x: number, z: number) => hall.reliefAt(x, z);
  // 可布置范围：有墙时必须留在墙内，无墙时留在地坪内 ——
  // 否则围栏 / 防撞柱 / 消防点会落到墙外或地坪外，俯视时非常明显。
  const innerX = h.walls && h.wallHeight > 0 ? h.spanX / 2 : hall.bounds.halfX;
  const innerZ = h.walls && h.wallHeight > 0 ? h.spanZ / 2 : hall.bounds.halfZ;
  const usableX = Math.min(h.spanX * 0.72, innerX * 0.9);
  const usableZ = Math.min(h.spanZ * 0.62, innerZ * 0.9);

  /* ---------- 1. 安全护栏：环绕作业区 ---------- */
  {
    const railH = 1.15;
    const postGap = 2.6;
    const inset = 1.4;
    const x0 = -usableX - inset;
    const x1 = usableX + inset;
    const z0 = -usableZ - inset;
    const z1 = usableZ + inset;
    // 只在「门口」留缺口：南北各留中段 8m
    const gap = 8;
    const edges: Array<{ ax: number; az: number; bx: number; bz: number }> = [
      { ax: x0, az: z0, bx: x1, bz: z0 },
      { ax: x0, az: z1, bx: x1, bz: z1 },
      { ax: x0, az: z0, bx: x0, bz: z1 },
      { ax: x1, az: z0, bx: x1, bz: z1 },
    ];
    for (const e of edges) {
      const dx = e.bx - e.ax;
      const dz = e.bz - e.az;
      const len = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      const n = Math.max(2, Math.round(len / postGap));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = e.ax + dx * t;
        const pz = e.az + dz * t;
        // 门口缺口
        const isNorthSouth = Math.abs(dz) < 1e-6;
        if (isNorthSouth && Math.abs(px) < gap / 2) continue;
        const gy = ground(px, pz);
        b.add('railPost', gCylY(0.075, railH, 8), 'steel', mats.steel, trs(px, gy, pz, 0));
        count++;
      }
      // 两道横杆（沿边分段，避开缺口）
      const segs: Array<[number, number]> = [];
      if (Math.abs(dz) < 1e-6) {
        segs.push([0, clamp(0.5 - gap / 2 / len, 0, 1)]);
        segs.push([clamp(0.5 + gap / 2 / len, 0, 1), 1]);
      } else {
        segs.push([0, 1]);
      }
      for (const [t0, t1] of segs) {
        const segLen = len * (t1 - t0);
        if (segLen < 0.6) continue;
        const mx = e.ax + dx * ((t0 + t1) / 2);
        const mz = e.az + dz * ((t0 + t1) / 2);
        const gy = ground(mx, mz);
        for (const ry of [railH - 0.12, railH * 0.52]) {
          b.add('railBar', gCylX(0.055, 8), 'steel', mats.steel, trsPipeX(mx, gy + ry, mz, -ang, segLen));
          count++;
        }
      }
    }
  }

  /* ---------- 2. 防撞柱：通道口 ---------- */
  {
    const n = 5;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const x = -6 + (12 * i) / (n - 1);
        const z = side * (usableZ + 2.2);
        if (blocked(x, z, 1.2)) continue;
        const gy = ground(x, z);
        b.add('bollard', gCylY(0.16, 0.95, 10), 'yellow', mats.yellow, trs(x, gy, z, 0));
        b.add('bollardCap', gSph(0.16, 10), 'yellow', mats.yellow, trs(x, gy + 0.95, z, 0));
        count += 2;
      }
    }
  }

  /* ---------- 3. 警示牌：只给异常态设备挂（颜色取自真实状态） ---------- */
  if (detail >= 1) {
    for (let i = 0; i < slots.length && i < devices.length; i++) {
      const st = statusKey(devices[i]?.status);
      if (!STATUS_META[st].alert) continue;
      const s = slots[i];
      const off = s.radius * 1.5 + 1.1;
      const px = s.x + off;
      const pz = s.z - off * 0.6;
      if (Math.abs(px) > hall.bounds.halfX - 1 || Math.abs(pz) > hall.bounds.halfZ - 1) continue;
      const gy = ground(px, pz);
      const signMat = st === 'warning' ? mats.yellow : mats.red;
      const signKey = st === 'warning' ? 'yellow' : 'red';
      b.add('signPost', gCylY(0.06, 2.1, 8), 'dark', mats.dark, trs(px, gy, pz, 0));
      b.add('signBoard', gBoxY(1.5, 0.95, 0.07), signKey, signMat, trs(px, gy + 2.1, pz, Math.atan2(pz, px) + Math.PI / 2));
      // 牌面白色边框，避免整块纯色
      b.add('signEdge', gBoxY(1.6, 1.05, 0.04), 'white', mats.white, trs(px, gy + 2.05, pz, Math.atan2(pz, px) + Math.PI / 2));
      count += 3;
    }
  }

  /* ---------- 4. 配电柜：沿北墙一字排开 ---------- */
  {
    const n = preset.floor.style === 'apron' ? 3 : 4;
    const wallZ = -h.spanZ / 2 + 1.3;
    for (let i = 0; i < n; i++) {
      const x = -h.spanX * 0.3 + (h.spanX * 0.6 * i) / Math.max(1, n - 1);
      const z = wallZ;
      if (Math.abs(x) > hall.bounds.halfX - 1.5) continue;
      const gy = ground(x, z);
      const ry = 0;
      b.add('cabBase', gBox(2.3, 0.16, 1.15), 'dark', mats.dark, trs(x, gy + 0.08, z, ry));
      b.add('cabShell', gBox(2.2, 2.15, 1.05), 'steel', mats.steel, trs(x, gy + 1.24, z, ry));
      b.add('cabRoof', gBox(2.35, 0.12, 1.2), 'steel', mats.steel, trs(x, gy + 2.37, z, ry));
      b.add('cabPanel', gBox(1.1, 0.34, 0.1), 'dark', mats.dark, trs(x, gy + 2.05, z + 0.54, ry));
      b.add('cabLed', gBox(0.1, 0.1, 0.06), 'accent', mats.accent, trs(x - 0.36, gy + 2.05, z + 0.6, ry));
      b.add('cabLed', gBox(0.1, 0.1, 0.06), 'accent', mats.accent, trs(x - 0.16, gy + 2.05, z + 0.6, ry));
      b.add('cabLed', gBox(0.1, 0.1, 0.06), 'accent', mats.accent, trs(x + 0.04, gy + 2.05, z + 0.6, ry));
      if (detail >= 1) {
        b.add('cabVent', gBox(1.5, 0.5, 0.08), 'dark', mats.dark, trs(x, gy + 0.55, z + 0.54, ry));
      }
      count++;
    }
  }

  /* ---------- 5. 设备连接管道：就近互联 + 部分上接主管廊 ---------- */
  {
    const topY = Math.max(6.2, h.wallHeight * 0.62);
    const links = Math.min(detail >= 1 ? 9 : 5, slots.length - 1);
    const used = new Set<number>();
    for (let i = 0; i < links; i++) {
      const a = slots[i];
      if (!a) continue;
      // 找最近的、尚未连过的邻居
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < slots.length; j++) {
        if (j === i || used.has(j)) continue;
        const d = (slots[j].x - a.x) ** 2 + (slots[j].z - a.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best < 0) break;
      const c = slots[best];
      const dist = Math.sqrt(bestD);
      if (dist > 26) continue;
      used.add(i);
      used.add(best);

      const y0 = ground(a.x, a.z);
      const y1 = ground(c.x, c.z);
      const rise = topY * 0.46 + rng.range(0, 0.6);
      const r = dist > 14 ? 0.28 : 0.22;

      // 两端立管
      b.add('pipeRiser', gCylY(r, topY - y0, 10), 'pipe', mats.pipe, trs(a.x, y0, a.z, 0));
      b.add('pipeRiser', gCylY(r, topY - y1, 10), 'pipe', mats.pipe, trs(c.x, y1, c.z, 0));
      // 弯头
      b.add('pipeElbow', gSph(r * 1.12, 10), 'pipe', mats.pipe, trs(a.x, topY, a.z, 0));
      b.add('pipeElbow', gSph(r * 1.12, 10), 'pipe', mats.pipe, trs(c.x, topY, c.z, 0));
      // 水平段
      const mx = (a.x + c.x) / 2;
      const mz = (a.z + c.z) / 2;
      const ang = Math.atan2(c.z - a.z, c.x - a.x);
      b.add('pipeRun', gCylX(r, 10), 'pipe', mats.pipe, trsPipeX(mx, topY, mz, -ang, dist));
      // 支管下引到设备顶部
      b.add('pipeDrop', gCylY(0.14, rise, 8), 'pipe', mats.pipe, trs(a.x, y0, a.z, 0));
      b.add('pipeDrop', gCylY(0.14, rise, 8), 'pipe', mats.pipe, trs(c.x, y1, c.z, 0));
      count += 7;
    }
    // 注意：架空主管廊（立柱 / 横梁 / 多层管道 / 下引支管）由 hall.buildPipeRacks()
    // 统一生成，此处不再重复，避免两套管廊叠在同一位置造成 z-fighting。
  }

  /* ---------- 6. 露天罐区围堰（仅户外场站） ---------- */
  if (preset.floor.style === 'apron') {
    const rx = Math.min(usableX * 1.12, hall.bounds.halfX * 0.92);
    const rz = Math.min(usableZ * 1.14, hall.bounds.halfZ * 0.92);
    const wallH = 0.85;
    const wallT = 0.55;
    const edges: Array<[number, number, number, number]> = [
      [-rx, -rz, rx * 2 + wallT, wallT],
      [-rx, rz, rx * 2 + wallT, wallT],
      [-rx, -rz, wallT, rz * 2 + wallT],
      [rx, -rz, wallT, rz * 2 + wallT],
    ];
    for (const [x, z, w, d] of edges) {
      const gy = ground(clamp(x + w / 2, -hall.bounds.halfX, hall.bounds.halfX), clamp(z, -hall.bounds.halfZ, hall.bounds.halfZ));
      b.add('bund', gBox(w, wallH, d), 'steel', mats.steel, trs(x + w / 2, gy + wallH / 2, z + d / 2, 0));
      b.add('bundCap', gBox(w * 1.01, 0.1, d * 1.02), 'yellow', mats.yellow, trs(x + w / 2, gy + wallH, z + d / 2, 0));
      count += 2;
    }
    // 围堰外的爬梯
    b.add('bundLadder', gBox(0.9, 0.12, 0.5), 'steel', mats.steel, trs(0, ground(0, rz) + 0.5, rz, 0));
    count++;
  }

  /* ---------- 7. 消防点 ---------- */
  {
    const n = preset.floor.style === 'apron' ? 3 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.8;
      const px = Math.cos(a) * (usableX * 1.02);
      const pz = Math.sin(a) * (usableZ * 1.05);
      if (blocked(px, pz, 2)) continue;
      if (Math.abs(px) > hall.bounds.halfX - 1 || Math.abs(pz) > hall.bounds.halfZ - 1) continue;
      const gy = ground(px, pz);
      b.add('firePost', gCylY(0.07, 1.3, 8), 'dark', mats.dark, trs(px, gy, pz, 0));
      b.add('fireBox', gBoxY(0.55, 0.8, 0.36), 'red', mats.red, trs(px, gy + 1.3, pz, -a));
      b.add('fireTop', gBox(0.62, 0.08, 0.42), 'white', mats.white, trs(px, gy + 2.14, pz, -a));
      count += 3;
    }
  }

  /* ---------- 8. 地面警示斑马线（设备前方） ---------- */
  if (detail >= 1) {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const w = s.radius * 1.9;
      const d = 0.55;
      const zz = s.z + s.radius * 1.5;
      if (Math.abs(zz) > hall.bounds.halfZ - 1) continue;
      for (let k = -3; k <= 3; k++) {
        const px = s.x + k * (w / 7);
        b.add('hazard', gPlane(w / 12, d), 'yellow', mats.yellow, trs(px, ground(px, zz) + 0.05, zz, 0));
        count++;
      }
    }
  }

  /* ---------- 9. 露天场站：地面支架小件（管墩） ---------- */
  if (preset.floor.style === 'apron' && detail >= 1) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * usableX * 0.6;
      const pz = Math.sin(a) * usableZ * 0.6;
      if (blocked(px, pz, 1.6)) continue;
      const gy = ground(px, pz);
      b.add('pipeShoe', gBox(1.0, 0.5, 0.7), 'dark', mats.dark, trs(px, gy + 0.25, pz, a));
      b.add('pipeShoeTop', gCylX(0.24, 10), 'pipe', mats.pipe, trsPipeX(px, gy + 0.62, pz, -a, 1.0));
      count += 2;
    }
  }

  void pal;
  void equipmentScale;

  const built = b.toGroup('props', shadows);
  return { group: built.group, triangles: built.triangles, meshes: built.meshes, count };
}

/** 供外部释放时使用：道具材质是本模块按构建创建的，几何体是共享的。 */
export function disposePropsMaterials(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    for (const mat of list) mat.dispose();
  });
}
