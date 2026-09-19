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
  /**
   * 屏幕空间悬浮标签（4 个测点气泡 + 检修闭环卡片）。
   *
   * 默认 **false**：温度/振动/电流/压力这类读数全部交给右侧参数面板，
   * 画面里只保留故障定位那一个红标签（用户明确要求"不要 PPT 式注释"）。
   * 置 true 才恢复气泡 + 引线 + 卡片布局（单设备聚焦层的检修作业闭环口径用它）。
   */
  floatingLabels?: boolean;
  /**
   * 只画数据、不画物理件。
   *
   * 同层的 `DeviceDetailEnv`（地面警戒线 / 立柱 / 屋架 / 管道 / 工具车 / 备件箱 /
   * 作业人员 / 工作灯）已经把这些摆了一遍，这里再摆就是"两辆工具车 + 两组工人"。
   * 由 scene.ts 在挂载时置 true：物理件归 DeviceDetailEnv，数据标注归本模块。
   */
  dataOnly?: boolean;
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
 * 四个数据气泡的**屏幕槽位**：[列比例, 行 NDC y]。
 *
 * 为什么不是世界坐标偏移：聚焦层相机方位由阻尼插值决定，世界 X 很可能就是视线方向，
 * 实测四个气泡会在屏幕上叠成一坨。NDC 槽位与相机距离/方位无关，恒定不叠。
 *
 * 为什么列写成"安全带内的比例"而不是写死的绝对 NDC：画布上浮着两块 DOM，两侧一起挤——
 *   ① 左侧「检修步骤卡片」弹窗（`absolute bottom-3 left-3 w-[380px]`，几乎满高），
 *      实测把左列气泡（NDC x=-0.62）整列盖住，精确命中测试 9/9 采样点全被压；
 *   ② 右侧详情面板，左缘会随内容变（实测 CSS 1261 → 1116，即 NDC 0.539 → 0.316）。
 * 两块中间只剩约 0.72 NDC 宽，写死绝对 NDC 必然有一侧钻到 DOM 底下。
 * 所以 x = 安全带内按比例展开（t=0 贴左安全线、t=1 贴右安全线），y 用固定行高。
 *
 * 分区（避开中央故障标签，它向左展开占住 x∈[-0.83,-0.13]、y∈[-0.21,0.21]）：
 *   - 下半区 y ≤ -0.24：四个气泡，两列 × 两行。
 *   - 上半区 y ≥ 0.24：检修卡片（贴左安全线）+ 警示牌（贴右安全线），同排不打架；
 *     卡片宽度按带宽自适应，带宽实在不够时**卡片优先**（D 是硬要求）、牌子让位不画。
 *   - 元素 NDC 尺寸（P00≈1.364、P11≈2.336）：气泡 0.30×0.19、卡片 0.46×0.55、警示牌 0.27×0.26。
 */
const BUBBLE_SLOTS: ReadonlyArray<readonly [number, number]> = [
  [0, -0.34],
  [1, -0.34],
  [0, -0.62],
  [1, -0.62],
];

/** 两列气泡的最大展开间距（NDC）：带宽富余时不再继续往两边拉，免得气泡贴死在画布边缘。 */
const BUBBLE_MAX_SPREAD = 0.75;

/** 卡片与警示牌之间留的缝（NDC）。 */
const TOP_BAND_GAP = 0.04;

/** 卡片自适应后的最小宽度（NDC）—— 再窄五步闭环就画不下了。 */
const CARD_MIN_W = 0.3;

/**
 * 上半区元素（卡片 / 警示牌）的**顶边** NDC。
 * ⚠️ 画布顶部偏右压着一条 HUD 状态条（实测 h=50px、左缘 CSS 1261 ⇒ 占 NDC y 0.818~0.95），
 *    贴着 0.95 放会把警示牌整块压在它底下（命中测试 9/9）。实测让到 0.78 ⇒ 顶边落在
 *    CSS 84px，与状态条留 15px 余量。
 */
