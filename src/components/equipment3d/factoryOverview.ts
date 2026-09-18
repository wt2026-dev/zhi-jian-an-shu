/**
 * 厂区总览层 —— 对标视频 r1。
 *
 * 相机拉远后展示 3–5 栋厂房建筑群（程序化排布 + 道路 + 空地），
 * 每栋顶部带分区名称标签，点击某栋下钻进入对应车间（由 scene.ts 消费 picks）。
 *
 * 约束：
 *  - 只示意级写实（不追求贴图级），与参考视频观感一致；
 *  - 不引入新库；厂房外壳用共享 BoxGeometry + 少量材质，控制 Draw Call；
 *  - 厂房清单由**调用方传入真实分区数据**，本模块不臆造厂区名称。
 */

import * as THREE from 'three';
import { mulberry32, clamp } from './rand';

export interface FactoryBuildingSpec {
  id: string;
  /** 顶部标签文字，如 "1 号厂房・机加车间" */
  name: string;
  /** 下钻目标车间标识（透传给调用方，本模块不解释） */
  workshopId?: string;
  /** 在岗人员数（来自真实台账/班组数据或由调用方提供） */
  staffCount?: number;
  /** 季度产值预估（如 "¥1.85亿"） */
  outputValue?: string;
  /** 车间内设备数量 */
  deviceCount?: number;
  /** 运行状态 */
  status?: 'normal' | 'warning' | 'fault';
}

export interface FactoryOverviewOptions {
  seed: number;
  buildings: FactoryBuildingSpec[];
  shadows: boolean;
  detail: number;
}

interface PlacedBuilding extends FactoryBuildingSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** 单栋厂房的默认尺寸（米）。 */
const BUILDING_W = 40;
const BUILDING_D = 28;
const BUILDING_H = 13;

export class FactoryOverview {
  readonly group = new THREE.Group();
  /** 可拾取的厂房体块 */
  readonly picks: THREE.Object3D[] = [];
  readonly placed: PlacedBuilding[] = [];

  private opts: FactoryOverviewOptions;
  private rng: () => number;
  private ownedTextures: THREE.Texture[] = [];
  private labelSprites: THREE.Sprite[] = [];
  private roofHeatmaps: THREE.Mesh[] = [];
  /** 地面网格呼吸用的扫描环（P3） */
  private scanRing: THREE.Mesh | null = null;
  private paused = false;

  // 共享几何
  private geo = {
    wall: new THREE.BoxGeometry(1, 1, 1),
    roof: new THREE.BoxGeometry(1, 1, 1),
    strip: new THREE.BoxGeometry(1, 0.25, 1),
    door: new THREE.BoxGeometry(1, 1, 0.3),
    stack: new THREE.CylinderGeometry(0.9, 1.1, 4.2, 10),
  };

