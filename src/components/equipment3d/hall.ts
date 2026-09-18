/**
 * 厂房车间本体生成器。
 *
 * 由参考生成器的 terrain.js（高度场 + 裙边）改造而来：把「地形」换成「厂区地坪」，
 * 并新增立柱 / 墙面 / 顶棚桁架 / 行车轨道 / 基础管廊 —— 也就是参考实现里没有、
 * 但车间场景必需的结构层。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, fbm2, clamp, lerp } from './rand';
import type { ScenePreset } from './styles';

/**
 * 把组内静态网格按材质合并为单个 mesh（每种材质 1 个 drawcall）。
 *
 * 为什么需要：buildStructure 原来每个柱/底座/腹杆/灯都是独立 Mesh，
 * 重工车间一次重建产生 120+ 个 drawcall，是 434 drawcall 的最大单一来源。
 * 合并后结构层只剩 ~5 个 drawcall（柱/钢/墙/顶/灯带各 1）。
 *
 * 约束：
 *  - 只合并直接子 Mesh（调用方须先把可动件如行车大梁移出，合并完再加回）；
 *  - 几何体必须是调用方当次新建的（本文件 structure/pipeRacks/lanes 均为 new 出来的，
 *    与 parts.ts / props.ts 的共享缓存几何体不同），合并后原几何体会被 dispose；
 *  - 要求各几何体属性集一致（Box/Cylinder/Plane 都有 position/normal/uv，可合并）。
 */
