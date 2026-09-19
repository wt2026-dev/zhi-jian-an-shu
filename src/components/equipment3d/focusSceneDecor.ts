/**
 * 单设备聚焦层 · 检修作业现场（对标视频的设备放大后"检修作业闭环"叙事）。
 *
 * 定位：**纯加法**。只在进入单设备聚焦层（isolationId 生效）时挂载，退出即整体卸载，
 * 不改动/不隐藏任何既有元素（厂房、产线、机械臂、传送带、物料箱、护栏、故障红标、
 * 扫描线、粒子、HUD 全部原样）。
 *
 * 五组内容：
 *   A 地面作业区 —— 黄黑斜纹警戒带（贴地半透明）+ 四角立柱 + 红色虚线框 + 工具车 + 检修警示牌
 *   B 检修人员   —— 2 个低多边形人员（安全帽黄 / 工作服蓝，约 1.6m）+ 脚下青色脉冲光圈
 *   C 测点引线   —— 真实遥测测点（温度/振动/电流/压力）引弧线到数据气泡，缺测显示 "—"
 *   D 检修卡片   —— 故障部位引线 + 五步闭环卡片（工单真实状态驱动）
 *   E 流程扫描环 —— 贴地缓慢旋转的弧形环（故障/预警青色、正常极淡绿）
 *
 * 数据纪律：所有数值来自真实台账/遥测/工单接口，缺测一律渲染 "—"，**不 mock、不补零**。
 * 性能：几何体与材质在实例内共享并集中释放；`lowFx`（软渲染 / 低画质）下跳过扫描环、
 *       脚下光圈等光效；动画受 setPaused 控制；不加任何新光源（发光件用 MeshBasicMaterial）。
 *
 * ⚠️ 两个踩过的坑（改这个文件前必读）：
 *   1. group 必须先 `position.set(box.x, 0, box.z)` **再** `rotation.y = slot.angle`，
 *      子元素一律用**相对设备中心**的局部坐标。早期版本把绝对世界坐标塞进子节点、
 *      又给 group 加了 rotation，结果是绕世界原点旋转，作业区被甩到设备外面去了。
 *   2. 气泡/卡片不能按"世界坐标 ± 几米"摆位：聚焦层相机方位是任意的（阻尼插值出来的），
 *      世界 X 偏移很可能就是相机的视线方向 ⇒ 四个气泡在屏幕上叠成一坨（实测互相压住）。
 *      现在改成**屏幕槽位**：按相机的 right/up 基向量反解世界坐标，NDC 偏移恒定，
 *      无论相机怎么转都不叠、也不钻到右侧详情面板底下。
 */

import * as THREE from 'three';
import { PART_OBSERVATION_ZONES } from './partEvidence';
import { telemetryToStatus } from './statusMapping';
import type { ScenePreset } from './styles';

/* ========================= 类型（对外数据契约） ========================= */

/** 聚焦设备的整体状态语义（决定扫描环颜色与是否显示检修卡片）。 */
export type FocusDecorStatus = 'normal' | 'warning' | 'fault' | 'maintenance' | 'unknown';

/** 单个测点的展示态。 */
export type MeasureState = 'healthy' | 'warning' | 'fault' | 'unavailable';

export interface FocusDecorMeasurePoint {
  key: 'temperature' | 'vibration' | 'current' | 'pressure';
  /** 测点名：优先用真实部位名（来自观察区台账），无对应部位时退化为指标名。 */
  label: string;
  value: number | null;
  unit: string;
  state: MeasureState;
}

/** 最新一个真实遥测采样点（结构兼容 TelemetryPoint，避免耦合 React 组件类型）。 */
export interface FocusDecorTelemetrySample {
  temperature?: number | null;
  vibration?: number | null;
  current?: number | null;
  pressure?: number | null;
}

export interface FocusDecorWorkOrder {
  orderNo: string;
  /** WorkOrderStatus；未知值按"未开始"渲染，不臆造。 */
  status: string;
  faultType?: string;
}

export interface FocusDecorData {
  deviceId: string;
  deviceName?: string | null;
  status: FocusDecorStatus;
  /** 设备配方 id —— 只用于查真实观察区（部位名），不参与任何数值计算。 */
  recipeId?: string | null;
  telemetry: FocusDecorTelemetrySample | null;
  workOrder: FocusDecorWorkOrder | null;
  /** 故障部位名（faultLocator 已在用同一份）；正常设备传 null。 */
  faultPartName?: string | null;
}

export interface FocusDecorBox {
  /** 设备实际几何中心的世界 x（DeviceBoxInfo.centerX）；无旋转时等同 slot.x。 */
  x: number;
  /** 设备实际几何中心的世界 z（DeviceBoxInfo.centerZ）。 */
  z: number;
  /** 设备底面高度。 */
  y: number;
  w: number;
  h: number;
  d: number;
}

export interface FocusSceneDecorOptions {
  box: FocusDecorBox;
  preset: ScenePreset;
  /** 几何细节档（QUALITY.detail） */
  detail: number;
  /**
   * 设备朝向（DeviceSlot.angle）。
   * ⚠️ 设备的 w/d 是**未旋转**的尺寸，真正的朝向在 slot.angle 上；
   *    这里整体转 group，警戒带/立柱/人员站位才跟着设备一起转，不会歪。
   */
  rotationY?: number;
  /** 软渲染 / 低画质：跳过新增光效（扫描环、脚下光圈、脉冲）。 */
  lowFx?: boolean;
}