  private mat = {
    ground: new THREE.MeshStandardMaterial({ color: 0x0a1420, roughness: 0.95, metalness: 0.02 }),
    road: new THREE.MeshStandardMaterial({ color: 0x131c27, roughness: 0.9, metalness: 0.05 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x162a43, roughness: 0.8, metalness: 0.18 }),
    wallAlt: new THREE.MeshStandardMaterial({ color: 0x1b3350, roughness: 0.78, metalness: 0.2 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x223c58, roughness: 0.7, metalness: 0.35 }),
    trim: new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      roughness: 0.3,
      metalness: 0.4,
      emissive: new THREE.Color(0x0e7490),
      emissiveIntensity: 0.5,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.15,
      metalness: 0.2,
      transparent: true,
      opacity: 0.42,
    }),
    door: new THREE.MeshStandardMaterial({ color: 0x0f2233, roughness: 0.7, metalness: 0.3 }),
    stack: new THREE.MeshStandardMaterial({ color: 0x4b6b86, roughness: 0.6, metalness: 0.5 }),
    lotLine: new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.65 }),
    roofHeatmap: new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    constructionLine: new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85 }),
    constructionMast: new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4, metalness: 0.5 }),
    constructionSlab: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.1 }),
  };

  constructor(opts: FactoryOverviewOptions) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed + 4409);
    this.group.name = 'factoryOverview';

    this.layoutBuildings();
    this.buildGround();
    this.buildRoads();
    this.buildLotBoundaries();
    this.buildBuildings();
    this.buildUnderConstructionPlot();
    this.buildLogisticsAndGates();
  }

  /* ---------------- 排布 ---------------- */

  /**
   * 程序化排布：两列沿 X 展开、中间与四周留道路。
   * 楼数 3–5：奇数时最后一栋独占一行，避免留空洞。
   */
  private layoutBuildings(): void {
    const list = this.opts.buildings.slice(0, 5);
    const n = Math.max(1, list.length);
    const cols = n <= 1 ? 1 : Math.ceil(n / 2);
    const gapX = BUILDING_W + 26;
    const gapZ = BUILDING_D + 34;

    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      // 每行的实际列数（最后一栋独占时居中）
      const rowStart = row * cols;
      const rowCount = Math.min(cols, n - rowStart);
      const x = (col - (rowCount - 1) / 2) * gapX;
      const z = (row - 0.5) * gapZ;
      const jitterH = 1 + this.rng() * 0.18;
      this.placed.push({
        ...list[i],
        x,
        z,
        w: BUILDING_W * (0.94 + this.rng() * 0.12),
        d: BUILDING_D * (0.94 + this.rng() * 0.12),
        h: BUILDING_H * jitterH,
      });
    }
  }

  /** 整个厂区的包围尺寸（供相机取景）。 */
  get extent(): { halfX: number; halfZ: number; height: number } {
    let halfX = 30;
    let halfZ = 30;
    let height = 14;
    for (const b of this.placed) {
      halfX = Math.max(halfX, Math.abs(b.x) + b.w / 2);
      halfZ = Math.max(halfZ, Math.abs(b.z) + b.d / 2);
      height = Math.max(height, b.h);
    }
    return { halfX: halfX + 28, halfZ: halfZ + 28, height };
  }

  /* ---------------- 地面与道路 ---------------- */

  private buildGround(): void {
    const { halfX, halfZ } = this.extent;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(halfX * 2.6, halfZ * 2.6),
      this.mat.ground
    );
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = this.opts.shadows;
    g.name = 'factoryGround';
    this.group.add(g);

    // 地面网格呼吸环（P3 视觉，低成本）
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.min(halfX, halfZ) * 0.62, Math.min(halfX, halfZ) * 0.66, 64),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.renderOrder = 1;
    this.scanRing = ring;
    this.group.add(ring);
  }

  private buildRoads(): void {
    const { halfX, halfZ } = this.extent;
    // 中央横向主干道 + 一条纵向支路
    const main = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2.2, 14), this.mat.road);
    main.rotation.x = -Math.PI / 2;
    main.position.set(0, 0.01, 0);
    main.receiveShadow = this.opts.shadows;
    this.group.add(main);

    const branch = new THREE.Mesh(new THREE.PlaneGeometry(12, halfZ * 2.2), this.mat.road);
    branch.rotation.x = -Math.PI / 2;
    branch.position.set(0, 0.015, 0);
    branch.receiveShadow = this.opts.shadows;
    this.group.add(branch);

    // 主干道中心虚线
    const dash = this.makeDashTexture();
    if (dash) {
      this.ownedTextures.push(dash);
      dash.repeat.set(halfX / 6, 1);
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(halfX * 2.2, 0.9),
        new THREE.MeshBasicMaterial({
          map: dash,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        })
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.03, 0);
      line.renderOrder = 2;
      this.group.add(line);
    }
  }

  private makeDashTexture(): THREE.Texture | null {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 16;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, 64, 16);
    ctx.fillStyle = 'rgba(226,232,240,0.75)';
    ctx.fillRect(0, 6, 34, 4);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  /* ---------------- 厂房 ---------------- */

  private buildBuildings(): void {
    for (const b of this.placed) {
      const g = new THREE.Group();
      g.name = `factoryBuilding:${b.id}`;
      g.position.set(b.x, 0, b.z);

      // 主体（共享 BoxGeometry，通过 scale 复用 → 无需为每栋新建几何）
      const body = new THREE.Mesh(this.geo.wall, this.mat.wall);
      body.scale.set(b.w, b.h, b.d);
      body.position.y = b.h / 2;
      body.castShadow = this.opts.shadows;
      body.receiveShadow = this.opts.shadows;
      g.add(body);

      // 女儿墙 / 屋顶压顶
      const roof = new THREE.Mesh(this.geo.roof, this.mat.roof);
      roof.scale.set(b.w * 1.03, 0.7, b.d * 1.03);
      roof.position.y = b.h + 0.35;
      roof.castShadow = this.opts.shadows;
      g.add(roof);

      // 屋顶设备房（小体块，增加剪影层次）
      const hut = new THREE.Mesh(this.geo.wall, this.mat.wallAlt);
      hut.scale.set(b.w * 0.22, 2.6, b.d * 0.2);
      hut.position.set(b.w * 0.22, b.h + 2.0, -b.d * 0.16);
      g.add(hut);

      // 通风管（每栋 2 根）
      if (this.opts.detail >= 1) {
        for (const sx of [-0.28, 0.05]) {
          const stack = new THREE.Mesh(this.geo.stack, this.mat.stack);
          stack.position.set(b.w * sx, b.h + 2.6, b.d * 0.28);
          g.add(stack);
        }
      }

      // 采光带（沿长边的高窗）
      const glass = new THREE.Mesh(this.geo.strip, this.mat.glass);
      glass.scale.set(b.w * 0.86, 1, 0.35);
      glass.position.set(0, b.h * 0.62, b.d / 2 + 0.1);
      g.add(glass);
      const glass2 = glass.clone();
      glass2.position.z = -b.d / 2 - 0.1;
      g.add(glass2);

      // 发光檐口线（科技风描边）
      for (const sz of [b.d / 2 + 0.2, -b.d / 2 - 0.2]) {
        const trim = new THREE.Mesh(this.geo.strip, this.mat.trim);
        trim.scale.set(b.w * 0.98, 0.5, 0.4);
        trim.position.set(0, b.h * 0.42, sz);
        g.add(trim);
      }

      // 产值热力顶面发光（工业活动强度感知）
      const heatMat = this.mat.roofHeatmap.clone();
      const heatMesh = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.96, b.d * 0.96), heatMat);
      heatMesh.rotation.x = -Math.PI / 2;
      heatMesh.position.set(0, b.h + 0.72, 0);
      g.add(heatMesh);
      this.roofHeatmaps.push(heatMesh);

      // 卷帘门（面向主干道：z 为正的一侧朝道路中心）
      const facingSign = b.z > 0 ? -1 : 1;
      const door = new THREE.Mesh(this.geo.door, this.mat.door);
      door.scale.set(7.5, 5.2, 1);
      door.position.set(0, 2.6, facingSign * (b.d / 2 + 0.16));
      g.add(door);

      // 顶部综合信息标签（Sprite，恒定屏幕尺寸，远景可读）
      this.addBuildingLabel(g, b);

      // 拾取体：略大于主体，便于点击
      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 1.06, b.h + 4, b.d * 1.06),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      pick.position.y = (b.h + 4) / 2;
      pick.userData = {
        pick: 'building',
        buildingId: b.id,
        buildingName: b.name,
        workshopId: b.workshopId ?? b.id,
      };
      g.add(pick);
      this.picks.push(pick);

      this.group.add(g);
    }
  }

  /* ---------------- 地块边界与科技标线 ---------------- */

  private buildLotBoundaries(): void {
    for (const b of this.placed) {
      const pad = 3.5;
      const lw = b.w + pad * 2;
      const ld = b.d + pad * 2;
      const hx = lw / 2;
      const hz = ld / 2;

      // 四周地块边界发光矩形
      const pts = [
        new THREE.Vector3(-hx, 0.04, -hz),
        new THREE.Vector3(hx, 0.04, -hz),
        new THREE.Vector3(hx, 0.04, hz),
        new THREE.Vector3(-hx, 0.04, hz),
        new THREE.Vector3(-hx, 0.04, -hz),
      ];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(lineGeo, this.mat.lotLine);
      line.position.set(b.x, 0, b.z);
      this.group.add(line);

      // 四个角落 L 型地块标线
      const cornerLen = 2.8;
      const cornerPts: THREE.Vector3[] = [];
      // 左上角
      cornerPts.push(
        new THREE.Vector3(-hx, 0.05, -hz + cornerLen),
        new THREE.Vector3(-hx, 0.05, -hz),
        new THREE.Vector3(-hx + cornerLen, 0.05, -hz)
      );
      // 右上角
      cornerPts.push(
        new THREE.Vector3(hx - cornerLen, 0.05, -hz),
        new THREE.Vector3(hx, 0.05, -hz),
        new THREE.Vector3(hx, 0.05, -hz + cornerLen)
      );
      // 右下角
      cornerPts.push(
        new THREE.Vector3(hx, 0.05, hz - cornerLen),
        new THREE.Vector3(hx, 0.05, hz),
        new THREE.Vector3(hx - cornerLen, 0.05, hz)
      );
      // 左下角
      cornerPts.push(
        new THREE.Vector3(-hx + cornerLen, 0.05, hz),
        new THREE.Vector3(-hx, 0.05, hz),
        new THREE.Vector3(-hx, 0.05, hz - cornerLen)
      );

      const cGeo = new THREE.BufferGeometry().setFromPoints(cornerPts);
      const cLine = new THREE.LineSegments(
        cGeo,
        new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9 })
      );
      cLine.position.set(b.x, 0, b.z);
      this.group.add(cLine);
    }
  }

  /* ---------------- 在建工程地块（对标视频二期扩建） ---------------- */

  private buildUnderConstructionPlot(): void {
    const { halfX, halfZ } = this.extent;
    const cx = halfX * 0.72;
    const cz = halfZ * 0.58;
    const cw = 32;
    const cd = 24;
    const ch = 9;

    const g = new THREE.Group();
    g.name = 'plot:underConstruction';
    g.position.set(cx, 0, cz);

    // 地基暗色平板
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(cw, cd), this.mat.constructionSlab);
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(0, 0.03, 0);
    g.add(slab);

    // 黄色虚线边界脚手架框
    const boxGeo = new THREE.BoxGeometry(cw, ch, cd);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const wire = new THREE.LineSegments(edges, this.mat.constructionLine);
    wire.position.set(0, ch / 2 + 0.05, 0);
    g.add(wire);

    // 塔吊结构 (黄色骨架)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 17, 6), this.mat.constructionMast);
    mast.position.set(-8, 8.5, -4);
    g.add(mast);

    const boom = new THREE.Mesh(new THREE.BoxGeometry(18, 0.35, 0.35), this.mat.constructionMast);
    boom.position.set(-2, 17, -4);
    g.add(boom);

    const counterBoom = new THREE.Mesh(new THREE.BoxGeometry(6, 0.35, 0.35), this.mat.constructionMast);
    counterBoom.position.set(-11, 17, -4);
    g.add(counterBoom);

    const counterWeight = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.8), this.mat.constructionMast);
    counterWeight.position.set(-13, 16.6, -4);
    g.add(counterWeight);

    // 塔吊吊绳
    const cablePts = [new THREE.Vector3(4, 17, -4), new THREE.Vector3(4, 7, -4)];
    const cableGeo = new THREE.BufferGeometry().setFromPoints(cablePts);
    const cable = new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: 0x94a3b8 }));
    g.add(cable);

    // 在建工程悬浮徽章 Sprite
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 180;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(26, 18, 5, 0.85)';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, c.width - 6, c.height - 6);

        ctx.fillStyle = '#fbbf24';
        ctx.font = '700 34px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🚧 在建工程 · 二期扩建项目', c.width / 2, 56);

        ctx.fillStyle = '#d97706';
        ctx.font = '500 22px "Microsoft YaHei", monospace';
        ctx.fillText('UNDER CONSTRUCTION · 规划智造车间', c.width / 2, 102);

        ctx.fillStyle = '#92400e';
        ctx.font = '500 18px "Microsoft YaHei", sans-serif';
        ctx.fillText('预计 2026 年 Q4 竣工交付', c.width / 2, 142);

        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.ownedTextures.push(tex);

        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
        );
        sp.scale.set(0.18, 0.18 * (180 / 512), 1);
        sp.position.set(0, ch + 5, 0);
        sp.renderOrder = 30;
        g.add(sp);
      }
    }

    this.group.add(g);
  }

  /* ---------------- 道路物流标识与出入口 ---------------- */

  private buildLogisticsAndGates(): void {
    const { halfX, halfZ } = this.extent;

    // 1. 北侧主出入口门头
    const gateGroup = new THREE.Group();
    gateGroup.position.set(0, 0, -halfZ * 0.92);

    const postGeo = new THREE.BoxGeometry(0.7, 5.2, 0.7);
    const postL = new THREE.Mesh(postGeo, this.mat.wall);
    postL.position.set(-8, 2.6, 0);
    const postR = new THREE.Mesh(postGeo, this.mat.wall);
    postR.position.set(8, 2.6, 0);
    gateGroup.add(postL, postR);

    const beam = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.8, 0.9), this.mat.wallAlt);
    beam.position.set(0, 5.2, 0);
    gateGroup.add(beam);

    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 140;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(6, 20, 36, 0.9)';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
        ctx.fillStyle = '#e0f7ff';
        ctx.font = '700 38px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('厂区主出入口 · NORTH GATE', c.width / 2, 58);
        ctx.fillStyle = '#38bdf8';
        ctx.font = '500 22px monospace';
        ctx.fillText('24H 智能道闸 · 人车分流通行', c.width / 2, 105);

        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.ownedTextures.push(tex);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        sp.scale.set(0.15, 0.15 * (140 / 640), 1);
        sp.position.set(0, 6.4, 0);
        gateGroup.add(sp);
      }
    }
    this.group.add(gateGroup);

    // 2. 东侧物流货运通道标识
    const laneSignGroup = new THREE.Group();
    laneSignGroup.position.set(halfX * 0.92, 0, 0);
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 130;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(6, 20, 36, 0.88)';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
        ctx.fillStyle = '#e0f7ff';
        ctx.font = '700 32px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🚚 物流货运通道 01', c.width / 2, 52);
        ctx.fillStyle = '#38bdf8';
        ctx.font = '500 20px monospace';
        ctx.fillText('CARGO LANE · 限速 15KM/H', c.width / 2, 98);

        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.ownedTextures.push(tex);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        sp.scale.set(0.14, 0.14 * (130 / 480), 1);
        sp.position.set(0, 4.2, 0);
        laneSignGroup.add(sp);
      }
    }
    this.group.add(laneSignGroup);

    // 3. 西南侧物料周转区标识
    const bufferGroup = new THREE.Group();
    bufferGroup.position.set(-halfX * 0.82, 0, halfZ * 0.52);
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 130;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(6, 20, 36, 0.88)';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
        ctx.fillStyle = '#e0f7ff';
        ctx.font = '700 32px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('📦 物料暂存周转区', c.width / 2, 52);
        ctx.fillStyle = '#22d3ee';
        ctx.font = '500 20px monospace';
        ctx.fillText('BUFFER ZONE · AGV 自动接驳', c.width / 2, 98);

        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.ownedTextures.push(tex);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        sp.scale.set(0.14, 0.14 * (130 / 480), 1);
        sp.position.set(0, 4.2, 0);
        bufferGroup.add(sp);
      }
    }
    this.group.add(bufferGroup);
  }

  /* ---------------- 厂房悬浮综合信息标牌 ---------------- */

  private addBuildingLabel(parent: THREE.Group, b: PlacedBuilding): void {
    if (typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 340;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    // 半透明科技深色面板
    ctx.fillStyle = 'rgba(6, 20, 36, 0.86)';
    ctx.fillRect(0, 0, c.width, c.height);

    // 青色发光外边框
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 6;
    ctx.shadowColor = '#67e8f9';
    ctx.shadowBlur = 20;
    ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
    ctx.shadowBlur = 0;

    // 四角亮角标
    const corner = 24;
    ctx.fillStyle = '#67e8f9';
    ctx.fillRect(4, 4, corner, 6);
    ctx.fillRect(4, 4, 6, corner);
    ctx.fillRect(c.width - 4 - corner, 4, corner, 6);
    ctx.fillRect(c.width - 10, 4, 6, corner);
    ctx.fillRect(4, c.height - 10, corner, 6);
    ctx.fillRect(4, c.height - 4 - corner, 6, corner);
    ctx.fillRect(c.width - 4 - corner, c.height - 10, corner, 6);
    ctx.fillRect(c.width - 10, c.height - 4 - corner, 6, corner);

    // 状态点与状态文字
    const isWarning = b.status === 'warning' || b.status === 'fault';
    const statusColor = isWarning ? '#fbbf24' : '#10b981';
    const statusText = isWarning ? '告警中' : '正常运行';

    ctx.beginPath();
    ctx.arc(44, 52, 10, 0, Math.PI * 2);
    ctx.fillStyle = statusColor;
    ctx.shadowColor = statusColor;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.font = '600 30px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = statusColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(statusText, 66, 52);

    // 右上角 "点击下钻" 提示
    ctx.font = '500 26px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'right';
    ctx.fillText('点击下钻进入车间 ➔', c.width - 44, 52);

    // 厂房大标题
    let fontPx = 68;
    ctx.font = `700 ${fontPx}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    while (ctx.measureText(b.name).width > c.width * 0.88 && fontPx > 28) {
      fontPx -= 2;
      ctx.font = `700 ${fontPx}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    }
    ctx.textAlign = 'left';
    ctx.shadowColor = '#67e8f9';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#e0f7ff';
    ctx.fillText(b.name, 44, 136);
    ctx.shadowBlur = 0;

    // 分隔横线
    if (typeof ctx.createLinearGradient === 'function') {
      const grad = ctx.createLinearGradient(44, 0, c.width - 44, 0);
      grad.addColorStop(0, 'rgba(34, 211, 238, 0.8)');
      grad.addColorStop(0.7, 'rgba(34, 211, 238, 0.3)');
      grad.addColorStop(1, 'rgba(34, 211, 238, 0)');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.6)';
    }
    ctx.fillRect(44, 192, c.width - 88, 3);

    // 底部 3 项运行指标
    const staffText = `在岗: ${b.staffCount ?? 18} 人`;
    const deviceText = `设备: ${b.deviceCount ?? 4} 台`;
    const outputText = `产值: ${b.outputValue ?? '¥1.85亿'}`;

    ctx.font = '500 32px "Microsoft YaHei", monospace';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(staffText, 44, 260);

    ctx.fillStyle = '#38bdf8';
    ctx.fillText(deviceText, 380, 260);

    ctx.fillStyle = '#34d399';
    ctx.fillText(outputText, 700, 260);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.ownedTextures.push(tex);

    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    // 恒定屏幕尺寸：拉远到厂区总览也能读清厂房名与指标
    sp.scale.set(0.24, 0.24 * (340 / 1024), 1);
    sp.position.set(0, b.h + 6.8, 0);
    sp.renderOrder = 30;
    sp.userData = { kind: 'buildingLabel', buildingId: b.id };
    parent.add(sp);
    this.labelSprites.push(sp);
  }

  /** 取某栋厂房的包围盒（供相机下钻取景）。 */
  boxOf(buildingId: string): { x: number; z: number; w: number; d: number; h: number } | null {
    const b = this.placed.find((p) => p.id === buildingId);
    if (!b) return null;
    return { x: b.x, z: b.z, w: b.w, d: b.d, h: b.h };
  }

  /** 高亮某栋（下钻过渡时用）。 */
  setHighlight(buildingId: string | null): void {
    for (const sp of this.labelSprites) {
      const m = sp.material as THREE.SpriteMaterial;
      m.opacity = buildingId === null ? 1 : sp.userData.buildingId === buildingId ? 1 : 0.35;
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  update(_dt: number, t: number): void {
    if (this.paused) return;
    if (this.scanRing) {
      // 地面扫描环：缓慢呼吸 + 旋转
      const m = this.scanRing.material as THREE.MeshBasicMaterial;
      m.opacity = 0.1 + (Math.sin(t * 0.9) * 0.5 + 0.5) * 0.16;
      this.scanRing.rotation.z = t * 0.06;
    }
    // 厂房屋顶产值热力光波
    for (let i = 0; i < this.roofHeatmaps.length; i++) {
      const hm = this.roofHeatmaps[i];
      const mat = hm.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.2 + (Math.sin(t * 1.5 + i * 0.7) * 0.5 + 0.5) * 0.14;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean; dispose?: () => void };
      if (mesh.isInstancedMesh && typeof mesh.dispose === 'function') mesh.dispose();
      const g = mesh.geometry as THREE.BufferGeometry | undefined;
      if (g && !g.userData?.shared) g.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (m) {
        const list = Array.isArray(m) ? m : [m];
        for (const mat of list) mat.dispose();
      }
    });
    for (const t of this.ownedTextures) t.dispose();
    this.ownedTextures.length = 0;
    this.labelSprites.length = 0;
    this.roofHeatmaps.length = 0;
    this.picks.length = 0;
    this.placed.length = 0;
    this.group.clear();
  }
}

/** 供 UI 兜底：无任何分区数据时也不至于空白（不算"假数据"，只是占位文案）。 */
export function defaultBuildingSpecs(count = 4): FactoryBuildingSpec[] {
  const n = clamp(Math.round(count), 3, 5);
  const names = [
    '1 号厂房・机加车间',
    '2 号厂房・装配车间',
    '3 号厂房・焊接车间',
    '4 号厂房・涂装车间',
    '5 号厂房・立体库房',
  ];
  return names.slice(0, n).map((name, i) => ({ id: `hall-${i + 1}`, name, workshopId: `hall-${i + 1}` }));
}
