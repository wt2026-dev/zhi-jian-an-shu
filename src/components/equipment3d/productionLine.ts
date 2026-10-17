/**
 * 车间生产线 —— 对标视频 r2 的核心场景。
 *
 * 职责边界（与既有模块的关系）：
 *   equipment.ts / buildEquipment   真实台账设备的几何与状态（沿用，不动）
 *   props.ts                        厂房家具（配电柜、货架等，沿用，不动）
 *   productionLine.ts（本文件）     生产线资产层：机械臂工作站阵列 / 传送带 / 物料箱 /
 *                                   警示浮标 / 分区立牌 / 通道线与警示带 / 架空管线
 *
 * 设计约束：
 *  1. 不引入新库，只用 three；新增几何尽量共享 geometry + material，控制 Draw Call。
 *  2. 机械臂工作站属"场景资产"（与既有行车 / 管架同类，不进设备台账）；
 *     但**警示浮标必须由真实设备状态驱动** —— 由 setDeviceAnchors() 传入真实台账的
 *     坐标与状态，故障/告警设备才生成浮标，正常设备没有。绝不随机生成。
 *  3. 全部动画集中在 update()，受 setPaused() 控制；传送带动画可整体关闭（低端机降级）。
 */

import * as THREE from 'three';
import { mulberry32, clamp } from './rand';
import { loadEquipmentGLB } from './equipment';
import type { StatusKey } from './equipment';

/* ========================= 类型 ========================= */

export interface ProductionLineOptions {
  seed: number;
  /** 机械臂工作站数量（4–6） */
  stationCount: number;
  /** 车间可布置半跨（X 方向，沿传送带） */
  halfX: number;
  /** 车间可布置半跨（Z 方向） */
  halfZ: number;
  shadows: boolean;
  /** LOD 细节档（0 低 / 1 中 / 2 高） */
  detail: number;
  /** 分区立牌文字，如 "4# 生产车间" */
  zoneLabel?: string;
  /** 警示浮标只对以下状态生成（其余状态不生成） */
  faultStatuses?: StatusKey[];
}

/** 真实台账设备在车间中的锚点（用于生成警示浮标） */
export interface DeviceAnchor {
  id: string;
  name: string;
  x: number;
  z: number;
  /** 设备顶部高度（浮标悬浮其上） */
  topY: number;
  status: StatusKey;
}

export interface RobotStationInfo {
  /** 站内序号，从 1 开始 */
  index: number;
  /** 编号牌文字，如 "机械臂 001" */
  code: string;
  group: THREE.Group;
  /** 绑定的真实台账设备 id（无匹配设备时为 null） */
  deviceId: string | null;
  x: number;
  z: number;
  /**
   * 程序化机械臂零件（基座/腰/肩/大小臂/腕/工具）。
   * 外部 GLB 模型就绪后隐藏，避免新旧两套叠加显示。
   */
  armParts: THREE.Object3D[];
}

/* ========================= 画布贴图工具 ========================= */

interface LabelTextureResult {
  texture: THREE.CanvasTexture;
  /** 宽高比（w/h），用于按比例设置面片尺寸 */
  aspect: number;
}

/**
 * 生成文字贴图。dark 风格：深色半透明底 + 发光描边文字。
 * 无 document 环境（SSR / 单测）返回 null，调用方需跳过标签。
 */
function makeLabelTexture(
  text: string,
  opts: {
    width: number;
    height: number;
    fontPx: number;
    color: string;
    bg: string;
    border: string;
    glow: string;
    bold?: boolean;
  }
): LabelTextureResult | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 底板
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, opts.width, opts.height);

  // 发光边框
  ctx.strokeStyle = opts.border;
  ctx.lineWidth = Math.max(2, Math.round(opts.height * 0.05));
  ctx.shadowColor = opts.glow;
  ctx.shadowBlur = Math.round(opts.height * 0.18);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, opts.width - ctx.lineWidth, opts.height - ctx.lineWidth);
  ctx.shadowBlur = 0;

  // 文字（居中，超宽自动压缩字距）
  const weight = opts.bold === false ? '500' : '700';
  let fontPx = opts.fontPx;
  ctx.font = `${weight} ${fontPx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
  const maxW = opts.width * 0.86;
  let w = ctx.measureText(text).width;
  while (w > maxW && fontPx > 8) {
    fontPx -= 1;
    ctx.font = `${weight} ${fontPx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
    w = ctx.measureText(text).width;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = opts.glow;
  ctx.shadowBlur = Math.round(fontPx * 0.5);
  ctx.fillStyle = opts.color;
  ctx.fillText(text, opts.width / 2, opts.height / 2);
  ctx.shadowBlur = 0;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, aspect: opts.width / opts.height };
}

