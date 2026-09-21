/**
 * 厂区俯瞰层 · 园区边界与场地细节（纯加法装饰模块）。
 *
 * 只读 FactoryOverview 暴露的公开字段（placed / gates / extent / group），把"真实
 * 工厂的场地感"补上：
 *   围墙栏杆 + 压顶 → 沿园区边界成圈，出入口处留豁口；
 *   门卫室 + 道闸杆 → 落在四个真实出入口标记上（gate 数据驱动，不是随便摆）；
 *   路灯 → 沿十字主干道与外环路成排；
 *   储罐区 + 管道支架 → 找空地落位，避开厂房轮廓；
 *   划线停车场 + 轿车/货车；
 *   走动工人与道路车辆 → 由 FactoryOverview.update 驱动（addUpdater），
 *                        因此**不需要改 scene.ts**（该文件由另一会话主责）。
 *
 * 性能口径：重复体一律 InstancedMesh，整个场地装饰 ≈ 20 个 Draw Call；材质自建
 * 自销毁，cleanup 时会从厂区 group 里摘掉自己的根节点。
 */

import * as THREE from 'three';
import { mulberry32 } from './rand';

export interface PerimeterBuilding {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface PerimeterGate {
  id: string;
  kind: 'main' | 'logistics' | 'person' | 'buffer' | string;
  x: number;
  z: number;
  heading: number;
}

/** 宿主 = FactoryOverview 的公开面（用结构化类型，避免装饰模块反向依赖类）。 */
export interface PerimeterHost {
  group: THREE.Group;
  placed: PerimeterBuilding[];
  gates: PerimeterGate[];
  readonly extent: { halfX: number; halfZ: number; height: number };
  /** 由场景主循环驱动的每帧回调注册口（FactoryOverview.addUpdater） */
  addUpdater: (fn: (dt: number, t: number) => void) => () => void;
}

export interface PerimeterDecorStats {
  fencePanels: number;
  lamps: number;
  tanks: number;
  parkingSlots: number;
  parkedVehicles: number;
  workers: number;
  roadVehicles: number;
  drawCalls: number;
}

export interface PerimeterDecor {
  dispose(): void;
  readonly stats: PerimeterDecorStats;
}

const FENCE_STEP = 3.2;
const FENCE_H = 2.3;

export function attachPerimeterDecor(host: PerimeterHost): PerimeterDecor {
  const { halfX, halfZ } = host.extent;
  const root = new THREE.Group();
  root.name = 'factoryPerimeterDecor';
  host.group.add(root);

  const rng = mulberry32(20260921);
  const dummy = new THREE.Object3D();
  const disposables: Array<{ dispose: () => void }> = [];
  const stats: PerimeterDecorStats = {
    fencePanels: 0,
    lamps: 0,
    tanks: 0,
    parkingSlots: 0,
    parkedVehicles: 0,
    workers: 0,
    roadVehicles: 0,
    drawCalls: 0,
  };

  /* ---------- 自建资源（几何共享、材质共享，随 cleanup 释放） ---------- */
  const geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
    sphere: new THREE.SphereGeometry(1, 10, 8),
    plane: new THREE.PlaneGeometry(1, 1),
  };
  for (const g of Object.values(geo)) disposables.push(g);