function mergeStaticChildren(group: THREE.Group): void {
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
  const meshes: THREE.Mesh[] = [];
  for (const child of [...group.children]) {
    const m = child as THREE.Mesh;
    if (!m.isMesh) continue;
    const g = m.geometry as THREE.BufferGeometry | undefined;
    const mat = m.material as THREE.Material | undefined;
    if (!g || !mat || Array.isArray(mat)) {
      continue;
    }
    m.updateMatrix();
    // Primitive.clone() constructs a default Box/Cylinder before copying it.
    // Copy into a plain buffer instead; source geometry stays intact on merge failure.
    const c = new THREE.BufferGeometry().copy(g).applyMatrix4(m.matrix);
    let b = buckets.get(mat);
    if (!b) {
      b = { geos: [], cast: false, receive: false };
      buckets.set(mat, b);
    }
    b.geos.push(c);
    b.cast = b.cast || m.castShadow;
    b.receive = b.receive || m.receiveShadow;
    meshes.push(m);
  }
  if (meshes.length === 0 || buckets.size === 0) return;
  const mergedMaterials = new Set<THREE.Material>();
  for (const [mat, b] of buckets) {
    // 只有 1 个的也合并（统一为 merged 命名，便于统计与调试），失败则保留原样
    let merged: THREE.BufferGeometry | null = null;
    try {
      merged = mergeGeometries(b.geos, false);
    } catch {
      merged = null;
    }
    if (!merged) {
      for (const g of b.geos) g.dispose();
      continue;
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.name = `merged:${group.name}`;
    mesh.frustumCulled = false;
    group.add(mesh);
    mergedMaterials.add(mat);
    // mergeGeometries owns new buffers, not these temporary transformed copies.
    for (const geo of b.geos) geo.dispose();
  }
  for (const m of meshes) {
    if (!mergedMaterials.has(m.material as THREE.Material)) continue;
    group.remove(m);
    (m.geometry as THREE.BufferGeometry).dispose();
  }
}

export interface DeviceSlot {
  x: number;
  z: number;
  /** 设备朝向（弧度） */
  angle: number;
  /** 设备占位半径，用于避让与布局间距 */
  radius: number;
}

/**
 * 厂房外壳显示方式。
 * 关键取舍：封闭厂房的墙与屋顶会把 16 台设备完全挡住，默认视角什么都看不到 ——
 * 因此默认 'ghost'（半透明），既保留厂房体量感，又能直接看见内部设备状态。
 * 'full' 用于出"外观大图"，'none' 用于纯内部布局观察。
 */
export type ShellMode = 'full' | 'ghost' | 'none';

export class Hall {
  preset: ScenePreset;
  params: { seed: number; spacing: number; highlight: boolean; quality: string };
  seed: number;
  width: number;
  depth: number;
  halfX: number;
  halfZ: number;
  rng: Rng;
  /** 地坪网格分辨率 */
  private resX = 64;
  private resZ = 48;

  constructor(preset: ScenePreset, params: Hall['params'], seed: number) {
    this.preset = preset;
    this.params = params;
    this.seed = seed;
    this.rng = new Rng(seed + 4409);
    // 地坪比柱网略大一圈，形成车间外的散水/场坪边缘
    this.width = preset.hall.spanX * 1.24;
    this.depth = preset.hall.spanZ * 1.24;
    this.halfX = this.width / 2;
    this.halfZ = this.depth / 2;
  }

  /**
   * 按画质档设置地坪网格分辨率（地坪 64×48 ≈ 6k 三角面，是低档预算的大头）。
   * 低档 16×12、中档 32×24、高档 48×36。
   */
  setFloorResolution(rx: number, rz: number): void {
    this.resX = Math.max(4, Math.round(rx));
    this.resZ = Math.max(4, Math.round(rz));
  }

  /** 地坪微起伏（米）。relief = 0 时完全平整。 */
  reliefAt(x: number, z: number): number {
    const amp = this.preset.floor.relief;
    if (amp <= 0.001) return 0;
    const n = 6.4 / Math.max(40, this.width);
    const h = (fbm2(x * n, z * n, this.seed + 17, 4) - 0.5) * 2.0;
    // 靠边轻微起坡，避免地坪看起来像一张浮空的纸
    const edge = Math.max(Math.abs(x) / this.halfX, Math.abs(z) / this.halfZ);
    const rise = Math.pow(clamp(edge, 0, 1), 3.2) * amp * 5.5;
    return h * amp + rise;
  }

  // ---------------- 地坪 ----------------
  buildFloor(material: THREE.Material): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(this.width, this.depth, this.resX, this.resZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const pal = this.preset.palette;
    const cBase = new THREE.Color(this.preset.floor.colour);
    const cAlt = new THREE.Color(this.preset.floor.colourAlt);
    const cDark = new THREE.Color(pal.floor).multiplyScalar(0.62);
    const cLane = new THREE.Color(this.preset.floor.lane);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.reliefAt(x, z));

      // 斑驳的水泥色：两层噪声叠加，避免大面积纯色
      const n1 = fbm2(x * 0.055, z * 0.055, this.seed + 71, 3);
      const n2 = fbm2(x * 0.22, z * 0.22, this.seed + 133, 2);
      const c = cBase.clone().lerp(cAlt, clamp(n1 * 1.5 - 0.2, 0, 1));
      c.lerp(cDark, clamp((n2 - 0.62) * 1.6, 0, 0.5));

      // 重工车间：地面沿设备走向被油污与胎痕压暗
      if (this.preset.floor.style === 'lanes') {
        const tread = Math.abs(Math.sin(x * 0.34)) * Math.abs(Math.sin(z * 0.34));
        c.lerp(cDark, tread * 0.22);
      }
      // 户外场站：碎石与混凝土拼接，边界更硬
      if (this.preset.floor.style === 'apron') {
        const patch = fbm2(x * 0.09, z * 0.09, this.seed + 211, 2);
        if (patch > 0.58) c.lerp(cLane, 0.16);
      }

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.name = 'floor';
    return mesh;
  }

  /** 安全通道标线：沿设备行/列之间的通道刷黄色边线。 */
  buildLanes(slots: DeviceSlot[]): THREE.Group {
    const g = new THREE.Group();
    g.name = 'lanes';
    const laneStyle = this.preset.floor.style;
    if (laneStyle === 'concrete' || slots.length === 0) return g;

    const laneMat = new THREE.MeshBasicMaterial({
      color: this.preset.floor.lane,
      transparent: true,
      opacity: laneStyle === 'lanes' ? 0.78 : 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const edgeMat = new THREE.MeshBasicMaterial({
      color: laneStyle === 'lanes' ? 0xe8e4dc : 0xe8e4dc,
      transparent: true,
      opacity: 0.42,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const bandW = laneStyle === 'lanes' ? 0.42 : 0.3;
    const pts = slots.map((s) => ({ x: s.x, z: s.z }));

    // 用去重后的行/列坐标画通道标线，使标线自然贴合设备阵列
    const xs = Array.from(new Set(pts.map((p) => Math.round(p.x * 2) / 2))).sort((a, b) => a - b);
    const zs = Array.from(new Set(pts.map((p) => Math.round(p.z * 2) / 2))).sort((a, b) => a - b);

    const addStrip = (x0: number, z0: number, x1: number, z1: number, w: number, mat: THREE.Material) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.5) return;
      const geo = new THREE.PlaneGeometry(len, w);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      mesh.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      // 贴合地坪起伏
      const samples = 12;
      const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const lx = p.getX(i);
        const lz = p.getZ(i);
        const wx = mesh.position.x + lx * Math.cos(mesh.rotation.y) + lz * Math.sin(mesh.rotation.y);
        const wz = mesh.position.z - lx * Math.sin(mesh.rotation.y) + lz * Math.cos(mesh.rotation.y);
        p.setY(i, this.reliefAt(wx, wz) + 0.045);
      }
      p.needsUpdate = true;
      g.add(mesh);
      void samples;
    };

    // 横向通道（沿 X 贯穿）
    for (let i = 0; i < zs.length - 1; i++) {
      const zMid = (zs[i] + zs[i + 1]) / 2;
      if (i % 2 === 0) continue;
      addStrip(-this.halfX * 0.86, zMid, this.halfX * 0.86, zMid, bandW, laneMat);
      addStrip(-this.halfX * 0.86, zMid + bandW * 1.5, this.halfX * 0.86, zMid + bandW * 1.5, bandW * 0.42, edgeMat);
    }
    // 纵向通道（沿 Z 贯穿）
    for (let i = 0; i < xs.length - 1; i++) {
      const xMid = (xs[i] + xs[i + 1]) / 2;
      if (i % 2 === 0) continue;
      addStrip(xMid, -this.halfZ * 0.86, xMid, this.halfZ * 0.86, bandW, laneMat);
      addStrip(xMid + bandW * 1.5, -this.halfZ * 0.86, xMid + bandW * 1.5, this.halfZ * 0.86, bandW * 0.42, edgeMat);
    }
    // 标线带全静态，按材质合并为 2 个 drawcall（黄色带 / 白色边）
    mergeStaticChildren(g);
    return g;
  }

  // ---------------- 结构层：立柱 / 墙面 / 顶棚 / 行车 ----------------
  buildStructure(shell: ShellMode = 'full'): THREE.Group {
    const g = new THREE.Group();
    g.name = 'structure';
    const pal = this.preset.palette;
    const h = this.preset.hall;
    const rng = this.rng;

    // 半透明外壳：设备在厂房内部，不透明墙顶会让默认视角只剩一个盒子。
    const ghost = shell === 'ghost';
    const hideShell = shell === 'none';
    const columnMat = new THREE.MeshStandardMaterial({ color: pal.column, roughness: 0.82, metalness: 0.12 });
    const steelMat = new THREE.MeshStandardMaterial({ color: pal.steel, roughness: 0.55, metalness: 0.55 });
    const wallMat = new THREE.MeshStandardMaterial({
      color: pal.wall,
      roughness: 0.9,
      metalness: 0.02,
      side: THREE.DoubleSide,
      transparent: ghost,
      opacity: ghost ? 0.15 : 1,
      depthWrite: !ghost,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: pal.roof,
      roughness: 0.86,
      metalness: 0.08,
      side: THREE.DoubleSide,
      transparent: ghost,
      opacity: ghost ? 0.13 : 1,
      depthWrite: !ghost,
    });

    const H = h.wallHeight;
    const bay = h.baySpacing;
    const nx = Math.max(2, Math.round(h.spanX / bay));
    const nz = Math.max(2, Math.round(h.spanZ / bay));
    // 流畅档厂房 LOD：桁架腹杆与高跨照明灯减半（合并后 drawcall 不变，但三角面与
    // 构建时的 BoxGeometry 数量减半；柱网/墙体/行车等辨识特征完整保留）。
    const lowQ = this.params.quality === 'low';

    // ---- 柱网 ----
    if (H > 0) {
      const colW = 0.85;
      for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= nz; j++) {
          // 内部柱网抽稀：只保留边缘与每两跨一根，车间中央留出作业面
          const onEdge = i === 0 || i === nx || j === 0 || j === nz;
          if (!onEdge && (i % 2 !== 0 || j % 2 !== 0)) continue;
          const x = -h.spanX / 2 + (h.spanX * i) / nx;
          const z = -h.spanZ / 2 + (h.spanZ * j) / nz;
          const ch = H + (h.roof === 'truss' ? 1.6 : 0.4);
          const col = new THREE.Mesh(new THREE.BoxGeometry(colW, ch, colW), columnMat);
          col.position.set(x, ch / 2, z);
          col.castShadow = true;
          col.receiveShadow = true;
          g.add(col);
          // 柱脚底板
          const base = new THREE.Mesh(new THREE.BoxGeometry(colW * 2.1, 0.32, colW * 2.1), steelMat);
          base.position.set(x, 0.16, z);
          g.add(base);
        }
      }
    }

    // ---- 墙面（仅封闭车间，且外壳未隐藏） ----
    if (h.walls && H > 0 && !hideShell) {
      const t = 0.42;
      const wallH = H;
      // 长边墙带勒脚与上部窗带
      const sides: Array<{ x: number; z: number; w: number; d: number }> = [
        { x: 0, z: -h.spanZ / 2, w: h.spanX + t, d: t },
        { x: 0, z: h.spanZ / 2, w: h.spanX + t, d: t },
        { x: -h.spanX / 2, z: 0, w: t, d: h.spanZ + t },
        { x: h.spanX / 2, z: 0, w: t, d: h.spanZ + t },
      ];
      for (const s of sides) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(s.w, wallH, s.d), wallMat);
        wall.position.set(s.x, wallH / 2, s.z);
        wall.receiveShadow = true;
        g.add(wall);
        // 勒脚（深色）
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(s.w * 1.004, 1.1, s.d * 1.02), steelMat);
        skirt.position.set(s.x, 0.55, s.z);
        g.add(skirt);
        // 高侧窗带（发光条）
        const winMat = new THREE.MeshBasicMaterial({
          color: pal.emissive,
          transparent: true,
          opacity: ghost ? 0.22 : 0.55,
          depthWrite: false,
        });
        const win = new THREE.Mesh(new THREE.BoxGeometry(s.w * 1.005, 1.6, s.d * 1.03), winMat);
        win.position.set(s.x, wallH * 0.74, s.z);
        g.add(win);
      }
      // 山墙通风器
      if (this.preset.id === 'heavy') {
        for (const z of [-h.spanZ / 2, h.spanZ / 2]) {
          for (let i = -1; i <= 1; i += 2) {
            const vent = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 2.2, 10), steelMat);
            vent.position.set(i * h.spanX * 0.22, wallH + 2.6, z * 1.02);
            vent.castShadow = true;
            g.add(vent);
          }
        }
      }
    }

    // ---- 顶棚 ----
    if (h.roof === 'truss') {
      const trussTop = H + 2.0;
      // 上下弦 + 腹杆
      for (let i = 0; i <= nx; i++) {
        const x = -h.spanX / 2 + (h.spanX * i) / nx;
        // 下弦
        const low = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, h.spanZ), steelMat);
        low.position.set(x, H + 0.25, 0);
        g.add(low);
        // 上弦
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, h.spanZ), steelMat);
        up.position.set(x, trussTop, 0);
        g.add(up);
        // 腹杆（斜撑）
        const webN = Math.max(4, Math.round(h.spanZ / (lowQ ? 8.4 : 4.2)));
        for (let k = 0; k < webN; k++) {
          const z0 = -h.spanZ / 2 + (h.spanZ * k) / webN;
          const z1 = -h.spanZ / 2 + (h.spanZ * (k + 1)) / webN;
          const len = Math.hypot(0, z1 - z0);
          const web = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, len * 1.06), steelMat);
          web.position.set(x, (H + 0.25 + trussTop) / 2, (z0 + z1) / 2);
          web.rotation.x = (k % 2 === 0 ? 1 : -1) * Math.atan2(trussTop - (H + 0.25), len);
          g.add(web);
        }
      }
      // 檩条（沿 X 贯通）+ 屋面板：外壳隐藏时只留桁架骨架，形成"开顶厂房"效果
      if (!hideShell) {
        const purlinN = Math.max(3, Math.round(h.spanZ / 6));
        for (let j = 0; j <= purlinN; j++) {
          const z = -h.spanZ / 2 + (h.spanZ * j) / purlinN;
          const purlin = new THREE.Mesh(new THREE.BoxGeometry(h.spanX, 0.2, 0.2), steelMat);
          purlin.position.set(0, trussTop + 0.22, z);
          g.add(purlin);
        }
        const roof = new THREE.Mesh(new THREE.BoxGeometry(h.spanX + 1.2, 0.26, h.spanZ + 1.2), roofMat);
        roof.position.set(0, trussTop + 0.5, 0);
        roof.castShadow = true;
        g.add(roof);
      }

      // 高跨照明灯（发光板）
      const lightMat = new THREE.MeshBasicMaterial({ color: pal.emissive, transparent: true, opacity: 0.85, depthWrite: false });
      const lxN = Math.max(2, Math.round(h.spanX / (lowQ ? 26 : 16)));
      const lzN = Math.max(1, Math.round(h.spanZ / (lowQ ? 26 : 16)));
      for (let i = 0; i < lxN; i++) {
        for (let j = 0; j <= lzN; j++) {
          const x = -h.spanX / 2 + (h.spanX * (i + 0.5)) / lxN;
          const z = -h.spanZ / 2 + (h.spanZ * j) / lzN;
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.9), lightMat);
          lamp.position.set(x, trussTop - 0.35, z);
          g.add(lamp);
        }
      }
    } else if (h.roof === 'flat' && !hideShell) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(h.spanX + 1.4, 0.4, h.spanZ + 1.4), roofMat);
      roof.position.set(0, H + 0.6, 0);
      g.add(roof);
    }

    // ---- 行车轨道（重工车间） ----
    if (h.crane) {
      const railY = h.craneHeight;
      const railMat = steelMat;
      // 两条纵向轨道梁
      for (const side of [-1, 1]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(h.spanX + 0.6, 0.85, 0.7), railMat);
        beam.position.set(0, railY, side * (h.spanZ / 2 - 0.9));
        beam.castShadow = true;
        g.add(beam);
        // 轨道下的牛腿
        const bracketN = Math.max(2, Math.round(h.spanX / bay));
        for (let i = 0; i <= bracketN; i++) {
          const x = -h.spanX / 2 + (h.spanX * i) / bracketN;
          const br = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), railMat);
          br.position.set(x, railY - 1.0, side * (h.spanZ / 2 - 0.9));
          g.add(br);
        }
      }
      // 行车大梁（可沿 X 缓慢移动，由场景 update 驱动）
      const bridge = new THREE.Group();
      bridge.name = 'craneBridge';
      const girder = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, h.spanZ - 1.4), steelMat);
      girder.castShadow = true;
      bridge.add(girder);
      // 端梁
      for (const side of [-1, 1]) {
        const end = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.2), railMat);
        end.position.set(0, -0.4, side * (h.spanZ / 2 - 0.9));
        bridge.add(end);
      }
      // 小车与吊钩
      const trolley = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 2.4), new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.6, metalness: 0.3 }));
      trolley.position.set(0, -1.4, 0);
      trolley.castShadow = true;
      bridge.add(trolley);
      const hookRope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.4, 6), steelMat);
      hookRope.position.set(0, -4.6, 0);
      bridge.add(hookRope);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.4, metalness: 0.7 }));
      hook.position.set(0, -7.5, 0);
      bridge.add(hook);
      bridge.position.set(-h.spanX * 0.28, railY + 1.2, 0);
      bridge.userData.craneRange = h.spanX * 0.3;
      g.add(bridge);
    }

    // 行车大梁是可动件（场景 update 每帧驱动），必须排除在静态合并之外
    const crane = g.getObjectByName('craneBridge');
    if (crane) g.remove(crane);
    mergeStaticChildren(g);
    if (crane) g.add(crane);

    void rng;
    return g;
  }

  /** 基础管廊：沿厂房纵向架空敷设，并把若干设备接入。 */
  buildPipeRacks(slots: DeviceSlot[]): THREE.Group {
    const g = new THREE.Group();
    g.name = 'piperacks';
    if (!this.preset.hall.pipeRacks || slots.length === 0) return g;
    const pal = this.preset.palette;
    const steelMat = new THREE.MeshStandardMaterial({ color: pal.steel, roughness: 0.6, metalness: 0.5 });
    const pipeMats = [0x8a9aa4, 0xa8b0b6, 0xb8a06a, 0x7f9a8a].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0.72 })
    );

    const h = this.preset.hall;
    const y = Math.max(5.5, h.wallHeight * 0.55);
    const rackZ = -h.spanZ / 2 + 3.2;
    const len = h.spanX * 1.02;

    // 立柱 + 横梁
    const bayN = Math.max(3, Math.round(h.spanX / 13));
    for (let i = 0; i <= bayN; i++) {
      const x = -len / 2 + (len * i) / bayN;
      for (const dz of [-1.1, 1.1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, y, 0.34), steelMat);
        post.position.set(x, y / 2, rackZ + dz);
        post.castShadow = true;
        g.add(post);
      }
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 2.6), steelMat);
      cross.position.set(x, y - 0.2, rackZ);
      g.add(cross);
    }
    // 多层管道
    const layers = [
      { dy: 0.0, r: 0.42, mat: 0 },
      { dy: 0.95, r: 0.3, mat: 1 },
      { dy: 1.7, r: 0.24, mat: 2 },
      { dy: 0.95, r: 0.24, mat: 3, dz: 0.95 },
    ];
    for (const L of layers) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(L.r, L.r, len, 12), pipeMats[L.mat]);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, y + 0.6 + L.dy, rackZ + (L.dz || 0));
      pipe.castShadow = true;
      g.add(pipe);
    }
    // 若干支管下引至设备附近
    const dropN = Math.min(4, slots.length);
    for (let i = 0; i < dropN; i++) {
      const s = slots[Math.floor((i + 0.5) * (slots.length / dropN)) % slots.length];
      if (!s) continue;
      const dx = s.x;
      const dz = s.z - rackZ;
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, y + 0.6, 10), pipeMats[i % pipeMats.length]);
      drop.position.set(dx, (y + 0.6) / 2, rackZ);
      g.add(drop);
      const run = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, Math.abs(dz), 10), pipeMats[i % pipeMats.length]);
      run.rotation.x = Math.PI / 2;
      run.position.set(dx, y + 0.6, rackZ + dz / 2);
      g.add(run);
    }
    // 管廊全静态（无可动件），按材质合并：立柱/横梁/各层管道各 1 个 drawcall
    mergeStaticChildren(g);
    return g;
  }

  /** 参考实现里 terrain 的 skirt —— 地坪侧壁，避免俯视时像一张浮空纸片。 */
  buildApron(material: THREE.Material): THREE.Mesh {
    const depth = 6;
    const verts: number[] = [];
    const push = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
      verts.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    };
    const segs = 28;
    const hx = this.halfX;
    const hz = this.halfZ;
    const yAt = (x: number, z: number) => this.reliefAt(clamp(x, -hx, hx), clamp(z, -hz, hz));
    for (let i = 0; i < segs; i++) {
      const t0 = -hx + (2 * hx * i) / segs;
      const t1 = -hx + (2 * hx * (i + 1)) / segs;
      const u0 = -hz + (2 * hz * i) / segs;
      const u1 = -hz + (2 * hz * (i + 1)) / segs;
      // 北 / 南
      push(t0, yAt(t0, -hz), -hz, t1, yAt(t1, -hz), -hz, t0, -depth, -hz);
      push(t1, yAt(t1, -hz), -hz, t1, -depth, -hz, t0, -depth, -hz);
      push(t0, yAt(t0, hz), hz, t1, yAt(t1, hz), hz, t0, -depth, hz);
      push(t1, yAt(t1, hz), hz, t1, -depth, hz, t0, -depth, hz);
      // 西 / 东
      push(-hx, yAt(-hx, u0), u0, -hx, yAt(-hx, u1), u1, -hx, -depth, u0);
      push(-hx, yAt(-hx, u1), u1, -hx, -depth, u1, -hx, -depth, u0);
      push(hx, yAt(hx, u0), u0, hx, yAt(hx, u1), u1, hx, -depth, u0);
      push(hx, yAt(hx, u1), u1, hx, -depth, u1, hx, -depth, u0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.computeVertexNormals();
    const mat = (material as THREE.MeshStandardMaterial).clone();
    mat.vertexColors = false;
    mat.color = new THREE.Color(this.preset.floor.colour).multiplyScalar(0.5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'apron';
    return mesh;
  }

  /** 布局：把 16 台设备摆进车间。pattern 决定阵列形态。 */
  layout(count: number, pattern: 'grid' | 'ring' | 'wall', spacing: number, scale: number): DeviceSlot[] {
    const h = this.preset.hall;
    const rng = new Rng(this.seed + 5501);
    const slots: DeviceSlot[] = [];
    // 可布置范围必须同时满足两件事：在墙内（有墙时）、在地坪内（无墙时），
    // 并留出设备自身占位余量 —— 否则环布/沿墙布局会把设备摆到墙外或地坪外。
    const innerX = h.walls && h.wallHeight > 0 ? h.spanX / 2 : this.halfX * 0.94;
    const innerZ = h.walls && h.wallHeight > 0 ? h.spanZ / 2 : this.halfZ * 0.94;
    const usableX = innerX * 0.8;
    const usableZ = innerZ * 0.78;
    const baseR = 3.1 * scale * clamp(spacing, 0.6, 1.8);

    if (pattern === 'grid') {
      const cols = Math.ceil(Math.sqrt(count * (usableX / usableZ)));
      const rows = Math.ceil(count / cols);
      const stepX = (usableX * 2) / Math.max(1, cols);
      const stepZ = (usableZ * 2) / Math.max(1, rows);
      for (let i = 0; i < count; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = -usableX + stepX * (c + 0.5) + rng.jitter(stepX * 0.06);
        const z = -usableZ + stepZ * (r + 0.5) + rng.jitter(stepZ * 0.06);
        slots.push({ x, z, angle: rng.chance(0.5) ? 0 : Math.PI / 2, radius: baseR });
      }
    } else if (pattern === 'ring') {
      // 罐区式环布：外圈 + 内圈
      const outer = Math.ceil(count * 0.62);
      const inner = count - outer;
      const rx = usableX * 0.92;
      const rz = usableZ * 1.05;
      for (let i = 0; i < outer; i++) {
        const a = (i / outer) * Math.PI * 2 + 0.2;
        slots.push({
          x: Math.cos(a) * rx + rng.jitter(1.2),
          z: Math.sin(a) * rz + rng.jitter(1.2),
          angle: -a + Math.PI / 2,
          radius: baseR,
        });
      }
      for (let i = 0; i < inner; i++) {
        const a = (i / Math.max(1, inner)) * Math.PI * 2 + 1.1;
        slots.push({
          x: Math.cos(a) * rx * 0.42,
          z: Math.sin(a) * rz * 0.42,
          angle: -a + Math.PI / 2,
          radius: baseR * 0.9,
        });
      }
    } else {
      // 沿墙两排
      const perRow = Math.ceil(count / 2);
      const step = (usableX * 2) / Math.max(1, perRow);
      for (let i = 0; i < count; i++) {
        const row = i < perRow ? -1 : 1;
        const k = i % perRow;
        slots.push({
          x: -usableX + step * (k + 0.5) + rng.jitter(step * 0.05),
          z: row * usableZ * 0.86,
          angle: row < 0 ? Math.PI : 0,
          radius: baseR,
        });
      }
    }
    return slots.slice(0, count);
  }

  /** 地面网格辅助线开关用到的尺寸。 */
  get bounds() {
    return { halfX: this.halfX, halfZ: this.halfZ };
  }

  /** 供相机取景参考的最大高度。 */
  get structureHeight(): number {
    const h = this.preset.hall;
    if (h.roof === 'truss') return h.wallHeight + 3.2;
    if (h.crane) return h.craneHeight + 3;
    return Math.max(6, h.wallHeight * 0.4);
  }

  /** 让地坪颜色随预设变化的辅助：返回 lerp 后的地坪色。 */
  floorTint(alt: number, t: number): THREE.Color {
    return new THREE.Color(this.preset.floor.colour).lerp(new THREE.Color(alt), t);
  }

  static lerpColor = lerp;
}