/** 生成警示浮标贴图：红三角 + 白色感叹号。 */
function makeWarningTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, S, S);
  // 外描边（深红，保证深色背景上也有轮廓）
  ctx.beginPath();
  ctx.moveTo(S * 0.5, S * 0.06);
  ctx.lineTo(S * 0.96, S * 0.9);
  ctx.lineTo(S * 0.04, S * 0.9);
  ctx.closePath();
  ctx.fillStyle = '#7f1d1d';
  ctx.fill();

  // 主体三角
  ctx.beginPath();
  ctx.moveTo(S * 0.5, S * 0.13);
  ctx.lineTo(S * 0.89, S * 0.85);
  ctx.lineTo(S * 0.11, S * 0.85);
  ctx.closePath();
  ctx.fillStyle = '#ef4444';
  ctx.shadowColor = '#fca5a5';
  ctx.shadowBlur = 24;
  ctx.fill();
  ctx.shadowBlur = 0;

  // 感叹号：竖条 + 点
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(S * 0.455, S * 0.32, S * 0.09, S * 0.3);
  ctx.beginPath();
  ctx.arc(S * 0.5, S * 0.72, S * 0.055, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** 黄黑斜纹警示带贴图（沿 U 重复）。 */
function makeHazardTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 64;
  const H = 32;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111827';
  ctx.save();
  ctx.translate(-W * 0.5, 0);
  for (let i = -1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 32, 0);
    ctx.lineTo(i * 32 + 16, 0);
    ctx.lineTo(i * 32 + 16 + H, H);
    ctx.lineTo(i * 32 + H, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** 传送带带面贴图：深色橡胶 + 横向浅色胶条（沿 U 重复，靠 offset 滚动）。 */
function makeBeltTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 64;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#374151';
  for (let i = 0; i < 4; i++) ctx.fillRect(i * 16, 0, 6, H);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, W, 3);
  ctx.fillRect(0, H - 3, W, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** 安全通道地面贴图：绿色通道 + 两侧白色边线（沿 U 重复）。 */
function makeAisleTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 64;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(16,185,129,0.30)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(0, 2, W, 4);
  ctx.fillRect(0, H - 6, W, 4);
  // 中间虚线
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(0, H / 2 - 2, 28, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/* ========================= 生产线主体 ========================= */

export class ProductionLine {
  readonly group = new THREE.Group();
  /** 可拾取对象（机械臂本体），userData 带 stationId / deviceId */
  readonly picks: THREE.Object3D[] = [];
  /** 工作站清单（含编号牌文字与坐标） */
  readonly stations: RobotStationInfo[] = [];

  private opts: ProductionLineOptions;
  private rng: () => number;

  /** 传送带长度（沿 X） */
  private beltLength = 0;
  private beltWidth = 1.7;
  private beltY = 1.02;

  // 共享几何（机械臂各站复用）
  private geo = {
    pad: new THREE.CylinderGeometry(1.15, 1.25, 0.3, 18),
    pedestal: new THREE.CylinderGeometry(0.86, 1.0, 0.9, 18),
    waist: new THREE.CylinderGeometry(0.7, 0.7, 0.6, 16),
    shoulder: new THREE.CylinderGeometry(0.42, 0.42, 0.9, 14),
    arm1: new THREE.BoxGeometry(0.56, 1.7, 0.66),
    elbow: new THREE.CylinderGeometry(0.36, 0.36, 0.66, 14),
    arm2: new THREE.BoxGeometry(0.44, 1.28, 0.52),
    wrist: new THREE.CylinderGeometry(0.28, 0.28, 0.5, 12),
    tool: new THREE.BoxGeometry(0.66, 0.32, 0.42),
    lamp: new THREE.SphereGeometry(0.15, 10, 8),
    tableTop: new THREE.BoxGeometry(2.3, 0.14, 1.25),
    tableLeg: new THREE.BoxGeometry(0.12, 0.88, 0.12),
    platePost: new THREE.BoxGeometry(0.09, 1.25, 0.09),
  };

  private mat = {
    steel: new THREE.MeshStandardMaterial({ color: 0x8ea6bd, roughness: 0.52, metalness: 0.72 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x33475c, roughness: 0.6, metalness: 0.55 }),
    body: new THREE.MeshStandardMaterial({ color: 0xe8b23a, roughness: 0.45, metalness: 0.35 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.35, metalness: 0.6 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x5b7186, roughness: 0.55, metalness: 0.6 }),
    roller: new THREE.MeshStandardMaterial({ color: 0xb8c6d4, roughness: 0.35, metalness: 0.85 }),
    motor: new THREE.MeshStandardMaterial({ color: 0x2f4a63, roughness: 0.5, metalness: 0.6 }),
    boxShell: new THREE.MeshStandardMaterial({
      color: 0x2f9fe0,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.55,
    }),
    boxContent: new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.8, metalness: 0.05 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0x365d77, roughness: 0.6, metalness: 0.6 }),
    lampOk: new THREE.MeshBasicMaterial({ color: 0x34d399, toneMapped: false }),
    lampRun: new THREE.MeshBasicMaterial({ color: 0x22d3ee, toneMapped: false }),
  };

  private ownedTextures: THREE.Texture[] = [];
  private labelSprites: THREE.Sprite[] = [];
  private warnSprites = new Map<string, { sprite: THREE.Sprite; baseY: number; phase: number }>();
  private zoneSigns: THREE.Group[] = [];

  // 动画状态
  private beltEnabled = true;
  private paused = false;
  private beltSpeed = 1.15;
  private beltTex: THREE.Texture | null = null;
  private rollerMesh: THREE.InstancedMesh | null = null;
  /** 物料箱外壳实例（公开：便于外部读取动画位移与做回归断言） */
  boxMesh: THREE.InstancedMesh | null = null;
  private boxContentMesh: THREE.InstancedMesh | null = null;
  private boxOffsets: number[] = [];
  private boxCount = 0;
  private motorFan: THREE.Mesh | null = null;
  private stationAnims: Array<{
    swivel: THREE.Object3D;
    upper: THREE.Object3D;
    fore: THREE.Object3D;
    phase: number;
    lamp: THREE.Mesh | null;
  }> = [];

  /** 参与"呼吸"的地面网格与扫描线（P3 可选） */
  private scanMesh: THREE.Mesh | null = null;

  constructor(opts: ProductionLineOptions) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed + 8801);
    this.group.name = 'productionLine';

    this.beltLength = clamp(opts.halfX * 1.42, 18, 78);

    this.buildConveyor();
    this.buildStations();
    this.buildFloorMarkings();
    this.buildOverheadPipes();
    this.buildZoneSigns();
  }

  /* ---------------- 传送带 ---------------- */

  private buildConveyor(): void {
    const L = this.beltLength;
    const W = this.beltWidth;
    const Y = this.beltY;
    const g = new THREE.Group();
    g.name = 'conveyor';

    // 带面（贴图沿 U 重复，update 里滚动 offset）
    const beltTexRaw = makeBeltTexture();
    if (beltTexRaw) {
      beltTexRaw.repeat.set(Math.max(4, Math.round(L / 1.6)), 1);
      this.beltTex = beltTexRaw;
      this.ownedTextures.push(beltTexRaw);
    }
    const beltMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: beltTexRaw ?? undefined,
      roughness: 0.85,
      metalness: 0.05,
    });
    if (beltMat.map) this.ownedTextures.push(beltMat.map);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(L, 0.12, W), beltMat);
    belt.position.set(0, Y, 0);
    belt.receiveShadow = this.opts.shadows;
    g.add(belt);

    // 侧边机架（两条纵梁）
    const railGeo = new THREE.BoxGeometry(L, 0.22, 0.16);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, this.mat.frame);
      rail.position.set(0, Y + 0.16, (s * (W + 0.16)) / 2);
      rail.castShadow = this.opts.shadows;
      g.add(rail);
    }

    // 支腿（每 4 米一对）
    const legGeo = new THREE.BoxGeometry(0.16, Y, 0.16);
    const legCount = Math.max(2, Math.round(L / 4));
    for (let i = 0; i <= legCount; i++) {
      const x = -L / 2 + (L * i) / legCount;
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, this.mat.frame);
        leg.position.set(x, Y / 2, (s * W) / 2.4);
        leg.castShadow = this.opts.shadows;
        g.add(leg);
      }
    }

    // 滚轮：InstancedMesh，全部共享一个圆柱几何 → 1 个 Draw Call
    const rollerCount = Math.max(6, Math.round(L / 1.1));
    const rollerGeo = new THREE.CylinderGeometry(0.13, 0.13, W * 0.94, 10);
    const rollers = new THREE.InstancedMesh(rollerGeo, this.mat.roller, rollerCount);
    rollers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    for (let i = 0; i < rollerCount; i++) {
      const x = -L / 2 + (L * (i + 0.5)) / rollerCount;
      m.compose(new THREE.Vector3(x, Y - 0.02, 0), q, new THREE.Vector3(1, 1, 1));
      rollers.setMatrixAt(i, m);
    }
    rollers.instanceMatrix.needsUpdate = true;
    rollers.castShadow = false;
    this.rollerMesh = rollers;
    g.add(rollers);

    // 驱动电机（末端）+ 风扇（会转）
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 14), this.mat.motor);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(L / 2 + 0.55, Y - 0.1, W * 0.5 + 0.42);
    motor.castShadow = this.opts.shadows;
    g.add(motor);

    const fan = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.16), this.mat.roller);
    fan.position.set(L / 2 + 1.06, Y - 0.1, W * 0.5 + 0.42);
    this.motorFan = fan;
    g.add(fan);

    this.group.add(g);
  }

  /** 蓝色物料箱：半透明箱体 + 内部内容物，沿带面间隔摆放。 */
  private buildMaterialBoxes(): void {
    const L = this.beltLength;
    const spacing = 4.2;
    const count = Math.max(3, Math.floor(L / spacing));
    this.boxCount = count;

    const outer = new THREE.BoxGeometry(1.15, 0.82, 1.0);
    const inner = new THREE.BoxGeometry(0.86, 0.42, 0.74);
    const shell = new THREE.InstancedMesh(outer, this.mat.boxShell, count);
    const content = new THREE.InstancedMesh(inner, this.mat.boxContent, count);
    shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    content.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shell.castShadow = this.opts.shadows;
    shell.frustumCulled = false;
    content.frustumCulled = false;

    this.boxOffsets = [];
    for (let i = 0; i < count; i++) {
      this.boxOffsets.push((-L / 2 + 1.2 + i * spacing + L) % L);
    }
    this.boxMesh = shell;
    this.boxContentMesh = content;
    this.group.add(shell);
    this.group.add(content);
    this.syncBoxes(0);
  }

  private syncBoxes(travel: number): void {
    const shell = this.boxMesh;
    const content = this.boxContentMesh;
    if (!shell || !content) return;
    const L = this.beltLength;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.boxCount; i++) {
      const x = -L / 2 + ((this.boxOffsets[i] + travel) % L);
      pos.set(x, this.beltY + 0.47, 0);
      m.compose(pos, quat, one);
      shell.setMatrixAt(i, m);
      pos.set(x, this.beltY + 0.2, 0);
      m.compose(pos, quat, one);
      content.setMatrixAt(i, m);
    }
    shell.instanceMatrix.needsUpdate = true;
    content.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- 机械臂工作站 ---------------- */

  private buildStations(): void {
    const n = clamp(Math.round(this.opts.stationCount), 4, 6);
    const L = this.beltLength;
    const usable = L - 6;
    const step = n > 1 ? usable / (n - 1) : 0;

    for (let i = 0; i < n; i++) {
      // 双侧交错：奇数号在 -Z 侧，偶数号在 +Z 侧，均面向传送带
      const side = i % 2 === 0 ? -1 : 1;
      const x = n > 1 ? -usable / 2 + step * i : 0;
      const z = side * 4.15;
      const station = this.buildOneStation(i + 1, x, z, side);
      this.stations.push(station);
      this.group.add(station.group);
    }

    this.buildMaterialBoxes();

    // 异步加载外部机械臂 GLB（Sketchfab 6-Axis，CC-BY），就绪后替换程序化几何
    this.initRobotGLB();
  }

  private buildOneStation(index: number, x: number, z: number, side: number): RobotStationInfo {
    const code = `机械臂 ${String(index).padStart(3, '0')}`;
    const g = new THREE.Group();
    g.name = `robotStation-${index}`;
    g.position.set(x, 0, z);
    // 面向传送带：位于 -Z 侧则朝 +Z，位于 +Z 侧则朝 -Z
    g.rotation.y = side < 0 ? 0 : Math.PI;

    // 程序化机械臂零件（GLB 就绪后隐藏）
    const armParts: THREE.Object3D[] = [];

    // —— 基座
    const pad = new THREE.Mesh(this.geo.pad, this.mat.dark);
    pad.position.y = 0.15;
    pad.receiveShadow = this.opts.shadows;
    g.add(pad);
    armParts.push(pad);

    const pedestal = new THREE.Mesh(this.geo.pedestal, this.mat.body);
    pedestal.position.y = 0.72;
    pedestal.castShadow = this.opts.shadows;
    g.add(pedestal);
    armParts.push(pedestal);

    const waist = new THREE.Mesh(this.geo.waist, this.mat.body);
    waist.position.y = 1.45;
    waist.castShadow = this.opts.shadows;
    g.add(waist);
    armParts.push(waist);

    // 状态灯（绿=正常，青=运行中；由 setStationRunning 切换）
    // 外部 GLB 机械臂更高，灯位抬高以保持可见
    const lamp = new THREE.Mesh(this.geo.lamp, this.mat.lampOk);
    lamp.position.set(0, 2.55, 0.6);
    g.add(lamp);

    // —— 回转体（绕 Y 摆动）
    const swivel = new THREE.Group();
    swivel.position.y = 1.9;
    g.add(swivel);

    const shoulder = new THREE.Mesh(this.geo.shoulder, this.mat.dark);
    shoulder.rotation.x = Math.PI / 2;
    shoulder.castShadow = this.opts.shadows;
    swivel.add(shoulder);
    armParts.push(shoulder);

    // —— 大臂
    const upper = new THREE.Group();
    upper.position.y = 0;
    swivel.add(upper);
    armParts.push(upper);
    const a1 = -0.34;
    const arm1 = new THREE.Mesh(this.geo.arm1, this.mat.body);
    arm1.position.set(0, 0.85, 0);
    arm1.rotation.z = a1;
    arm1.position.x = Math.sin(-a1) * 0.85;
    arm1.castShadow = this.opts.shadows;
    upper.add(arm1);

    // 肘关节位于大臂末端
    const elbowX = Math.sin(-a1) * 1.7;
    const elbowY = Math.cos(a1) * 1.7;
    const elbow = new THREE.Mesh(this.geo.elbow, this.mat.dark);
    elbow.rotation.x = Math.PI / 2;
    elbow.position.set(elbowX, elbowY, 0);
    swivel.add(elbow);
    armParts.push(elbow);

    // —— 小臂（绕肘旋转）
    const fore = new THREE.Group();
    fore.position.set(elbowX, elbowY, 0);
    swivel.add(fore);
    armParts.push(fore);
    const a2 = 0.66;
    const arm2 = new THREE.Mesh(this.geo.arm2, this.mat.body);
    arm2.rotation.z = a2;
    arm2.position.set(Math.sin(-a2) * 0.64, Math.cos(a2) * 0.64, 0);
    arm2.castShadow = this.opts.shadows;
    fore.add(arm2);

    const wristX = Math.sin(-a2) * 1.28;
    const wristY = Math.cos(a2) * 1.28;
    const wrist = new THREE.Mesh(this.geo.wrist, this.mat.dark);
    wrist.rotation.x = Math.PI / 2;
    wrist.position.set(wristX, wristY, 0);
    fore.add(wrist);
    armParts.push(wrist);

    const tool = new THREE.Mesh(this.geo.tool, this.mat.accent);
    tool.position.set(wristX + 0.3, wristY - 0.34, 0);
    tool.rotation.z = a2;
    fore.add(tool);
    armParts.push(tool);

    // —— 基座工作台（位于机械臂与传送带之间）
    const table = new THREE.Group();
    table.position.set(1.95, 0, 0.35);
    const top = new THREE.Mesh(this.geo.tableTop, this.mat.steel);
    top.position.y = 0.95;
    top.castShadow = this.opts.shadows;
    top.receiveShadow = this.opts.shadows;
    table.add(top);
    for (const [lx, lz] of [
      [-1.0, -0.5],
      [1.0, -0.5],
      [-1.0, 0.5],
      [1.0, 0.5],
    ]) {
      const leg = new THREE.Mesh(this.geo.tableLeg, this.mat.frame);
      leg.position.set(lx, 0.44, lz);
      table.add(leg);
    }
    // 台面上的工件
    const work = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.6), this.mat.accent);
    work.position.set(-0.4, 1.17, 0);
    table.add(work);
    g.add(table);

    // —— 编号牌：实体立牌（近景可读）+ 顶部 Sprite（远景恒定可读）
    this.buildStationPlate(g, code, index);

    // —— 基座黄黑警示带（贴地一圈方框）
    this.buildStationHazard(g);

    // 动画登记（相位错开，避免整排同步摆动像"仪仗队"）
    const phase = this.rng() * Math.PI * 2;
    this.stationAnims.push({ swivel, upper, fore, phase, lamp });

    // 拾取体：用一个不可见包围盒覆盖机械臂，避免逐零件 raycast
    const pickBox = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 3.6, 2.6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    pickBox.position.set(0, 1.8, 0);
    pickBox.userData = { pick: 'station', stationId: index, stationCode: code, deviceId: null };
    g.add(pickBox);
    this.picks.push(pickBox);

    return { index, code, group: g, deviceId: null, x, z, armParts };
  }

  /**
   * 异步加载外部机械臂 GLB（Sketchfab「6 Axis Industrial Robot Arm」CC-BY，
   * 作者 Jayson Stauffer）并替换各站程序化几何。
   * - 一次加载，clone 到每个工作站，几何/材质跨站共享；
   * - 实例挂到该站回转体 swivel 下，保留既有腰转动画；
   * - 加载失败静默降级：程序化几何保持现状，不阻塞场景。
   */
  private initRobotGLB(): void {
    const url = '/models/robotarm/6_axis_industrial_robot_arm.glb';
    loadEquipmentGLB(url)
      .then((model) => {
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        // 目标总高约 2.9m（工业六轴机械臂比例），底座垫高 0.15
        const scale = size.y > 0 ? 2.9 / size.y : 2.25;
        const offsetX = -center.x * scale;
        const offsetY = 0.15 - box.min.y * scale;
        const offsetZ = -center.z * scale;

        for (let i = 0; i < this.stations.length; i++) {
          const st = this.stations[i];
          const swivel = this.stationAnims[i]?.swivel;
          if (!swivel) continue;
          for (const p of st.armParts) p.visible = false;
          const inst = model.clone(true);
          inst.scale.setScalar(scale);
          inst.position.set(offsetX, offsetY, offsetZ);
          // 性能优化：
          // 1) 关闭阴影（6 台 × GLB 材质，远观不可见，省 shadow map 重算）
          // 2) KHR_materials_specular 生成 MeshPhysicalMaterial，shader 开销大；
          //    转成 MeshStandardMaterial（保留 map/roughness/metalness 质感）降 draw cost
          inst.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.castShadow = false;
            m.receiveShadow = false;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            m.material = mats.map((mat) => {
              if (mat instanceof THREE.MeshPhysicalMaterial) {
                const std = new THREE.MeshStandardMaterial({
                  map: mat.map,
                  roughnessMap: mat.roughnessMap,
                  metalnessMap: mat.metalnessMap,
                  normalMap: mat.normalMap,
                  emissiveMap: mat.emissiveMap,
                  emissive: mat.emissive,
                  color: mat.color,
                  roughness: mat.roughness,
                  metalness: mat.metalness,
                  transparent: mat.transparent,
                  opacity: mat.opacity,
                });
                mat.dispose();
                return std;
              }
              return mat;
            }) as THREE.Material | THREE.Material[];
          });
          swivel.add(inst);
        }
      })
      .catch(() => {
        // 加载失败：保留程序化几何兜底，不抛错
      });
  }

  private buildStationPlate(parent: THREE.Group, code: string, index: number): void {
    // 1) 实体立牌
    const plateW = 1.5;
    const plateH = 0.62;
    const label = makeLabelTexture(code, {
      width: 512,
      height: 212,
      fontPx: 96,
      color: '#e6fbff',
      bg: 'rgba(8,28,44,0.92)',
      border: '#22d3ee',
      glow: '#67e8f9',
    });
    if (label) {
      this.ownedTextures.push(label.texture);
      const plateMat = new THREE.MeshBasicMaterial({
        map: label.texture,
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(plateW, plateW / label.aspect), plateMat);
      plate.position.set(-1.55, 1.5, 0.9);
      plate.rotation.y = -0.35;
      parent.add(plate);

      for (const px of [-0.62, 0.62]) {
        const post = new THREE.Mesh(this.geo.platePost, this.mat.frame);
        post.position.set(-1.55 + px, 0.62, 0.9);
        parent.add(post);
      }
    }

    // 2) 顶部恒定尺寸 Sprite：远景下"编号牌可辨"
    const spriteLabel = makeLabelTexture(code, {
      width: 512,
      height: 168,
      fontPx: 88,
      color: '#22d3ee',
      bg: 'rgba(6,20,34,0.72)',
      border: '#22d3ee',
      glow: '#67e8f9',
    });
    if (spriteLabel) {
      this.ownedTextures.push(spriteLabel.texture);
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: spriteLabel.texture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          // ⚠️ three r186：sizeAttenuation=true（默认）会按**世界尺寸**渲染贴牌，
          //    scale 0.115 就只有 11.5 cm → 远景等于看不见。
          //    显式 false 才走 scale *= -mvPosition.z 的透视补偿 → 恒定屏幕尺寸。
          sizeAttenuation: false,
        })
      );
      sp.scale.set(0.115, 0.115 * (168 / 512), 1);
      sp.position.set(0, 4.35, 0);
      sp.renderOrder = 30;
      sp.userData = { kind: 'stationLabel', stationId: index };
      parent.add(sp);
      this.labelSprites.push(sp);
    }
  }

  private buildStationHazard(parent: THREE.Group): void {
    const tex = makeHazardTexture();
    if (!tex) return;
    this.ownedTextures.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      toneMapped: false,
      depthWrite: false,
    });
    // 贴地四边
    const half = 1.42;
    const thick = 0.26;
    for (const [w, d, px, pz] of [
      [half * 2, thick, 0, half],
      [half * 2, thick, 0, -half],
      [thick, half * 2, half, 0],
      [thick, half * 2, -half, 0],
    ]) {
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(2, Math.round(w * 1.4)), 1);
      this.ownedTextures.push(t);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat.clone());
      (m.material as THREE.MeshBasicMaterial).map = t;
      m.rotation.x = -Math.PI / 2;
      m.position.set(px, 0.035, pz);
      m.renderOrder = 2;
      parent.add(m);
    }
    mat.dispose();
    tex.dispose();
  }

  /* ---------------- 地面通道线 / 分区立牌 / 管线 ---------------- */

  private buildFloorMarkings(): void {
    const L = this.beltLength;
    const aisleTex = makeAisleTexture();
    if (aisleTex) {
      this.ownedTextures.push(aisleTex);
      const mat = new THREE.MeshBasicMaterial({
        map: aisleTex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      // 传送带两侧各一条安全通道（沿 X 贯穿）
      for (const z of [-7.6, 7.6]) {
        const t = aisleTex.clone();
        t.needsUpdate = true;
        t.repeat.set(Math.max(4, Math.round(L / 2.4)), 1);
        this.ownedTextures.push(t);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(L + 4, 2.2), mat.clone());
        (m.material as THREE.MeshBasicMaterial).map = t;
        m.rotation.x = -Math.PI / 2;
        m.position.set(0, 0.02, z);
        m.renderOrder = 1;
        this.group.add(m);
      }
      mat.dispose();
      aisleTex.dispose();
    }
  }

  private buildZoneSigns(): void {
    const text = this.opts.zoneLabel ?? '4# 生产车间';
    const L = this.beltLength;
    // 车间两端各一块立牌，朝向中轴
    for (const [x, ry] of [
      [-L / 2 - 2.6, Math.PI / 2],
      [L / 2 + 2.6, -Math.PI / 2],
    ]) {
      const g = new THREE.Group();
      g.position.set(x, 0, 0);
      g.rotation.y = ry;

      const W = 5.6;
      const H = 1.5;
      // 半透明立板
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(W, H),
        new THREE.MeshBasicMaterial({
          color: 0x0b2233,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      );
      board.position.y = 3.4;
      g.add(board);

      // 发光文字（略在立板前，避免 z-fighting）
      const label = makeLabelTexture(text, {
        width: 1024,
        height: 274,
        fontPx: 150,
        color: '#a5f3fc',
        bg: 'rgba(0,0,0,0)',
        border: 'rgba(0,0,0,0)',
        glow: '#22d3ee',
      });
      if (label) {
        this.ownedTextures.push(label.texture);
        const textMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(W * 0.94, (W * 0.94) / label.aspect),
          new THREE.MeshBasicMaterial({
            map: label.texture,
            transparent: true,
            side: THREE.DoubleSide,
            toneMapped: false,
          })
        );
        textMesh.position.set(0, 3.4, 0.03);
        g.add(textMesh);
      }

      // 立柱
      for (const px of [-W / 2 + 0.3, W / 2 - 0.3]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.11, 0.13, 4.1, 10),
          this.mat.frame
        );
        post.position.set(px, 2.05, 0);
        g.add(post);
      }

      this.zoneSigns.push(g);
      this.group.add(g);
    }
  }

  private buildOverheadPipes(): void {
    if (this.opts.detail < 1) return;
    const L = this.beltLength;
    const specs: Array<{ y: number; z: number; r: number; color: number }> = [
      { y: 7.2, z: -6.2, r: 0.24, color: 0x365d77 },
      { y: 7.6, z: -5.7, r: 0.18, color: 0x4b7f9e },
      { y: 7.2, z: 6.2, r: 0.24, color: 0x365d77 },
    ];
    for (const s of specs) {
      const mat = new THREE.MeshStandardMaterial({
        color: s.color,
        roughness: 0.55,
        metalness: 0.65,
      });
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, L + 6, 12), mat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, s.y, s.z);
      this.group.add(pipe);

      // 支吊架
      const hangers = Math.max(2, Math.round(L / 9));
      for (let i = 0; i <= hangers; i++) {
        const hx = -L / 2 + (L * i) / hangers;
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), this.mat.frame);
        h.position.set(hx, s.y + 0.55, s.z);
        this.group.add(h);
      }
    }
  }

  /* ---------------- 数据驱动：警示浮标 ---------------- */

  /**
   * 用**真实台账**更新警示浮标。
   * 只有状态属于 faultStatuses（默认 fault / alert）的设备才会生成浮标，
   * 其余设备（正常 / 停机 / 检修）不生成；已恢复的设备其浮标会被移除。
   */
  setDeviceAnchors(anchors: DeviceAnchor[]): void {
    // 注意 StatusKey 里没有 'alert'：告警态是 warning / critical（见 equipment.ts STATUS_META）。
    // 早期写成 'alert' 会导致故障设备永远匹配不上、浮标一个都不生成。
    const wanted = new Set(this.opts.faultStatuses ?? (['fault', 'warning', 'critical'] as StatusKey[]));
    const seen = new Set<string>();

    for (const a of anchors) {
      if (!wanted.has(a.status)) continue;
      seen.add(a.id);
      const existing = this.warnSprites.get(a.id);
      if (existing) {
        existing.sprite.position.set(a.x, a.topY + 2.1, a.z);
        existing.baseY = a.topY + 2.1;
        continue;
      }
      const sprite = this.makeWarningSprite(a);
      if (!sprite) continue;
      sprite.position.set(a.x, a.topY + 2.1, a.z);
      this.group.add(sprite);
      this.warnSprites.set(a.id, {
        sprite,
        baseY: a.topY + 2.1,
        phase: this.rng() * Math.PI * 2,
      });
    }

    // 移除已恢复设备的浮标
    for (const [id, rec] of Array.from(this.warnSprites.entries())) {
      if (seen.has(id)) continue;
      this.group.remove(rec.sprite);
      const m = rec.sprite.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.dispose();
      this.warnSprites.delete(id);
    }
  }

  private makeWarningSprite(anchor: DeviceAnchor): THREE.Sprite | null {
    const tex = makeWarningTexture();
    if (!tex) return null;
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
    sp.scale.set(1.35, 1.35, 1);
    sp.renderOrder = 40;
    sp.userData = { kind: 'faultFloat', deviceId: anchor.id, deviceName: anchor.name };
    return sp;
  }

  /** 当前处于警示状态的设备 id（便于 UI 显示"异常 N 台"）。 */
  get warnedDeviceIds(): string[] {
    return Array.from(this.warnSprites.keys());
  }

  /* ---------------- 绑定 / 开关 ---------------- */

  /** 把工作站与真实台账设备绑定（点击工作站即选中该设备）。 */
  bindDevice(stationIndex: number, deviceId: string | null): void {
    const st = this.stations.find((s) => s.index === stationIndex);
    if (!st) return;
    st.deviceId = deviceId;
    st.group.traverse((o) => {
      if (o.userData?.pick === 'station' && o.userData.stationId === stationIndex) {
        o.userData.deviceId = deviceId;
      }
    });
  }

  /** 设置某工作站的运行状态（影响指示灯颜色）。 */
  setStationRunning(stationIndex: number, running: boolean): void {
    const a = this.stationAnims[stationIndex - 1];
    if (!a?.lamp) return;
    a.lamp.material = running ? this.mat.lampRun : this.mat.lampOk;
  }

  setBeltEnabled(on: boolean): void {
    this.beltEnabled = on;
  }

  setBeltSpeed(v: number): void {
    this.beltSpeed = clamp(v, 0, 6);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** 复位所有动画到初始相位。 */
  resetAnimation(): void {
    this.syncBoxes(0);
    for (const a of this.stationAnims) {
      a.swivel.rotation.y = 0;
      a.upper.rotation.z = 0;
      a.fore.rotation.z = 0;
    }
    if (this.motorFan) this.motorFan.rotation.x = 0;
    if (this.beltTex) this.beltTex.offset.x = 0;
  }

  /* ---------------- 帧更新 ---------------- */

  private travel = 0;

  update(dt: number, t: number): void {
    if (this.paused) return;

    // 传送带：贴图滚动 + 物料箱位移 + 滚轮转动 + 电机风扇
    if (this.beltEnabled && this.beltSpeed > 0) {
      this.travel = (this.travel + this.beltSpeed * dt) % this.beltLength;
      if (this.beltTex) this.beltTex.offset.x = -this.travel / 1.6;
      this.syncBoxes(this.travel);
      if (this.motorFan) this.motorFan.rotation.x += dt * 6.5 * this.beltSpeed;
    }

    // 机械臂：腰转 + 大臂 + 小臂，相位错开
    for (let i = 0; i < this.stationAnims.length; i++) {
      const a = this.stationAnims[i];
      const p = a.phase;
      a.swivel.rotation.y = Math.sin(t * 0.42 + p) * 0.34;
      a.upper.rotation.z = Math.sin(t * 0.62 + p) * 0.1;
      a.fore.rotation.z = Math.sin(t * 0.85 + p * 1.3) * 0.16;
    }

    // 警示浮标：上下浮动 + 脉冲缩放
    for (const rec of this.warnSprites.values()) {
      const s = 1.35 + Math.sin(t * 3.1 + rec.phase) * 0.14;
      rec.sprite.scale.set(s, s, 1);
      rec.sprite.position.y = rec.baseY + Math.sin(t * 1.9 + rec.phase) * 0.22;
      const m = rec.sprite.material as THREE.SpriteMaterial;
      m.opacity = 0.78 + Math.sin(t * 3.1 + rec.phase) * 0.2;
    }
  }

  /* ---------------- 释放 ---------------- */

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
    this.warnSprites.clear();
    this.labelSprites.length = 0;
    this.zoneSigns.length = 0;
    this.picks.length = 0;
    this.stations.length = 0;
    this.stationAnims.length = 0;
    this.group.clear();
  }
}
