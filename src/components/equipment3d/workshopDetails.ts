/**
 * 车间环境细节层 —— 纯加法细节（workshopDetails）。
 *
 * 职责边界（与既有模块的关系）：
 *   productionLine.ts   机械臂产线 / 传送带 / 物料箱 / 警示浮标（沿用，不动）
 *   equipment.ts        真实台账设备几何与状态色（沿用，不动）
 *   workshopDetails.ts（本文件）  在既有元素之间的"缝隙"里补细节：
 *     A 地面层    安全通道箭头 / 工位黄色标线框 / 地脚螺栓 / 检修地沟格栅
 *     B 设备层    基座侧面仪表圆盘（指针按真实遥测摆动，缺测归零）/
 *                 顶部状态灯柱（呼吸，颜色跟 STATUS_META）/ 铭牌 Sprite（远景按相机距离裁剪）
 *     C 环境层    顶棚工位灯带（MeshBasic 低强度，非光源）/ 工具柜与零件架 /
 *                 通道 AGV（默认静止，可开关往返）/ 靠墙检修直梯
 *
 * 设计约束：
 *  1. 只做加法：不改动、不遮挡、不重绘任何既有已渲染元素；贴花统一垫在
 *     既有地面层（y=0.02 安全通道）之上、离地 0.005~0.015 的薄层，depthWrite:false。
 *  2. 全部几何共享 + InstancedMesh，整层新增 Draw Call 控制在 ~30 个以内；
 *     铭牌 Sprite 远景自动隐藏（隐藏后 0 开销）。
 *  3. 数据全部来自真实台账（坐标 / 状态 / 遥测由 scene.ts 注入），缺测指针归零，绝不编数据。
 *  4. 动画集中在 update()，受 setPaused() 控制（与 productionLine 同一开关）。
 */

import * as THREE from 'three';
import { mulberry32, clamp } from './rand';
import { STATUS_META } from './equipmentStatus';
import type { StatusKey } from './equipmentStatus';
import type { PartTelemetry } from './partEvidence';

/* ========================= 类型 ========================= */

export interface WorkshopDetailsOptions {
  seed: number;
  halfX: number;
  halfZ: number;
  shadows: boolean;
  detail: number;
}

/** 真实台账设备锚点（由 scene.ts 从 slots/devices/boxById 组装，禁止编造坐标） */
export interface DetailDeviceAnchor {
  id: string;
  name: string;
  code?: string;
  x: number;
  z: number;
  /** 设备顶面高度（灯柱立于其上） */
  topY: number;
  /** 台账包围盒 footprint（螺栓 / 标线框按真实尺寸摆放） */
  w: number;
  d: number;
  status: StatusKey;
  /** 初始遥测快照（缺测 → 指针归零） */
  telemetry?: PartTelemetry | null;
}

interface DeviceEntry {
  anchor: DetailDeviceAnchor;
  /** 指针目标角（弧度，-0.75π = 零位） */
  needleTarget: number;
  /** 是否有真实读数（无则指针静止在零位，不摆） */
  hasReading: boolean;
  phase: number;
}

/* ========================= 画布贴图 ========================= */

function makeCanvas(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d');
}