  const mk = (
    color: number,
    opts: Partial<THREE.MeshStandardMaterialParameters> = {}
  ): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.2, ...opts });
    disposables.push(m);
    return m;
  };
  const mkBasic = (color: number, opacity = 1): THREE.MeshBasicMaterial => {
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      toneMapped: false,
      depthWrite: false,
    });
    disposables.push(m);
    return m;
  };

  const mat = {
    fence: mk(0x1e3246, { metalness: 0.45, roughness: 0.6 }),
    fenceCap: mk(0x22d3ee, { emissive: new THREE.Color(0x0e7490), emissiveIntensity: 0.5, metalness: 0.5 }),
    post: mk(0x243b52, { metalness: 0.5, roughness: 0.55 }),
    booth: mk(0x16293d, { metalness: 0.3, roughness: 0.7 }),
    boom: mk(0xef4444, { emissive: new THREE.Color(0x7f1d1d), emissiveIntensity: 0.35 }),
    lampPole: mk(0x2b3f56, { metalness: 0.6, roughness: 0.5 }),
    lampHead: mk(0xca8a04, { emissive: new THREE.Color(0xf59e0b), emissiveIntensity: 0.7 }),
    tankShell: mk(0x94a3b8, { metalness: 0.75, roughness: 0.35 }),
    tankBand: mk(0x38bdf8, { metalness: 0.6, roughness: 0.4 }),
    asphalt: mk(0x0f1822, { roughness: 0.95, metalness: 0.05 }),
    paint: mkBasic(0xe2e8f0, 0.82),
    carA: mk(0x1d4ed8, { metalness: 0.6, roughness: 0.35 }),
    carB: mk(0x0f766e, { metalness: 0.6, roughness: 0.35 }),
    carGlass: mk(0x0b1220, { metalness: 0.8, roughness: 0.2 }),
    truckBody: mk(0x475569, { metalness: 0.5, roughness: 0.5 }),
    workerSuit: mk(0xf97316, { emissive: new THREE.Color(0x9a3412), emissiveIntensity: 0.3 }),
    workerHat: mk(0xfde68a),
    glow: mkBasic(0x22d3ee, 0.55),
  };

  /* ---------- 通用工具 ---------- */
  const addInstanced = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    matrices: THREE.Matrix4[]
  ): THREE.InstancedMesh | null => {
    if (!matrices.length) return null;
    const im = new THREE.InstancedMesh(geometry, material, matrices.length);
    for (let i = 0; i < matrices.length; i++) im.setMatrixAt(i, matrices[i]);
    im.instanceMatrix.needsUpdate = true;
    im.name = name;
    root.add(im);
    stats.drawCalls++;
    return im;
  };

  const place = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    ry = 0
  ): THREE.Matrix4 => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };

  /** 贴地面元（停车线、门口光斑这类画在 y≈0 的片状物）。 */
  const placeFlat = (x: number, z: number, sx: number, sz: number, y = 0.05): THREE.Matrix4 => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(sx, sz, 1);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };

  /** 是否压在厂房轮廓或主干道走廊上（场地设施要找空地）。 */
  const blocked = (x: number, z: number, margin = 6): boolean => {
    if (Math.abs(x) < 12 || Math.abs(z) < 12) return true; // 十字主干道走廊
    return host.placed.some(
      (b) => Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin
    );
  };

  /* ==================== 1. 围墙：栏杆板 + 压顶，出入口留豁口 ==================== */

  const fencePanels: THREE.Matrix4[] = [];
  const fenceCaps: THREE.Matrix4[] = [];
  const fencePosts: THREE.Matrix4[] = [];

  /** 门在东西墙 → 该边的开口量取 gate.z；在南北墙 → 取 gate.x。 */
  const xOpenings: number[] = [];
  const zOpenings: number[] = [];
  for (const g of host.gates) {
    if (Math.abs(g.x) > Math.abs(g.z)) xOpenings.push(g.z);
    else zOpenings.push(g.x);
  }

  const runEdge = (along: 'x' | 'z', fixed: number, from: number, to: number, openings: number[]) => {
    for (let c = from; c <= to; c += FENCE_STEP) {
      if (openings.some((o) => Math.abs(c - o) < 11)) continue;
      const x = along === 'x' ? c : fixed;
      const z = along === 'x' ? fixed : c;
      if (Math.abs(x) > halfX - 1 || Math.abs(z) > halfZ - 1) continue;
      const ry = along === 'x' ? 0 : Math.PI / 2;
      fencePanels.push(place(x, FENCE_H * 0.55, z, FENCE_STEP * 0.82, FENCE_H, 0.22, ry));
      fenceCaps.push(place(x, FENCE_H * 1.08, z, FENCE_STEP * 0.86, 0.14, 0.42, ry));
      if ((c - from) % (FENCE_STEP * 3) < FENCE_STEP * 0.5) {
        fencePosts.push(place(x, FENCE_H * 0.62, z, 0.32, FENCE_H * 1.24, 0.32, ry));
      }
    }
  };

  for (const sign of [-1, 1]) {
    runEdge('x', sign * (halfZ - 3), -halfX + 3, halfX - 3, zOpenings);
    runEdge('z', sign * (halfX - 3), -halfZ + 3, halfZ - 3, xOpenings);
  }
  addInstanced('fencePanels', geo.box, mat.fence, fencePanels);
  addInstanced('fenceCaps', geo.box, mat.fenceCap, fenceCaps);
  addInstanced('fencePosts', geo.box, mat.post, fencePosts);
  stats.fencePanels = fencePanels.length;

  /* ==================== 2. 门卫室 + 道闸（落在真实出入口上） ==================== */

  const booths: THREE.Matrix4[] = [];
  const boothRoofs: THREE.Matrix4[] = [];
  const boomArms: THREE.Matrix4[] = [];
  const boomPoles: THREE.Matrix4[] = [];
  const gateGlows: THREE.Matrix4[] = [];

  for (const g of host.gates) {
    const intoX = Math.sin(g.heading);
    const intoZ = Math.cos(g.heading);
    // 门卫室退在门洞一侧，道闸杆横在车道上
    booths.push(place(g.x - intoZ * 9, 1.6, g.z + intoX * 9, 4.6, 3.2, 4.0, g.heading));
    boothRoofs.push(place(g.x - intoZ * 9, 3.5, g.z + intoX * 9, 5.4, 0.3, 4.8, g.heading));
    boomPoles.push(place(g.x + intoZ * 6.5, 0.9, g.z - intoX * 6.5, 0.6, 1.8, 0.6, g.heading));
    boomArms.push(
      place(
        g.x + intoZ * 2.6,
        1.72,
        g.z - intoX * 2.6,
        8.2,
        0.16,
        0.24,
        g.heading + Math.PI / 2
      )
    );
    gateGlows.push(placeFlat(g.x, g.z, 5.2, 5.2, 0.12));
  }
  addInstanced('gateBooths', geo.box, mat.booth, booths);
  addInstanced('gateBoothRoofs', geo.box, mat.fenceCap, boothRoofs);
  addInstanced('gateBoomArms', geo.box, mat.boom, boomArms);
  addInstanced('gateBoomPosts', geo.box, mat.post, boomPoles);
  addInstanced('gateGroundGlow', geo.plane, mat.glow, gateGlows);

  /* ==================== 3. 路灯：沿十字主干道与外环 ==================== */

  const poles: THREE.Matrix4[] = [];
  const arms: THREE.Matrix4[] = [];
  const heads: THREE.Matrix4[] = [];
  const addLamp = (x: number, z: number, face: number) => {
    poles.push(place(x, 3.6, z, 0.3, 7.2, 0.3, 0));
    arms.push(place(x + Math.sin(face) * 1.1, 7.05, z + Math.cos(face) * 1.1, 2.2, 0.2, 0.22, face));
    heads.push(place(x + Math.sin(face) * 2.1, 6.9, z + Math.cos(face) * 2.1, 0.9, 0.22, 0.5, face));
  };
  for (let i = 1; i <= 8; i++) {
    const x = -halfX + (i * (halfX * 2)) / 9;
    if (Math.abs(x) < halfX - 8) {
      addLamp(x, -10.8, Math.PI);
      addLamp(x, 10.8, 0);
    }
    const z = -halfZ + (i * (halfZ * 2)) / 9;
    if (Math.abs(z) < halfZ - 8) {
      addLamp(-10.8, z, -Math.PI / 2);
      addLamp(10.8, z, Math.PI / 2);
    }
  }
  addInstanced('lampPoles', geo.box, mat.lampPole, poles);
  addInstanced('lampArms', geo.box, mat.lampPole, arms);
  addInstanced('lampHeads', geo.box, mat.lampHead, heads);
  stats.lamps = poles.length;

  /* ==================== 4. 储罐区 + 管道支架（找空地落位） ==================== */

  const tankCandidates: Array<[number, number]> = [
    [-halfX * 0.55, halfZ * 0.34],
    [halfX * 0.52, -halfZ * 0.36],
    [halfX * 0.3, halfZ * 0.62],
    [-halfX * 0.34, -halfZ * 0.62],
  ];
  const shells: THREE.Matrix4[] = [];
  const domes: THREE.Matrix4[] = [];
  const bands: THREE.Matrix4[] = [];
  const legs: THREE.Matrix4[] = [];
  const pipeRacks: THREE.Matrix4[] = [];
  const rackBeams: THREE.Matrix4[] = [];

  let tankIdx = 0;
  for (const [cx, cz] of tankCandidates) {
    if (tankIdx >= 4) break;
    const r = 3.4 + rng() * 0.9;
    const hh = 6.6 + rng() * 1.6;
    // 罐区整体要么放得下、要么跳过（压在厂房上就删掉整组）
    let ok = true;
    for (const a of [-1, 0, 1]) {
      for (const b of [-1, 0, 1]) {
        if (blocked(cx + a * (r + 2), cz + b * (r + 2), 3)) ok = false;
      }
    }
    if (!ok) continue;
    const ry = rng() * Math.PI;
    shells.push(place(cx, hh / 2, cz, r, hh, r, ry));
    domes.push(place(cx, hh + 0.1, cz, r * 1.02, r * 0.55, r * 1.02, ry));
    for (const by of [hh * 0.34, hh * 0.68]) bands.push(place(cx, by, cz, r * 1.04, 0.34, r * 1.04, ry));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      legs.push(place(cx + Math.cos(a) * r * 0.86, 1.1, cz + Math.sin(a) * r * 0.86, 0.34, 2.2, 0.34, 0));
    }
    // 罐区到主干道的管廊支架
    const dirX = cx > 0 ? -1 : 1;
    for (let i = 0; i < 3; i++) {
      const rx = cx + dirX * (6 + i * 7);
      const rz = cz;
      if (Math.abs(rx) < 13) break;
      pipeRacks.push(place(rx, 2.4, rz, 0.4, 4.8, 0.4, 0));
      rackBeams.push(place(rx, 4.6, rz, 0.5, 0.42, 6.2, 0));
    }
    tankIdx++;
  }
  addInstanced('tankShells', geo.cyl, mat.tankShell, shells);
  addInstanced('tankDomes', geo.sphere, mat.tankBand, domes);
  addInstanced('tankBands', geo.cyl, mat.tankBand, bands);
  addInstanced('tankLegs', geo.box, mat.post, legs);
  addInstanced('pipeRackPosts', geo.box, mat.post, pipeRacks);
  addInstanced('pipeRackBeams', geo.box, mat.truckBody, rackBeams);
  stats.tanks = shells.length;

  /* ==================== 5. 划线停车场 + 停放的轿车/货车 ==================== */

  const parkCenter: [number, number] | null = (() => {
    const cands: Array<[number, number]> = [
      [halfX * 0.62, halfZ * 0.52],
      [-halfX * 0.62, halfZ * 0.5],
      [halfX * 0.6, -halfZ * 0.5],
      [-halfX * 0.2, -halfZ * 0.74],
    ];
    for (const [cx, cz] of cands) if (!blocked(cx, cz, 12) && !blocked(cx + 14, cz + 8, 12)) return [cx, cz];
    return null;
  })();

  const lines: THREE.Matrix4[] = [];
  const carBodies: THREE.Matrix4[] = [];
  const carCabins: THREE.Matrix4[] = [];

  if (parkCenter) {
    const [cx, cz] = parkCenter;
    const pad = new THREE.Mesh(geo.plane, mat.asphalt);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, 0.025, cz);
    pad.scale.set(34, 20, 1);
    pad.name = 'parkingPad';
    root.add(pad);
    stats.drawCalls++;

    const rows = 2;
    const cols = 6;
    for (let r = 0; r <= rows; r++) lines.push(placeFlat(cx, cz - 9 + r * 9, 30, 0.16));
    for (let c = 0; c <= cols; c++) {
      lines.push(placeFlat(cx - 15 + (c * 30) / cols, cz, 0.16, 8.6));
    }
    let parked = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (parked >= 7) break;
        if (rng() < 0.25) continue;
        const x = cx - 15 + (c * 30) / cols + 2.5;
        const z = cz - 4.5 + r * 9;
        const truck = parked === 2;
        carBodies.push(place(x, 0.75, z, truck ? 3.4 : 2.1, 1.2, truck ? 7.4 : 4.4, 0));
        carCabins.push(
          place(x, 1.75, z + (truck ? -2.4 : 0.6), truck ? 2.4 : 1.9, 0.9, truck ? 2.6 : 1.9, 0)
        );
        parked++;
      }
    }
    stats.parkingSlots = cols * rows;
    stats.parkedVehicles = parked;
  }
  addInstanced('parkingLines', geo.plane, mat.paint, lines);
  addInstanced('parkedCars', geo.box, mat.carA, carBodies);
  addInstanced('parkedCabins', geo.box, mat.carGlass, carCabins);

  /* ==================== 6. 走动工人（每栋厂房门口 2–3 人，沿门前折返） ==================== */

  interface Walker {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    phase: number;
    speed: number;
  }
  const walkers: Walker[] = [];
  for (const b of host.placed) {
    const sign = b.z > 0 ? -1 : 1;
    const fz = b.z + sign * (b.d / 2 + 4.5);
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 6.5;
      walkers.push({
        x0: b.x + off - 5,
        z0: fz,
        x1: b.x + off + 5,
        z1: fz + (i === 1 ? 3.2 : -2.4),
        phase: rng() * 2,
        speed: 0.16 + rng() * 0.1,
      });
    }
  }
  for (let i = 0; i < 4; i++) {
    const g = host.gates[i % Math.max(1, host.gates.length)];
    if (!g) break;
    walkers.push({
      x0: g.x + (i % 2 ? 6 : -6),
      z0: g.z + (i < 2 ? 8 : -8),
      x1: g.x + (i % 2 ? 12 : -12),
      z1: g.z + (i < 2 ? 16 : -16),
      phase: rng() * 2,
      speed: 0.13 + rng() * 0.08,
    });
  }
  const workerBodies = addInstanced('workerBodies', geo.box, mat.workerSuit, [
    ...walkers.map((w) => place(w.x0, 0.95, w.z0, 0.62, 1.75, 0.42, 0)),
  ]);
  const workerHats = addInstanced('workerHats', geo.sphere, mat.workerHat, [
    ...walkers.map((w) => place(w.x0, 1.95, w.z0, 0.34, 0.3, 0.34, 0)),
  ]);
  stats.workers = walkers.length;

  /* ---------- 车辆：道路上 2 辆来回（厂区道路本身就是环形，取两条直段） ---------- */
  const drivers = [
    { axis: 'x' as const, fixed: -5.6, from: -halfX * 0.75, to: halfX * 0.75, t: 0.15, speed: 0.045, dir: 1 },
    { axis: 'z' as const, fixed: 5.6, from: -halfZ * 0.7, to: halfZ * 0.7, t: 0.72, speed: 0.036, dir: -1 },
  ];
  const movingBodies = addInstanced('roadVehicles', geo.box, mat.truckBody, [
    ...drivers.map(() => place(0, 1.0, 0, 2.6, 1.6, 6.2, 0)),
  ]);
  const movingCabs = addInstanced('roadVehicleCabs', geo.box, mat.carGlass, [
    ...drivers.map(() => place(0, 2.0, 0, 2.4, 1.1, 2.0, 0)),
  ]);
  stats.roadVehicles = drivers.length;

  /* ==================== 每帧更新（由 FactoryOverview.update 驱动） ==================== */

  let clock = 0;
  const tick = () => {
    clock += 1 / 60;
    if (workerBodies && workerHats) {
      for (let i = 0; i < walkers.length; i++) {
        const w = walkers[i];
        const k = 0.5 + 0.5 * Math.sin(clock * w.speed * 6.28 + w.phase * 3.14);
        const x = w.x0 + (w.x1 - w.x0) * k;
        const z = w.z0 + (w.z1 - w.z0) * k;
        const heading = Math.atan2(w.x1 - w.x0, w.z1 - w.z0) + (k > 0.5 ? Math.PI : 0);
        dummy.position.set(x, 0.95, z);
        dummy.rotation.set(0, heading, 0);
        // 走路时的轻微起伏：让人点不至于像贴在地上的方块
        dummy.scale.set(0.62, 1.75 + Math.sin(clock * 7 + i) * 0.03, 0.42);
        dummy.updateMatrix();
        workerBodies.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 1.95, z);
        dummy.scale.set(0.34, 0.3, 0.34);
        dummy.updateMatrix();
        workerHats.setMatrixAt(i, dummy.matrix);
      }
      workerBodies.instanceMatrix.needsUpdate = true;
      workerHats.instanceMatrix.needsUpdate = true;
    }
    if (movingBodies && movingCabs) {
      for (let i = 0; i < drivers.length; i++) {
        const d = drivers[i];
        d.t += d.speed * d.dir * (1 / 60) * 6;
        if (d.t > 1) {
          d.t = 1;
          d.dir = -1;
        } else if (d.t < 0) {
          d.t = 0;
          d.dir = 1;
        }
        const along = d.from + (d.to - d.from) * d.t;
        const x = d.axis === 'x' ? along : d.fixed;
        const z = d.axis === 'x' ? d.fixed : along;
        const ry = d.axis === 'x' ? Math.PI / 2 : 0;
        dummy.position.set(x, 1.0, z);
        dummy.rotation.set(0, ry, 0);
        dummy.scale.set(2.6, 1.6, 6.2);
        dummy.updateMatrix();
        movingBodies.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 2.05, z);
        dummy.scale.set(2.4, 1.1, 2.0);
        dummy.updateMatrix();
        movingCabs.setMatrixAt(i, dummy.matrix);
      }
      movingBodies.instanceMatrix.needsUpdate = true;
      movingCabs.instanceMatrix.needsUpdate = true;
    }
  };

  const drive = (dt: number) => {
    // 与场景时钟解耦：按真实帧间隔推进，掉帧时也不会让工人瞬移
    const steps = Math.min(3, Math.max(1, Math.round(dt * 60)));
    for (let i = 0; i < steps; i++) tick();
  };
  const unregister = host.addUpdater(drive);

  return {
    stats,
    dispose(): void {
      unregister();
      root.removeFromParent();
      root.traverse((o) => {
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) im.dispose();
      });
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      root.clear();
    },
  };
}