/* ========================= 纯函数（可单测，无 three 依赖） ========================= */

const METRIC_SPECS = [
  { key: 'temperature', fallback: '设备温度', unit: '°C', zoneMetric: 'temp' },
  { key: 'vibration', fallback: '设备振动', unit: 'mm/s', zoneMetric: 'vibration' },
  { key: 'current', fallback: '电机电流', unit: 'A', zoneMetric: null },
  { key: 'pressure', fallback: '介质压力', unit: 'MPa', zoneMetric: null },
] as const;

/**
 * 依据**真实**遥测采样点构造测点列表。
 *
 * - 测点名：先在真实观察区（PART_OBSERVATION_ZONES）里找该指标对应的部位名，
 *   找不到（如电流/压力这类没有部位映射的指标）就用指标名本身 —— 不编造部位。
 * - 缺测（null / NaN / Infinity）一律 `value: null` → 渲染 "—"，**绝不补零**。
 * - 状态由既有阈值策略 `telemetryToStatus` 判定；该策略没有阈值的指标（电流/压力）
 *   返回 null，此时按 healthy 渲染（不越权造阈值）。
 */
export function buildMeasurementPoints(
  recipeId: string | null | undefined,
  sample: FocusDecorTelemetrySample | null | undefined,
): FocusDecorMeasurePoint[] {
  const zones = (recipeId && PART_OBSERVATION_ZONES[recipeId]) || [];
  return METRIC_SPECS.map((spec): FocusDecorMeasurePoint => {
    const zone = spec.zoneMetric ? zones.find((z) => z.metric === spec.zoneMetric) : undefined;
    const raw = sample ? (sample as Record<string, unknown>)[spec.key] : undefined;
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    let state: MeasureState = 'unavailable';
    if (value !== null) {
      const classified = telemetryToStatus({ [spec.key]: value });
      state = classified === 'warning' ? 'warning'
        : classified === 'fault' || classified === 'critical' ? 'fault'
          : 'healthy';
    }
    return {
      key: spec.key,
      label: zone ? zone.partLabel : spec.fallback,
      value,
      unit: spec.unit,
      state,
    };
  });
}

/**
 * 台账状态（StatusKey：running/warning/fault/critical/overhauling/standby/scrapped/nodata）
 * → 聚焦层语义。未知值一律 'unknown'（按灰处理），**不臆造状态**。
 */
export function toFocusDecorStatus(raw: string | null | undefined): FocusDecorStatus {
  switch (String(raw ?? '').trim().toLowerCase()) {
    case 'running':
    case 'standby':
    case 'normal':
    case 'healthy':
      return 'normal';
    case 'warning':
    case 'warn':
      return 'warning';
    case 'fault':
    case 'critical':
    case 'alarm':
      return 'fault';
    case 'overhauling':
    case 'maintenance':
      return 'maintenance';
    default:
      return 'unknown';
  }
}

/** 五步检修闭环（与既有 RepairStepCard 的作业流程语义一致）。 */
export const REPAIR_STEPS = ['故障发现', '工单派发', '到场诊断', '部件维修', '试机验收'] as const;

export interface RepairStepState {
  /** 当前进行到的步骤下标；-1 = 未开始（无工单 / 已取消），>= REPAIR_STEPS.length = 全部完成。 */
  current: number;
  /** 工单已取消：整卡渲染为灰色，不推进任何步骤。 */
  cancelled: boolean;
}

/**
 * 工单真实状态 → 闭环步骤进度。
 * created → dispatched → in_progress → pending_acceptance → completed
 */
export function repairStepState(status: string | null | undefined): RepairStepState {
  switch (String(status ?? '').trim()) {
    case 'created': return { current: 0, cancelled: false };
    case 'dispatched': return { current: 1, cancelled: false };
    case 'in_progress': return { current: 3, cancelled: false };
    case 'pending_acceptance': return { current: 4, cancelled: false };
    case 'completed': return { current: REPAIR_STEPS.length, cancelled: false };
    default: return { current: -1, cancelled: String(status ?? '') === 'cancelled' };
  }
}

/* ========================= 颜色 / 常量 ========================= */

const STATE_COLOR: Record<MeasureState, string> = {
  healthy: '#22c55e',
  warning: '#facc15',
  fault: '#ef4444',
  unavailable: '#94a3b8',
};

const STATE_HEX: Record<MeasureState, number> = {
  healthy: 0x22c55e,
  warning: 0xfacc15,
  fault: 0xef4444,
  unavailable: 0x94a3b8,
};

/** 安全帽黄 / 工作服蓝（沿用既有技师配色）。 */
const HELMET_COLOR = 0xf5c518;
const SUIT_COLOR = 0x3b82f6;

/**
 * 恒定屏幕尺寸 sprite 的 scale.x —— ⚠️ 它直接等于"占屏宽比例 / 0.93"（实测
 * LABEL_SCALE=0.44 ⇒ 屏宽 41%，即 比例 ≈ scale.x × 0.93）。调大即挤爆画面、
 * 或钻到右侧详情面板底下。改这三个值必须重跑 `scratch/verify-focus-decor.mjs` 量一遍。
 */
const SIGN_SCALE = 0.2;
const BUBBLE_SCALE = 0.22;
const CARD_SCALE = 0.34;