function toTexture(ctx: CanvasRenderingContext2D): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(ctx.canvas as HTMLCanvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** 安全通道前进箭头（透明底，白色 V 形，沿 U 方向即前进方向）。 */
function makeArrowTexture(): THREE.CanvasTexture | null {
  const ctx = makeCanvas(64, 64);
  if (!ctx) return null;
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(226,232,240,0.85)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(18, 14);
  ctx.lineTo(48, 32);
  ctx.lineTo(18, 50);
  ctx.stroke();
  return toTexture(ctx);
}

/** 工位黄色标线框：四角加粗的镂空矩形（中心透明，盖在设备上不会糊脸）。 */
function makeZoneFrameTexture(): THREE.CanvasTexture | null {
  const ctx = makeCanvas(128, 128);
  if (!ctx) return null;
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(234,179,8,0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 112, 112);
  ctx.strokeStyle = 'rgba(250,204,21,0.9)';
  ctx.lineWidth = 10;
  const C = 26;
  for (const [cx, cy, dx, dy] of [
    [8, 8, 1, 1], [120, 8, -1, 1], [8, 120, 1, -1], [120, 120, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * C, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * C);
    ctx.stroke();
  }
  return toTexture(ctx);
}

/** 仪表盘面：深蓝底 + 青色刻度环 + 底部小字。 */
function makeGaugeFaceTexture(): THREE.CanvasTexture | null {
  const S = 128;
  const ctx = makeCanvas(S, S);
  if (!ctx) return null;
  ctx.fillStyle = '#0e1a2b';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(34,211,238,0.65)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // 270° 量程刻度（-135° ~ +135°，12 等分，每 4 格加长）
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI * 0.75 + (i / 12) * Math.PI * 1.5;
    const long = i % 4 === 0;
    const r0 = long ? 40 : 47;
    ctx.strokeStyle = long ? 'rgba(226,232,240,0.95)' : 'rgba(148,163,184,0.75)';
    ctx.lineWidth = long ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.sin(a) * r0, S / 2 - Math.cos(a) * r0);
    ctx.lineTo(S / 2 + Math.sin(a) * 54, S / 2 - Math.cos(a) * 54);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(148,163,184,0.9)';
  ctx.font = '600 13px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('℃', S / 2, S * 0.72);
  return toTexture(ctx);
}

/** 设备铭牌：名称 + 编号两行，深色半透明底 + 青色描边（与产线标签同一语言）。 */
function makeNameplateTexture(name: string, code: string): THREE.CanvasTexture | null {
  const W = 256;
  const H = 96;
  const ctx = makeCanvas(W, H);
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(10,20,36,0.82)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(34,211,238,0.75)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  ctx.textAlign = 'center';
  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  ctx.fillStyle = '#e2f4ff';
  ctx.font = '700 26px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(clip(name, 8), W / 2, 40);
  ctx.fillStyle = 'rgba(34,211,238,0.9)';
  ctx.font = '500 20px "Consolas", monospace';
  ctx.fillText(clip(code, 16), W / 2, 72);
  return toTexture(ctx);
}

/** 厂区出入口标识贴图由孪生页自行生成，本文件不涉及。 */

/* ========================= 细节层主体 ========================= */

export class WorkshopDetails {
  readonly group = new THREE.Group();

  private opts: WorkshopDetailsOptions;
  private rng: () => number;
  private paused = false;
  private agvShuttle = false;

  // 共享几何
  private geo = {
    bolt: new THREE.CylinderGeometry(0.07, 0.09, 0.22, 8),
    arrow: new THREE.PlaneGeometry(1.1, 1.1),
    frame: new THREE.PlaneGeometry(1, 1),
    dial: new THREE.CircleGeometry(0.24, 20),
    rim: new THREE.TorusGeometry(0.25, 0.03, 6, 20),
    needle: new THREE.BoxGeometry(0.035, 0.19, 0.015),
    pole: new THREE.CylinderGeometry(0.045, 0.055, 0.42, 8),
    bulb: new THREE.SphereGeometry(0.11, 10, 8),
    gratingBar: new THREE.BoxGeometry(0.22, 0.05, 1.15),
    gratingRail: new THREE.BoxGeometry(0.09, 0.1, 1.3),
    lampStrip: new THREE.BoxGeometry(6, 0.1, 0.26),
    lampHousing: new THREE.BoxGeometry(6.3, 0.16, 0.42),
  };

  // 共享材质（颜色全部取自产线既有语言：dark / steel / frame / accent 青）
  private mat = {
    bolt: new THREE.MeshStandardMaterial({ color: 0x2b3d4f, roughness: 0.5, metalness: 0.6 }),
    grating: new THREE.MeshStandardMaterial({ color: 0x8ea6bd, roughness: 0.6, metalness: 0.7 }),
    dialRim: new THREE.MeshStandardMaterial({ color: 0x33475c, roughness: 0.5, metalness: 0.6 }),
    needle: new THREE.MeshBasicMaterial({ color: 0xf8fafc, toneMapped: false }),
    pole: new THREE.MeshStandardMaterial({ color: 0x33475c, roughness: 0.55, metalness: 0.6 }),
    // 灯柱球体：白底 + instanceColor 按状态着色，toneMapped:false 保持发光纯度
    bulb: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xbfe3ff, toneMapped: false, transparent: true, opacity: 0.72 }),
    lampHousing: new THREE.MeshStandardMaterial({ color: 0x33475c, roughness: 0.6, metalness: 0.5 }),
    cabinet: new THREE.MeshStandardMaterial({ color: 0x33475c, roughness: 0.55, metalness: 0.5 }),
    cabinetDoor: new THREE.MeshStandardMaterial({ color: 0x8ea6bd, roughness: 0.5, metalness: 0.6 }),
    cabinetStripe: new THREE.MeshStandardMaterial({ color: 0xe8b23a, roughness: 0.5, metalness: 0.3 }),
    rack: new THREE.MeshStandardMaterial({ color: 0x5b7186, roughness: 0.55, metalness: 0.6 }),
    agvBody: new THREE.MeshStandardMaterial({ color: 0x33475c, roughness: 0.5, metalness: 0.55 }),
    agvTop: new THREE.MeshStandardMaterial({ color: 0x8ea6bd, roughness: 0.45, metalness: 0.65 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0x1c2836, roughness: 0.8, metalness: 0.2 }),
    lidar: new THREE.MeshBasicMaterial({ color: 0x22d3ee, toneMapped: false }),
    ladder: new THREE.MeshStandardMaterial({ color: 0xb8c6d4, roughness: 0.45, metalness: 0.7 }),
  };

  private ownedTextures: THREE.Texture[] = [];
  private disposables: Array<{ dispose(): void }> = [];

  // 设备驱动的实例化网格（setDevices 时重建）
  private bolts: THREE.InstancedMesh | null = null;
  private frames: THREE.InstancedMesh | null = null;
  private dials: THREE.InstancedMesh | null = null;
  private rims: THREE.InstancedMesh | null = null;
  private needles: THREE.InstancedMesh | null = null;
  private poles: THREE.InstancedMesh | null = null;
  private bulbs: THREE.InstancedMesh | null = null;
  private nameplates = new Map<string, THREE.Sprite>();
  private devices: DeviceEntry[] = [];
  private deviceIndexById = new Map<string, number>();

  // 静态内容
  private arrows: THREE.InstancedMesh | null = null;
  private gratingBars: THREE.InstancedMesh | null = null;
  private lampStrips: THREE.InstancedMesh | null = null;
  private lampHousings: THREE.InstancedMesh | null = null;
  private agv: THREE.Group | null = null;
  private agvX = 0;
  private agvDir = 1;

  constructor(opts: WorkshopDetailsOptions) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed + 5231);
    this.group.name = 'workshopDetails';

    this.buildFloorDecals();
    this.buildTrenchGrating();
    this.buildCeilingLamps();
    this.buildWallProps();
    this.buildAgv();
    this.buildLadders();
  }

  /* ---------------- A. 地面贴花（箭头 + 通道方向） ---------------- */

  private buildFloorDecals(): void {
    const tex = makeArrowTexture();
    if (!tex) return;
    this.ownedTextures.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.disposables.push(mat);
    // 与产线安全通道（z=±7.6，y=0.02）同轨，箭头垫高 0.008 避免 z-fighting
    const spacing = 5.5;
    const count = Math.max(4, Math.floor((this.opts.halfX * 1.5) / spacing)) * 2;
    const inst = new THREE.InstancedMesh(this.geo.arrow, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const e = new THREE.Euler();
    let k = 0;
    for (const [z, dir] of [
      [-7.6, 1],
      [7.6, -1],
    ] as const) {
      for (let i = 0; i < count / 2; i++) {
        const x = -this.opts.halfX * 0.75 + i * spacing;
        // 平面躺倒后，纹理 U 方向 = 世界 X；+Z 侧通道人流反向
        e.set(-Math.PI / 2, 0, dir > 0 ? 0 : Math.PI);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(x, 0.028, z), q, one);
        inst.setMatrixAt(k++, m);
      }
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    inst.renderOrder = 2;
    this.arrows = inst;
    this.group.add(inst);
  }

  /* ---------------- A. 检修地沟格栅（车间北侧一一条） ---------------- */

  private buildTrenchGrating(): void {
    const z = -10.4;
    const len = clamp(this.opts.halfX * 1.5, 18, 46);
    const spacing = 0.36;
    const count = Math.floor(len / spacing);
    const bars = new THREE.InstancedMesh(this.geo.gratingBar, this.mat.grating, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < count; i++) {
      m.compose(new THREE.Vector3(-len / 2 + i * spacing, 0.03, z), q, one);
      bars.setMatrixAt(i, m);
    }
    bars.instanceMatrix.needsUpdate = true;
    bars.castShadow = false;
    this.gratingBars = bars;
    this.group.add(bars);

    // 两侧承托边框
    for (const dz of [-0.68, 0.68]) {
      const rail = new THREE.Mesh(this.geo.gratingRail, this.mat.grating);
      rail.scale.x = len / 1.3;
      rail.position.set(0, 0.04, z + dz);
      this.group.add(rail);
    }
  }

  /* ---------------- C. 顶棚工位灯带（非光源，纯发光片） ---------------- */

  private buildCeilingLamps(): void {
    const rows = [-2.6, 0, 2.6];
    const spacing = 8.4;
    const perRow = Math.max(2, Math.floor((this.opts.halfX * 1.4) / spacing));
    const count = rows.length * perRow;
    const strips = new THREE.InstancedMesh(this.geo.lampStrip, this.mat.lamp, count);
    const housings = new THREE.InstancedMesh(this.geo.lampHousing, this.mat.lampHousing, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let k = 0;
    for (const z of rows) {
      for (let i = 0; i < perRow; i++) {
        const x = -this.opts.halfX * 0.7 + i * spacing;
        // 灯带挂在架空管线（y≈7.2~7.6）之上，拉开空间层次
        m.compose(new THREE.Vector3(x, 8.6, z), q, one);
        strips.setMatrixAt(k, m);
        m.compose(new THREE.Vector3(x, 8.74, z), q, one);
        housings.setMatrixAt(k, m);
        k++;
      }
    }
    strips.instanceMatrix.needsUpdate = true;
    housings.instanceMatrix.needsUpdate = true;
    this.lampStrips = strips;
    this.lampHousings = housings;
    this.group.add(strips);
    this.group.add(housings);
  }

  /* ---------------- C. 工具柜 / 零件架（靠墙，配色沿用 dark/steel/frame） ---------------- */

  private buildWallProps(): void {
    const g = new THREE.Group();
    g.name = 'wallProps';
    const wallX = -this.opts.halfX + 2.2;

    const makeCabinet = (z: number, tall: boolean) => {
      const c = new THREE.Group();
      const h = tall ? 2.1 : 1.7;
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, h, 0.8), this.mat.cabinet);
      body.position.y = h / 2;
      body.castShadow = this.opts.shadows;
      c.add(body);
      for (const dy of [-h * 0.18, h * 0.18]) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, h * 0.28, 0.06), this.mat.cabinetDoor);
        door.position.set(0, h / 2 + dy, 0.43);
        c.add(door);
      }
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.1, 0.84), this.mat.cabinetStripe);
      stripe.position.y = h * 0.78;
      c.add(stripe);
      c.position.set(wallX, 0, z);
      c.rotation.y = Math.PI / 2;
      return c;
    };
    g.add(makeCabinet(-13.2, true));
    g.add(makeCabinet(-10.4, false));

    // 零件架：四立柱 + 三层搁板
    const rack = new THREE.Group();
    const postGeo = new THREE.BoxGeometry(0.09, 2.2, 0.09);
    for (const [px, pz] of [
      [-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4],
    ]) {
      const post = new THREE.Mesh(postGeo, this.mat.rack);
      post.position.set(px, 1.1, pz);
      post.castShadow = this.opts.shadows;
      rack.add(post);
    }
    for (const y of [0.55, 1.25, 1.95]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.07, 0.95), this.mat.rack);
      shelf.position.y = y;
      rack.add(shelf);
      // 搁板上的零件盒（真实尺寸小方块，颜色用 steel）
      const bins = 2 + Math.floor(this.rng() * 2);
      for (let i = 0; i < bins; i++) {
        const bin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.4), this.mat.cabinetDoor);
        bin.position.set(-0.65 + i * 0.55, y + 0.17, (this.rng() - 0.5) * 0.3);
        rack.add(bin);
      }
    }
    rack.position.set(wallX + 0.2, 0, -6.8);
    rack.rotation.y = Math.PI / 2;
    g.add(rack);

    this.group.add(g);
    // 本模块 new 出来的非共享几何登记释放（共享几何都在 this.geo 白名单里）
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const geo = o.geometry as THREE.BufferGeometry;
        if (!Object.values(this.geo).some((shared) => shared === geo) && !this.disposables.includes(geo)) {
          this.disposables.push(geo);
        }
      }
    });
  }

  /* ---------------- C. 通道 AGV（默认静止；可开缓速往返） ---------------- */

  private buildAgv(): void {
    const g = new THREE.Group();
    g.name = 'agv';
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.42, 1.25), this.mat.agvBody);
    chassis.position.y = 0.4;
    chassis.castShadow = this.opts.shadows;
    g.add(chassis);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.05), this.mat.agvTop);
    deck.position.y = 0.66;
    g.add(deck);
    const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.14, 10), this.mat.lidar);
    lidar.position.set(0.78, 0.78, 0);
    g.add(lidar);
    const wheelGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.14, 10);
    for (const [wx, wz] of [
      [-0.66, -0.66], [0.66, -0.66], [-0.66, 0.66], [0.66, 0.66],
    ]) {
      const wheel = new THREE.Mesh(wheelGeo, this.mat.wheel);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.19, wz);
      g.add(wheel);
    }
    g.position.set(this.opts.halfX * 0.45, 0, 7.6);
    g.rotation.y = Math.PI / 2; // 车头朝 -Z 通道方向，横在通道边不挡路
    this.agv = g;
    this.agvX = g.position.x;
    this.group.add(g);
    this.disposables.push(chassis.geometry, deck.geometry, lidar.geometry, wheelGeo);
  }

  /* ---------------- C. 靠墙检修直梯（立柱 + 横档 InstancedMesh） ---------------- */

  private buildLadders(): void {
    const postGeo = new THREE.BoxGeometry(0.07, 4.6, 0.07);
    const rungGeo = new THREE.BoxGeometry(0.06, 0.05, 0.52);
    const spots: Array<{ x: number; z: number }> = [
      { x: -this.opts.halfX + 0.6, z: -16.5 },
      { x: -this.opts.halfX + 0.6, z: -15.2 },
    ];
    const rungs: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (const s of spots) {
      for (const dz of [-0.28, 0.28]) {
        const post = new THREE.Mesh(postGeo, this.mat.ladder);
        post.position.set(s.x, 2.3, s.z + dz);
        this.group.add(post);
      }
      for (let i = 0; i < 9; i++) {
        m.compose(new THREE.Vector3(s.x, 0.45 + i * 0.5, s.z), q, one);
        rungs.push(m.clone());
      }
    }
    const inst = new THREE.InstancedMesh(rungGeo, this.mat.ladder, rungs.length);
    rungs.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
    this.disposables.push(postGeo, rungGeo);
  }

  /* ---------------- B. 设备级细节：螺栓 / 标线框 / 仪表 / 灯柱 / 铭牌 ---------------- */

  /** 按真实台账重建设备级实例（scene.refreshFaultFloats 同数据源，状态变化即时反映）。 */
  setDevices(anchors: DetailDeviceAnchor[]): void {
    this.disposeDeviceInstances();
    this.devices = [];
    this.deviceIndexById.clear();

    const n = anchors.length;
    if (!n) {
      this.hideStaleNameplates(new Set());
      return;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const e = new THREE.Euler();

    const bolts = new THREE.InstancedMesh(this.geo.bolt, this.mat.bolt, n * 4);
    const frames = new THREE.InstancedMesh(this.geo.frame, this.frameMat(), n);
    const dials = new THREE.InstancedMesh(this.geo.dial, this.dialMat(), n);
    const rims = new THREE.InstancedMesh(this.geo.rim, this.mat.dialRim, n);
    const needles = new THREE.InstancedMesh(this.geo.needle, this.mat.needle, n);
    needles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const poles = new THREE.InstancedMesh(this.geo.pole, this.mat.pole, n);
    const bulbs = new THREE.InstancedMesh(this.geo.bulb, this.mat.bulb, n);
    bulbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const liveIds = new Set<string>();
    for (let i = 0; i < n; i++) {
      const a = anchors[i];
      liveIds.add(a.id);
      // —— 地脚螺栓：底座四角内缩 0.16，按真实 footprint
      const bx = Math.max(0.3, a.w / 2 - 0.16);
      const bz = Math.max(0.3, a.d / 2 - 0.16);
      for (let c = 0; c < 4; c++) {
        const sx = c % 2 === 0 ? -1 : 1;
        const sz = c < 2 ? -1 : 1;
        m.compose(new THREE.Vector3(a.x + sx * bx, 0.11, a.z + sz * bz), q, one);
        bolts.setMatrixAt(i * 4 + c, m);
      }
      // —— 工位黄色标线框
      e.set(-Math.PI / 2, 0, 0);
      q.setFromEuler(e);
      m.compose(
        new THREE.Vector3(a.x, 0.034, a.z),
        q,
        new THREE.Vector3(Math.max(1.6, a.w + 1.1), Math.max(1.6, a.d + 1.1), 1)
      );
      frames.setMatrixAt(i, m);
      e.set(0, 0, 0);
      q.setFromEuler(e);

      // —— 仪表盘：基座 +Z 面左侧（铭牌/配方牌在设备正面，这里错开不遮它）
      const gx = a.x - a.w * 0.3;
      const gz = a.z + a.d / 2 + 0.05;
      m.compose(new THREE.Vector3(gx, 0.85, gz), q, one);
      dials.setMatrixAt(i, m);
      rims.setMatrixAt(i, m);
      this.needleMatrixAt(needles, i, a, 0);

      // —— 状态灯柱：立于设备顶面偏 -X 侧（与故障浮标错开，浮标在盒心正上方）
      const px = a.x - a.w * 0.26;
      const pz = a.z + a.d * 0.26;
      m.compose(new THREE.Vector3(px, a.topY - 0.05, pz), q, one);
      poles.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(px, a.topY + 0.24, pz), q, new THREE.Vector3(1, 1, 1));
      bulbs.setMatrixAt(i, m);
      const meta = STATUS_META[a.status] ?? STATUS_META.nodata;
      const col = new THREE.Color(meta.alert ? meta.glow : meta.colour);
      bulbs.setColorAt(i, col);

      const telemetry = a.telemetry ?? null;
      const temp = telemetry?.temperature ?? telemetry?.temp;
      const hasReading = typeof temp === 'number' && Number.isFinite(temp);
      this.devices.push({
        anchor: { ...a },
        needleTarget: hasReading ? this.needleAngleOf(temp as number) : -Math.PI * 0.75,
        hasReading,
        phase: this.rng() * Math.PI * 2,
      });
      this.deviceIndexById.set(a.id, i);
      this.upsertNameplate(a);
    }

    // devices 填充完毕后补一次静态指针姿态（暂停态下也保持真实读数指向）
    for (let i = 0; i < this.devices.length; i++) {
      this.needleMatrixAt(needles, i, this.devices[i].anchor, 0);
    }

    frames.renderOrder = 3;
    for (const mesh of [bolts, frames, dials, rims, needles, poles, bulbs]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      this.group.add(mesh);
    }
    this.bolts = bolts;
    this.frames = frames;
    this.dials = dials;
    this.rims = rims;
    this.needles = needles;
    this.poles = poles;
    this.bulbs = bulbs;
    this.hideStaleNameplates(liveIds);
  }

  /** 温度 → 指针角（0~120℃ 映射到 270° 量程；越界钳位，不外推）。 */
  private needleAngleOf(temp: number): number {
    return -Math.PI * 0.75 + (clamp(temp, 0, 120) / 120) * Math.PI * 1.5;
  }

  private needleMatrixAt(target: THREE.InstancedMesh, i: number, a: DetailDeviceAnchor, sway: number): void {
    const m = new THREE.Matrix4();
    const entry = this.devices[i];
    const base = entry ? entry.needleTarget : -Math.PI * 0.75;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -(base + sway)));
    // 指针绕盘面中心旋转：几何原点在中心，先平移半长再旋转
    const pivot = new THREE.Vector3(a.x - a.w * 0.3, 0.85, a.z + a.d / 2 + 0.07);
    const offset = new THREE.Vector3(0, 0.075, 0).applyQuaternion(q);
    m.compose(pivot.clone().add(offset), q, new THREE.Vector3(1, 1, 1));
    target.setMatrixAt(i, m);
  }

  /** 遥测快照注入：只认真实读数，缺测 → 指针回零位（不编数据）。 */
  setTelemetry(deviceId: string, data: PartTelemetry): void {
    const i = this.deviceIndexById.get(deviceId);
    if (i === undefined || !this.devices[i]) return;
    const entry = this.devices[i];
    const temp = data.temperature ?? data.temp;
    if (typeof temp === 'number' && Number.isFinite(temp)) {
      entry.needleTarget = this.needleAngleOf(temp);
      entry.hasReading = true;
    } else {
      entry.needleTarget = -Math.PI * 0.75;
      entry.hasReading = false;
    }
  }

  private frameMat(): THREE.MeshBasicMaterial {
    if (!this._frameMat) {
      const tex = makeZoneFrameTexture();
      if (!tex) return new THREE.MeshBasicMaterial({ visible: false });
      this.ownedTextures.push(tex);
      this._frameMat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      this.disposables.push(this._frameMat);
    }
    return this._frameMat;
  }
  private _frameMat: THREE.MeshBasicMaterial | null = null;

  private dialMat(): THREE.MeshBasicMaterial {
    if (!this._dialMat) {
      const tex = makeGaugeFaceTexture();
      if (!tex) return new THREE.MeshBasicMaterial({ visible: false });
      this.ownedTextures.push(tex);
      this._dialMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      this.disposables.push(this._dialMat);
    }
    return this._dialMat;
  }
  private _dialMat: THREE.MeshBasicMaterial | null = null;

  /* ---------------- 铭牌（远景自动隐藏） ---------------- */

  private upsertNameplate(a: DetailDeviceAnchor): void {
    if (typeof document === 'undefined') return;
    let sprite = this.nameplates.get(a.id);
    if (sprite && sprite.userData.key === `${a.name}|${a.code ?? ''}`) return;
    if (sprite) {
      this.group.remove(sprite);
      (sprite.material as THREE.SpriteMaterial).map?.dispose();
      sprite.material.dispose();
      this.nameplates.delete(a.id);
    }
    const tex = makeNameplateTexture(a.name, a.code ?? a.id);
    if (!tex) return;
    this.ownedTextures.push(tex);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.7, 0.64, 1);
    sp.position.set(a.x, a.topY - 0.35, a.z + a.d / 2 + 0.12);
    sp.userData = { anchorId: a.id, key: `${a.name}|${a.code ?? ''}` };
    this.nameplates.set(a.id, sp);
    this.group.add(sp);
  }

  private hideStaleNameplates(live: Set<string>): void {
    for (const [id, sp] of this.nameplates) {
      if (live.has(id)) continue;
      this.group.remove(sp);
      (sp.material as THREE.SpriteMaterial).map?.dispose();
      sp.material.dispose();
      this.nameplates.delete(id);
    }
  }

  /* ---------------- D. 动画（受 setPaused 统一控制） ---------------- */

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** AGV 缓速往返开关（帧率不足时保持关闭 —— scene 侧默认不开）。 */
  setAgvShuttle(on: boolean): void {
    this.agvShuttle = on;
  }

  update(dt: number, t: number, camPos: THREE.Vector3): void {
    if (this.paused) return;

    // 灯柱呼吸 + 仪表指针微摆
    if (this.needles && this.bulbs && this.devices.length) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < this.devices.length; i++) {
        const entry = this.devices[i];
        const a = entry.anchor;
        if (entry.hasReading) {
          this.needleMatrixAt(this.needles, i, a, Math.sin(t * 2.1 + entry.phase) * 0.028);
        }
        const meta = STATUS_META[a.status] ?? STATUS_META.nodata;
        const speed = meta.alert ? 3.1 : 1.6;
        const amp = meta.alert ? 0.28 : 0.1;
        const s = 1 + Math.sin(t * speed + entry.phase) * amp;
        m.compose(
          new THREE.Vector3(a.x - a.w * 0.26, a.topY + 0.24, a.z + a.d * 0.26),
          q.set(0, 0, 0, 1),
          new THREE.Vector3(s, s, s)
        );
        this.bulbs.setMatrixAt(i, m);
      }
      this.needles.instanceMatrix.needsUpdate = true;
      this.bulbs.instanceMatrix.needsUpdate = true;
    }

    // 铭牌按相机距离裁剪：>85 隐藏（0 开销），60~85 淡出
    const near = 60;
    const far = 85;
    for (const sp of this.nameplates.values()) {
      const d = camPos.distanceTo(sp.position);
      const opacity = clamp((far - d) / (far - near), 0, 1) * 0.95;
      const mat = sp.material as THREE.SpriteMaterial;
      mat.opacity = opacity;
      sp.visible = opacity > 0.03;
    }

    // AGV 往返（默认关）
    if (this.agvShuttle && this.agv) {
      const limit = this.opts.halfX * 0.62;
      this.agvX += this.agvDir * dt * 1.1;
      if (this.agvX > limit) this.agvDir = -1;
      if (this.agvX < this.opts.halfX * 0.12) this.agvDir = 1;
      this.agv.position.x = this.agvX;
    }
  }

  /* ---------------- 释放 ---------------- */

  private disposeDeviceInstances(): void {
    for (const key of ['bolts', 'frames', 'dials', 'rims', 'needles', 'poles', 'bulbs'] as const) {
      const mesh = this[key];
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose();
      this[key] = null;
    }
  }

  dispose(): void {
    this.disposeDeviceInstances();
    this.hideStaleNameplates(new Set());
    for (const mesh of [this.arrows, this.gratingBars, this.lampStrips, this.lampHousings]) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.dispose();
      }
    }
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* 共享几何可能被外部释放，忽略 */
      }
    }
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o as THREE.InstancedMesh).isInstancedMesh) {
        // 仅释放本模块 new 出来的非共享几何（共享的都在 this.geo 白名单里）
        const geo = o.geometry as THREE.BufferGeometry;
        if (!Object.values(this.geo).some((g) => g === geo)) geo.dispose();
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const mt of list) if (!Object.values(this.mat).some((m) => m === mt)) mt.dispose();
      }
    });
    for (const tex of this.ownedTextures) tex.dispose();
    this.ownedTextures = [];
    for (const key of Object.keys(this.geo)) {
      (this.geo as Record<string, THREE.BufferGeometry>)[key].dispose();
    }
    for (const key of Object.keys(this.mat)) {
      (this.mat as Record<string, THREE.Material>)[key].dispose();
    }
    this.group.removeFromParent();
  }
}