const TOP_SAFE_Y = 0.78;

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
  /** 气泡在安全带内的列比例：0 = 贴左安全线，1 = 贴右安全线 */
  colT: number;
  /** 气泡的行 NDC y（负 = 下半区，避开中央故障标签） */
  rowY: number;
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
  /** 非共享的零星几何/材质（如实物警示牌），随实例统一释放。 */
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private ownedMaterials: THREE.Material[] = [];
  private disposed = false;

  private footRings: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];
  /** 检修人员的 InstancedMesh（按几何体分桶），dispose 时逐桶释放实例缓冲。 */
  private crewParts: THREE.InstancedMesh[] = [];
  /**
   * 待检修人员的"零件 → 实例"映射，逐帧写回 instanceMatrix 做待机小动作。
   * 14 个零件 / 帧，成本可忽略，换来的是"活人"而不是塑料模特。
   */
  private crewItems: Array<{ inst: THREE.InstancedMesh; slot: number; pose: number; part: THREE.Matrix4 }> = [];
  private crewPoses: Array<{ base: THREE.Matrix4; phase: number; origin: THREE.Vector3; ry: number }> = [];
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
  /** animateCrew 的复用临时量（每帧零分配）。 */
  private crewPoseM = new THREE.Matrix4();
  private crewTmpM = new THREE.Matrix4();
  private crewQ = new THREE.Quaternion();
  private crewE = new THREE.Euler();
  private crewOne = new THREE.Vector3(1, 1, 1);
  private crewTmpV = new THREE.Vector3();
  /**
   * 是否需要重排屏幕槽位。
   * ⚠️ 不能用 `lastCamPos = (NaN,NaN,NaN)` 当"还没排过"的哨兵：
   *    NaN 参与的比较恒为 false，`distanceToSquared(...) > 1e-6` 直接不成立，
   *    第一帧永远排不上（实测气泡全叠在设备中心）。
   */
  private layoutDirty = true;
  private lastCamPos = new THREE.Vector3();
  /**
   * 屏幕右侧"安全线"（NDC）。右侧详情面板是浮在画布上的 DOM，宽度会随内容变
   * （实测左缘 CSS 1261 → 1116，NDC 0.539 → 0.316），由 UI 层量出来喂进来。
   */
  private safeRight = 0.95;

  /**
   * 屏幕左侧"安全线"（NDC）。左侧「检修步骤卡片」弹窗（`w-[380px]`，几乎满高）
   * 会把左半边整列盖住（实测左列气泡命中测试 9/9 全被压），同样由 UI 层量出来。
   * ⚠️ 只有右侧安全线是不够的 —— 早期版本只喂右边，左列气泡照样全看不见。
   */
  private safeLeft = -0.95;

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
    if (!opts.dataOnly) {
      // 物理件：地面警戒带 + 四角立柱 + 红色虚线框 + 工具车 + 两名作业人员。
      // ⚠️ dataOnly（scene.ts 默认这么挂）时整体跳过 —— 同层 DeviceDetailEnv 已经摆了
      //    地面警戒线 / 工具车 / 工人，两边都摆会当场出现"两辆工具车 + 两组工人"。
      this.buildWorkZone();
      this.buildToolCart();
      this.buildCrew();
    }
    this.buildWarningSign();
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

    // 四角立柱：4 根完全同形的柱子 ⇒ InstancedMesh（4 次 draw call 变 1 次）
    const W = box.w / 2 + pad * 0.92;
    const D = box.d / 2 + pad * 0.92;
    const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const posts = new THREE.InstancedMesh(this.geo.post, this.mat.post, corners.length);
    const pm = new THREE.Matrix4();
    corners.forEach(([sx, sz], i) => {
      pm.makeTranslation(sx * W, (box.y ?? 0) + 0.475, sz * D);
      posts.setMatrixAt(i, pm);
    });
    posts.instanceMatrix.needsUpdate = true;
    this.staticGroup.add(posts);

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

    // 4 个轮子 / 2 根把手：同形部件一律 InstancedMesh
    const wheels = new THREE.InstancedMesh(this.geo.cartWheel, this.mat.dark, 4);
    const wm = new THREE.Matrix4();
    const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    const one = new THREE.Vector3(1, 1, 1);
    let wi = 0;
    for (const sx of [-0.34, 0.34]) {
      for (const sz of [-0.2, 0.2]) {
        wm.compose(new THREE.Vector3(sx, 0.12, sz), wq, one);
        wheels.setMatrixAt(wi++, wm);
      }
    }
    wheels.instanceMatrix.needsUpdate = true;
    g.add(wheels);

    const handles = new THREE.InstancedMesh(this.geo.cartHandle, this.mat.steel, 2);
    const hq = new THREE.Quaternion();
    let hi = 0;
    for (const sx of [-0.4, 0.4]) {
      wm.compose(new THREE.Vector3(sx, 0.92, -0.18), hq, one);
      handles.setMatrixAt(hi++, wm);
    }
    handles.instanceMatrix.needsUpdate = true;
    g.add(handles);

    this.staticGroup.add(g);
  }

  private buildWarningSign(): void {
    const tex = this.makeSignTexture();
    if (!tex) return;
    if (!this.opts.floatingLabels) {
      // 实物警示牌：钉在朝向相机那根立柱上，随设备一起转。
      // 屏幕空间那种"浮在画面上的一块牌"和悬浮标签是同一类东西，一并收掉。
      const { box } = this.opts;
      const pad = this.pad();
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.44), mat);
      board.position.set(box.w / 2 + pad * 0.92, (box.y ?? 0) + 0.95, box.d / 2 + pad * 0.92);
      board.rotation.y = Math.PI * 0.25;
      board.renderOrder = 6;
      this.staticGroup.add(board);
      this.ownedGeometries.push(board.geometry);
      this.ownedMaterials.push(mat);
      return;
    }
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
    // 站位：警戒带**内侧**（带子内缘在 w/2 + pad·0.58），一名正前方面对设备站立观察，
    // 一名侧方蹲姿检修。早期版本把人摆在带子外侧（pad·0.86），既踩在黄纹上也不像"作业中"。
    const poses: Array<{ p: THREE.Vector3; ry: number; crouch: boolean }> = [
      { p: new THREE.Vector3(box.w * 0.16, box.y ?? 0, box.d / 2 + pad * 0.3), ry: Math.PI, crouch: false },
      { p: new THREE.Vector3(-(box.w / 2 + pad * 0.26), box.y ?? 0, box.d * 0.14), ry: Math.PI * 0.5, crouch: true },
    ];

    // 两名人员一共 14 个零件，但只有 5 种几何体 ⇒ 按几何体分桶建 InstancedMesh
    // （14 次 draw call → 5 次）。零件局部变换按"人"的位姿矩阵左乘得到实例矩阵。
    const buckets = new Map<THREE.BufferGeometry, {
      mat: THREE.Material;
      items: Array<{ m: THREE.Matrix4; pose: number; part: THREE.Matrix4 }>;
    }>();
    const base = new THREE.Matrix4();
    const part = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.crewPoses = poses.map((_, i) => ({
      base: new THREE.Matrix4(),
      phase: i * 1.9,
      origin: poses[i].p.clone(),
      ry: poses[i].ry,
    }));
    poses.forEach((pose, pi) => {
      base.compose(pose.p, q.setFromEuler(new THREE.Euler(0, pose.ry, 0)), new THREE.Vector3(1, 1, 1));
      this.crewPoses[pi].base.copy(base);
      for (const it of this.workerParts(pose.crouch)) {
        let b = buckets.get(it.geo);
        if (!b) { b = { mat: it.mat, items: [] }; buckets.set(it.geo, b); }
        part.compose(it.position, q.setFromEuler(it.rotation), it.scale);
        b.items.push({ m: base.clone().multiply(part), pose: pi, part: part.clone() });
      }
    });
    for (const [geo, b] of buckets) {
      const inst = new THREE.InstancedMesh(geo, b.mat, b.items.length);
      b.items.forEach((it, i) => {
        inst.setMatrixAt(i, it.m);
        this.crewItems.push({ inst, slot: i, pose: it.pose, part: it.part });
      });
      inst.instanceMatrix.needsUpdate = true;
      this.staticGroup.add(inst);
      this.crewParts.push(inst);
    }

    if (this.opts.lowFx) return; // 软渲染：跳过脚下光效
    for (const pose of poses) this.addFootRing(pose.p.x, box.y ?? 0, pose.p.z);
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

  /**
   * 低多边形人员的零件清单（头 + 安全帽 + 躯干 + 四肢，约 1.6m）。
   * 只描述**相对人体原点**的局部变换；由 buildCrew 按位姿矩阵实例化。
   */
  private workerParts(crouching: boolean): Array<{
    geo: THREE.BufferGeometry;
    mat: THREE.Material;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  }> {
    const k = crouching ? 0.68 : 1; // 蹲姿整体压低
    const torsoY = (0.72 + 0.3) * (crouching ? 0.78 : 1);
    const headY = torsoY + 0.44;
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const e = (x: number) => new THREE.Euler(x, 0, 0);
    const s = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    return [
      { geo: this.geo.leg, mat: this.mat.suit, position: v(-0.09, 0.36 * k, 0), rotation: e(0), scale: s(1, k, 1) },
      { geo: this.geo.leg, mat: this.mat.suit, position: v(0.09, 0.36 * k, 0), rotation: e(0), scale: s(1, k, 1) },
      { geo: this.geo.torso, mat: this.mat.suit, position: v(0, torsoY, 0), rotation: e(0), scale: s(1, 1, 1) },
      // 蹲姿手臂前伸（检修姿态），站姿自然下垂
      { geo: this.geo.limb, mat: this.mat.suit, position: v(-0.24, torsoY + 0.06, crouching ? 0.16 : 0.04), rotation: e(crouching ? -0.9 : 0.12), scale: s(1, 1, 1) },
      { geo: this.geo.limb, mat: this.mat.suit, position: v(0.24, torsoY + 0.06, crouching ? 0.16 : 0.04), rotation: e(crouching ? -0.9 : 0.12), scale: s(1, 1, 1) },
      { geo: this.geo.head, mat: this.mat.skin, position: v(0, headY, 0), rotation: e(0), scale: s(1, 1, 1) },
      { geo: this.geo.helmet, mat: this.mat.helmet, position: v(0, headY + 0.03, 0), rotation: e(0), scale: s(1, 1, 1) },
    ];
  }

  /**
   * 待机小动作：整体缓慢起伏（呼吸）+ 极小幅度转身，两名人员相位错开。
   * 只写 instanceMatrix，不新建对象、不加 draw call。
   */
  private animateCrew(t: number): void {
    if (!this.crewItems.length || this.opts.lowFx) return;
    for (let i = 0; i < this.crewPoses.length; i++) {
      const pose = this.crewPoses[i];
      this.crewPoseM.compose(
        this.crewTmpV.set(pose.origin.x, pose.origin.y + Math.sin(t * 1.15 + pose.phase) * 0.022, pose.origin.z),
        this.crewQ.setFromEuler(this.crewE.set(0, pose.ry + Math.sin(t * 0.42 + pose.phase) * 0.14, 0)),
        this.crewOne,
      );
      for (const it of this.crewItems) {
        if (it.pose !== i) continue;
        this.crewTmpM.copy(this.crewPoseM).multiply(it.part);
        it.inst.setMatrixAt(it.slot, this.crewTmpM);
      }
    }
    for (const inst of this.crewParts) inst.instanceMatrix.needsUpdate = true;
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
    // 读数仍然算出来（右侧参数面板与单测都消费 points），只是不再摆到画面上。
    this.lastPoints = points;
    if (this.opts.floatingLabels) this.buildMeasurementLeads(points);

    const faulty = data.status === 'fault' || data.status === 'warning' || data.status === 'maintenance';
    if (this.opts.floatingLabels && faulty && data.workOrder) {
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
        // InstancedMesh：只释放实例缓冲，**不要**碰共享几何
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
        // 测点小球：几何共享（this.geo.dot），材质是按批单独建的
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

    // 锚点小节点：4 个同形小球 ⇒ 一个 InstancedMesh + setColorAt（状态色走实例色）
    const dotMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9 });
    const dots = new THREE.InstancedMesh(this.geo.dot, dotMat, points.length);
    const dm = new THREE.Matrix4();
    const col = new THREE.Color();

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

      dm.makeTranslation(anchor.x, anchor.y, anchor.z);
      dots.setMatrixAt(i, dm);
      dots.setColorAt(i, col.setHex(STATE_HEX[p.state]));

      const bubble = this.makeBubble(p);
      this.dataGroup.add(bubble);
      this.measureBubbles.push(bubble);

      this.leads.push({ anchor, colT: slot[0], rowY: slot[1], line, bubble, dot: dots, dashed });
    });

    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    dots.renderOrder = 11;
    this.dataGroup.add(dots);
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

    // ── 安全带（两侧 DOM 遮挡之间真正露出来的那一条）─────────────────────────
    // 左侧是「检修步骤卡片」弹窗、右侧是详情面板，两块都是浮在画布上的 DOM，
    // 宽度还会变 ⇒ 由 UI 层用 elementFromPoint 精确扫出来喂进来（见 EquipmentScene）。
    const bandL = Math.min(this.safeLeft, this.safeRight - 0.2);
    const bandR = this.safeRight;
    const band = Math.max(0.2, bandR - bandL);
    const bandCx = (bandL + bandR) / 2;

    // 恒定屏幕尺寸 sprite 的 NDC 尺寸可由投影矩阵精确算出：宽 = P00·scale.x、高 = P11·scale.y
    // ⇒ 不需要任何魔法常数就能把左右缘都收在安全线以内、上下缘收在画布内。
    const place = (target: THREE.Object3D, x: number, y: number) => {
      const s = (target as THREE.Sprite).scale;
      const halfW = s ? (p00 * s.x) / 2 : 0;
      const halfH = s ? (p11 * s.y) / 2 : 0;
      const cx = Math.max(bandL + halfW, Math.min(x, bandR - halfW));
      const cy = Math.max(-0.95 + halfH, Math.min(0.95 - halfH, y));
      const world = this.tmpA.copy(origin)
        .addScaledVector(this.right, cx * kx)
        .addScaledVector(this.up, cy * ky);
      target.position.copy(this.group.worldToLocal(world));
    };

    // ── 上半区：检修卡片（贴左）+ 警示牌（贴右）────────────────────────────
    // 卡片宽度按带宽自适应：先按理想尺寸，放不下就缩，缩到 CARD_MIN_W 还放不下
    // 就让警示牌不画 —— 五步闭环卡片是硬要求，牌子是加分项，冲突时牌子让位。
    const signW = p00 * SIGN_SCALE;
    let cardW = p00 * CARD_SCALE;
    let showSign = !!this.signSprite;
    if (showSign && cardW + signW + TOP_BAND_GAP > band) {
      const shrunk = band - signW - TOP_BAND_GAP;
      if (shrunk >= CARD_MIN_W) cardW = shrunk;
      else { cardW = Math.min(cardW, Math.max(CARD_MIN_W, band - 0.02)); showSign = false; }
    }
    cardW = Math.min(cardW, band - 0.02);

    if (this.stepCard) {
      // scale.x 直接决定 NDC 宽度，反解出来即可，不用猜
      const cs = cardW / p00;
      this.stepCard.scale.set(cs, cs * (320 / 460), 1);
      const cardH = p11 * this.stepCard.scale.y;
      place(this.stepCard, bandL + cardW / 2, TOP_SAFE_Y - cardH / 2);
      if (this.cardAnchor && this.cardLead) {
        this.updateLeadCurve(this.cardAnchor, this.stepCard.position, this.cardLead);
      }
    }
    if (this.signSprite) {
      this.signSprite.visible = showSign;
      if (showSign) {
        const signH = p11 * this.signSprite.scale.y;
        place(this.signSprite, bandR - signW / 2, TOP_SAFE_Y - signH / 2);
      }
    }

    // ── 下半区：四个气泡，两列 × 两行 ──────────────────────────────────────
    // 列间距 = min(带宽 - 一个气泡宽, 0.75)：带宽被两侧 DOM 挤窄时自动往中间收，
    // 但气泡宽 0.30 是硬下限，收不进去就贴着安全线放（此时宁可紧一点也不叠）。
    const bubW = p00 * BUBBLE_SCALE;
    const spread = Math.max(0, Math.min(BUBBLE_MAX_SPREAD, band - bubW));
    for (const item of this.leads) {
      if (!item.bubble) continue;
      place(item.bubble, bandCx + (item.colT - 0.5) * spread, item.rowY);
      this.updateLeadCurve(item.anchor, item.bubble.position, item.line);
    }
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
   * 设置屏幕右侧安全线（NDC）。右侧详情面板是浮在画布上的 DOM，宽度会变，
   * 由 UI 层量出面板左缘换算后喂进来；槽位右缘会自动收到这条线左边。
   */
  setSafeArea(rightNdc: number): void {
    // ⚠️ 下界别设太保守：详情面板展开时实测能占到画布 62%（NDC 左缘 ≈ 0.24 甚至更小），
    //    早期把下界写死成 0.05，结果"让位"根本没生效。
    const v = Number.isFinite(rightNdc) ? Math.min(0.95, Math.max(-0.6, rightNdc)) : 0.95;
    if (Math.abs(v - this.safeRight) < 1e-4) return;
    this.safeRight = v;
    this.layoutDirty = true;
  }

  /**
   * 设置屏幕左侧安全线（NDC）。
   * @param leftNdc 左侧遮挡物的右缘；槽位左缘一律收在这条线右边。
   */
  setSafeAreaLeft(leftNdc: number): void {
    const v = Number.isFinite(leftNdc) ? Math.max(-0.95, Math.min(0.6, leftNdc)) : -0.95;
    if (Math.abs(v - this.safeLeft) < 1e-4) return;
    this.safeLeft = v;
    this.layoutDirty = true;
  }

  /** 当前右侧安全线（自检/单测用）。 */
  get safeArea(): number {
    return this.safeRight;
  }

  /** 当前左侧安全线（自检/单测用）。 */
  get safeAreaLeft(): number {
    return this.safeLeft;
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
    this.animateCrew(t);
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
    for (const c of this.crewParts) c.dispose(); // 人员实例缓冲（几何仍由 geo 统一释放）
    this.crewParts.length = 0;
    for (const tex of this.ownedTextures) tex.dispose(); // 静态贴图（斜纹/光圈/警示牌）
    this.ownedTextures.length = 0;
    for (const g of this.ownedGeometries) g.dispose();
    this.ownedGeometries.length = 0;
    for (const m of this.ownedMaterials) m.dispose();
    this.ownedMaterials.length = 0;
    this.group.clear();
  }
}