/**
 * 四个数据气泡的**屏幕槽位**（NDC 偏移，相对设备中心）。
 * 为什么不是世界坐标偏移：聚焦层相机方位由阻尼插值决定，世界 X 很可能就是视线方向，
 * 实测四个气泡会在屏幕上叠成一坨。NDC 槽位与相机距离/方位无关，恒定不叠。
 * 取值约束（实测画布 1304×761、右侧详情面板左缘 NDC≈0.54）：
 *   气泡 NDC 尺寸约 0.30×0.19 ⇒ 同列行距 ≥0.25、右列右缘 <0.45。
 */
const BUBBLE_SLOTS: ReadonlyArray<readonly [number, number]> = [
  [-0.58, 0.60],
  [0.10, 0.60],
  [-0.58, 0.30],
  [0.10, 0.30],
];

/** 检修闭环卡片的屏幕槽位（左下，避开中央故障标签与右侧面板）。 */
const CARD_SLOT: readonly [number, number] = [-0.30, -0.52];

/** 检修警示牌的屏幕槽位（右下，避开卡片与右侧详情面板）。 */
const SIGN_SLOT: readonly [number, number] = [0.30, -0.55];

/** 引线采样点数（弧线）。 */
const LEAD_SEGMENTS = 22;

/* ========================= 画布小工具 ========================= */

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

/* ========================= 主体 ========================= */

interface LeadItem {
  /** 设备上的测点锚点（group 局部坐标） */
  anchor: THREE.Vector3;
  sx: number;
  sy: number;
  line: THREE.Line;
  bubble: THREE.Sprite | null;
  dot: THREE.Mesh;
  dashed: boolean;
}

export class FocusSceneDecor {
  readonly group = new THREE.Group();

  private opts: FocusSceneDecorOptions;
  private paused = false;

  /** 静态部分（作业区/人员/工具车/警示牌/扫描环），构建一次。 */
  private staticGroup = new THREE.Group();
  /** 数据驱动部分（引线 + 气泡 + 检修卡片），setData 时整体重建。 */
  private dataGroup = new THREE.Group();

  private ownedTextures: THREE.Texture[] = [];
  private disposed = false;

