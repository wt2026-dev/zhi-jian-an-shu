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

/** 生成红色安全生产大幅横幅贴图 */
function makeSloganTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(0, 0, 1024, 160);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 1012, 148);
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, 1000, 136);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 50px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillText('安全生产 人命关天 · 规范操作 严守规程', 512, 65);

  ctx.fillStyle = '#fef08a';
  ctx.font = 'bold 22px monospace';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillText('★ SAFETY FIRST · STRICT PROCESS COMPLIANCE · ZERO DEFECT ★', 512, 120);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 生成车间操作规程看板贴图 */
function makeRegulationTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 680;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 680);
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 504, 672);

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(8, 8, 496, 92);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('机加车间设备安全操作规程', 256, 54);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'left';
  const rules = [
    '1. 必须按规定穿戴防砸劳保鞋与安全帽',
    '2. 开机作业前严格点检润滑油位与气压',
    '3. 设备运转中严禁手伸入作业危险区',
    '4. 发现震动/温升异响立即按急停并报修',
    '5. 检修维护作业严格执行 LOTO 挂锁断电',
    '6. 班后关断主电闸，清理工位保持 5S 规范',
  ];
  let y = 160;
  for (const r of rules) {
    ctx.fillText(r, 26, y);
    y += 75;
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('动力智能车间 安全生产委员会 监制', 480, 640);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
  /** 车间天花板工业大吊扇，可动件由场景 update 驱动 */
  ceilingFans: THREE.Group[] = [];
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
    const cDark = new THREE.Color(pal.floor).multiplyScalar(0.72);
    const cLane = new THREE.Color(this.preset.floor.lane);
    const cEpoxyGreen = new THREE.Color(0x1a332f); // 工业环氧墨绿作业区

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.reliefAt(x, z));

      // 斑驳细腻的自流平地坪色：双层微噪声，保持平整反光质感
      const n1 = fbm2(x * 0.055, z * 0.055, this.seed + 71, 3);
      const n2 = fbm2(x * 0.22, z * 0.22, this.seed + 133, 2);
      const c = cBase.clone().lerp(cAlt, clamp(n1 * 1.4 - 0.2, 0, 1));
      c.lerp(cDark, clamp((n2 - 0.65) * 1.5, 0, 0.4));

      // 工业车间：设备工作区域带有经典环氧地坪深墨绿色泽，主通道偏深灰
      if (this.preset.id === 'industrial') {
        const inWorkZone = Math.abs(x) < this.halfX * 0.72 && Math.abs(z) < this.halfZ * 0.72;
        if (inWorkZone) {
          c.lerp(cEpoxyGreen, 0.45);
        }
      }

      // 重工车间：地面沿设备走向被油污与胎痕压暗
      if (this.preset.floor.style === 'lanes') {
        const tread = Math.abs(Math.sin(x * 0.34)) * Math.abs(Math.sin(z * 0.34));
        c.lerp(cDark, tread * 0.18);
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

    // ---- 墙面（真实工业车间围合结构） ----
    if (h.walls && H > 0 && !hideShell) {
      const t = 0.42;
      const wallH = H;
      const skirtH = 2.4;

      if (ghost || lowQ) {
        // 极简半透明/流畅档外壳：四向平整轻量墙面，无额外挂件与高面数构件
        for (const sideZ of [-h.spanZ / 2, h.spanZ / 2]) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(h.spanX + t, wallH, t), wallMat);
          w.position.set(0, wallH / 2, sideZ);
          g.add(w);
        }
        for (const sideX of [-h.spanX / 2, h.spanX / 2]) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(t, wallH, h.spanZ), wallMat);
          w.position.set(sideX, wallH / 2, 0);
          g.add(w);
        }
      } else {
        // 1. 北墙（远端正墙，不遮挡设备视线，全高实体保温板）
        const northWall = new THREE.Mesh(new THREE.BoxGeometry(h.spanX + t, wallH, t), wallMat);
        northWall.position.set(0, wallH / 2, -h.spanZ / 2);
        northWall.receiveShadow = true;
        g.add(northWall);
        const northSkirt = new THREE.Mesh(new THREE.BoxGeometry(h.spanX + t * 1.1, skirtH, t * 1.05), steelMat);
        northSkirt.position.set(0, skirtH / 2, -h.spanZ / 2);
        g.add(northSkirt);

        // 北墙悬挂大红色安全生产巨幅看板
        const sloganTex = makeSloganTexture();
        if (sloganTex) {
          const bannerW = Math.min(26, h.spanX * 0.65);
          const bannerH = bannerW * (160 / 1024);
          const bannerGeo = new THREE.PlaneGeometry(bannerW, bannerH);
          const bannerMat = new THREE.MeshBasicMaterial({ map: sloganTex, transparent: true });
          const banner = new THREE.Mesh(bannerGeo, bannerMat);
          banner.position.set(0, wallH * 0.72, -h.spanZ / 2 + t * 0.55);
          g.add(banner);
        }

        // 北墙挂载《机加车间设备安全操作规程》
        const regTex = makeRegulationTexture();
        if (regTex) {
          const boardW = 3.2;
          const boardH = 4.2;
          const boardGeo = new THREE.PlaneGeometry(boardW, boardH);
          const boardMat = new THREE.MeshBasicMaterial({ map: regTex, transparent: true });
          const board = new THREE.Mesh(boardGeo, boardMat);
          board.position.set(-h.spanX * 0.32, wallH * 0.44, -h.spanZ / 2 + t * 0.55);
          g.add(board);

          // 另一侧看板：5S 现场管理规范
          const board2 = board.clone();
          board2.position.set(h.spanX * 0.32, wallH * 0.44, -h.spanZ / 2 + t * 0.55);
          g.add(board2);
        }

        // 2. 东西两侧墙面：下部护墙裙边 + 上部大面积工业网格采光玻璃大窗
        const glassMat = new THREE.MeshPhysicalMaterial({
          color: 0x93c5fd,
          transparent: true,
          opacity: 0.42,
          roughness: 0.12,
          metalness: 0.85,
          transmission: 0.6,
          ior: 1.45,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        for (const sideX of [-h.spanX / 2, h.spanX / 2]) {
          // 下部实心勒脚
          const skirt = new THREE.Mesh(new THREE.BoxGeometry(t, skirtH, h.spanZ + t), steelMat);
          skirt.position.set(sideX, skirtH / 2, 0);
          g.add(skirt);

          // 顶部门梁
          const lintelH = 1.4;
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(t, lintelH, h.spanZ + t), wallMat);
          lintel.position.set(sideX, wallH - lintelH / 2, 0);
          g.add(lintel);

          // 采光窗洞口尺寸
          const winH = wallH - skirtH - lintelH;
          const winY = skirtH + winH / 2;

          // 落地采光大玻璃
          const glass = new THREE.Mesh(new THREE.BoxGeometry(t * 0.2, winH, h.spanZ - 2), glassMat);
          glass.position.set(sideX, winY, 0);
          g.add(glass);

          // 窗框金属网格分格（双层 6 跨）
          const winCols = 8;
          for (let c = 0; c <= winCols; c++) {
            const wz = -(h.spanZ - 2) / 2 + ((h.spanZ - 2) * c) / winCols;
            const mullion = new THREE.Mesh(new THREE.BoxGeometry(t * 0.4, winH, 0.12), steelMat);
            mullion.position.set(sideX, winY, wz);
            g.add(mullion);
          }
          const transom = new THREE.Mesh(new THREE.BoxGeometry(t * 0.4, 0.12, h.spanZ - 2), steelMat);
          transom.position.set(sideX, winY, 0);
          g.add(transom);

          // 窗外室外绿化树与地坪延伸（透过大窗能清晰看见室外景致）
          const treeMat = new THREE.MeshStandardMaterial({ color: 0x1e3a29, roughness: 0.8 });
          const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 });
          for (let k = -2; k <= 2; k++) {
            const tx = sideX + (sideX > 0 ? 5.2 : -5.2);
            const tz = k * 9;
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.8, 6), trunkMat);
            trunk.position.set(tx, 1.4, tz);
            g.add(trunk);
            const foliage = new THREE.Mesh(new THREE.SphereGeometry(1.4, 6, 6), treeMat);
            foliage.position.set(tx, 3.6, tz);
            g.add(foliage);
          }
        }

        // 3. 南墙（面对摄像机入口侧）：低矮防坠护墙 + 黄色警示双道钢管扶手，畅通无阻看车间
        const southH = 1.35;
        const southWall = new THREE.Mesh(new THREE.BoxGeometry(h.spanX + t, southH, t), steelMat);
        southWall.position.set(0, southH / 2, h.spanZ / 2);
        g.add(southWall);
        const railYellowMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35, metalness: 0.5 });
        const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h.spanX, 8), railYellowMat);
        topRail.rotation.z = Math.PI / 2;
        topRail.position.set(0, southH + 0.1, h.spanZ / 2);
        g.add(topRail);
      }
    }

    // ---- 顶棚钢桁架与大吊扇 ----
    this.ceilingFans = [];
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
        const dz = h.spanZ / webN;
        for (let j = 0; j < webN; j++) {
          const z0 = -h.spanZ / 2 + j * dz;
          const z1 = z0 + dz;
          const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, dz * 1.1, 5), steelMat);
          strut.position.set(x, (H + 0.25 + trussTop) / 2, (z0 + z1) / 2);
          strut.rotation.x = 0.55 * (j % 2 === 0 ? 1 : -1);
          g.add(strut);
        }
      }
      // 纵向系杆
      for (const f of [-0.35, 0, 0.35]) {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(h.spanX, 0.24, 0.24), steelMat);
        tie.position.set(0, trussTop, f * h.spanZ);
        g.add(tie);
      }
      // 屋面板（半透明高耸大厂房，采光顶棚）
      const halfZ = h.spanZ / 2;
      const roofHalf = new THREE.Mesh(new THREE.BoxGeometry(h.spanX + 1.2, 0.22, halfZ), roofMat);
      roofHalf.position.set(0, trussTop + 0.25, -halfZ / 2);
      g.add(roofHalf);

      // 高跨下悬 LED 工矿吊灯（合并后仅 1 个 drawcall）
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3d6 });
      for (let i = 1; i < nx; i++) {
        const lx = -h.spanX / 2 + (h.spanX * i) / nx;
        for (const lz of [-h.spanZ * 0.26, 0, h.spanZ * 0.26]) {
          const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), steelMat);
          cord.position.set(lx, H - 0.7, lz);
          g.add(cord);
          const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.12, 0.36, 8, 1, true), steelMat);
          hood.position.set(lx, H - 1.4, lz);
          g.add(hood);
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), lampMat);
          bulb.position.set(lx, H - 1.45, lz);
          g.add(bulb);
        }
      }

      // 工业车间大吊扇（4 台，直径 4.2m，5 片流线叶片）
      if (!ghost && !lowQ) {
        const fanMotorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.7 });
        const fanBladeMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.35, metalness: 0.6 });
        const fanPos = [
          { x: -h.spanX * 0.22, z: -h.spanZ * 0.2 },
          { x: h.spanX * 0.22, z: -h.spanZ * 0.2 },
          { x: -h.spanX * 0.22, z: h.spanZ * 0.2 },
          { x: h.spanX * 0.22, z: h.spanZ * 0.2 },
        ];
        for (let fi = 0; fi < fanPos.length; fi++) {
          const fp = fanPos[fi];
          const fanGroup = new THREE.Group();
          fanGroup.name = `ceilingFan_${fi}`;
          fanGroup.position.set(fp.x, H - 1.2, fp.z);

          // 悬吊固定杆
          const dropRod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), steelMat);
          dropRod.position.set(0, 0.6, 0);
          fanGroup.add(dropRod);

          // 转动子组件（电机壳与 5 片大叶片）
          const rotor = new THREE.Group();
          rotor.name = 'fanRotor';
          const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.48, 12), fanMotorMat);
          rotor.add(motor);

          const bladeN = 5;
          const bladeLen = 2.4;
          for (let b = 0; b < bladeN; b++) {
            const ang = (b / bladeN) * Math.PI * 2;
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, bladeLen), fanBladeMat);
            blade.position.set(Math.sin(ang) * (bladeLen / 2 + 0.35), -0.1, Math.cos(ang) * (bladeLen / 2 + 0.35));
            blade.rotation.y = ang;
            blade.rotation.x = 0.14; // 倾斜攻角
            rotor.add(blade);
          }
          fanGroup.add(rotor);
          g.add(fanGroup);
          this.ceilingFans.push(rotor);
        }
      }
    }

    // ---- 车间操作工位与 5S 杂物散布 ----
    if (!ghost && !lowQ) {
      this.buildWorkshopClutterAndStations(g, h);
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

    // 可动件（行车大梁与大吊扇）排除在静态合并之外
    const crane = g.getObjectByName('craneBridge');
    const fans: THREE.Object3D[] = [];
    g.traverse((obj) => {
      if (obj.name.startsWith('ceilingFan_')) fans.push(obj);
    });
    if (crane) g.remove(crane);
    for (const f of fans) g.remove(f);

    mergeStaticChildren(g);

    if (crane) g.add(crane);
    for (const f of fans) g.add(f);

    void rng;
    return g;
  }

  /** 构建车间工位、木托盘、纸箱堆、机油钢桶与工具车等环境细节 */
  private buildWorkshopClutterAndStations(g: THREE.Group, h: ScenePreset['hall']): void {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.7 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.85, metalness: 0.05 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.88, metalness: 0.02 });
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.6 });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    const yellowDrumMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35, metalness: 0.6 });
    const blueDrumMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35, metalness: 0.6 });
    const redToolMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35, metalness: 0.5 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.95, metalness: 0.05 });

    // 1. 操作工位（放置在主通道两侧与产线旁）
    const stationSpots = [
      { x: -h.spanX * 0.28, z: -h.spanZ * 0.3, ang: 0 },
      { x: h.spanX * 0.28, z: -h.spanZ * 0.3, ang: 0 },
      { x: -h.spanX * 0.28, z: h.spanZ * 0.25, ang: Math.PI },
    ];
    for (const st of stationSpots) {
      const gy = this.reliefAt(st.x, st.z);
      // 防疲劳黑色橡胶地垫
      const matPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), rubberMat);
      matPlane.rotateX(-Math.PI / 2);
      matPlane.position.set(st.x, gy + 0.02, st.z);
      g.add(matPlane);

      // 工业操作台桌（长 1.6m，高 0.9m，宽 0.75m）
      const tableX = st.x;
      const tableZ = st.z + (st.ang === 0 ? -0.8 : 0.8);
      const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.75), tableMat);
      deskTop.position.set(tableX, gy + 0.9, tableZ);
      g.add(deskTop);
      for (const dx of [-0.7, 0.7]) {
        for (const dz of [-0.3, 0.3]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8), steelMat);
          leg.position.set(tableX + dx, gy + 0.45, tableZ + dz);
          g.add(leg);
        }
      }

      // 桌面工控数控液晶屏
      const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.42, 0.06), steelMat);
      monitor.position.set(tableX, gy + 1.25, tableZ);
      g.add(monitor);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), screenMat);
      scr.position.set(tableX, gy + 1.25, tableZ + (st.ang === 0 ? 0.035 : -0.035));
      if (st.ang !== 0) scr.rotateY(Math.PI);
      g.add(scr);

      // 工位旋转工学椅
      const chairX = st.x + 0.35;
      const chairZ = st.z;
      const chairSeat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 10), rubberMat);
      chairSeat.position.set(chairX, gy + 0.55, chairZ);
      g.add(chairSeat);
      const chairStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), steelMat);
      chairStem.position.set(chairX, gy + 0.275, chairZ);
      g.add(chairStem);
    }

    // 2. 工件木托盘与机加工件堆叠（4 处散布在仓储暂存区）
    const palletSpots = [
      { x: -h.spanX * 0.38, z: -h.spanZ * 0.15 },
      { x: -h.spanX * 0.38, z: 0.1 },
      { x: h.spanX * 0.38, z: -0.15 },
      { x: h.spanX * 0.38, z: 0.2 },
    ];
    for (const p of palletSpots) {
      const gy = this.reliefAt(p.x, p.z);
      // 木托盘（长 1.2m，宽 1.0m，高 0.15m）
      const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 1.0), woodMat);
      pallet.position.set(p.x, gy + 0.07, p.z);
      g.add(pallet);

      // 上方码放零件瓦楞纸箱（2~3 箱）
      const box1 = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.42), boxMat);
      box1.position.set(p.x - 0.25, gy + 0.35, p.z - 0.2);
      g.add(box1);
      const box2 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.44), boxMat);
      box2.position.set(p.x + 0.25, gy + 0.36, p.z - 0.18);
      g.add(box2);
      const box3 = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.38, 0.4), boxMat);
      box3.position.set(p.x - 0.1, gy + 0.77, p.z - 0.15);
      g.add(box3);
    }

    // 3. 工业机油钢桶组（黄色液压油 + 蓝色抗磨润滑油桶）
    const drumSpots = [
      { x: -h.spanX * 0.36, z: -h.spanZ * 0.36 },
      { x: h.spanX * 0.36, z: -h.spanZ * 0.36 },
    ];
    for (const ds of drumSpots) {
      const gy = this.reliefAt(ds.x, ds.z);
      const drumD = 0.58;
      const drumH = 0.92;
      // 3 桶一组排列
      const d1 = new THREE.Mesh(new THREE.CylinderGeometry(drumD / 2, drumD / 2, drumH, 12), yellowDrumMat);
      d1.position.set(ds.x, gy + drumH / 2, ds.z);
      g.add(d1);
      const d2 = new THREE.Mesh(new THREE.CylinderGeometry(drumD / 2, drumD / 2, drumH, 12), blueDrumMat);
      d2.position.set(ds.x + 0.65, gy + drumH / 2, ds.z);
      g.add(d2);
      const d3 = new THREE.Mesh(new THREE.CylinderGeometry(drumD / 2, drumD / 2, drumH, 12), blueDrumMat);
      d3.position.set(ds.x + 0.32, gy + drumH / 2, ds.z + 0.58);
      g.add(d3);
    }

    // 4. 红色移动抽屉工具推车与黄色防爆安全柜
    const toolSpots = [
      { x: -h.spanX * 0.18, z: -h.spanZ * 0.4 },
      { x: h.spanX * 0.18, z: -h.spanZ * 0.4 },
    ];
    for (const ts of toolSpots) {
      const gy = this.reliefAt(ts.x, ts.z);
      // 红色抽屉工具车（长 0.85m，高 0.95m，宽 0.55m）
      const cart = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.95, 0.55), redToolMat);
      cart.position.set(ts.x, gy + 0.52, ts.z);
      g.add(cart);
      // 黑色脚轮
      for (const cdx of [-0.35, 0.35]) {
        for (const cdz of [-0.22, 0.22]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), rubberMat);
          wheel.rotateZ(Math.PI / 2);
          wheel.position.set(ts.x + cdx, gy + 0.06, ts.z + cdz);
          g.add(wheel);
        }
      }
      // 推手把手
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.45), steelMat);
      handle.position.set(ts.x - 0.45, gy + 0.92, ts.z);
      g.add(handle);
    }
  }

  /** 更新车间内的吊扇等可动部件动画 */
  update(dt: number): void {
    for (const fan of this.ceilingFans) {
      fan.rotation.y += dt * 2.8;
    }
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