  private footRings: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];
  private scanRing: THREE.Mesh | null = null;
  private signSprite: THREE.Sprite | null = null;
  private measureBubbles: THREE.Sprite[] = [];
  private stepCard: THREE.Sprite | null = null;
  private leads: LeadItem[] = [];
  private cardAnchor: THREE.Vector3 | null = null;
  private cardLead: THREE.Line | null = null;
  private lastPoints: FocusDecorMeasurePoint[] = [];

  /** 屏幕槽位反解用到的临时量（复用，避免每帧分配）。 */
  private centerLocal = new THREE.Vector3();
  private tmpCenter = new THREE.Vector3();
  private tmpOrigin = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpMid = new THREE.Vector3();
  private tmpOut = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
  );
  /**
   * 是否需要重排屏幕槽位。
   * ⚠️ 不能用 `lastCamPos = (NaN,NaN,NaN)` 当"还没排过"的哨兵：
   *    NaN 参与的比较恒为 false，`distanceToSquared(...) > 1e-6` 直接不成立，
   *    第一帧永远排不上（实测气泡全叠在设备中心）。
   */
  private layoutDirty = true;
  private lastCamPos = new THREE.Vector3();

  private geo!: {
    band: THREE.ShapeGeometry;
    post: THREE.CylinderGeometry;
    foot: THREE.PlaneGeometry;
    scan: THREE.TorusGeometry;
    torso: THREE.CylinderGeometry;
    head: THREE.SphereGeometry;
    helmet: THREE.SphereGeometry;
    dot: THREE.SphereGeometry;
    limb: THREE.CylinderGeometry;
    leg: THREE.CylinderGeometry;
    cartBody: THREE.BoxGeometry;
    cartTop: THREE.BoxGeometry;
    cartWheel: THREE.CylinderGeometry;
    cartHandle: THREE.CylinderGeometry;
  };

  private mat!: {
    hazard: THREE.MeshBasicMaterial;
    post: THREE.MeshStandardMaterial;
    frame: THREE.LineDashedMaterial;
    steel: THREE.MeshStandardMaterial;
    dark: THREE.MeshStandardMaterial;
    suit: THREE.MeshStandardMaterial;
    helmet: THREE.MeshStandardMaterial;
    skin: THREE.MeshStandardMaterial;
    foot: THREE.MeshBasicMaterial;
    scan: THREE.MeshBasicMaterial;
    leader: THREE.LineBasicMaterial;
    leaderDash: THREE.LineDashedMaterial;
  };

  constructor(opts: FocusSceneDecorOptions) {
    this.opts = opts;
    this.group.name = 'focusSceneDecor';
    // ⚠️ 顺序不能反：先落到设备中心，再按设备朝向自转；子节点一律用相对中心的局部坐标。
    this.group.position.set(opts.box.x, 0, opts.box.z);
    this.group.rotation.y = opts.rotationY ?? 0;
    this.centerLocal.set(0, (opts.box.y ?? 0) + opts.box.h / 2, 0);
    this.group.add(this.staticGroup, this.dataGroup);
    this.initAssets();
    this.buildWorkZone();
    this.buildToolCart();
    this.buildWarningSign();
    this.buildCrew();
    this.buildScanRing();
  }

  /* ---------------- 共享资源 ---------------- */

  private initAssets(): void {
    const { box, preset, detail } = this.opts;
    const pad = this.pad();
    const seg = detail >= 2 ? 12 : detail >= 1 ? 9 : 6;

    // 黄黑斜纹警戒带：外框 + 内框挖孔 = 环形带
    const W = box.w / 2 + pad;
    const D = box.d / 2 + pad;
    const band = Math.max(0.35, pad * 0.42);
    const shape = new THREE.Shape();
    shape.moveTo(-W, -D);
    shape.lineTo(W, -D);
    shape.lineTo(W, D);
    shape.lineTo(-W, D);
    shape.closePath();
    const hole = new THREE.Path();
    const iw = Math.max(0.1, W - band);
    const id = Math.max(0.1, D - band);
    hole.moveTo(-iw, -id);
    hole.lineTo(-iw, id);
    hole.lineTo(iw, id);
    hole.lineTo(iw, -id);
    hole.closePath();
    shape.holes.push(hole);

    this.geo = {
      band: new THREE.ShapeGeometry(shape),
      post: new THREE.CylinderGeometry(0.045, 0.055, 0.95, seg),
      foot: new THREE.PlaneGeometry(1.15, 1.15),
      scan: new THREE.TorusGeometry(Math.max(box.w, box.d) * 0.62 + pad * 0.85, 0.05, 6, detail >= 1 ? 48 : 24),
      torso: new THREE.CylinderGeometry(0.2, 0.23, 0.6, seg),
      head: new THREE.SphereGeometry(0.13, seg, Math.max(4, seg - 2)),
      helmet: new THREE.SphereGeometry(0.15, seg, Math.max(4, seg - 3), 0, Math.PI * 2, 0, Math.PI * 0.55),
      dot: new THREE.SphereGeometry(0.075, 8, 6),
      limb: new THREE.CylinderGeometry(0.05, 0.05, 0.46, 6),
      leg: new THREE.CylinderGeometry(0.075, 0.065, 0.72, 6),
      cartBody: new THREE.BoxGeometry(0.86, 0.46, 0.48),
      cartTop: new THREE.BoxGeometry(0.92, 0.06, 0.54),
      cartWheel: new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8),
      cartHandle: new THREE.CylinderGeometry(0.028, 0.028, 0.5, 6),
    };

    const stripe = this.makeStripeTexture();
    const glow = this.makeGlowTexture();

    this.mat = {
      hazard: new THREE.MeshBasicMaterial({
        map: stripe ?? null,
        color: stripe ? 0xffffff : 0xe4b83f,
        transparent: true,
        opacity: stripe ? 0.52 : 0.3,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
      post: new THREE.MeshStandardMaterial({ color: HELMET_COLOR, roughness: 0.62, metalness: 0.22 }),
      frame: new THREE.LineDashedMaterial({
        color: 0xef4444, dashSize: 0.34, gapSize: 0.24,
        transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false,
      }),
      steel: new THREE.MeshStandardMaterial({ color: preset.palette.steel, roughness: 0.55, metalness: 0.5 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1f2a37, roughness: 0.72, metalness: 0.24 }),
      suit: new THREE.MeshStandardMaterial({ color: SUIT_COLOR, roughness: 0.76, metalness: 0.05 }),
      helmet: new THREE.MeshStandardMaterial({ color: HELMET_COLOR, roughness: 0.45, metalness: 0.1 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xd8b08c, roughness: 0.82, metalness: 0.02 }),
      foot: new THREE.MeshBasicMaterial({
        map: glow ?? null,
        color: glow ? 0xffffff : 0x22d3ee,
        transparent: true,
        opacity: glow ? 0.5 : 0.22,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      scan: new THREE.MeshBasicMaterial({
        color: 0x22d3ee, transparent: true, opacity: 0.34,
        depthWrite: false, toneMapped: false,
      }),
      leader: new THREE.LineBasicMaterial({
        color: 0x22d3ee, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false,
      }),
      leaderDash: new THREE.LineDashedMaterial({
        color: 0x94a3b8, dashSize: 0.22, gapSize: 0.18,
        transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false,
      }),
    };
  }

  /** 作业区外扩距离：设备越大留得越宽，但设上限避免小设备被圈得太空。 */
  private pad(): number {
    const { box } = this.opts;
    return Math.min(2.4, Math.max(0.9, Math.max(box.w, box.d) * 0.34));
  }

  /* ---------------- A 地面作业区 ---------------- */

  private buildWorkZone(): void {
    const { box } = this.opts;
    const pad = this.pad();
    const baseY = (box.y ?? 0) + 0.015;

    // 黄黑斜纹警戒带（贴地）
    const bandMesh = new THREE.Mesh(this.geo.band, this.mat.hazard);
    bandMesh.rotation.x = -Math.PI / 2;
    bandMesh.position.set(0, baseY, 0);
    bandMesh.renderOrder = 2;
    this.staticGroup.add(bandMesh);

    // 四角立柱
    const W = box.w / 2 + pad * 0.92;
    const D = box.d / 2 + pad * 0.92;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(this.geo.post, this.mat.post);
        post.position.set(sx * W, (box.y ?? 0) + 0.475, sz * D);
        this.staticGroup.add(post);
      }
    }

    // 红色地面虚线框（绕设备包围盒）
    const iw = box.w / 2 + pad * 0.34;
    const id = box.d / 2 + pad * 0.34;
    const pts = [
      new THREE.Vector3(-iw, 0, -id),
      new THREE.Vector3(iw, 0, -id),
      new THREE.Vector3(iw, 0, id),
      new THREE.Vector3(-iw, 0, id),
    ];
    const loop = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([...pts, pts[0].clone()]),
      this.mat.frame,
    );
    loop.computeLineDistances();
    loop.position.y = (box.y ?? 0) + 0.03;
    this.staticGroup.add(loop);
  }

  /* ---------------- A 工具车 + 警示牌 ---------------- */

  private buildToolCart(): void {
    const { box } = this.opts;
    const pad = this.pad();
    const g = new THREE.Group();
    // 停在设备侧前方（+X/+Z 角），不挡正面视线
    g.position.set(box.w / 2 + pad * 0.62, box.y ?? 0, box.d / 2 + pad * 0.5);
    g.rotation.y = -Math.PI * 0.22;

    const body = new THREE.Mesh(this.geo.cartBody, this.mat.steel);
    body.position.y = 0.42;
    g.add(body);

    const top = new THREE.Mesh(this.geo.cartTop, this.mat.dark);
    top.position.y = 0.7;
    g.add(top);

    for (const sx of [-0.34, 0.34]) {
      for (const sz of [-0.2, 0.2]) {
        const wheel = new THREE.Mesh(this.geo.cartWheel, this.mat.dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx, 0.12, sz);
        g.add(wheel);
      }
    }

    for (const sx of [-0.4, 0.4]) {
      const handle = new THREE.Mesh(this.geo.cartHandle, this.mat.steel);
      handle.position.set(sx, 0.92, -0.18);
      g.add(handle);
    }

    this.staticGroup.add(g);
  }

  private buildWarningSign(): void {
    const tex = this.makeSignTexture();
    if (!tex) return;
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        // ⚠️ three r186 起 sizeAttenuation 语义被"扶正"：true（默认）按世界尺寸渲染，
        //    远景缩成亚像素等于看不见；false 才是恒定屏幕尺寸。标牌必须显式关掉。
        sizeAttenuation: false,
      }),
    );
    sp.scale.set(SIGN_SCALE, SIGN_SCALE * (180 / 320), 1);
    sp.renderOrder = 20;
    this.staticGroup.add(sp);
    // 警示牌也走屏幕槽位：它是"提示牌"而不是设备的一部分，
    // 按世界坐标摆会随镜头方位乱飘，还会压到检修卡片上。
    this.signSprite = sp;
  }

  /* ---------------- B 检修人员 ---------------- */

  private buildCrew(): void {
    const { box } = this.opts;
    const pad = this.pad();
    // 站位：一个正前方面对设备，一个侧方蹲姿检修
    const standing = this.makeWorker(false);
    standing.position.set(0, box.y ?? 0, box.d / 2 + pad * 0.86);
    standing.rotation.y = Math.PI; // 面朝设备（-Z）
    this.staticGroup.add(standing);

    const crouch = this.makeWorker(true);
    crouch.position.set(-box.w / 2 - pad * 0.7, box.y ?? 0, box.d * 0.18);
    crouch.rotation.y = Math.PI * 0.5; // 面朝设备（+X）
    this.staticGroup.add(crouch);

    if (this.opts.lowFx) return; // 软渲染：跳过脚下光效
    this.addFootRing(standing.position.x, box.y ?? 0, standing.position.z);
    this.addFootRing(crouch.position.x, box.y ?? 0, crouch.position.z);
  }

  private addFootRing(x: number, y: number, z: number): void {
    if (!this.mat.foot.map) return;
    const mat = this.mat.foot.clone();
    const mesh = new THREE.Mesh(this.geo.foot, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.025, z);
    mesh.renderOrder = 3;
    this.staticGroup.add(mesh);
    this.footRings.push({ mesh, mat });
  }

  /** 低多边形人员：头 + 安全帽 + 躯干 + 四肢，约 1.6m。 */
  private makeWorker(crouching: boolean): THREE.Group {
    const g = new THREE.Group();
    const k = crouching ? 0.68 : 1; // 蹲姿整体压低

    const legL = new THREE.Mesh(this.geo.leg, this.mat.suit);
    legL.position.set(-0.09, 0.36 * k, 0);
    legL.scale.y = k;
    g.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.09;
    g.add(legR);

    const torso = new THREE.Mesh(this.geo.torso, this.mat.suit);
    torso.position.y = (0.72 + 0.3) * (crouching ? 0.78 : 1);
    g.add(torso);

    const armL = new THREE.Mesh(this.geo.limb, this.mat.suit);
    armL.position.set(-0.24, torso.position.y + 0.06, crouching ? 0.16 : 0.04);
    armL.rotation.x = crouching ? -0.9 : 0.12;
    g.add(armL);
    const armR = armL.clone();
    armR.position.x = 0.24;
    g.add(armR);

    const head = new THREE.Mesh(this.geo.head, this.mat.skin);
    head.position.y = torso.position.y + 0.44;
    g.add(head);

    const helmet = new THREE.Mesh(this.geo.helmet, this.mat.helmet);
    helmet.position.y = head.position.y + 0.03;
    g.add(helmet);

    return g;
  }

  /* ---------------- E 流程扫描环 ---------------- */

  private buildScanRing(): void {
    if (this.opts.lowFx) return; // 软渲染：跳过新增光效
    const { box } = this.opts;
    const ring = new THREE.Mesh(this.geo.scan, this.mat.scan);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, (box.y ?? 0) + 0.045, 0);
    ring.renderOrder = 4;
    this.staticGroup.add(ring);
    this.scanRing = ring;
  }

  /* ---------------- C/D 数据驱动部分 ---------------- */

  /** 用真实台账/遥测/工单刷新气泡与检修卡片（不重复请求，数据由调用方给）。 */
  setData(data: FocusDecorData): void {
    if (this.disposed) return;
    this.clearDataGroup();

    const points = buildMeasurementPoints(data.recipeId, data.telemetry);
    this.lastPoints = points;
    this.buildMeasurementLeads(points);

    const faulty = data.status === 'fault' || data.status === 'warning' || data.status === 'maintenance';
    if (faulty && data.workOrder) {
      this.buildRepairCard(data);
    }
    // 扫描环颜色：故障/预警青色（诊断中），正常设备极淡绿
    if (this.scanRing) {
      const normal = data.status === 'normal';
      this.mat.scan.color.setHex(normal ? 0x22c55e : 0x22d3ee);
      this.mat.scan.opacity = normal ? 0.14 : 0.34;
    }
    // 数据变了 ⇒ 强制重排一次屏幕槽位（相机没动也要重画引线端点）
    this.layoutDirty = true;
  }

  /**
   * 清空数据组（引线 + 气泡 + 卡片）。
   * ⚠️ 顺序：气泡贴图与卡片贴图**不进** ownedTextures（它们是数据生命周期），
   *    在这里随 sprite 一起释放；锚点小球共用 this.geo.dot 几何，只释放自己那份材质。
   */
  private clearDataGroup(): void {
    this.dataGroup.traverse((o) => {
      if (o instanceof THREE.Sprite) {
        const m = o.material as THREE.SpriteMaterial;
        m.map?.dispose();
        m.dispose();
      } else if (o instanceof THREE.Line) {
        o.geometry.dispose();
      } else if (o instanceof THREE.Mesh) {
        // 测点小球：几何共享（this.geo.dot），材质是按状态色单独建的
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
    });
    this.dataGroup.clear();
    this.measureBubbles.length = 0;
    this.leads.length = 0;
    this.stepCard = null;
    this.cardAnchor = null;
    this.cardLead = null;
  }

  /** 测点引线（弧线避免穿模）+ 数据气泡。 */
  private buildMeasurementLeads(points: FocusDecorMeasurePoint[]): void {
    const { box } = this.opts;
    const baseY = box.y ?? 0;
    const h = Math.max(1.2, box.h);
    const halfW = box.w / 2;
    const halfD = box.d / 2;

    // 4 个测点在设备上的锚点（错开高度与象限）—— 局部坐标，随 group 一起转
    const anchors: Array<[number, number, number]> = [
      [-halfW * 0.82, baseY + h * 0.78, halfD * 0.72],
      [halfW * 0.84, baseY + h * 0.56, halfD * 0.66],
      [-halfW * 0.66, baseY + h * 0.34, -halfD * 0.82],
      [halfW * 0.72, baseY + h * 0.9, -halfD * 0.55],
    ];

    points.forEach((p, i) => {
      const a = anchors[i % anchors.length];
      const anchor = new THREE.Vector3(a[0], a[1], a[2]);
      const slot = BUBBLE_SLOTS[i % BUBBLE_SLOTS.length];

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((LEAD_SEGMENTS + 1) * 3), 3));
      const dashed = p.value === null; // 缺测：虚线引线
      const line = new THREE.Line(geo, dashed ? this.mat.leaderDash : this.mat.leader);
      line.renderOrder = 10;
      this.dataGroup.add(line);

      // 锚点小节点
      const dot = new THREE.Mesh(
        this.geo.dot,
        new THREE.MeshBasicMaterial({ color: STATE_HEX[p.state], toneMapped: false, transparent: true, opacity: 0.9 }),
      );
      dot.position.copy(anchor);
      dot.renderOrder = 11;
      this.dataGroup.add(dot);

      const bubble = this.makeBubble(p);
      this.dataGroup.add(bubble);
      this.measureBubbles.push(bubble);

      this.leads.push({ anchor, sx: slot[0], sy: slot[1], line, bubble, dot, dashed });
    });
  }

  /** 故障部位引线 + 五步检修闭环卡片。 */
  private buildRepairCard(data: FocusDecorData): void {
    const { box } = this.opts;
    const tex = this.makeStepCardTexture(data);
    if (!tex) return;
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        sizeAttenuation: false,
      }),
    );
    sp.scale.set(CARD_SCALE, CARD_SCALE * (320 / 460), 1);
    sp.renderOrder = 30;
    this.dataGroup.add(sp);
    this.stepCard = sp;

    // 从故障部位引到卡片
    const steps = repairStepState(data.workOrder?.status);
    if (steps.cancelled) return;
    const anchor = new THREE.Vector3(0, (box.y ?? 0) + box.h * 0.75, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((LEAD_SEGMENTS + 1) * 3), 3));
    const line = new THREE.Line(geo, this.mat.leader);
    line.renderOrder = 12;
    this.dataGroup.add(line);
    this.cardAnchor = anchor;
    this.cardLead = line;
  }

  /* ---------------- 屏幕槽位反解 ---------------- */

  /**
   * 把 NDC 槽位反解成世界坐标，让气泡/卡片/警示牌在屏幕上**恒定**落在指定位置。
   *
   * 反解：ndc.x = (Δ·right)·P00 / depth ⇒ Δ_along_right = ndc.x · depth / P00
   * （P00/P11 为投影矩阵对角元；对透视相机成立）
   *
   * ⚠️ 槽位原点必须是**屏幕中心**（相机前方 depth 处那一点），不能用设备包围盒中心：
   *    聚焦镜头是按 `frameDeviceFault` 对准**故障部位**的，设备中心实测偏到 NDC
   *    (0.45, -0.28)；以它为原点算出来的槽位整体右移下移，右列气泡直接钻到右侧
   *    详情面板底下（实测 rightCss 1365 > 面板左缘 1261）。
   *    depth 仍取"相机到设备中心"的距离 —— 只用来定缩放，保证引线长度看起来合理。
   */
  private layoutScreenSpace(camera: THREE.Camera): void {
    if (this.leads.length === 0 && !this.stepCard && !this.signSprite) return;
    this.group.updateWorldMatrix(true, false);
    camera.updateMatrixWorld(); // 相机可能刚被轨道阻尼移动过，矩阵还是上一帧的

    const deviceCenter = this.group.localToWorld(this.tmpCenter.copy(this.centerLocal));
    const dist = camera.position.distanceTo(deviceCenter);
    if (!(dist > 1e-3)) return;

    const m = camera.matrixWorld.elements;
    this.right.set(m[0], m[1], m[2]).normalize();
    this.up.set(m[4], m[5], m[6]).normalize();
    this.fwd.set(-m[8], -m[9], -m[10]).normalize(); // 相机朝自身 -Z 看
    const proj = (camera as THREE.PerspectiveCamera).projectionMatrix?.elements;
    const p00 = proj && proj[0] ? proj[0] : 1;
    const p11 = proj && proj[5] ? proj[5] : 1;
    const kx = dist / p00;
    const ky = dist / p11;

    // 槽位原点 = 屏幕中心（相机正前方 dist 处）
    const origin = this.tmpOrigin.copy(camera.position).addScaledVector(this.fwd, dist);
    const place = (target: THREE.Object3D, sx: number, sy: number) => {
      const world = this.tmpA.copy(origin)
        .addScaledVector(this.right, sx * kx)
        .addScaledVector(this.up, sy * ky);
      target.position.copy(this.group.worldToLocal(world));
    };

    for (const item of this.leads) {
      if (!item.bubble) continue;
      place(item.bubble, item.sx, item.sy);
      this.updateLeadCurve(item.anchor, item.bubble.position, item.line);
    }

    if (this.stepCard) {
      place(this.stepCard, CARD_SLOT[0], CARD_SLOT[1]);
      if (this.cardAnchor && this.cardLead) {
        this.updateLeadCurve(this.cardAnchor, this.stepCard.position, this.cardLead);
      }
    }
    if (this.signSprite) place(this.signSprite, SIGN_SLOT[0], SIGN_SLOT[1]);
  }

  /** 重算一条弧线引线：控制点向外（背离设备中心）推出，绕开设备本体。 */
  private updateLeadCurve(start: THREE.Vector3, end: THREE.Vector3, line: THREE.Line): void {
    const mid = this.tmpMid.copy(start).add(end).multiplyScalar(0.5);
    const out = this.tmpOut.set(mid.x, 0, mid.z);
    if (out.lengthSq() > 1e-6) mid.addScaledVector(out.normalize(), 0.55);
    mid.y += 0.3;

    this.curve.v0.copy(start);
    this.curve.v1.copy(mid);
    this.curve.v2.copy(end);

    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const n = LEAD_SEGMENTS;
    for (let i = 0; i <= n; i++) {
      const p = this.curve.getPoint(i / n, this.tmpOut);
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    }
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    // 虚线必须重算线长，否则 dash 间隔会随长度漂移
    if ((line.material as THREE.LineDashedMaterial).isLineDashedMaterial) line.computeLineDistances();
  }

  /* ---------------- 贴图 ---------------- */

  private makeStripeTexture(): THREE.Texture | null {
    const made = makeCanvas(64, 64);
    if (!made) return null;
    const { ctx } = made;
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#e4b83f';
    ctx.lineWidth = 18;
    ctx.beginPath();
    for (let i = -64; i < 128; i += 36) {
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 64, 64);
    }
    ctx.stroke();
    const tex = new THREE.CanvasTexture(made.canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / 1.4, 1 / 1.4);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.ownedTextures.push(tex);
    return tex;
  }

  private makeGlowTexture(): THREE.Texture | null {
    const made = makeCanvas(128, 128);
    if (!made) return null;
    const { ctx } = made;
    const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(34,211,238,0.85)');
    grd.addColorStop(0.55, 'rgba(34,211,238,0.28)');
    grd.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
    // 外圈细环
    ctx.strokeStyle = 'rgba(125,240,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(made.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.ownedTextures.push(tex);
    return tex;
  }

  private makeSignTexture(): THREE.Texture | null {
    const made = makeCanvas(320, 180);
    if (!made) return null;
    const { ctx } = made;
    ctx.clearRect(0, 0, 320, 180);
    ctx.fillStyle = 'rgba(20,16,8,0.9)';
    ctx.fillRect(6, 6, 308, 168);
    ctx.strokeStyle = '#e4b83f';
    ctx.lineWidth = 7;
    ctx.strokeRect(6, 6, 308, 168);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde68a';
    ctx.font = '700 62px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillText('检修中', 160, 66);
    ctx.font = '700 30px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('DO NOT OPERATE', 160, 124);
    const tex = new THREE.CanvasTexture(made.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.ownedTextures.push(tex);
    return tex;
  }

  private makeBubble(p: FocusDecorMeasurePoint): THREE.Sprite {
    const W = 320;
    const H = 120;
    const color = STATE_COLOR[p.state];
    const made = makeCanvas(W, H);
    if (!made) return new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false }));
    const { ctx } = made;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,18,30,0.86)';
    ctx.fillRect(4, 4, W - 8, H - 8);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, W - 8, H - 8);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 30px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillText(p.label, W / 2, 38);

    // 缺测显示 "—"，绝不补零
    const text = p.value === null ? '—' : `${p.value}${p.unit === '°C' ? ' ' : ''}${p.unit}`;
    ctx.font = '700 42px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, 84);

    const tex = new THREE.CanvasTexture(made.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        sizeAttenuation: false,
      }),
    );
    sp.scale.set(BUBBLE_SCALE, BUBBLE_SCALE * (H / W), 1);
    sp.renderOrder = 28;
    return sp;
  }

  private makeStepCardTexture(data: FocusDecorData): THREE.Texture | null {
    const W = 460;
    const H = 320;
    const made = makeCanvas(W, H);
    if (!made) return null;
    const { ctx } = made;
    const order = data.workOrder!;
    const { current, cancelled } = repairStepState(order.status);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,16,28,0.92)';
    ctx.fillRect(4, 4, W - 8, H - 8);
    ctx.strokeStyle = cancelled ? '#64748b' : '#22d3ee';
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, W - 8, H - 8);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 34px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillText('检修闭环', 26, 40);
    ctx.font = '600 24px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(order.orderNo, 168, 42);

    if (data.faultPartName) {
      ctx.fillStyle = '#fca5a5';
      ctx.font = '600 24px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
      ctx.fillText(`部位：${data.faultPartName}`, 26, 78);
    }

    REPAIR_STEPS.forEach((label, i) => {
      const y = 118 + i * 38;
      const done = !cancelled && i < current;
      const isCurrent = !cancelled && i === current;
      ctx.font = `${isCurrent ? 700 : 600} 26px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
      ctx.fillStyle = cancelled ? '#64748b' : isCurrent ? '#67e8f9' : done ? '#94a3b8' : '#cbd5e1';
      const mark = cancelled ? '○' : done ? '✓' : isCurrent ? '▶' : '○';
      ctx.fillText(`${mark} ${i + 1}. ${label}`, 34, y);
      if (isCurrent) {
        ctx.strokeStyle = 'rgba(34,211,238,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(24, y - 17, W - 52, 34);
      }
    });

    if (cancelled) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 22px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
      ctx.fillText('工单已取消 · 无进行中的检修步骤', 26, H - 30);
    }

    const tex = new THREE.CanvasTexture(made.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /* ---------------- 动画 / 释放 ---------------- */

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /**
   * @param camera 传相机才会重排屏幕槽位（气泡/卡片要恒定贴在屏幕指定位置）。
   *               ⚠️ 重排不受 setPaused 影响 —— 暂停的只是动画，镜头一动仍要跟。
   */
  update(_dt: number, t: number, camera?: THREE.Camera): void {
    if (this.disposed) return;
    if (camera) {
      // 相机没动就不重算（软渲染下每帧省掉几十次曲线采样）
      if (this.layoutDirty || this.lastCamPos.distanceToSquared(camera.position) > 1e-6) {
        this.lastCamPos.copy(camera.position);
        this.layoutDirty = false;
        this.layoutScreenSpace(camera);
      }
    }
    if (this.paused) return;
    if (this.scanRing) {
      // 0.5 圈 / 8s ⇒ π rad / 8s ≈ 0.3927 rad/s
      this.scanRing.rotation.z = t * 0.3927;
    }
    if (!this.opts.lowFx) {
      const pulse = Math.sin(t * 2.1) * 0.5 + 0.5;
      for (const r of this.footRings) {
        r.mat.opacity = 0.28 + pulse * 0.34;
        const s = 1 + pulse * 0.08;
        r.mesh.scale.set(s, s, 1);
      }
    }
  }

  /** 供自检/单测与浏览器验收核对。 */
  get bubbleCount(): number {
    return this.measureBubbles.length;
  }

  get hasStepCard(): boolean {
    return !!this.stepCard;
  }

  /** 最近一次 setData 算出的真实测点（验收用：核对部位名与缺测 "—"）。 */
  get points(): readonly FocusDecorMeasurePoint[] {
    return this.lastPoints;
  }

  /** 检修卡片 sprite（验收核对屏幕位置用）。 */
  get card(): THREE.Sprite | null {
    return this.stepCard;
  }

  /** 验收/自检：气泡的世界坐标（屏幕槽位反解结果，用来量是否叠在一起）。 */
  bubbleWorldPositions(): THREE.Vector3[] {
    this.group.updateWorldMatrix(true, false);
    return this.measureBubbles.map((b) => this.group.localToWorld(b.position.clone()));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDataGroup(); // 先清数据组：气泡/卡片贴图与每点材质都在这里释放
    for (const g of Object.values(this.geo)) g.dispose();
    for (const m of Object.values(this.mat)) m.dispose();
    for (const r of this.footRings) r.mat.dispose(); // 脚下光圈是 mat.foot 的 clone
    this.footRings.length = 0;
    for (const tex of this.ownedTextures) tex.dispose(); // 静态贴图（斜纹/光圈/警示牌）
    this.ownedTextures.length = 0;
    this.group.clear();
  }
}
