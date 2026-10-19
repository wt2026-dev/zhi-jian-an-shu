/**
 * 设备 3D 场景引擎。
 *
 * 结构移植自「中国程序化城市生成器」src/scene.js 的 CityScene：
 *   initRenderer / initScene(PMREM 环境贴图 + 天空球) / initCamera /
 *   initLights / bindControls / build(params) 管线 / countTriangles /
 *   disposeGroup(共享几何体保护) / setView / onResize / update(阻尼相机)。
 *
 * 三处按项目实测做的适配（生成器用 three r160，本项目 npm 安装的是 0.186.0）：
 *   1) r186 中 `outputColorSpace` / `THREE.SRGBColorSpace` 仍然有效，沿用；
 *   2) `InstancedMesh.instanceColor` 需显式 `needsUpdate`，与 r160 行为一致；
 *   3) 指针事件改用 Pointer Events 统一鼠标与触摸，避免 r160 里 mouse+touch 双份监听。
 *   除此之外没有用到任何 r186 新增 API，因此升级/降级到 r160 也能跑。
 */

/**
 * ── scene.ts 拆解路线图（CameraRig 化进行中）─────────────────────────────
 * 本文件曾是 3200 行上帝类。拆解原则：每抽一个子系统，类方法退化为薄委托，
 * 既有调用方（含 Object.create 测试替身）零感知。进度：
 *
 *   ✅ cameraFraming.ts   取景数学纯函数（computeIsolatedFraming，带单测）
 *   ✅ deviceDetailEnv.ts 聚焦层工业环境（地面/立柱/管道/物料/工人/灯光）
 *   ✅ faultLocator.ts    故障定位标（红线框 + 减淡/恢复动画）
 *   ✅ sceneMinimap.ts    小地图绘制（drawSceneMinimap 纯函数）
 *   ✅ safetyBoundaries.ts 安全边界层（安全圈 + LOTO 罩 + 标签贴片；锚点由场景侧解析后传入）
 *   ⬜ CameraRig          orbit 状态 + 滚轮/双指 + userZoomRange + update() 相机段
 *                         （最大一块：this.orbit 在本文件被引用 ~40 处，需一次性机械替换）
 *   ⬜ FaultChainLayer    buildFaultChain/createFaultLabel/animateFaultPropagation
 *                         （测试替身 stub 了 createFaultLabel，需 labelFactory 注入）
 *   ⬜ WorkerFlowLayer    buildWorkers/animateWorkers（依赖 coordMap/trajectory）
 *   ⬜ FocusEnvironment   applyDeviceMood + DeviceDetailEnv 生命周期
 *                         （该区当前由另一会话活跃调参，等收敛后移动）
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SCENE_PRESETS, QUALITY, type ScenePreset, type QualityKey, type LayoutPattern } from './styles';
import { Hall, type DeviceSlot, type ShellMode } from './hall';
import {
  buildEquipment,
  type DeviceLike,
  type EquipmentBuild,
  type DeviceBoxInfo,
  type StatusLegendEntry,
  PROTOTYPE_BOUNDS,
  prototypeFor,
  STATUS_META,
  type StatusKey,
} from './equipment';
import { buildProps } from './props';
import { setGeoLod } from './parts';
import { clamp } from './rand';
import { FluidFlowSystem } from './fluidFlow';
import { telemetryToStatus } from './statusMapping';
import type { PartTelemetry } from './partEvidence';
import { ProductionLine, type DeviceAnchor, type ProductionLineOptions } from './productionLine';
import { WorkshopDetails, type DetailDeviceAnchor } from './workshopDetails';
import {
  FactoryOverview,
  defaultBuildingSpecs,
  type FactoryBuildingSpec,
  type FactoryZoneSpec,
  type FactoryZoneView,
  type FactoryRankMetric,
} from './factoryOverview';
import { FaultLocator, type FaultAnchor } from './faultLocator';
import { SafetyBoundaries, type SafetyAnchor } from './safetyBoundaries';
import { DeviceDetailEnv, type DeviceDetailEnvBox } from './deviceDetailEnv';
import { computeIsolatedFraming } from './cameraFraming';
import {
  FocusSceneDecor,
  type FocusDecorData,
  type FocusDecorBox,
} from './focusSceneDecor';
import { drawSceneMinimap } from './sceneMinimap';

/** 设备详情层暗调氛围：雾色 / 清屏色（深蓝灰，禁止纯黑背景）。 */
const FOG_COLOUR = 0x111b29;
/**
 * 线性雾。近端 12m 内全清晰，52m 处才完全融进背景 ——
 * 之前用 7/22 时车间壳体（30~50m）被整片糊成雾色，用户验收口径是
 * "背景不能是纯黑、要保留车间纵深感"，所以拉远；同时把雾色本身抬亮一档。
 */
const FOG_NEAR = 12;
const FOG_FAR = 52;
/**
 * 设备详情层的滚轮/双指拉远上限（米）：雾内仍能看清整个作业区，
 * 再远就会掉进雾外"一片黑"。只约束用户缩放，不约束自动取景
 * （窄窗口自适应取景必须能拉到 need，否则角点溢出画面）。
 */
const FOG_ZOOM_CAP = 17;
/**
 * 设备详情层「数据标注层」（测点气泡 / 五步闭环卡片 / 警示牌）开关。
 * ⚠️ 用户规格（场景密度优先）明确：3D 画面里不允许任何飘字，数据走右侧 DOM 面板，
 *    因此默认 false。并行工作流曾将其作为"硬要求"挂回 —— 冲突时以用户规格为准；
 *    恢复悬浮标注只需改为 true（buildFocusCallouts 基础设施保持完整）。
 */
// 「场景密度优先」口径默认不挂载数据标注层 —— 但支持两种**运行时**临时打开方式，
// 不需要改源码也不会和别的会话反复改这个常量：
//   ① URL 参数：`?focusCallouts=1` 或 `?focusCallouts=true`
//   ② 运行时调用：`window.__equipmentScene.setFocusCalloutsEnabled(true)`
// 这样探针可以一键验证「开关为 true 时的布局是否正确」，默认仍尊重"不飘字"规格。
let FOCUS_CALLOUTS_ENABLED = (() => {
  if (typeof window === 'undefined') return false;
  try {
    const v = new URLSearchParams(window.location.search).get('focusCallouts');
    if (v !== null) return v === '1' || v === 'true';
  } catch { /* ignore */ }
  return false;
})();

/**
 * 场景层级：厂区总览 → 车间生产线 → 单设备聚焦（对标参考视频 r1/r2/r3）。
 *   factory  多栋厂房建筑群，点击下钻
 *   workshop 车间内部：真实台账设备 + 机械臂产线 + 传送带
 *   device   单设备独占特写（等同既有 isolationId 生效态）
 */
export type SceneLevel = 'factory' | 'workshop' | 'device';

/** 统一拾取结果：分区地块 / 厂房 / 机械臂工作站 / 台账设备 四选一。 */
export type ScenePickResult =
  | { kind: 'device'; id: string; index: number }
  | { kind: 'building'; buildingId: string; name: string; workshopId: string }
  | { kind: 'zone'; zoneId: string; name: string }
  | { kind: 'station'; stationId: number; code: string; deviceId: string | null };

export type ViewKey = 'orbit' | 'overhead' | 'iso' | 'closeup';

export type WorkOrderIndicatorStatus = 'pending' | 'in_progress' | 'completed';

export interface SceneParams {
  presetId: string;
  seed: number;
  quality: QualityKey;
  /** 设备台数（来自真实台账，上限即台账条数） */
  deviceCount: number;
  layout: LayoutPattern;
  spacing: number;
  highlight: boolean;
  showGrid: boolean;
  /** 介质内部流动（冷却水/润滑油/气流） */
  fluidFlow?: boolean;
  /** 厂房外壳：完整 / 半透明（默认，保证能看到内部设备）/ 隐藏 */
  shell: ShellMode;
  /** 光照强度倍率（1 = 预设原始曝光），滑块调节 */
  exposure: number;
}

export interface SceneStats {
  triangles: number;
  devices: number;
  faults: number;
  alerts: number;
  drawCalls: number;
  buildMs: number;
  legend: StatusLegendEntry[];
  byPrototype: Record<string, number>;
  /** 处于动画激活态的零件实例数（running 旋转件 + 异常态指示灯 + 故障抖动件） */
  animated: number;
}

export const DEFAULT_PARAMS: SceneParams = {
  presetId: 'industrial',
  seed: 20240914,
  quality: 'medium',
  deviceCount: 16,
  layout: 'grid',
  spacing: 1,
  highlight: true,
  showGrid: true,
  fluidFlow: true,
  shell: 'ghost',
  exposure: 1,
};

export class EquipmentScene {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  params: SceneParams;

  root = new THREE.Group();
  private hallGroup = new THREE.Group();
  private equipGroup = new THREE.Group();
  private propsGroup = new THREE.Group();
  private helperGroup = new THREE.Group();
  private workOrderGroup = new THREE.Group();
  private safety = new SafetyBoundaries();
  private faultChainGroup = new THREE.Group();
  private workerGroup = new THREE.Group();
  /**
   * 派工指引虚线层（技师 → 故障设备）。
   *
   * 刻意与 workerGroup 分开：聚焦层按既定口径（有单测守护：聚焦时
   * workerGroup/safety.group 一律隐藏）整体隐藏 workerGroup —— 技师人形与历史
   * 轨迹属于车间层信息，进详情层会与"画面里只剩这一台"冲突。而"选中哪台设备，
   * 就看它相关的那条链路"要求这条虚线在聚焦层保留，所以单独成层，并且
   * **不进 applyIsolationChrome 的隐藏表**。生命周期仍与 workerGroup 一致：
   * buildWorkers / clearWorkers 里一起建、一起销毁，退出聚焦即清空。
   */
  private guideGroup = new THREE.Group();
  /** 厂区总览层（多栋厂房 + 道路） */
  private factoryGroup = new THREE.Group();
  /** 车间生产线层（机械臂工作站 + 传送带 + 物料箱 + 分区牌） */
  private lineGroup = new THREE.Group();
  /** 故障部位定位标 */
  private faultGroup = new THREE.Group();
  /** 故障呼吸灯：红色点光源，聚焦层按 0.8~1.2 呼吸（用户规格：动态效果不许静止） */
  private readonly faultGlow = new THREE.PointLight(0xff4d40, 0, 9, 2);
  /** 单设备聚焦层 · 检修作业现场（纯加法：进入聚焦层挂载，退出即整体卸载） */
  private focusDecorGroup = new THREE.Group();
  fluidFlow: FluidFlowSystem;

  // ---- 三级层级（厂区 / 车间 / 单设备）----
  factory: FactoryOverview | null = null;
  productionLine: ProductionLine | null = null;
  /** 车间环境细节层（贴花/仪表/灯柱/工具柜等，纯加法，与产线同生命周期） */
  workshopDetails: WorkshopDetails | null = null;
  /** 单设备聚焦层的工业环境（地面警戒线/立柱/屋架/管道/检修物料/工人/工作灯/聚光灯） */
  focusDecor: DeviceDetailEnv | null = null;
  /* ---- 单设备聚焦层 · 检修作业闭环数据标注（测点引线+气泡 / 五步闭环卡片 / 警示牌 / 扫描环）
     与 focusDecor 同生命周期，但**只画数据、不再重复画物理件**：地面警戒线、工具车、
     作业人员由 DeviceDetailEnv 负责，这里重复摆放会当场出现"两辆工具车/两组工人"。 ---- */
  private focusCalloutGroup = new THREE.Group();
  focusCallouts: FocusSceneDecor | null = null;
  /** 屏幕左右安全线（NDC）；callouts 每次重建都要带上，否则又回到默认 ±0.95 */
  private focusCalloutSafeRight = 0.95;
  private focusCalloutSafeLeft = -0.95;
  /** 设备详情层暗调氛围的灯光备份（进入聚焦时记录，退出还原）。 */
  private moodBackup: { ambient: number; hemi: number; sun: number; skyVisible: boolean } | null = null;
  /**
   * 聚焦层自有基础光（环境/半球/兜底补光）。刻意与 focusDecor 分开持有：
   * 环境层构造抛错时它依然存在，设备本体不会被留在纯黑里。
   */
  private focusBaseLights: {
    group: THREE.Group;
    amb: THREE.AmbientLight;
    hemi: THREE.HemisphereLight;
    fill: THREE.SpotLight;
  } | null = null;
  faultLocator: FaultLocator;
  level: SceneLevel = 'workshop';
  /** 当前下钻的厂房 id（null = 未选择） */
  activeBuildingId: string | null = null;
  /** 层级变化回调（HUD 用它联动面包屑与标题） */
  onLevelChange: ((level: SceneLevel, buildingId: string | null) => void) | null = null;
  /** 是否启用生产线（低配可关） */
  private lineEnabled = true;
  /** 生产线当前几何对应的厂房尺寸键，尺寸变了才重建 */
  private lineKey = '';

  // 工单状态指示环（共享几何体与红/黄/绿基础材质）
  private workOrderRingGeo: THREE.RingGeometry | null = null;
  private ringMatPending = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  private ringMatInProgress = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  private ringMatCompleted = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  private workOrderRings = new Map<string, { mesh: THREE.Mesh; status: WorkOrderIndicatorStatus; baseScale: number }>();
  private currentWorkOrderMap = new Map<string, WorkOrderIndicatorStatus>();

  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private ambient: THREE.AmbientLight | null = null;
  private ceilingLight: THREE.DirectionalLight | null = null;
  private windowSun: THREE.DirectionalLight | null = null;
  /** 车间巡检数字人工程师（在通道中巡检走动） */
  private patrolAvatar: {
    group: THREE.Group;
    body: THREE.Mesh;
    head: THREE.Mesh;
    leftLeg: THREE.Mesh;
    rightLeg: THREE.Mesh;
    leftArm: THREE.Mesh;
    rightArm: THREE.Mesh;
    pathIndex: number;
    progress: number;
  } | null = null;
  private skyMesh: THREE.Mesh | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envSource: THREE.Texture | null = null;
  /** PMREM 生成器必须复用：每次 new 都会重新分配内部材质并触发着色器重编译，
   *  在软件光栅化下单次可达 1.3 秒（实测），复用后仅首次付出该代价。 */
  private pmrem: THREE.PMREMGenerator | null = null;
  /** 环境贴图 / 天空球 / 阴影贴图 只与预设配色有关，用 id 做缓存键避免每次重建都重算 */
  private envKey: string | null = null;
  private skyKey: string | null = null;
  private shadowKey = 0;
  private skyGeo: THREE.SphereGeometry | null = null;
  private selectionRing: THREE.Mesh | null = null;
  private grid: THREE.GridHelper | null = null;
  /** 地面扫描线（P3 深色科技风） */
  private scanLine: THREE.Mesh | null = null;
  /** 漂浮背景粒子系统（科技感数字孪生，Draw Call: 1） */
  private bgParticles: THREE.Points | null = null;
  private particleSpeeds: Float32Array | null = null;
  private particlesPaused = false;


  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  /** 当前构建产物 */
  hall: Hall | null = null;
  slots: DeviceSlot[] = [];
  devices: DeviceLike[] = [];
  private picks: THREE.Object3D[] = [];
  private equipment: EquipmentBuild | null = null;
  private crane: THREE.Object3D | null = null;
  /** 行车小车（缓存引用：RAF 内逐帧 find 会产生闭包与遍历开销） */
  private trolley: THREE.Object3D | null = null;
  private craneRange = 0;
  private craneT = 0;

  selectedId: string | null = null;
  /** 独占模式：当前独占显示的设备 id（null = 总览，16 台同框） */
  isolationId: string | null = null;
  /** 由 framePreset 计算出的取景距离，视角预设复用 */
  private fitRadius = 120;
  private focusedId: string | null = null;
  private isolationVisibility = new Map<THREE.Object3D, boolean>();
  /** 场景累计时间（秒），驱动设备状态动画（旋转件 / 指示灯 / 抖动） */
  private animTime = 0;

  /** 构建缓存标记（切预设/改布局时复用设备几何） */
  private lastBuiltPresetId: string | null = null;
  private lastBuiltQuality: QualityKey | null = null;
  private lastBuiltDetail: number | null = null;
  private lastBuiltDeviceCount = 0;

  // ---- 小地图（移植自参考生成器的 minimap：俯视布局 + 相机指示） ----
  private miniCanvas: HTMLCanvasElement | null = null;
  private miniCtx: CanvasRenderingContext2D | null = null;
  private miniTimer = 0;
  private miniDir = new THREE.Vector3();
  /** 每个安装位对应的健康状态，用于小地图着色（来自真实台账） */
  private slotStatus: StatusKey[] = [];

  // ---- 相机轨道（自研，带阻尼） ----
  private orbit = {
    target: new THREE.Vector3(0, 6, 0),
    sTarget: new THREE.Vector3(0, 80, 0),
    theta: Math.PI * 0.72,
    sTheta: Math.PI * 0.72,
    phi: 0.95,
    sPhi: 0.36,
    radius: 130,
    sRadius: 280,
    minPhi: 0.06,
    maxPhi: 1.52,
    // 下限放到 4 米：单台特写需要贴近观察（原来 10 米对 3 米高的设备太远）
    minRadius: 3,
    maxRadius: 620,
  };

  private pointers = new Map<number, { x: number; y: number }>();
  private dragMode: 'none' | 'rotate' | 'pan' = 'none';
  private lastPointer = { x: 0, y: 0 };
  private pinchStart = 0;
  private pinchRadius = 0;

  /** 完工恢复的相机缓推：{t, r0} 计时还原轨道半径；null = 无进行中的推镜。 */
  private recoveryPush: { t: number; r0: number } | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private onWindowResize = () => this.resize();

  /* ---- 后处理辉光（UnrealBloom）----
   * high：全分辨率 bloom；medium：bloom 渲染目标减半；low / 软件渲染：不建 composer，直渲。
   * 阈值经实测定为 1.6（线性 HDR 域，见 applyPostProcessing 注释），
   * 让泛光只落在高亮爆点（扫描环、粒子、发光件）上，地面网格与暗部保持干净。 */
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private composerQuality: QualityKey | null = null;
  /* 护栏③探测态：phase=direct 时强制直渲采基线帧时，phase=bloom 走 composer。 */
  private bloomProbe: { phase: 'direct' | 'bloom'; direct: number[]; bloom: number[] } | null = null;
  private bloomStrengthCut = false;

  /* ---- 选中设备 emissive 高亮 ----
   * 设备主体材质跨台共享（instanceColor 管颜色），直接改 emissive 会点亮全场；
   * 所以选中时给该台的 Mesh 克隆一份带蓝光的材质，取消选中即还原并 dispose。
   * 蓝色系（0x1e3a5f）与故障红标形成"选中蓝 / 故障红"的语义区分。 */
  private selEmissiveBackup = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private selEmissiveClones = new Map<THREE.Material, THREE.Material>();

  private rafId = 0;
  private lastTime = 0;
  private running = false;
  private frameTimes: number[] = [];
  private fps = 0;
  private dirty = true;

  /** 帧回调（用于 HUD 刷新） */
  onFrame: ((fps: number) => void) | null = null;

  constructor(container: HTMLElement, params: SceneParams) {
    this.container = container;
    this.params = { ...params };

    const q = QUALITY[params.quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: q.aa,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = q.shadows;
    // three r186 已移除 PCFSoftShadowMap 的实现（保留常量但会告警并回退），
    // 这里直接使用 PCFShadowMap，避免控制台出现 "has been removed" 警告。
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-label', '设备三维场景画布');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.6, 2600);
    this.scene.add(this.root);
    this.fluidFlow = new FluidFlowSystem();
    this.faultLocator = new FaultLocator();
    this.faultGroup.add(this.faultLocator.group);
    this.root.add(
      this.hallGroup,
      this.equipGroup,
      this.propsGroup,
      this.helperGroup,
      this.workOrderGroup,
      this.safety.group,
      this.faultChainGroup,
      this.workerGroup,
      this.guideGroup,
      this.factoryGroup,
      this.lineGroup,
      this.faultGroup,
      this.faultGlow,
      this.focusDecorGroup,
      this.focusCalloutGroup,
      this.fluidFlow.points
    );

    this.initLights();
    this.initHelpers();
    this.initSelectionRing();
    this.initWorkOrderRings();
    this.bindControls();

    this.resize();
    this.applyPostProcessing();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    window.addEventListener('resize', this.onWindowResize);
  }

  /* ========================= 光照 ========================= */

  private initLights(): void {
    this.ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.hemi = new THREE.HemisphereLight(0xe5eef7, 0x566270, 0.85);
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
    this.sun.position.set(80, 130, 60);
    this.sun.castShadow = true;

    // 天花板主吊灯垂直补充光照（高位下射，车间明亮均匀无死角）
    this.ceilingLight = new THREE.DirectionalLight(0xfffaed, 1.1);
    this.ceilingLight.position.set(0, 50, 0);

    // 侧窗倾斜射入的暖阳自然光照（穿透落地玻璃窗）
    this.windowSun = new THREE.DirectionalLight(0xffeedd, 1.5);
    this.windowSun.position.set(-75, 26, 8);
    this.windowSun.target.position.set(0, 0, 0);

    this.scene.add(
      this.ambient,
      this.hemi,
      this.sun,
      this.sun.target,
      this.ceilingLight,
      this.windowSun,
      this.windowSun.target
    );
  }

  private applyLighting(preset: ScenePreset): void {
    const l = preset.lighting;
    if (this.ambient) {
      this.ambient.color.setHex(preset.palette.light.ambient);
      this.ambient.intensity = Math.max(0.7, l.ambient * 1.25);
    }
    if (this.hemi) {
      this.hemi.color.setHex(preset.palette.light.hemi);
      this.hemi.groundColor.setHex(preset.palette.floor).multiplyScalar(0.5);
      this.hemi.intensity = Math.max(0.65, l.ambient * 1.05);
    }
    if (this.sun) {
      this.sun.color.setHex(preset.palette.light.sun);
      this.sun.intensity = l.sun;
      const a = 0.9;
      this.sun.position.set(Math.cos(a) * 160, l.sunHeight, Math.sin(a) * 160);
      this.sun.target.position.set(0, 0, 0);
      this.sun.target.updateMatrixWorld();
    }
    if (this.ceilingLight) {
      this.ceilingLight.intensity = this.level === 'factory' ? 0.2 : 1.1;
    }
    if (this.windowSun) {
      this.windowSun.intensity = this.level === 'factory' ? 0.2 : 1.5;
    }
    this.renderer.toneMappingExposure = Math.max(1.15, l.exposure * (this.params.exposure || 1));
    this.scene.fog = new THREE.FogExp2(preset.palette.fog, l.fogDensity);
    this.scene.background = new THREE.Color(preset.palette.sky);
  }

  /**
   * 环境贴图：用一张渐变 + 太阳光斑的小画布生成 PMREM —— 没有它金属会渲染成纯黑。
   *
   * 性能要点：PMREM 会渲染一整套 cubemap mip 链，在软件光栅化（SwiftShader）下
   * 单次就要几百毫秒，是「拖动滑块重建」耗时的主要来源。而它只取决于预设配色，
   * 因此按预设 id 缓存，重建时若预设未变直接复用。
   */
  private updateEnvMap(preset: ScenePreset, presetId: string): void {
    if (this.envRT && this.envKey === presetId) return;
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const top = new THREE.Color(preset.palette.sky);
    const bot = new THREE.Color(preset.palette.floor).multiplyScalar(0.75);
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, `#${top.getHexString()}`);
    grad.addColorStop(0.55, `#${top.clone().lerp(bot, 0.45).getHexString()}`);
    grad.addColorStop(1, `#${bot.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    // 太阳光斑
    const sun = new THREE.Color(preset.palette.light.sun);
    const sg = ctx.createRadialGradient(size * 0.28, size * 0.26, 1, size * 0.28, size * 0.26, size * 0.26);
    sg.addColorStop(0, `#${sun.getHexString()}`);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = this.pmrem.fromEquirectangular(tex);
    this.scene.environment = rt.texture;
    // 0.68：比原 0.62 略抬一档，金属设备反射更"实"（PBR 环境光是金属质感的主光源），
    // 再高会让钢壳过亮发假；渐变 PMREM 保持，不引入外部 HDRI（包体积 + 软渲染风险）。
    this.scene.environmentIntensity = 0.68;
    tex.dispose();
    this.envRT?.dispose();
    this.envSource?.dispose();
    this.envRT = rt;
    this.envSource = null;
    this.envKey = presetId;
  }

  /** 天空球：ShaderMaterial 渐变，BackSide + depthWrite false。同样按预设缓存。 */
  private updateSky(preset: ScenePreset, presetId: string): void {
    if (this.skyMesh && this.skyKey === presetId) return;
    if (this.skyMesh) {
      this.scene.remove(this.skyMesh);
      (this.skyMesh.material as THREE.Material).dispose();
      this.skyMesh = null;
    }
    const uniforms = {
      uTop: { value: new THREE.Color(preset.palette.sky) },
      uMid: { value: new THREE.Color(preset.palette.fog) },
      uBottom: { value: new THREE.Color(preset.palette.floor).multiplyScalar(0.55) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uBottom;
        varying vec3 vWorld;
        void main() {
          vec3 d = normalize(vWorld);
          float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(uBottom, uMid, smoothstep(0.0, 0.52, t));
          c = mix(c, uTop, smoothstep(0.48, 1.0, t));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    // 天空球几何体固定，跨重建复用，避免重复分配与首次渲染的着色器重编译
    if (!this.skyGeo) this.skyGeo = new THREE.SphereGeometry(1400, 24, 16);
    const mesh = new THREE.Mesh(this.skyGeo, mat);
    mesh.name = 'sky';
    mesh.frustumCulled = false;
    this.skyMesh = mesh;
    this.skyKey = presetId;
    this.scene.add(mesh);
  }

  private initHelpers(): void {
    this.grid = new THREE.GridHelper(100, 40, 0x22d3ee, 0x197697);
    const gm = this.grid.material as THREE.Material | THREE.Material[];
    const list = Array.isArray(gm) ? gm : [gm];
    for (const m of list) {
      m.transparent = true;
      m.opacity = 0.3;
      m.depthWrite = false;
      m.toneMapped = false;
    }
    this.grid.position.y = 0.035;
    this.grid.visible = this.params.showGrid;
    this.helperGroup.add(this.grid);

    // 扫描线：沿 X 往复推进的一条发光窄带（深色科技风），随车间层显隐
    const scan = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 90),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    scan.rotation.x = -Math.PI / 2;
    scan.position.y = 0.06;
    scan.renderOrder = 3;
    scan.name = 'scanLine';
    this.scanLine = scan;
    this.helperGroup.add(scan);

    // 漂浮粒子层：80-120个漂浮粒子（THREE.Points，y∈[0,8]，缓慢上浮循环，size 0.035，颜色 0x22d3ee，透明度 0.35，Draw Call: 1）
    const pCount = 100;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    const pSpeeds = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 70;
      pPos[i * 3 + 1] = Math.random() * 8;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      pSpeeds[i] = 0.2 + Math.random() * 0.4;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0x22d3ee,
      size: 0.035,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const pts = new THREE.Points(pGeo, pMat);
    pts.name = 'bgParticles';
    pts.renderOrder = 2;
    this.bgParticles = pts;
    this.particleSpeeds = pSpeeds;
    this.helperGroup.add(pts);
  }

  /** 扫描线与网格呼吸及粒子漂浮：低开销，仅在可见时更新。 */
  private animateChrome(t: number, dt = 0.016): void {
    // 地面网格呼吸
    if (this.grid && this.grid.visible) {
      const gm = this.grid.material as THREE.Material | THREE.Material[];
      const list = Array.isArray(gm) ? gm : [gm];
      const base = 0.3;
      for (const m of list) m.opacity = base + (Math.sin(t * 1.15) * 0.5 + 0.5) * 0.14;
    }
    // 扫描线往复
    if (this.scanLine && this.scanLine.visible) {
      const halfX = this.hall?.bounds.halfX ?? 27;
      const period = 14;
      const phase = ((t % period) / period) * 2 - 1; // -1 → 1
      this.scanLine.position.x = phase * halfX;
      const m = this.scanLine.material as THREE.MeshBasicMaterial;
      m.opacity = 0.1 + (1 - Math.abs(phase)) * 0.12;
    }
    // 漂浮粒子上浮循环（Draw Call: 1，暂停动画时不推进）
    if (this.bgParticles && this.bgParticles.visible && !this.particlesPaused && this.particleSpeeds) {
      const posAttr = this.bgParticles.geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const count = arr.length / 3;
      for (let i = 0; i < count; i++) {
        arr[i * 3 + 1] += this.particleSpeeds[i] * dt;
        if (arr[i * 3 + 1] > 8) {
          arr[i * 3 + 1] = 0.05;
        }
      }
      posAttr.needsUpdate = true;
    }
  }


  private initSelectionRing(): void {
    const geo = new THREE.RingGeometry(0.92, 1.0, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.visible = false;
    ring.name = 'selectionRing';
    this.selectionRing = ring;
    this.helperGroup.add(ring);
  }

  private initWorkOrderRings(): void {
    const geo = new THREE.RingGeometry(0.85, 1.0, 48);
    geo.rotateX(-Math.PI / 2);
    geo.userData.shared = true;
    this.workOrderRingGeo = geo;
  }

  /**
   * 设置工单状态指示环（设备级）
   * 映射表：equipmentId -> 'pending' | 'in_progress' | 'completed'
   */
  setWorkOrderIndicators(deviceStatusMap: Map<string, WorkOrderIndicatorStatus>): void {
    this.currentWorkOrderMap = new Map(deviceStatusMap);
    this.rebuildWorkOrderRings();
  }

  /**
   * 重建工单状态指示环实例
   */
  private rebuildWorkOrderRings(): void {
    while (this.workOrderGroup.children.length > 0) {
      const child = this.workOrderGroup.children[0];
      this.workOrderGroup.remove(child);
    }
    this.workOrderRings.clear();

    if (!this.equipment || !this.hall || !this.workOrderRingGeo) return;

    this.currentWorkOrderMap.forEach((status, id) => {
      const idx = this.equipment?.indexById.get(id);
      if (typeof idx !== 'number' || !this.slots[idx]) return;

      const slot = this.slots[idx];
      const y = this.hall ? this.hall.reliefAt(slot.x, slot.z) : 0;

      let mat: THREE.MeshBasicMaterial;
      if (status === 'pending') {
        mat = this.ringMatPending;
      } else if (status === 'in_progress') {
        mat = this.ringMatInProgress;
      } else {
        mat = this.ringMatCompleted;
      }

      const mesh = new THREE.Mesh(this.workOrderRingGeo!, mat);
      mesh.position.set(slot.x, y + 0.05, slot.z);
      const baseScale = slot.radius * 2.25;
      mesh.scale.setScalar(baseScale);
      mesh.name = `workOrderRing_${id}`;
      this.workOrderGroup.add(mesh);
      this.workOrderRings.set(id, { mesh, status, baseScale });
    });
  }

  /**
   * 工单指示环脉冲动画（整合进已有 RAF 动画循环中）
   */
  private animateWorkOrderRings(time: number): void {
    if (this.workOrderRings.size === 0) return;

    // 呼吸灯正弦波动：待检修(红)较快，检修中(黄)节奏更慢，已完成(绿)常亮
    const pendingPulse = Math.sin(time * 3.5);
    const inProgressPulse = Math.sin(time * 1.8);

    // 动态调整透明度（幅度克制，不刺眼）
    this.ringMatPending.opacity = 0.55 + 0.35 * pendingPulse;
    this.ringMatInProgress.opacity = 0.6 + 0.3 * inProgressPulse;
    this.ringMatCompleted.opacity = 0.85;

    const pendingScaleMult = 1.0 + 0.08 * pendingPulse;
    const progScaleMult = 1.0 + 0.05 * inProgressPulse;

    this.workOrderRings.forEach(({ mesh, status, baseScale }) => {
      if (status === 'pending') {
        mesh.scale.setScalar(baseScale * pendingScaleMult);
      } else if (status === 'in_progress') {
        mesh.scale.setScalar(baseScale * progScaleMult);
      } else {
        mesh.scale.setScalar(baseScale);
      }
    });
  }

  /* ========================= 安全边界可视化 ========================= */

  /**
   * 安全边界数据（由 React 层从 API 拉取后传入，3D 层只消费不访问网络）
   */
  /**
   * 构建安全边界3D：安全圈 + 能量隔离罩。
   * 由 React 层在 API 数据就绪后调用（非阻塞，不防抖）。
   * 场景侧只负责把设备 id 解析成世界坐标锚点，网格生成/销毁在 safetyBoundaries 模块。
   */
  buildSafetyBoundaries(data: Map<string, { permits: any[]; locks: any[] }>): void {
    const anchors = new Map<string, SafetyAnchor>();
    const boxById = this.equipment?.boxById;
    if (this.hall && boxById) {
      for (const eqId of data.keys()) {
        const idx = this.equipment?.indexById.get(eqId);
        if (typeof idx !== 'number' || !this.slots[idx]) continue;
        const slot = this.slots[idx];
        const box = boxById.get(eqId);
        anchors.set(eqId, {
          x: slot.x,
          y: this.hall.reliefAt(slot.x, slot.z),
          z: slot.z,
          phase: idx,
          h: box?.h,
          w: box?.w,
          d: box?.d,
        });
      }
    }
    this.safety.build(data, anchors);
  }

  /** 安全边界动画（合并进现有 RAF 循环） */
  animateSafetyBoundaries(time: number): void {
    this.safety.animate(time);
  }

  /** 安全边界显隐开关 */
  setSafetyBoundaryVisible(visible: boolean): void {
    this.setChromeVisible(this.safety.group, visible);
  }

  /* ========================= 故障传播链 ========================= */

  /** 故障链节点定义 */
  private faultChainNodes: THREE.Object3D[] = [];
  /** 故障链连线 + 动画 */
  private faultChainLines: Array<{
    mesh: THREE.Line;
    mat: THREE.LineBasicMaterial;
    flowMat: THREE.MeshBasicMaterial;
  }> = [];
  /** 故障链文字贴片 */
  private faultChainLabels: THREE.Object3D[] = [];


  /**
   * 构建故障传播链3D。
   * React 层在 API 数据就绪后调用（非阻塞，不防抖）。
   * @param eqId 选中设备 id
   * @param telemetryPoints 最近48h 遥测点
   * @param orders 该设备工单列表
   */
  buildFaultChain(
    eqId: string,
    telemetryPoints: Array<{ temperature?: number; vibration?: number; pressure?: number; current?: number; loadRate?: number }> | null,
    orders: Array<{ priority?: string; status?: string }> | null,
  ): void {
    this.disposeGroup(this.faultChainGroup);
    this.faultChainNodes = [];
    this.faultChainLines = [];
    this.faultChainLabels = [];
    if (!this.equipment || !this.hall) return;

    const idx = this.equipment.indexById.get(eqId);
    if (typeof idx !== 'number' || !this.slots[idx]) return;
    const slot = this.slots[idx];
    const y = this.hall.reliefAt(slot.x, slot.z);
    const box = this.equipment.boxById.get(eqId);
    if (!box) return;

    // 取最近一个遥测点判断超限项
    const tp = telemetryPoints && telemetryPoints.length > 0 ? telemetryPoints[telemetryPoints.length - 1] : null;
    if (!tp) return;
    const nodeData: Array<{ text: string; color: number }> = [];
    const metrics = [
      ['temperature', '温度', '°C'],
      ['vibration', '振动', 'mm/s'],
      ['loadRate', '负载', '%'],
    ] as const;
    for (const [key, label, unit] of metrics) {
      const value = tp[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const severity = telemetryToStatus({ [key]: value });
      if (severity) nodeData.push({ text: `观测：${label} ${value}${unit}`, color: severity === 'warning' ? 0xf59e0b : 0xef4444 });
    }
    if (nodeData.length === 0) return;
    // 观测声明：这些是真实读数的标注，不是已证实的部件级故障结论，也不互相连线。
    nodeData.push({ text: '超阈读数观测 · 非部件故障结论', color: 0x94a3b8 });

    const boxH = box.h;
    const baseX = box.centerX ?? slot.x;
    const baseY = (box.centerY ?? y + boxH + 0.8) + boxH / 2;
    const baseZ = box.centerZ ?? slot.z;
    const spacing = 1.6;
    const offsetX = 2.2; // 设备侧向偏移
    const angleStep = nodeData.length > 1 ? Math.PI / (nodeData.length * 2 + 2) : 0;

    for (let i = 0; i < nodeData.length; i++) {
      const nd = nodeData[i];
      const angle = -Math.PI / 4 + angleStep * (i + 1);
      const nx = baseX + offsetX + i * spacing * Math.cos(angle);
      const ny = baseY + i * 0.6;
      const nz = baseZ + Math.sin(angle) * 0.4;

      // 文字标签（深色底板 + 彩色边线 + canvas 贴图，复用安全标签方案）
      const label = this.createFaultLabel(nd.text, nd.color, 0.88, 0.24);
      label.position.set(nx, ny, nz);
      label.name = `fault-observation:${eqId}:${i}`;
      this.faultChainGroup.add(label);
      this.faultChainLabels.push(label);
    }
  }

  /** 创建故障链标签（深色底板 + 彩色边线 + canvas 文字） */
  private createFaultLabel(text: string, accentColor: number, w: number, h: number): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'fault-label';

    const bgGeo = new THREE.PlaneGeometry(w, h);
    bgGeo.userData.shared = true;
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a, transparent: true, opacity: 0.92,
      side: THREE.DoubleSide, toneMapped: false,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.rotation.x = -Math.PI / 4;
    group.add(bg);

    const borderGeo = new THREE.PlaneGeometry(w * 1.02, h * 0.06);
    borderGeo.userData.shared = true;
    const borderMat = new THREE.MeshBasicMaterial({
      color: accentColor, side: THREE.DoubleSide, toneMapped: false,
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.set(0, h * 0.45, 0.001);
    border.rotation.x = -Math.PI / 4;
    group.add(border);

    if (typeof document !== 'undefined') {
      const cw = Math.round(w * 256);
      const ch = Math.round(h * 256);
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#e8eef5';
        ctx.font = `bold ${Math.round(ch * 0.4)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cw / 2, ch / 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        const texGeo = new THREE.PlaneGeometry(w * 0.96, h * 0.78);
        texGeo.userData.shared = true;
        const texMat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false,
        });
        const texMesh = new THREE.Mesh(texGeo, texMat);
        texMesh.position.set(0, 0, 0.002);
        texMesh.rotation.x = -Math.PI / 4;
        group.add(texMesh);
      }
    }
    return group;
  }

  /** 故障传播链动画（合并进现有 RAF 循环） */
  animateFaultPropagation(time: number): void {
    if (this.faultChainLines.length === 0) return;

    for (let i = 0; i < this.faultChainLines.length; i++) {
      const { mat, flowMat } = this.faultChainLines[i];

      // 连线脉冲：透明度随正弦波波动
      mat.opacity = 0.45 + 0.35 * Math.sin(time * 3.0 + i * 1.2);

      // 流动粒子：在连线段内循环前进
      const t = (time * 0.5 + i * 0.35) % 1.0;
      flowMat.opacity = 0.5 + 0.4 * Math.sin(time * 4.0 + i * 2.0);
      // flow 位置由 nodePositions 插值驱动——因为节点位置不变，这里用脉冲透明度模拟流动
    }

    // 节点脉冲（呼吸灯效果）
    for (let i = 0; i < this.faultChainNodes.length; i++) {
      const node = this.faultChainNodes[i] as THREE.Mesh;
      const mat = node.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.65 + 0.3 * Math.sin(time * 2.5 + i * 0.8);
      const s = 1.0 + 0.12 * Math.sin(time * 2.5 + i * 0.8);
      node.scale.setScalar(s);
    }
  }

  /** 故障链显隐（拆解/独占联动） */
  setFaultChainVisible(visible: boolean): void {
    this.faultChainGroup.visible = visible;
  }

  /** 清空故障链（选中设备切换或退出时调用） */
  clearFaultChain(): void {
    this.disposeGroup(this.faultChainGroup);
    this.faultChainNodes = [];
    this.faultChainLines = [];
    this.faultChainLabels = [];
  }

  /* ========================= 人员与工位动线 ========================= */

  /** 每个技师的3D人形 + 轨迹 + 标签 */
  private workerMeshes: Map<string, {
    group: THREE.Group;
    body: THREE.Mesh;
    head: THREE.Mesh;
    label: THREE.Object3D;
    trail: THREE.Line | null;
    trailMat: THREE.LineBasicMaterial;
  }> = new Map();

  /** 技师到设备的指引虚线（仅选中设备且有 assignee 时显示） */
  private guideLine: THREE.Line | null = null;
  private guideLineMat: THREE.LineDashedMaterial | null = null;
  /** 指引线目标技师 id */
  private guideTargetId: string | null = null;

  /** 地图坐标映射缓存：DB 0–1000 → 3D 场景坐标 */
  private mapScaleX = 1;
  private mapScaleZ = 1;
  private mapOffsetX = 0;
  private mapOffsetZ = 0;

  /**
   * 建立地图坐标映射：用 dispatch API 的设备坐标与3D slot 位置求线性映射。
   * 由 React 层在拿到 equipmentPoints 后调用。
   */
  setCoordMap(equipmentPoints: Array<{ id: string; mapX: number; mapY: number }>): void {
    if (!this.equipment || equipmentPoints.length === 0) return;
    const xs: number[] = [];
    const zs: number[] = [];
    const mxs: number[] = [];
    const mys: number[] = [];
    for (const ep of equipmentPoints) {
      const idx = this.equipment.indexById.get(ep.id);
      if (typeof idx !== 'number' || !this.slots[idx]) continue;
      const s = this.slots[idx];
      xs.push(s.x);
      zs.push(s.z);
      mxs.push(ep.mapX);
      mys.push(ep.mapY);
    }
    if (xs.length < 2) return;
    // 最小二乘线性回归：sceneX = a * mapX + b, sceneZ = c * mapY + d
    const n = xs.length;
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    const sumXY = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
    const meanX = sum(mxs) / n;
    const meanZ = sum(mys) / n;
    const meanSx = sum(xs) / n;
    const meanSz = sum(zs) / n;
    const denomX = sumXY(mxs, mxs) - n * meanX * meanX;
    const denomZ = sumXY(mys, mys) - n * meanX * meanX;
    this.mapScaleX = denomX !== 0 ? (sumXY(mxs, xs) - n * meanX * meanSx) / denomX : 1;
    this.mapOffsetX = meanSx - this.mapScaleX * meanX;
    this.mapScaleZ = denomZ !== 0 ? (sumXY(mys, zs) - n * meanZ * meanSz) / denomZ : 1;
    this.mapOffsetZ = meanSz - this.mapScaleZ * meanZ;
  }

  /** DB 坐标 (mapX 0–1000, mapY 0–1000) → 3D 场景坐标 (x, z) */
  mapToScene(mapX: number, mapY: number): { x: number; z: number } {
    return {
      x: this.mapScaleX * mapX + this.mapOffsetX,
      z: this.mapScaleZ * mapY + this.mapOffsetZ,
    };
  }

  /**
   * 构建技师人形 + 轨迹 + 指引线。
   * 由 React 层在 API 数据就绪后调用（防抖由 React 层控制，3D 层只消费不访问网络）。
   * @param technicians 技师列表（dispatchApi.listTechnicians 返回）
   * @param trajectories 轨迹缓存（Map<userId, {mapX,mapY}[]>）
   * @param selectedEqId 当前选中设备 id（用于指引线）
   * @param assigneeId 当前选中设备工单的 assignee 技师 id
   * @param assigneeStatus 工单状态（决定指引线颜色）
   */
  buildWorkers(
    technicians: Array<{
      id: string;
      name: string;
      onlineStatus: 'online' | 'idle' | 'offline';
      mapX: number;
      mapY: number;
    }>,
    trajectories: Map<string, Array<{ mapX: number; mapY: number }>>,
    selectedEqId: string | null = null,
    assigneeId: string | null = null,
    assigneeStatus: string | null = null,
  ): void {
    this.disposeGroup(this.workerGroup);
    if (this.guideGroup) this.disposeGroup(this.guideGroup);
    this.workerMeshes.clear();
    this.guideLine = null;
    this.guideLineMat = null;
    this.guideTargetId = null;
    if (!this.hall || !this.equipment) return;

    const isIsolation = this.isolationId !== null;

    for (const tech of technicians) {
      // 独占模式：只显示与选中设备相关的技师
      if (isIsolation && tech.id !== assigneeId) continue;

      const pos = this.mapToScene(tech.mapX, tech.mapY);
      const y = this.hall.reliefAt(pos.x, pos.z);

      // 在线状态颜色
      const isOnline = tech.onlineStatus === 'online';
      const isIdle = tech.onlineStatus === 'idle';
      const bodyColor = isOnline ? 0x3b82f6 : isIdle ? 0x94a3b8 : 0x64748b;
      const opacity = tech.onlineStatus === 'offline' ? 0.4 : 0.9;

      // 创建人形组
      const group = new THREE.Group();
      group.name = `worker:${tech.id}`;

      // 身体（胶囊体简化为圆柱 + 两端半球）
      const bodyGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.7, 8);
      bodyGeo.userData.shared = true;
      const bodyMat = new THREE.MeshStandardMaterial({
        color: bodyColor, transparent: true, opacity,
        roughness: 0.6, metalness: 0.2, toneMapped: false,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.55;
      group.add(body);

      // 头部
      const headGeo = new THREE.SphereGeometry(0.16, 8, 6);
      headGeo.userData.shared = true;
      const headMat = new THREE.MeshStandardMaterial({
        color: bodyColor, transparent: true, opacity,
        roughness: 0.5, metalness: 0.1, toneMapped: false,
      });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 1.08;
      group.add(head);

      // 姓名标签（头顶悬浮）
      const label = this.createWorkerLabel(tech.name, bodyColor, 0.72, 0.2);
      label.position.set(0, 1.4, 0);
      group.add(label);

      group.position.set(pos.x, y, pos.z);
      this.workerGroup.add(group);

      // 轨迹线
      const traj = trajectories.get(tech.id);
      let trail: THREE.Line | null = null;
      const trailMat = new THREE.LineBasicMaterial({
        color: 0x3b82f6, transparent: true, opacity: 0.35,
        toneMapped: false, depthWrite: false,
      });
      if (traj && traj.length >= 2) {
        const pts = traj.map((p) => {
          const sp = this.mapToScene(p.mapX, p.mapY);
          return new THREE.Vector3(sp.x, this.hall!.reliefAt(sp.x, sp.z) + 0.05, sp.z);
        });
        const trailGeo = new THREE.BufferGeometry().setFromPoints(pts);
        trailGeo.userData.shared = true;
        trail = new THREE.Line(trailGeo, trailMat);
        trail.name = `trail:${tech.id}`;
        this.workerGroup.add(trail);

        // 轨迹节点小球
        for (const p of pts) {
          const dotGeo = new THREE.SphereGeometry(0.04, 4, 3);
          dotGeo.userData.shared = true;
          const dotMat = new THREE.MeshBasicMaterial({
            color: 0x3b82f6, transparent: true, opacity: 0.5, toneMapped: false,
          });
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(p);
          this.workerGroup.add(dot);
        }
      }

      this.workerMeshes.set(tech.id, { group, body, head, label, trail, trailMat });
    }

    // 指引虚线：选中设备有 assignee 时显示
    if (selectedEqId && assigneeId) {
      const techData = technicians.find((t) => t.id === assigneeId);
      if (techData) {
        const techPos = this.mapToScene(techData.mapX, techData.mapY);
        const techY = this.hall.reliefAt(techPos.x, techPos.z);
        const eqIdx = this.equipment.indexById.get(selectedEqId);
        if (typeof eqIdx === 'number' && this.slots[eqIdx]) {
          const s = this.slots[eqIdx];
          const eqY = this.hall.reliefAt(s.x, s.z);
          const guideGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(techPos.x, techY + 1.2, techPos.z),
            new THREE.Vector3(s.x, eqY + 0.5, s.z),
          ]);
          guideGeo.userData.shared = true;
          // 工单完成/待验收 → 绿色，否则蓝色
          const guideColor = (assigneeStatus === 'completed' || assigneeStatus === 'pending_acceptance')
            ? 0x22c55e : 0x3b82f6;
          this.guideLineMat = new THREE.LineDashedMaterial({
            color: guideColor, transparent: true, opacity: 0.7,
            dashSize: 0.3, gapSize: 0.15,
            toneMapped: false, depthWrite: false,
          });
          this.guideLine = new THREE.Line(guideGeo, this.guideLineMat);
          this.guideLine.computeLineDistances();
          this.guideLine.name = `guide:${assigneeId}`;
          // 挂 guideGroup 而不是 workerGroup：聚焦层要保留这条虚线（见字段注释）
          this.guideGroup.add(this.guideLine);
          this.guideTargetId = assigneeId;

          // 高亮该技师人形
          const wm = this.workerMeshes.get(assigneeId);
          if (wm) {
            (wm.body.material as THREE.MeshStandardMaterial).color.set(0xfbbf24);
            (wm.head.material as THREE.MeshStandardMaterial).color.set(0xfbbf24);
          }
        }
      }
    }
  }

  /** 创建工人姓名标签（深色底板 + 彩色边线 + canvas 文字） */
  private createWorkerLabel(name: string, accentColor: number, w: number, h: number): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'worker-label';

    const bgGeo = new THREE.PlaneGeometry(w, h);
    bgGeo.userData.shared = true;
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a, transparent: true, opacity: 0.88,
      side: THREE.DoubleSide, toneMapped: false,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.rotation.x = -Math.PI / 4;
    group.add(bg);

    const borderGeo = new THREE.PlaneGeometry(w * 1.02, h * 0.06);
    borderGeo.userData.shared = true;
    const borderMat = new THREE.MeshBasicMaterial({
      color: accentColor, side: THREE.DoubleSide, toneMapped: false,
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.set(0, h * 0.45, 0.001);
    border.rotation.x = -Math.PI / 4;
    group.add(border);

    if (typeof document !== 'undefined') {
      const cw = Math.round(w * 256);
      const ch = Math.round(h * 256);
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#e8eef5';
        ctx.font = `bold ${Math.round(ch * 0.4)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, cw / 2, ch / 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        const texGeo = new THREE.PlaneGeometry(w * 0.96, h * 0.78);
        texGeo.userData.shared = true;
        const texMat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false,
        });
        const texMesh = new THREE.Mesh(texGeo, texMat);
        texMesh.position.set(0, 0, 0.002);
        texMesh.rotation.x = -Math.PI / 4;
        group.add(texMesh);
      }
    }
    return group;
  }

  /** 初始化或获取车间内自主走动巡检工程师数字人 */
  private ensurePatrolWorker(): void {
    if (this.patrolAvatar) return;
    const group = new THREE.Group();
    group.name = 'patrol_engineer_avatar';

    const blueSuit = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.6, metalness: 0.1 });
    const vestYellow = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4, metalness: 0.2 });
    const darkPants = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, metalness: 0.1 });
    const safetyHelmet = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3, metalness: 0.3 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffd1b3, roughness: 0.5, metalness: 0.05 });

    // 躯干（蓝色工装 + 反光背心）
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.65, 8), blueSuit);
    body.position.y = 0.95;
    group.add(body);
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.21, 0.38, 8), vestYellow);
    vest.position.y = 0.98;
    group.add(vest);

    // 头部 + 安全帽
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), skinMat);
    head.position.y = 1.42;
    group.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), safetyHelmet);
    helmet.position.y = 1.46;
    group.add(helmet);
    const helmetBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 10), safetyHelmet);
    helmetBrim.position.set(0, 1.44, 0.04);
    group.add(helmetBrim);

    // 双腿（可摆动）
    const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.65, 6), darkPants);
    leftLeg.geometry.translate(0, -0.32, 0);
    leftLeg.position.set(-0.11, 0.65, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.65, 6), darkPants);
    rightLeg.geometry.translate(0, -0.32, 0);
    rightLeg.position.set(0.11, 0.65, 0);
    group.add(rightLeg);

    // 双臂（可摆动）
    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.55, 6), blueSuit);
    leftArm.geometry.translate(0, -0.27, 0);
    leftArm.position.set(-0.28, 1.22, 0);
    group.add(leftArm);

    const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.55, 6), blueSuit);
    rightArm.geometry.translate(0, -0.27, 0);
    rightArm.position.set(0.28, 1.22, 0);
    group.add(rightArm);

    // 巡检员头顶标牌
    const tag = this.createWorkerLabel('巡检工程师 · 张伟 [巡检中]', 0x22d3ee, 1.35, 0.24);
    tag.position.set(0, 1.78, 0);
    group.add(tag);

    group.position.set(-14, 0, -6);
    this.workerGroup.add(group);

    this.patrolAvatar = {
      group,
      body,
      head,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      pathIndex: 0,
      progress: 0,
    };
  }

  /** 人员动画：数字人在车间安全通道持续巡检走动 + 迈步摆臂 */
  animateWorkers(time: number, dt = 0.016): void {
    // 确保巡检数字人存在
    if (!this.patrolAvatar && this.level !== 'factory') {
      this.ensurePatrolWorker();
    }

    if (this.patrolAvatar && this.workerGroup.visible) {
      const p = this.patrolAvatar;
      const waypoints = [
        { x: -16, z: -6 },
        { x: 16, z: -6 },
        { x: 16, z: 6 },
        { x: -16, z: 6 },
      ];
      const p0 = waypoints[p.pathIndex];
      const nextIdx = (p.pathIndex + 1) % waypoints.length;
      const p1 = waypoints[nextIdx];
      const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);

      // 巡检移速 2.4 m/s
      const speed = 2.4;
      p.progress += (speed * dt) / Math.max(1, dist);
      if (p.progress >= 1) {
        p.progress = 0;
        p.pathIndex = nextIdx;
      }

      const curX = p0.x + (p1.x - p0.x) * p.progress;
      const curZ = p0.z + (p1.z - p0.z) * p.progress;
      const gy = this.hall ? this.hall.reliefAt(curX, curZ) : 0;
      const targetAng = Math.atan2(p1.x - p0.x, p1.z - p0.z);

      p.group.position.set(curX, gy + Math.abs(Math.sin(time * 6.5)) * 0.04, curZ);
      p.group.rotation.y = targetAng;

      // 双腿双臂前后正弦交替摆动
      const legSwing = Math.sin(time * 6.5) * 0.45;
      p.leftLeg.rotation.x = legSwing;
      p.rightLeg.rotation.x = -legSwing;
      p.leftArm.rotation.x = -legSwing * 0.85;
      p.rightArm.rotation.x = legSwing * 0.85;
    }

    // 既有人形呼吸灯
    this.workerMeshes.forEach((wm) => {
      const s = 1.0 + 0.04 * Math.sin(time * 2.0);
      wm.body.scale.setScalar(s);
      wm.head.scale.setScalar(s);
    });
    // 指引虚线脉冲
    if (this.guideLineMat) {
      this.guideLineMat.opacity = 0.45 + 0.35 * Math.sin(time * 3.0);
    }
  }

  /**
   * 人员动线显隐开关（HUD「可视化图层」里的"技师轨迹与指引线"）。
   *
   * 技师人形 / 历史轨迹跟随总开关；**派工指引虚线例外** —— 聚焦层里只要
   * 选中了设备就保留（需求：选中哪台设备就看它相关的那条链路），
   * 车间层没有选中设备时它本来也不存在。
   */
  setWorkerVisible(visible: boolean): void {
    this.setChromeVisible(this.workerGroup, visible);
    // if 兜底：既有单测用 Object.create(prototype) 构造精简实例，可能没有这一层。
    if (this.guideGroup) this.guideGroup.visible = visible || this.isolationId !== null;
  }

  /** 清空人员动线与派工指引虚线 */
  clearWorkers(): void {
    this.disposeGroup(this.workerGroup);
    if (this.guideGroup) this.disposeGroup(this.guideGroup);
    this.workerMeshes.clear();
    // 巡检数字人也挂在 workerGroup 下，连同被 dispose —— 不清引用的话
    // animateWorkers 会一直动画一个已经脱离场景的 group，数字人再也不回来。
    this.patrolAvatar = null;
    this.guideLine = null;
    this.guideLineMat = null;
    this.guideTargetId = null;
  }

  /* ========================= 交互 ========================= */

  private bindControls(): void {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', this.onContextMenu);
    el.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    el.addEventListener('pointermove', this.onPointerMove, { passive: true });
    el.addEventListener('pointerup', this.onPointerUp, { passive: true });
    el.addEventListener('pointercancel', this.onPointerUp, { passive: true });
    el.addEventListener('pointerleave', this.onPointerUp, { passive: true });
    // wheel 必须非 passive，否则无法 preventDefault（参考实现同样处理）
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onContextMenu = (e: Event): void => {
    // 右键用于平移，必须屏蔽系统菜单
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    // setPointerCapture 在合成事件（自动化/远程调试注入）下可能抛 NotFoundError，
    // 捕获失败不影响旋转/平移，因此这里必须容错，否则整个交互会中断。
    try {
      this.renderer.domElement.setPointerCapture?.(e.pointerId);
    } catch {
      /* 忽略：无活动指针时无法捕获 */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      // 左键旋转 / 右键或中键平移（与生成器一致）
      this.dragMode = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'rotate';
      this.lastPointer = { x: e.clientX, y: e.clientY };
    } else if (this.pointers.size === 2) {
      this.dragMode = 'none';
      const [a, b] = Array.from(this.pointers.values());
      this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchRadius = this.orbit.radius;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStart > 0) {
        const k = this.pinchStart / Math.max(1, d);
        const pzr = this.userZoomRange();
        this.orbit.radius = clamp(this.pinchRadius * k, pzr.min, pzr.max);
      }
      return;
    }
    if (this.dragMode === 'none') return;

    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };

    if (this.dragMode === 'rotate') {
      this.orbit.theta -= dx * 0.0042;
      this.orbit.phi = clamp(this.orbit.phi - dy * 0.0034, this.orbit.minPhi, this.orbit.maxPhi);
    } else {
      // 平移：沿相机右向量 / 前向量在水平面移动
      const scale = this.orbit.radius * 0.0016;
      const sin = Math.sin(this.orbit.sTheta);
      const cos = Math.cos(this.orbit.sTheta);
      this.orbit.target.x -= (cos * dx - sin * dy * 0.6) * scale;
      this.orbit.target.z += (sin * dx + cos * dy * 0.6) * scale;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.dragMode = 'none';
      this.pinchStart = 0;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const k = Math.exp(clamp(e.deltaY, -220, 220) * 0.0012);
    const zr = this.userZoomRange();
    this.orbit.radius = clamp(this.orbit.radius * k, zr.min, zr.max);
  };

  /**
   * 用户缩放（滚轮/双指）的有效区间（仅设备详情层）：
   *   - 下限 ≥ 包围盒最长边 × 1.2 —— 防止缩过头把镜头怼回设备脸上；
   *   - 上限封顶在雾可见范围内 —— 拉远可看整个作业区，但不掉进雾外黑屏。
   * 自动取景（frameIsolated）不受此区间约束，保证任意纵横比都能正确框住设备。
   */
  private userZoomRange(): { min: number; max: number } {
    if (this.isolationId && this.scene.fog) {
      const box = this.equipment?.boxById.get(this.isolationId);
      const longest = box ? Math.max(box.w, box.h, box.d) : 0;
      return {
        min: Math.max(this.orbit.minRadius, longest * 1.2),
        max: Math.min(this.orbit.maxRadius, FOG_ZOOM_CAP),
      };
    }
    return { min: this.orbit.minRadius, max: this.orbit.maxRadius };
  }

  /* ========================= 尺寸 ========================= */

  resize(): void {
    const w = Math.max(1, this.container.clientWidth || 1);
    const h = Math.max(1, this.container.clientHeight || 1);
    const q = QUALITY[this.params.quality];
    // 渲染开销控制：流畅档严格限制为 1.0，均衡档 1.25，精细档 1.5
    const maxPr = this.params.quality === 'low' ? 1.0 : this.params.quality === 'medium' ? 1.25 : 1.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPr));
    this.renderer.setSize(w, h, false);
    const aspectChanged = this.camera.aspect !== w / h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const box = this.focusedId ? this.equipment?.boxById.get(this.focusedId) : null;
    if (aspectChanged && box) this.frameIsolated(box, true);
    this.syncComposerSize();
    this.dirty = true;
  }

  /* ========================= 后处理辉光 ========================= */

  /**
   * 软件渲染检测：SwiftShader/llvmpipe 下 bloom 的 mip 链每帧要几百毫秒
   * （本项目 PMREM 在软渲染下就有前科），检测到即整体回退直渲。
   */
  private isSoftwareRenderer(): boolean {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|llvmpipe|software|basic render/i.test(name);
    } catch {
      return false;
    }
  }

  /** 按画质档创建/重建 bloom 链；low 档与软件渲染保持直渲。幂等，可在 build() 里放心调。 */
  private applyPostProcessing(): void {
    const want = this.params.quality !== 'low' && !this.isSoftwareRenderer();
    if (!want) {
      this.disposeComposer();
      return;
    }
    if (this.composer && this.composerQuality === this.params.quality) return;
    this.disposeComposer();
    const w = Math.max(1, this.container.clientWidth || 1);
    const h = Math.max(1, this.container.clientHeight || 1);
    const pr = this.renderer.getPixelRatio();
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // ⚠️ threshold 实测取 1.6 而非资料常见的 0.8~0.9：RenderPass 输出到 HalfFloat RT，
    // bloom 工作在**色调映射前的线性 HDR 域**，本项目白色机身（0xe9eef3 + sun1.2 + 环境 0.68）
    // 线性亮度 ≈1.2~1.5，0.85 时整机糊成白团（截图对比见 scratch/bloom-th-*.png）。
    // 1.6 只放过高光爆点、加性混合的扫描环/粒子/发光件，地面网格与暗部保持干净。
    const bloom = new UnrealBloomPass(new THREE.Vector2(w * pr, h * pr), 0.55, 0.4, 1.6);
    composer.addPass(bloom);
    // OutputPass 放最后：RenderPass 渲染到 RT 时材质跳过色调映射，由它统一做
    // ACES 曝光 + sRGB 输出，一次完成、不重复。
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloomPass = bloom;
    this.composerQuality = this.params.quality;
    this.syncComposerSize();
    this.startBloomProbe();
  }

  private syncComposerSize(): void {
    if (!this.composer) return;
    const w = Math.max(1, this.container.clientWidth || 1);
    const h = Math.max(1, this.container.clientHeight || 1);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    // 均衡档 bloom 分辨率减半（性能护栏①）：composer.setSize 刚把 bloom 重置为
    // 全尺寸，这里再传一半的有效像素尺寸（UnrealBloomPass 内部还会再 /2 建 mip）。
    if (this.bloomPass && this.composerQuality === 'medium') {
      const pr = this.renderer.getPixelRatio();
      this.bloomPass.setSize(Math.round((w * pr) / 2), Math.round((h * pr) / 2));
    }
  }

  /** 每次新建 bloom 链都跑一轮两阶段探测（各 30 帧），量化 bloom 的相对开销。 */
  private startBloomProbe(): void {
    this.bloomProbe = { phase: 'direct', direct: [], bloom: [] };
  }

  /**
   * 性能护栏③：比较两阶段的平均"渲染调用耗时"。composer 期超过直渲期 1/0.7 倍
   * （即 FPS 掉 30% 以上）→ 第一步 bloom 强度减半 + threshold 上调一档并复测；
   * 复测仍超标 → 拆掉整链回直渲。"不允许好看但卡"。
   */
  private sampleBloomProbe(renderMs: number): void {
    const p = this.bloomProbe;
    if (!p) return;
    if (!this.composer || !this.bloomPass) {
      this.bloomProbe = null;
      return;
    }
    if (p.phase === 'direct') {
      p.direct.push(renderMs);
      if (p.direct.length >= 30) p.phase = 'bloom';
      return;
    }
    p.bloom.push(renderMs);
    if (p.bloom.length < 30) return;
    this.bloomProbe = null;
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const tDirect = Math.max(0.5, avg(p.direct));
    if (avg(p.bloom) <= tDirect / 0.7) return;
    if (!this.bloomStrengthCut) {
      this.bloomStrengthCut = true;
      this.bloomPass.strength *= 0.5;
      this.bloomPass.threshold += 0.4;
      this.startBloomProbe();
    } else {
      this.disposeComposer();
    }
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.composerQuality = null;
    this.bloomProbe = null;
  }

  /* ========================= 构建管线 ========================= */

  /**
   * 重建管线：
   * 1. 预设切换通道：设备几何零重建，仅换厂房地坪/光照/环境贴图/道具，设备更新位置与材质色（耗时 < 30ms）
   * 2. 布局重排增量通道：不重建几何，仅更新实例矩阵与包围盒（耗时 < 15ms）
   * 3. 全量构建通道：仅在画质档切换或设备台账变化时执行完整构件生成
   */
  build(params: SceneParams, devices: DeviceLike[]): SceneStats {
    const t0 = performance.now();
    // 旧设备组即将销毁：先还原选中克隆材质并释放，避免克隆泄漏
    this.applySelectionEmissive(null);
    const prevParams = { ...this.params };
    this.params = { ...params };
    // 重建会替换 hall/props 子对象，先按记录恢复显隐，避免旧引用残留到恢复表里
    this.applyIsolationChrome(false);
    const preset = SCENE_PRESETS[params.presetId] ?? SCENE_PRESETS.standard;
    const q = QUALITY[params.quality];
    let detail: number = q.detail;
    setGeoLod(detail);

    const count = Math.max(1, Math.min(params.deviceCount, devices.length));
    const targetDevices = devices.slice(0, count);

    // 生产线启用时设备必须沿墙布置：grid / ring 布局会把设备摆到中轴
    // （实测 grid 16 台时设备落在 z≈±3.7），与传送带（z≈0）和机械臂（z≈±4.15）穿模。
    const layoutForSlots: LayoutPattern = this.lineEnabled ? 'wall' : params.layout;

    // 判断是否可复用设备几何缓存（切预设 / 增量改布局，禁止重建设备几何）
    const canReuseEquipment =
      this.equipment !== null &&
      this.equipGroup.children.length > 0 &&
      this.lastBuiltQuality === params.quality &&
      this.lastBuiltDetail === q.detail &&
      this.lastBuiltDeviceCount === count &&
      this.devices.length === count &&
      this.devices.every((d, i) => d.id === targetDevices[i]?.id);

    const isPresetSwitchOnly =
      canReuseEquipment &&
      prevParams.presetId !== params.presetId &&
      prevParams.quality === params.quality &&
      prevParams.deviceCount === params.deviceCount;

    const isLayoutRearrangeOnly =
      canReuseEquipment &&
      !isPresetSwitchOnly &&
      prevParams.presetId === params.presetId &&
      prevParams.quality === params.quality &&
      prevParams.deviceCount === params.deviceCount &&
      (prevParams.spacing !== params.spacing || prevParams.layout !== params.layout || prevParams.seed !== params.seed);

    this.applyLighting(preset);
    this.updateEnvMap(preset, params.presetId);
    this.updateSky(preset, params.presetId);
    this.renderer.shadowMap.enabled = q.shadows;
    if (this.sun) {
      const span = Math.max(preset.hall.spanX, preset.hall.spanZ) * 1.15;
      if (this.shadowKey !== q.shadowMap) {
        this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        if (this.sun.shadow.map) {
          this.sun.shadow.map.dispose();
          this.sun.shadow.map = null;
        }
        this.shadowKey = q.shadowMap;
      }
      const cam = this.sun.shadow.camera;
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.near = 1;
      cam.far = 520;
      cam.updateProjectionMatrix();
    }

    if (isPresetSwitchOnly) {
      // 预设切换通道：设备几何零重建，仅换厂房环境层
      this.disposeGroup(this.hallGroup);
      this.disposeGroup(this.propsGroup);

      const hall = new Hall(preset, { seed: params.seed, spacing: params.spacing, highlight: params.highlight, quality: params.quality }, params.seed);
      hall.setFloorResolution(q.floorRes, Math.round((q.floorRes * 3) / 4));
      this.hall = hall;
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: preset.floor.roughness,
        metalness: 0.04,
        vertexColors: true,
      });
      const floor = hall.buildFloor(floorMat);
      this.hallGroup.add(floor);
      const apron = hall.buildApron(floorMat);
      this.hallGroup.add(apron);

      const slots = hall.layout(count, layoutForSlots, params.spacing, preset.morphology.equipmentScale);
      this.slots = slots;
      this.devices = targetDevices;

      this.hallGroup.add(hall.buildLanes(slots));
      const structure = hall.buildStructure(params.shell);
      this.hallGroup.add(structure);
      const bridge = structure.getObjectByName('craneBridge');
      this.crane = bridge ?? null;
      this.craneRange = bridge?.userData?.craneRange ?? 0;
      this.craneT = 0;
      this.trolley = bridge?.children.find((c) => c.type === 'Mesh' && c.position.y === -1.4) ?? null;
      this.hallGroup.add(hall.buildPipeRacks(slots));

      // 仅更新设备位置与材质调色板，耗时 < 1ms
      this.equipment?.updatePresetPalette?.(preset);
      this.equipment?.updateTransforms?.(slots, (x, z) => hall.reliefAt(x, z), preset.morphology.equipmentScale);

      const props = buildProps({
        preset,
        hall,
        slots,
        devices: this.devices,
        seed: params.seed,
        shadows: q.shadows,
        detail,
        equipmentScale: preset.morphology.equipmentScale,
      });
      this.propsGroup.add(props.group);

      this.lastBuiltPresetId = params.presetId;
    } else if (isLayoutRearrangeOnly) {
      // 布局重排增量通道：不重建设备几何，仅重排实例位置
      this.disposeGroup(this.propsGroup);
      const hall = this.hall!;
      const slots = hall.layout(count, layoutForSlots, params.spacing, preset.morphology.equipmentScale);
      this.slots = slots;
      this.devices = targetDevices;

      // 重新对齐设备位置
      this.equipment?.updateTransforms?.(slots, (x, z) => hall.reliefAt(x, z), preset.morphology.equipmentScale);
      this.fluidFlow.updateSlots(slots, this.devices, (x, z) => hall.reliefAt(x, z), preset.morphology.equipmentScale);

      const props = buildProps({
        preset,
        hall,
        slots,
        devices: this.devices,
        seed: params.seed,
        shadows: q.shadows,
        detail,
        equipmentScale: preset.morphology.equipmentScale,
      });
      this.propsGroup.add(props.group);
    } else {
      // 全量构建通道（画质档改变 / 首次加载 / 设备清单变化）
      this.disposeGroup(this.hallGroup);
      this.disposeGroup(this.equipGroup);
      this.disposeGroup(this.propsGroup);

      const hall = new Hall(preset, { seed: params.seed, spacing: params.spacing, highlight: params.highlight, quality: params.quality }, params.seed);
      hall.setFloorResolution(q.floorRes, Math.round((q.floorRes * 3) / 4));
      this.hall = hall;
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: preset.floor.roughness,
        metalness: 0.04,
        vertexColors: true,
      });
      const floor = hall.buildFloor(floorMat);
      this.hallGroup.add(floor);
      const apron = hall.buildApron(floorMat);
      this.hallGroup.add(apron);

      const slots = hall.layout(count, layoutForSlots, params.spacing, preset.morphology.equipmentScale);
      this.slots = slots;
      this.devices = targetDevices;

      this.hallGroup.add(hall.buildLanes(slots));
      const structure = hall.buildStructure(params.shell);
      this.hallGroup.add(structure);
      const bridge = structure.getObjectByName('craneBridge');
      this.crane = bridge ?? null;
      this.craneRange = bridge?.userData?.craneRange ?? 0;
      this.craneT = 0;
      this.trolley = bridge?.children.find((c) => c.type === 'Mesh' && c.position.y === -1.4) ?? null;
      this.hallGroup.add(hall.buildPipeRacks(slots));

      let equipment: EquipmentBuild;
      for (let guard = 0; ; guard++) {
        this.disposeGroup(this.equipGroup);
        this.disposeGroup(this.propsGroup);

        equipment = buildEquipment({
          preset,
          hall,
          slots,
          devices: this.devices,
          seed: params.seed,
          highlight: params.highlight,
          shadows: q.shadows,
          detail,
          equipmentScale: preset.morphology.equipmentScale,
        });
        this.equipGroup.add(equipment.group);

        const props = buildProps({
          preset,
          hall,
          slots,
          devices: this.devices,
          seed: params.seed,
          shadows: q.shadows,
          detail,
          equipmentScale: preset.morphology.equipmentScale,
        });
        this.propsGroup.add(props.group);

        const triCount = this.countTriangles();
        if (triCount <= q.maxTriangles || detail <= 0 || guard >= 2) break;
        detail -= 1;
        setGeoLod(detail);
      }

      this.equipment = equipment;
      this.picks = equipment.picks;
      this.lastBuiltPresetId = params.presetId;
      this.lastBuiltQuality = params.quality;
      this.lastBuiltDetail = q.detail;
      this.lastBuiltDeviceCount = count;
    }

    const triangles = this.countTriangles();
    this.resize();
    // 画质档可能在此切换（low↔medium/high），幂等重建 bloom 链
    this.applyPostProcessing();

    this.slotStatus = [];
    for (const p of this.picks) {
      const idx = p.userData?.slotIndex;
      if (typeof idx === 'number') this.slotStatus[idx] = (p.userData?.status as StatusKey) || 'nodata';
    }

    // 车间生产线 + 异常警示浮标：依赖 slotStatus（真实状态），故必须排在其后。
    // 只在厂房尺寸/站数变化时重建几何，其余情况仅刷新绑定与浮标。
    if (this.lineEnabled) {
      const hb = this.hall?.bounds;
      const key = `${Math.round(hb?.halfX ?? 0)}x${Math.round(hb?.halfZ ?? 0)}x${this.params.presetId}`;
      if (!this.productionLine || key !== this.lineKey) {
        this.lineKey = key;
        this.buildProductionLine();
      } else {
        this.bindStationsToDevices();
        this.refreshFaultFloats();
      }
    }

    this.drawMinimap();

    if (this.grid) {
      // 独占模式下参考网格保持隐藏（保持设备下方是干净展示台）
      this.grid.visible = params.showGrid && this.isolationId === null;
      this.grid.scale.setScalar(Math.max(1, preset.hall.spanX / 100));
    }

    this.framePreset(preset, this.hall!);
    // 重建后恢复独占状态：换画质 / 预设 / 布局不应把用户踢出独占模式。
    // 若该设备已不存在（例如调小了设备数），则安全退出独占。
    if (this.isolationId && !this.setIsolation(this.isolationId)) {
      this.isolationId = null;
    }
    this.refreshSelection();
    this.rebuildWorkOrderRings();
    this.fluidFlow.updateSlots(this.slots, this.devices, (x, z) => this.hall ? this.hall.reliefAt(x, z) : 0, preset.morphology.equipmentScale);
    this.fluidFlow.setVisible(params.fluidFlow ?? true);

    this.dirty = true;
    return {
      triangles,
      devices: this.devices.length,
      faults: this.equipment ? this.equipment.faultCount : 0,
      alerts: this.equipment ? this.equipment.alertCount : 0,
      drawCalls: this.countDrawables(),
      buildMs: Math.round((performance.now() - t0) * 10) / 10,
      legend: this.equipment ? this.equipment.legend : [],
      byPrototype: this.equipment ? this.equipment.byPrototype : {},
      animated: this.equipment ? this.equipment.animatedCount : 0,
    };
  }

  /** 仅调整渲染参数，不重建几何体（滑块拖动时的即时反馈路径）。 */
  quickApply(params: SceneParams): void {
    const preset = SCENE_PRESETS[params.presetId];
    this.params = { ...params };
    if (preset) this.renderer.toneMappingExposure = preset.lighting.exposure * (params.exposure || 1);
    // 独占模式下参考网格保持隐藏，避免与"干净展示台"冲突
    if (this.grid) this.grid.visible = params.showGrid && this.isolationId === null;
    if (this.fluidFlow) this.fluidFlow.setVisible(params.fluidFlow ?? true);
    this.resize();
  }

  /**
   * 依据厂房实际包围盒与当前相机 FOV/aspect 计算取景距离。
   *
   * 为什么不用「包围球 / sin(fov/2)」：本场景是扁而宽的厂房，包围球半径会被
   * 水平跨度撑大，导致垂直方向严重留白（实测原预设距离 118 时厂房只占画面 15%）。
   * 这里分别求水平、垂直两个方向所需距离取较大者。
   */
  private fitDistance(hall: Hall, preset: ScenePreset): number {
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.4, this.camera.aspect));
    const halfW = Math.hypot(hall.bounds.halfX, hall.bounds.halfZ) * 0.86;
    const halfH = Math.max(6, hall.structureHeight) * 0.5;
    const dH = halfW / Math.tan(hHalf);
    const dV = halfH / Math.tan(vHalf);
    // 预设 distance 退化为取景倍率（120 ≈ 1.0），保留各预设"想更近/更远"的意图
    const k = clamp(preset.camera.distance / 120, 0.8, 1.4);
    return Math.max(dH, dV) * 1.3 * k;
  }

  private framePreset(preset: ScenePreset, hall: Hall): void {
    const c = preset.camera;
    const o = this.orbit;
    this.focusedId = null;
    o.minRadius = 3;
    o.maxRadius = 620;
    this.fitRadius = this.fitDistance(hall, preset);
    o.target.set(0, Math.max(3, hall.structureHeight * 0.3), 0);
    o.sTarget.copy(o.target);
    o.radius = clamp(this.fitRadius, o.minRadius, o.maxRadius);
    o.sRadius = o.radius;
    o.theta = Math.PI * 0.72;
    o.sTheta = o.theta;
    o.phi = clamp(1.52 - c.tilt * 0.9, o.minPhi, o.maxPhi);
    o.sPhi = o.phi;
  }

  /* ========================= 视角预设 ========================= */

  setView(view: ViewKey, focusIndex?: number): void {
    const o = this.orbit;
    const hall = this.hall;
    if (!hall) return;
    const focusId = this.isolationId ?? (view === 'closeup' && typeof focusIndex === 'number' ? this.devices[focusIndex]?.id : null);
    if (focusId && this.focusDevice(focusId)) {
      if (view === 'overhead' || view === 'iso') {
        o.phi = view === 'overhead' ? 0.14 : 0.86;
        o.theta = view === 'overhead' ? Math.PI * 0.5 : Math.PI * 0.25;
        this.frameIsolated(this.equipment!.boxById.get(focusId)!, true);
      }
      return;
    }
    this.focusedId = null;
    o.minRadius = 3;
    o.maxRadius = 620;
    const fit = this.fitRadius || Math.max(hall.bounds.halfX, hall.bounds.halfZ) * 2;

    if (view === 'overhead') {
      o.phi = 0.14;
      o.theta = Math.PI * 0.5;
      o.radius = clamp(fit * 0.86, o.minRadius, o.maxRadius);
      o.target.set(0, 0, 0);
    } else if (view === 'iso') {
      o.phi = 0.86;
      o.theta = Math.PI * 0.25;
      o.radius = clamp(fit * 0.92, o.minRadius, o.maxRadius);
      o.target.set(0, Math.max(3, hall.structureHeight * 0.28), 0);
    } else if (view === 'closeup' && typeof focusIndex === 'number' && this.slots[focusIndex]) {
      const s = this.slots[focusIndex];
      const box = this.equipment?.boxById.get(this.devices[focusIndex]?.id ?? '');
      const h = box?.h ?? PROTOTYPE_BOUNDS[prototypeFor(this.devices[focusIndex] ?? {})].h;
      o.target.set(s.x, h * 0.45, s.z);
      o.phi = 1.06;
      // 绕到设备正面的四分之三视角（配方铭牌贴在设备 +Z 面，这样能看到编号）
      o.theta = s.angle + 0.6;
      const w = box?.w ?? PROTOTYPE_BOUNDS[prototypeFor(this.devices[focusIndex] ?? {})].w;
      const d = box?.d ?? PROTOTYPE_BOUNDS[prototypeFor(this.devices[focusIndex] ?? {})].d;
      o.radius = clamp(Math.max(w, d) * 1.5 + h * 0.9 + 2, o.minRadius, o.maxRadius);
    } else {
      const c = SCENE_PRESETS[this.params.presetId]?.camera;
      o.phi = clamp(1.52 - (c?.tilt ?? 0.6) * 0.9, o.minPhi, o.maxPhi);
      o.theta = Math.PI * 0.72;
      o.radius = clamp(fit, o.minRadius, o.maxRadius);
      o.target.set(0, Math.max(3, hall.structureHeight * 0.3), 0);
    }
    this.dirty = true;
  }

  /* ========================= 单台聚焦 ========================= */

  /**
   * 平滑聚焦到单台设备（点击设备时调用）。
   *
   * 与 setView 的区别：setView 是"视角预设"（俯视/等轴/特写），
   * 这里只改**目标值**，由 update() 里那套指数阻尼插值过去 ——
   * 因此表现是"镜头推近"而不是"画面跳转"，与参考生成器切换城市时的手感一致。
   *
   * 取景距离来自配方包围盒（boxById）：5# 是 9 米长的多级泵、14# 是 4 米长的电机，
   * 用统一的原型尺寸会让前者穿帮、后者过远。
   */
  /**
   * @param targetY 可选取景中心高度（对准故障部位时传故障点 y）。
   *                不传即按包围盒中心取景（整机居中）。
   */
  focusDevice(id: string, targetY?: number): boolean {
    const eq = this.equipment;
    const hall = this.hall;
    if (!eq || !hall) return false;
    const box = eq.boxById.get(id);
    if (!box) return false;
    this.focusedId = id;
    this.frameIsolated(box, false, targetY);
    return true;
  }

  /** 退出单台聚焦，回到预设的整体取景。 */
  resetFocus(): void {
    if (!this.hall) return;
    this.setView('orbit');
  }

  /* ========================= 单设备独占模式 ========================= */

  /**
   * 进入 / 退出单设备独占模式。
   *
   * 与 focusDevice 的区别：
   *   focusDevice 只把镜头推近，其余 15 台仍在画面里，取景偏远
   *   （设备仅占画面约 1/3，用户反馈"太小"）。
   *   独占模式把其余 15 台 —— 连同它们的地面光环与告警光柱 —— 全部隐藏，
   *   并按相机 FOV 反解距离，让该设备占满画面约 75%，画面里只剩它一台。
   *
   * @param id 设备 id；传 null 退出独占，恢复 16 台 + 总览取景。
   * @param targetY 可选取景中心高度（对准故障部位时传故障点 y）。
   * @returns 是否成功；id 不存在时返回 false，调用方据此回退到普通聚焦。
   */
  setIsolation(id: string | null, targetY?: number): boolean {
    const eq = this.equipment;
    if (!eq) return false;

    if (id === null) {
      if (this.isolationId !== null) {
        eq.showAllDevices();
        // 离开设备详情层：还原文字铭牌（车间/总览层允许铭牌）
        eq.setNameplateVisible?.(this.isolationId, true);
        this.isolationId = null;
        this.fluidFlow?.setIsolation(null);
        // 退出聚焦层：检修作业现场整体卸载，绝不残留到车间/总览层
        this.disposeFocusDecor();
        this.disposeFocusCallouts();
        this.applyIsolationChrome(false);
        this.resetFocus();
        this.level = 'workshop';
        this.applyFocusLevelVisibility();
        this.onLevelChange?.('workshop', this.activeBuildingId);
      }
      return true;
    }

    const box = eq.boxById.get(id);
    if (!box) return false;

    this.level = 'device';
    eq.showOnlyDevice(id);
    // 铭牌是贴在设备顶部的 canvas 文字牌 —— 聚焦层同样属于"3D 上飘字"，
    // 退出独占时由 setIsolation(null) 那条路径还原。
    eq.setNameplateVisible?.(id, false);
    this.isolationId = id;
    this.focusedId = id;
    this.fluidFlow?.setIsolation(id);
    this.applyFocusLevelVisibility();
    this.applyIsolationChrome(true);
    this.frameIsolated(box, false, targetY);
    // 挂载检修作业现场（警戒带 / 人员 / 工具车 / 警示牌 / 扫描环）
    this.buildFocusDecor(box);
    // 挂载检修作业闭环的数据标注（测点引线+气泡 / 五步闭环卡片 / 警示牌 / 扫描环）
    // 「场景密度优先」口径（用户规格）：3D 画面里不飘任何文字/气泡/卡片，
    // 数据全部由右侧 DOM 面板承担 —— 数据标注层默认不挂载。
    if (FOCUS_CALLOUTS_ENABLED) this.buildFocusCallouts(box);
    this.onLevelChange?.('device', this.activeBuildingId);
    return true;
  }

  /**
   * 聚焦层的设备/厂厅显隐复位。
   *
   * equipGroup 与 hallGroup 归层级状态机管（厂区总览下两者隐藏）。而"在厂区层
   * 直接用设备下拉框进入详情"这条路径不经过 enterWorkshopLevel()，没有人为它们
   * 恢复可见 —— 实测聚焦画面里设备 0 个 draw call、地面消失、整屏纯黑。
   * 只复位这两组，其余 chrome 仍由 applyIsolationChrome 的恢复表负责。
   */
  private applyFocusLevelVisibility(): void {
    const show = this.level !== 'factory';
    if (this.equipGroup) this.equipGroup.visible = show;
    if (this.hallGroup) this.hallGroup.visible = show;
    // 产线层由层级派生，不进 applyIsolationChrome 的恢复表：
    // 从厂区层直接用下拉框进详情时，进聚焦那一刻它是 false，按恢复表还原
    // 会让退出聚焦回到车间层后产线永远不再出现。
    if (this.lineGroup) this.lineGroup.visible = this.lineLayerVisible;
  }

  /** Keep the floor, but mask unrelated helpers without overwriting their requested visibility. */
  private applyIsolationChrome(on: boolean): void {
    if (on) {
      // 厂区层属于"非本设备"内容，聚焦时一并隐藏；产线层改由 applyFocusLevelVisibility
      // 按层级派生（进恢复表会让"厂区层→详情→退出"后车间层再也看不到产线）。
      // filter(Boolean)：既有单测用 Object.create(prototype) 构造精简实例，
      // 未定义这两个新增 group，直接 push 会把 undefined 混进数组并在下方 .visible 处炸掉。
      const objects = [this.propsGroup, this.workerGroup, this.workOrderGroup, this.safety.group, this.helperGroup,
        this.factoryGroup,
        ...this.hallGroup.children.filter(object => object.name !== 'floor' && object.name !== 'apron')]
        .filter((o): o is THREE.Object3D => !!o);
      for (const object of objects) {
        if (!this.isolationVisibility.has(object)) this.isolationVisibility.set(object, object.visible);
        object.visible = false;
      }
    } else {
      for (const [object, visible] of this.isolationVisibility) object.visible = visible;
      this.isolationVisibility.clear();
    }
    if (this.grid) this.grid.visible = !on && this.params.showGrid;
  }

  private setChromeVisible(group: THREE.Object3D, visible: boolean): void {
    if (this.isolationId !== null) {
      this.isolationVisibility.set(group, visible);
      group.visible = false;
    } else group.visible = visible;
  }

  /**
   * 独占取景：反解相机距离，让设备包围盒在画面里占约 75%。
   *
   * 为什么不是简单的 `d = h / (2·FILL·tan(fov/2))`：
   * 那个公式假设「屏幕竖直方向只由设备高度决定」，只有在相机水平正视时才成立。
   * 本场景的相机是俯视的（phi≈1.0，仰角约 33°），于是**设备的长度也会"倒"进
   * 屏幕竖直方向** —— 一台 2.4 米高、5.5 米长的减速机，投影后竖直方向要占
   * 1.55 个屏高（实测），按老公式算出来的距离会让它上下都被裁掉。
   *
   * 现在的做法：把包围盒 8 个角变换到世界坐标，再按相机基向量
   * (right/up) 反解每个角要求的最小距离，取最大值。等价于
   *   R ≥ p·u + max(|p·right| / (FILL·tanH), |p·up| / (FILL·tanV))
   * 对俯角、设备朝向、透视都成立。
   */
  private frameIsolated(box: DeviceBoxInfo, preserveAngles = false, targetY?: number): void {
    // 取景数学已抽到 cameraFraming.ts（纯函数，可单测）—— 本方法只剩状态回写。
    // 目标点固定为设备包围盒中心（聚焦机位居中口径）；故障红标 depthTest:false 穿壳可见。
    const f = computeIsolatedFraming(
      box,
      { fov: this.camera.fov, aspect: this.camera.aspect, near: this.camera.near },
      {
        slotAngle: this.slots?.[box.index]?.angle ?? 0,
        targetY,
        preserveAngles,
        currentPhi: this.orbit.phi,
        currentTheta: this.orbit.theta,
        minPhi: this.orbit.minPhi,
        maxPhi: this.orbit.maxPhi,
        fill: 0.9, // 设备约占视锥高度 55%，周围检修物件随取景可见
      },
    );
    this.orbit.target.copy(f.target);
    this.orbit.minRadius = f.minRadius;
    this.orbit.maxRadius = f.maxRadius;
    this.orbit.radius = f.radius;
    this.orbit.phi = f.phi;
    this.orbit.theta = f.theta;
    this.dirty = true;
  }

  /* ========================= 三级层级：厂区 / 车间 / 单设备 ========================= */

  /**
   * 构建（或重建）厂区总览层。
   * 厂房清单 / 分区定义均来自调用方的真实数据（台账 workshop 去重等），本引擎不臆造。
   */
  buildFactory(specs?: FactoryBuildingSpec[], zones?: FactoryZoneSpec[], rankMetric?: FactoryRankMetric): void {
    this.disposeFactory();
    const list = specs && specs.length ? specs : defaultBuildingSpecs(4);
    const q = QUALITY[this.params.quality];
    this.factory = new FactoryOverview({
      seed: this.params.seed,
      buildings: list,
      zones,
      rankMetric,
      shadows: q.shadows,
      detail: q.detail,
    });
    this.factoryGroup.add(this.factory.group);
    this.factoryGroup.visible = this.level === 'factory';
    this.dirty = true;
  }

  private disposeFactory(): void {
    if (!this.factory) return;
    this.factoryGroup.remove(this.factory.group);
    this.factory.dispose();
    this.factory = null;
  }

  /** 分区视图（大屏 HUD 消费：产值 / 故障率 / 健康分 / 排名 / 在建工程）。 */
  factoryZones(): FactoryZoneView[] {
    return this.factory?.zones ?? [];
  }

  /** 切换分区排名口径（产值 / 故障率 / 健康分）。 */
  setFactoryRankMetric(metric: FactoryRankMetric): void {
    this.factory?.setRankMetric(metric);
  }

  /**
   * 选中某分区：地块高亮 + 标牌聚焦 + 相机取景到该分区。
   * 传 null 取消选中（回到全园取景）。**不切换层级** —— 层级切换由点击厂房触发。
   */
  selectZone(zoneId: string | null): void {
    const f = this.factory;
    if (!f) return;
    f.setActiveZone(zoneId);
    if (zoneId) {
      const box = f.boxOfZone(zoneId);
      if (box) this.frameZone(box);
    } else {
      this.frameFactory();
    }
    this.dirty = true;
  }

  /** 按分区包围盒取景（复用厂区取景的同一套反解思路）。 */
  private frameZone(box: { x: number; z: number; w: number; d: number; h: number }): void {
    const o = this.orbit;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const needZ = (box.d / 2) / Math.tan(vFov / 2);
    const needX = (box.w / 2) / (Math.tan(vFov / 2) * Math.max(0.35, this.camera.aspect));
    const need = Math.max(needX, needZ) * 1.5;
    o.minRadius = 40;
    o.maxRadius = 900;
    o.radius = clamp(need, o.minRadius, o.maxRadius);
    o.target.set(box.x, box.h * 0.4, box.z);
    o.phi = clamp(0.95, o.minPhi, o.maxPhi);
    this.dirty = true;
  }

  /** 进入厂区总览。相机拉远到建筑群（阻尼插值 → 平滑过渡，非跳变）。 */
  enterFactoryLevel(diveFromSky = false): boolean {
    if (!this.factory) this.buildFactory();
    if (!this.factory) return false;
    this.level = 'factory';
    this.applyLevelVisibility();
    // 若此前选中了某分区，回到厂区层时保持该分区视角，不重置用户上下文
    const active = this.factory.activeZone;
    const box = active ? this.factory.boxOfZone(active) : null;
    if (box) this.frameZone(box);
    else this.frameFactory();
    if (diveFromSky) {
      this.orbit.sRadius = 280;
      this.orbit.sPhi = 0.36;
      this.orbit.sTarget.set(0, 80, 0);
    }
    this.onLevelChange?.('factory', this.activeBuildingId);
    return true;
  }

  /** 回到车间层（从厂区下钻，或退出单设备聚焦）。 */
  enterWorkshopLevel(): void {
    this.level = 'workshop';
    this.applyLevelVisibility();
    this.resetFocus();
    this.onLevelChange?.('workshop', this.activeBuildingId);
  }

  /** 下钻：点击某栋厂房 → 进入对应车间。 */
  drillIntoBuilding(buildingId: string): void {
    this.activeBuildingId = buildingId;
    this.factory?.setHighlight(buildingId);
    this.enterWorkshopLevel();
  }

  /**
   * 产线层（机械臂工作站铭牌、设备悬浮标签、传送带）的可见性。
   *
   * 单设备聚焦层必须一并排除：lineGroup 的显隐会被"数据刷新重建产线"和
   * "低配整体开关"两条路径写回 true，实测聚焦画面里飘出 机械臂 001/002 标签
   * —— 用户规格：3D 画面里不允许飘任何文字。
   */
  private get lineLayerVisible(): boolean {
    return this.level !== 'factory' && this.level !== 'device' && this.lineEnabled;
  }

  private applyLevelVisibility(): void {
    const isFactory = this.level === 'factory';
    this.factoryGroup.visible = isFactory;
    this.hallGroup.visible = !isFactory;
    this.equipGroup.visible = !isFactory;
    this.propsGroup.visible = !isFactory;
    this.lineGroup.visible = this.lineLayerVisible;
    // 总览层不需要车间内的工单环 / 安全边界 / 故障链 / 人员
    this.workOrderGroup.visible = !isFactory;
    this.safety.group.visible = !isFactory;
    this.faultChainGroup.visible = !isFactory;
    this.workerGroup.visible = !isFactory;
    // 派工指引虚线：厂区层没有"车间内的人/设备链路"，一律不显示；
    // 车间/聚焦层由 setWorkerVisible 按总开关 + 是否选中设备决定。
    if (isFactory && this.guideGroup) this.guideGroup.visible = false;
    // 扫描线属于车间内的科技风装饰，厂区层不显示
    if (this.scanLine) this.scanLine.visible = !isFactory;
    this.dirty = true;
  }

  /** 按厂区包围盒与相机 FOV 反解取景距离（与 framePreset 同一套思路）。 */
  private frameFactory(): void {
    const f = this.factory;
    if (!f) return;
    const { halfX, halfZ, height } = f.extent;
    const o = this.orbit;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const needZ = halfZ / Math.tan(vFov / 2);
    const needX = halfX / (Math.tan(vFov / 2) * Math.max(0.35, this.camera.aspect));
    const need = Math.max(needX, needZ) * 1.05;
    o.minRadius = 40;
    o.maxRadius = 900;
    o.radius = clamp(need, o.minRadius, o.maxRadius);
    o.target.set(0, height * 0.35, 0);
    o.phi = clamp(0.92, o.minPhi, o.maxPhi);
    o.theta = Math.PI * 0.72;
    this.dirty = true;
  }

  /** 构建（或重建）车间生产线：机械臂阵列 + 传送带 + 物料箱 + 分区牌。 */
  buildProductionLine(opts?: Partial<ProductionLineOptions>): void {
    this.disposeProductionLine();
    const q = QUALITY[this.params.quality];
    const hall = this.hall;
    const line = new ProductionLine({
      seed: this.params.seed,
      stationCount: opts?.stationCount ?? 6,
      halfX: opts?.halfX ?? hall?.bounds.halfX ?? 27,
      halfZ: opts?.halfZ ?? hall?.bounds.halfZ ?? 20,
      shadows: q.shadows,
      detail: q.detail,
      zoneLabel: opts?.zoneLabel,
      faultStatuses: opts?.faultStatuses,
    });
    this.productionLine = line;
    this.lineGroup.add(line.group);
    this.lineGroup.visible = this.lineLayerVisible;
    this.buildWorkshopDetails();
    this.bindStationsToDevices();
    this.refreshFaultFloats();
  }

  /** 构建（或重建）车间环境细节层：贴花 / 地脚螺栓 / 仪表 / 灯柱 / 铭牌 / 工具柜 / AGV / 直梯。 */
  private buildWorkshopDetails(): void {
    this.disposeWorkshopDetails();
    const q = QUALITY[this.params.quality];
    const hall = this.hall;
    this.workshopDetails = new WorkshopDetails({
      seed: this.params.seed,
      halfX: hall?.bounds.halfX ?? 27,
      halfZ: hall?.bounds.halfZ ?? 20,
      shadows: q.shadows,
      detail: q.detail,
    });
    this.lineGroup.add(this.workshopDetails.group);
  }

  private disposeWorkshopDetails(): void {
    if (!this.workshopDetails) return;
    this.lineGroup.remove(this.workshopDetails.group);
    this.workshopDetails.dispose();
    this.workshopDetails = null;
  }

  /* ---------------- 单设备聚焦层 · 工业环境（场景密度优先） ---------------- */

  /**
   * 进入单设备聚焦层时挂载设备详情工业环境：
   * 深灰环氧地坪 + 45° 警戒线 + 工字钢立柱 + 屋架/管道桥 + 工业管道（球阀/法兰）
   * + 工具车/备件箱/电缆盘/检修平台/临时工作灯（真实暖光）/ 工人 ×2 + 上盖板移开 30cm。
   *
   * ⚠️ 一律不产生文字 / 编号 / 箭头 —— 数据全部由右侧 DOM 面板承担。
   * ⚠️ 只在这里 new，退出聚焦层（setIsolation(null)）与 dispose() 里必须成对 dispose，
   *    否则会残留到车间/总览层。
   */
  private buildFocusDecor(box: DeviceBoxInfo): void {
    this.disposeFocusDecor();
    const decorBox: DeviceDetailEnvBox = {
      x: box.centerX ?? box.x,
      z: box.centerZ ?? box.z,
      y: box.y,
      w: box.w,
      h: box.h,
      d: box.d,
    };
    // 压暗 + 立基础光必须排在环境层**之前**：环境层是 40 多个构件的堆叠，
    // 任何一次构造抛错都不该把设备留在"车间灯被隐藏、自己的灯又没建起来"的黑屏里。
    this.applyDeviceMood(true, box);
    this.buildFocusBaseLights(box);
    try {
      this.focusDecor = new DeviceDetailEnv({
        box: decorBox,
        // ⚠️ 既有单测用 Object.create(prototype) 造精简实例，slots 可能未初始化
        rotationY: this.slots?.[box.index]?.angle ?? 0,
        // 软渲染（SwiftShader）与 low 画质：跳过阴影投射灯与部分小件
        lowFx: this.params.quality === 'low' || this.isSoftwareRenderer(),
      });
      this.focusDecorGroup?.add(this.focusDecor.group);
    } catch (e) {
      // 兜底降级：环境层起不来就退回"设备本体 + 基础光"，右侧 DOM 面板照常工作。
      console.error('[equipment3d] 设备详情环境层构造失败，已降级为无环境聚焦视图', e);
      this.focusDecor = null;
      this.boostFocusBaseLights();
    }
    if (this.focusDecorGroup) this.focusDecorGroup.visible = true;
  }

  /**
   * 聚焦层自有基础光（环境光 + 半球光 + 一盏补光聚光）。由**场景**持有而非环境层持有：
   * 环境层构造失败时它仍在，设备与周围物件不会黑成一片。
   */
  private buildFocusBaseLights(box: DeviceBoxInfo): void {
    if (this.focusBaseLights) return;
    const cx = box.centerX ?? box.x ?? 0;
    const cz = box.centerZ ?? box.z ?? 0;
    const topY = (box.y ?? 0) + (box.h ?? 3);
    const amb = new THREE.AmbientLight(0x9db4d8, 0.26);
    // 上深蓝灰 / 下地面灰：让立柱、工具车、工人这些周围物件有可读的明暗层次
    const hemi = new THREE.HemisphereLight(0x2b3c58, 0x3f4650, 0.5);
    // 补光平时关闭，只在环境层构造失败时顶上（见 boostFocusBaseLights）
    const fill = new THREE.SpotLight(0xdfe9ff, 0, 34, 0.55, 0.95, 1.4);
    fill.position.set(cx - 3.4, topY + 7.5, cz + 3.2);
    fill.target.position.set(cx, topY * 0.45, cz);
    const group = new THREE.Group();
    group.name = 'focusBaseLights';
    group.add(amb, hemi, fill, fill.target);
    this.focusBaseLights = { group, amb, hemi, fill };
    this.focusDecorGroup?.add(group);
  }

  /** 环境层缺席时的补救：把基础光抬到"设备看得清"的量级，不追求明暗层次。 */
  private boostFocusBaseLights(): void {
    const base = this.focusBaseLights;
    if (!base) return;
    base.amb.intensity = 0.55;
    base.hemi.intensity = 0.9;
    base.fill.intensity = 520;
  }

  private disposeFocusBaseLights(): void {
    const base = this.focusBaseLights;
    if (!base) return;
    this.focusDecorGroup?.remove(base.group);
    base.group.clear();
    this.focusBaseLights = null;
  }

  private disposeFocusDecor(): void {
    // 既有单测用 Object.create(prototype) 造精简实例，无 faultGlow 字段
    if (this.faultGlow) this.faultGlow.intensity = 0;
    this.disposeFocusBaseLights();
    // 还原灯光必须在 focusDecor 判空之前：环境层构造失败时 focusDecor 是 null，
    // 但 applyDeviceMood(true) 已经生效，走这里退出必须把它还原回去。
    this.applyDeviceMood(false);
    if (!this.focusDecor) return;
    this.focusDecorGroup?.remove(this.focusDecor.group);
    this.focusDecor.dispose();
    this.focusDecor = null;
    if (this.focusDecorGroup) this.focusDecorGroup.visible = false;
  }

  /**
   * 单设备聚焦层 · 检修作业闭环的**数据标注**层（与 DeviceDetailEnv 同生命周期）：
   * 真实测点引线 + 数据气泡（缺测显示"—"）+ 五步检修闭环卡片 + 检修警示牌 + 诊断扫描环。
   *
   * ⚠️ 只画数据，物理件（地面警戒线 / 立柱 / 工具车 / 作业人员）交给 DeviceDetailEnv，
   *    两边都摆就变成"两辆工具车 + 两组工人"。dataOnly 即为此开关。
   * ⚠️ 数据一律来自设备台账与遥测接口，由 EquipmentScene 在既有那次 Promise.allSettled
   *    里顺手喂进来，本模块自己不发请求。
   */
  private buildFocusCallouts(box: DeviceBoxInfo): void {
    this.disposeFocusCallouts();
    const decorBox: FocusDecorBox = {
      x: box.centerX ?? box.x,
      z: box.centerZ ?? box.z,
      y: box.y,
      w: box.w,
      h: box.h,
      d: box.d,
    };
    const q = QUALITY[this.params.quality];
    this.focusCallouts = new FocusSceneDecor({
      box: decorBox,
      preset: SCENE_PRESETS[this.params.presetId] ?? SCENE_PRESETS.standard,
      detail: q.detail,
      // ⚠️ 既有单测用 Object.create(prototype) 造精简实例，slots 可能未初始化
      rotationY: this.slots?.[box.index]?.angle ?? 0,
      lowFx: this.params.quality === 'low' || this.isSoftwareRenderer(),
      // 测点气泡 + 五步闭环卡片是本层的硬要求（数据来自真实台账/遥测，缺测显示"—"）
      floatingLabels: true,
      dataOnly: true,
    });
    this.focusCallouts.setPaused(this.particlesPaused === true);
    this.focusCallouts.setSafeArea(this.focusCalloutSafeRight);
    this.focusCallouts.setSafeAreaLeft(this.focusCalloutSafeLeft);
    this.focusCalloutGroup?.add(this.focusCallouts.group);
    if (this.focusCalloutGroup) this.focusCalloutGroup.visible = true;
  }

  private disposeFocusCallouts(): void {
    if (!this.focusCallouts) return;
    this.focusCalloutGroup?.remove(this.focusCallouts.group);
    this.focusCallouts.dispose();
    this.focusCallouts = null;
    if (this.focusCalloutGroup) this.focusCalloutGroup.visible = false;
  }

  /* ---- 数据/安全区入口：由 EquipmentScene 调用，喂的是既有那一次请求的结果 ---- */
  setFocusDecorData(data: FocusDecorData): void {
    // 补 recipeId：调用方拿不到设备几何，测点部位名要按设备型号从真实观测区取
    const box = this.equipment?.boxById.get(data.deviceId);
    this.focusCallouts?.setData({
      ...data,
      recipeId: data.recipeId ?? box?.recipeId ?? null,
    });
  }

  setFocusDecorSafeArea(rightNdc: number): void {
    this.focusCalloutSafeRight = rightNdc;
    this.focusCallouts?.setSafeArea(rightNdc);
  }

  setFocusDecorSafeAreaLeft(leftNdc: number): void {
    this.focusCalloutSafeLeft = leftNdc;
    this.focusCallouts?.setSafeAreaLeft(leftNdc);
  }

  setFocusDecorPaused(_paused: boolean): void { /* 由 setLayerAnimationsPaused 统一驱动 */ }

  /**
   * 临时开关数据标注层。默认 false（尊重"3D 不飘字"规格），置 true 立即挂载、
   * 置 false 立即卸载。**只为探针/单设备调试留口**，不要在前端 UI 里挂按钮。
   */
  setFocusCalloutsEnabled(enabled: boolean): void {
    const v = !!enabled;
    if (v === FOCUS_CALLOUTS_ENABLED) return;
    FOCUS_CALLOUTS_ENABLED = v;
    if (v) {
      const id = this.isolationId;
      if (id) {
        const box = this.equipment?.boxById.get(id);
        if (box) this.buildFocusCallouts(box);
      }
    } else {
      this.disposeFocusCallouts();
    }
  }

  /**
   * 设备详情层的暗调灯光氛围：
   *   - 环境光 / 半球光 / 阳光全部压低（冷白聚光灯与暖黄工作灯由 DeviceDetailEnv 提供）
   *   - 指数雾 + 深蓝灰清屏色，隐约遮蔽远景；天空球在聚焦层隐藏
   * 相机 / 轨道手感零改动。harness 精简实例（无灯）直接跳过。
   */
  private applyDeviceMood(on: boolean, box?: DeviceBoxInfo): void {
    if (!this.ambient || !this.hemi || !this.sun) return;
    if (on) {
      if (!this.moodBackup) {
        this.moodBackup = {
          ambient: this.ambient.intensity,
          hemi: this.hemi.intensity,
          sun: this.sun.intensity,
          skyVisible: this.skyMesh ? this.skyMesh.visible : false,
        };
      }
      this.ambient.intensity = this.moodBackup.ambient * 0.42;
      this.hemi.intensity = this.moodBackup.hemi * 0.36;
      this.sun.intensity = this.moodBackup.sun * 0.42;
      this.sun.position.set(
        (box?.centerX ?? 0) + 14, (box?.h ?? 3) + 22, (box?.centerZ ?? 0) + 10,
      );
      if (this.skyMesh) this.skyMesh.visible = false;
      if (!this.scene.fog) {
        this.scene.fog = new THREE.Fog(FOG_COLOUR, FOG_NEAR, FOG_FAR);
      }
      this.renderer.setClearColor(FOG_COLOUR, 1);
    } else {
      if (this.moodBackup) {
        this.ambient.intensity = this.moodBackup.ambient;
        this.hemi.intensity = this.moodBackup.hemi;
        this.sun.intensity = this.moodBackup.sun;
        this.sun.position.set(80, 130, 60);
        if (this.skyMesh) this.skyMesh.visible = this.moodBackup.skyVisible;
        this.moodBackup = null;
      }
      this.scene.fog = null;
      this.renderer.setClearColor(0x000000, 0);
    }
  }

  /** 用真实台账刷新设备级细节（坐标/尺寸/状态/遥测快照全部来自 slots / boxById / slotStatus）。 */
  private refreshWorkshopDetails(): void {
    const det = this.workshopDetails;
    const eq = this.equipment;
    if (!det || !eq) return;
    const preset = SCENE_PRESETS[this.params.presetId] ?? SCENE_PRESETS.standard;
    const scale = preset.morphology.equipmentScale;
    const anchors: DetailDeviceAnchor[] = [];
    for (let i = 0; i < this.slots.length && i < this.devices.length; i++) {
      const s = this.slots[i];
      const d = this.devices[i];
      const box = eq.boxById.get(d.id);
      anchors.push({
        id: d.id,
        name: d.name ?? d.id,
        code: d.code,
        x: s.x,
        z: s.z,
        topY: (box?.h ?? 3.2) * scale + 0.5,
        w: (box?.w ?? 2) * scale,
        d: (box?.d ?? 2) * scale,
        status: this.slotStatus[i] ?? 'nodata',
        telemetry: d.telemetry ?? null,
      });
    }
    det.setDevices(anchors);
  }

  private disposeProductionLine(): void {
    if (!this.productionLine) return;
    this.disposeWorkshopDetails();
    this.lineGroup.remove(this.productionLine.group);
    this.productionLine.dispose();
    this.productionLine = null;
  }

  /** 生产线整体开关（低配可整体关闭）。 */
  setProductionLineEnabled(on: boolean): void {
    this.lineEnabled = on;
    this.lineGroup.visible = this.lineLayerVisible;
    this.dirty = true;
  }

  /** 传送带动画独立开关（帧率不足时只停动画、保留静态产线）。 */
  setBeltAnimation(on: boolean): void {
    this.productionLine?.setBeltEnabled(on);
  }

  /**
   * 用**真实台账**刷新异常警示浮标：故障/告警设备正上方生成红色三角感叹号，
   * 正常设备不生成，恢复的设备浮标被移除。
   */
  refreshFaultFloats(): void {
    const line = this.productionLine;
    const eq = this.equipment;
    if (!line || !eq) return;
    const preset = SCENE_PRESETS[this.params.presetId] ?? SCENE_PRESETS.standard;
    const scale = preset.morphology.equipmentScale;
    const anchors: DeviceAnchor[] = [];
    for (let i = 0; i < this.slots.length && i < this.devices.length; i++) {
      const s = this.slots[i];
      const d = this.devices[i];
      const box = eq.boxById.get(d.id);
      anchors.push({
        id: d.id,
        name: d.name ?? d.id,
        x: s.x,
        z: s.z,
        topY: (box?.h ?? 3.2) * scale + 0.5,
        status: this.slotStatus[i] ?? 'nodata',
      });
    }
    line.setDeviceAnchors(anchors);
    this.refreshWorkshopDetails();
  }

  /** 把机械臂工作站绑定到台账中的工业机器人（点击工作站即可选中该设备）。 */
  private bindStationsToDevices(): void {
    const line = this.productionLine;
    if (!line) return;
    const robots = this.devices.filter((d) => prototypeFor(d) === 'robot');
    for (const st of line.stations) {
      const dev = robots.length ? robots[(st.index - 1) % robots.length] : null;
      line.bindDevice(st.index, dev ? dev.id : null);
    }
  }

  /* ---------------- 动画暂停 / 复位（P3） ---------------- */

  /** 暂停/恢复新增三层内容的动画（不影响相机阻尼与既有设备动画）。 */
  setLayerAnimationsPaused(paused: boolean): void {
    this.particlesPaused = paused;
    this.productionLine?.setPaused(paused);
    this.workshopDetails?.setPaused(paused);
    this.factory?.setPaused(paused);
    this.faultLocator.setPaused(paused);
    this.focusCallouts?.setPaused(paused);
  }

  /** 复位三层动画到初始相位。 */
  resetLayerAnimations(): void {
    this.productionLine?.resetAnimation();
  }

  /* ---------------- 故障部位定位标 ---------------- */

  /**
   * 故障定位环（红色脉冲环 / 绿色恢复环）总开关 —— 纯委托，不改定位标自身的
   * 登记与动画状态：关掉再打开时，已登记的定位标原样回来（含维修进度与恢复动画）。
   * 对应 HUD「可视化图层」开关组里的"故障定位环"，默认开启。
   */
  setFaultLocatorVisible(visible: boolean): void {
    this.faultLocator.setVisible(visible);
  }

  /** 故障定位环当前是否可见（供 UI / 自检读取）。 */
  get faultLocatorVisible(): boolean {
    return this.faultLocator.isVisible;
  }

  /** 设置故障部位定位标（部位名与坐标来自真实台账 / AI 诊断结果）。 */
  setFaults(anchors: FaultAnchor[]): void {
    this.faultLocator.setFaults(anchors);
  }

  clearFaults(deviceId?: string): void {
    if (deviceId) this.faultLocator.clear(deviceId);
    else this.faultLocator.clearAll();
  }

  /**
   * 便捷定位某台设备的具体故障部位标。
   * @param partKey 可选。传入观察区 partKey 时按**真实零件几何**的世界包围盒生成
   *                红色线框笼；匹配不到零件则退回锚点处的标准笼盒。
   */
  showDeviceFault(deviceId: string, partName: string, partKey?: string): boolean {
    const box = this.equipment?.boxById.get(deviceId);
    if (!box) return false;
    const y = ((box.h ?? 3.2) * (box.scale ?? 1)) * 0.75 + (box.y ?? 0);
    const bounds = partKey ? this.partWorldBounds(deviceId, partKey) : undefined;
    if (bounds) {
      // 钳制：零件矩阵可能叠加设备缩放导致包围盒虚大（实测油罐笼高 5.85m，
      // 把相机推到屋顶上方俯视）。笼盒尺寸收进设备尺度的合理范围，
      // 中心高度钳回设备包围盒内，保证取景始终对准设备本体。
      const cap = Math.max(0.3, Math.min(box.w, box.h, box.d));
      bounds.sx = Math.min(Math.max(bounds.sx, 0.25), cap);
      bounds.sy = Math.min(Math.max(bounds.sy, 0.25), cap);
      bounds.sz = Math.min(Math.max(bounds.sz, 0.25), cap);
      bounds.cy = Math.min(Math.max(bounds.cy, box.y + bounds.sy / 2), box.y + box.h - bounds.sy / 2);
    }
    const ax = bounds ? bounds.cx : box.x;
    const ay = bounds ? bounds.cy : y;
    const az = bounds ? bounds.cz : box.z;
    // 红色呼吸灯打在故障部位上（纯光、不带任何文字/引线）
    this.faultGlow.position.set(ax, ay, az);
    this.faultGlow.intensity = 0.8;
    this.setFaults([{ deviceId, partName, x: ax, y: ay, z: az, bounds }]);
    return true;
  }

  /** 求指定零件的世界 AABB（设备实例变换后）；找不到返回 null。 */
  private partWorldBounds(deviceId: string, partKey: string):
    { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number } | null {
    const eq = this.equipment;
    if (!eq) return null;
    const parts = eq.getDevicePartInfo(deviceId);
    if (!parts) return null;
    const part = parts.find((p) => p.key === partKey);
    if (!part) return null;
    if (!part.geo.boundingBox) part.geo.computeBoundingBox();
    const bb = part.geo.boundingBox!;
    // part.matrix 在 equipment.ts 里就是 deviceMatrix × partMatrix，**已经是世界矩阵**；
    // 再乘一次 dev.matrixWorld 会把锚点甩到别处（实测相机对着 25m 外的空地，画面全黑）。
    const min = bb.min.clone().applyMatrix4(part.matrix);
    const max = bb.max.clone().applyMatrix4(part.matrix);
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    return { cx, cy, cz, sx: Math.abs(max.x - min.x), sy: Math.abs(max.y - min.y), sz: Math.abs(max.z - min.z) };
  }

  /**
   * 聚焦设备并优先把镜头对准故障部位（无定位标时退回整机取景）。
   *
   * ⚠️ 必须**一次性**把故障点高度交给 frameIsolated：早期实现是先按整机包围盒
   * 解距离、再事后把 orbit.target 挪到故障点，于是半径是按"盒心"算的、
   * 画面却按"故障点"居中 —— 实测设备下半截被裁出画面（用户反馈"设备被裁一半"）。
   * 现在 targetY 参与半径反解，两者自洽。
   */
  focusDeviceWithFault(id: string): boolean {
    // 「聚焦机位居中」口径：目标点固定设备包围盒中心，不再对准故障点。
    return this.focusDevice(id);
  }

  /**
   * 已在独占/聚焦态时，按**已设置**的故障部位重新取景（保持当前视角角度）。
   *
   * 调用时序很重要：UI 的 handlePick 是「先 setIsolation 进独占、再 showDeviceFault
   * 建定位标」，所以建标之后必须回过头再取景一次，否则故障点会落在画面边缘。
   *
   * @returns 是否命中定位标；没有定位标（设备正常）时返回 false，调用方无需处理。
   */
  frameDeviceFault(id: string): boolean {
    const box = this.equipment?.boxById.get(id);
    if (!box) return false;
    // 「聚焦机位居中」口径：目标点固定设备包围盒中心（不怼故障点），
    // 故障红标 depthTest:false 穿壳可见，拉远后在设备旁清晰可辨。
    // preserveAngles = true：只调距离与目标点，不改俯仰/方位，避免"又转一圈"的眩晕感。
    this.frameIsolated(box, true);
    return true;
  }

  /* ---------------- 维修闭环（工单操作联动） ---------------- */

  /**
   * 检修阶段覆盖：'repairing' = 技师接单检修中（台账蓝色"检修中"）；
   * 'operating' = 修复完成恢复运转（绿色，旋转件复转、告警灯熄灭）。
   * 只覆盖显示，不改台账；台账状态由工单流程与刷新后的真实接口驱动。
   */
  setDeviceRepairPhase(deviceId: string, phase: 'repairing' | 'operating'): void {
    this.setStatusOverride(deviceId, phase === 'repairing' ? 'overhauling' : 'running');
  }

  /** 检修步骤进度（0~1）→ 故障定位标逐层减淡（勾一步消一层）。 */
  setDeviceRepairProgress(deviceId: string, ratio: number): void {
    this.faultLocator.setRepairProgress(deviceId, ratio);
  }

  /**
   * 完工恢复动画：故障定位标红→绿扫过并淡出自毁 + 设备状态色立即转绿复转 +
   * 相机向设备缓推再回落（"验收复机"的镜头语言）。
   * @returns 是否命中了定位标（无定位标的设备也做状态/相机部分）
   */
  playRepairRecovery(deviceId: string): boolean {
    const hitMarker = this.faultLocator.startRecovery(deviceId);
    this.setStatusOverride(deviceId, 'running');
    const o = this.orbit;
    const r0 = Math.max(o.radius, o.sRadius);
    if (r0 > o.minRadius * 1.5) {
      // 先把目标半径收 12%，1.6s 后由帧循环还原；阻尼让两段都平滑不跳变
      o.radius = Math.max(o.minRadius + 0.5, r0 * 0.88);
      this.recoveryPush = { t: 0, r0 };
    }
    return hitMarker;
  }

  /* ---------------- 统一拾取 ---------------- */

  /**
   * 按当前层级拾取：厂区层 → 厂房；车间层 → 台账设备 / 机械臂工作站。
   */
  pickScene(clientX: number, clientY: number): ScenePickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    if (this.level === 'factory' && this.factory) {
      // 厂房体块优先于分区地块（分区地块是平铺面，射线必然命中，会盖住厂房）
      const hits = this.raycaster.intersectObjects(this.factory.picks, false);
      const ud = hits[0]?.object?.userData;
      if (ud?.pick === 'building') {
        return {
          kind: 'building',
          buildingId: String(ud.buildingId),
          name: String(ud.buildingName ?? ''),
          workshopId: String(ud.workshopId ?? ud.buildingId),
        };
      }
      const zoneHits = this.raycaster.intersectObjects(this.factory.zonePicks, false);
      const zud = zoneHits[0]?.object?.userData;
      if (zud?.pick === 'zone') {
        return { kind: 'zone', zoneId: String(zud.zoneId), name: String(zud.zoneName ?? '') };
      }
      return null;
    }

    const candidates: THREE.Object3D[] = [];
    if (this.isolationId) {
      for (const p of this.picks) if (p.userData?.equipmentId === this.isolationId) candidates.push(p);
    } else {
      for (const p of this.picks) candidates.push(p);
    }
    if (this.productionLine && this.lineGroup.visible) {
      for (const p of this.productionLine.picks) candidates.push(p);
    }
    if (!candidates.length) return null;

    const hits = this.raycaster.intersectObjects(candidates, false);
    if (!hits.length) return null;
    const ud = hits[0].object.userData;

    if (ud?.pick === 'station') {
      return {
        kind: 'station',
        stationId: Number(ud.stationId),
        code: String(ud.stationCode ?? ''),
        deviceId: ud.deviceId ? String(ud.deviceId) : null,
      };
    }
    if (ud?.equipmentId && typeof ud.slotIndex === 'number') {
      return { kind: 'device', id: String(ud.equipmentId), index: Number(ud.slotIndex) };
    }
    return null;
  }

  /* ========================= 拾取 ========================= */


  pick(clientX: number, clientY: number): { id: string; index: number } | null {
    if (!this.picks.length) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const candidates = this.isolationId
      ? this.picks.filter((object) => object.userData.equipmentId === this.isolationId)
      : this.picks;
    const hits = this.raycaster.intersectObjects(candidates, false);
    if (!hits.length) return null;
    const obj = hits[0].object;
    const id = obj.userData?.equipmentId as string | undefined;
    const index = obj.userData?.slotIndex as number | undefined;
    if (!id || typeof index !== 'number') return null;
    return { id, index };
  }

  /** 选中高亮：地面白环跟随选中设备 + 该台设备 emissive 蓝调提亮。 */
  setSelected(id: string | null): void {
    this.selectedId = id;
    this.applySelectionEmissive(id);
    this.refreshSelection();
    this.drawMinimap();
  }

  /**
   * 给选中设备逐 Mesh 换上有蓝调 emissive 的克隆材质；传 null 还原全部。
   * 只动"原本不发光"的 MeshStandardMaterial —— 状态灯/发光件自带语义，不叠加。
   */
  private applySelectionEmissive(id: string | null): void {
    // 还原上一轮
    for (const [mesh, prev] of this.selEmissiveBackup) mesh.material = prev;
    this.selEmissiveBackup.clear();
    for (const c of this.selEmissiveClones.values()) (c as THREE.MeshStandardMaterial).dispose();
    this.selEmissiveClones.clear();

    if (!id || !this.equipment) return;
    const devGroup = this.equipment.group.getObjectByName(`device:${id}`);
    if (!devGroup) return;
    devGroup.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
      const m = o.material;
      const list = Array.isArray(m) ? m : [m];
      let changed = false;
      const next = list.map((mat) => {
        if (!(mat instanceof THREE.MeshStandardMaterial)) return mat;
        if (mat.emissive.getHex() !== 0) return mat;
        let own = this.selEmissiveClones.get(mat);
        if (!own) {
          const clone = mat.clone();
          clone.emissive.setHex(0x1e3a5f);
          clone.emissiveIntensity = 0.35;
          this.selEmissiveClones.set(mat, clone);
          own = clone;
        }
        changed = true;
        return own;
      });
      if (changed) {
        this.selEmissiveBackup.set(o, m);
        o.material = Array.isArray(m) ? next : next[0];
      }
    });
  }

  /* ========================= 状态覆盖（遥测回放联动） ========================= */

  /** 运行时覆盖单台设备的状态色（用于遥测回放联动）。传 null 清除覆盖。 */
  setStatusOverride(deviceId: string, status: StatusKey | null): void {
    this.equipment?.setStatusOverride(deviceId, status);
  }

  /** 清除所有状态覆盖，恢复全部设备到原始台账状态。 */
  clearStatusOverrides(): void {
    this.equipment?.clearStatusOverrides();
  }

  /** 每次替换完整快照，缺失读数同时清除部位高亮与流动示意。 */
  setDeviceTelemetry(deviceId: string, data: PartTelemetry & { status: string; current?: number; rpm?: number }): void {
    this.equipment?.updateTelemetry(deviceId, data);
    this.fluidFlow?.setDeviceTelemetry(deviceId, data);
    this.workshopDetails?.setTelemetry(deviceId, data);
  }

  /* ========================= 拆解视图 ========================= */

  /** 进入拆解视图：隐藏指定设备的实例，准备创建拆解零件 */
  enterExplodedView(deviceId: string): void {
    this.equipment?.hideDeviceInstances(deviceId);
    this.safety.group.visible = false;
    this.faultChainGroup.visible = false;
    this.workerGroup.visible = false;
    const explodedGroup = this.scene.getObjectByName('explodedView') as THREE.Group | null;
    this.fluidFlow?.setExploded(deviceId, true, explodedGroup);
  }

  /** 同步拆解视图网格给介质流动系统（部件展开时粒子沿拆解管路流动） */
  syncExplodedFluid(deviceId: string): void {
    const explodedGroup = this.scene.getObjectByName('explodedView') as THREE.Group | null;
    this.fluidFlow?.setExploded(deviceId, true, explodedGroup);
  }

  /** 退出拆解视图：恢复指定设备的实例，安全边界/故障链由 React 层按当前开关状态恢复 */
  exitExplodedView(deviceId: string): void {
    this.equipment?.showDeviceInstances(deviceId);
    this.fluidFlow?.setExploded(deviceId, false, null);
    // faultChainGroup 可见性由 React 层 restoreFaultChain 恢复
  }

  /** 获取指定设备的零件信息（用于创建拆解视图） */
  getDevicePartInfo(deviceId: string) {
    return this.equipment?.getDevicePartInfo(deviceId) ?? null;
  }

  private refreshSelection(): void {
    const ring = this.selectionRing;
    if (!ring) return;
    if (!this.selectedId || !this.equipment) {
      ring.visible = false;
      return;
    }
    const idx = this.equipment.indexById.get(this.selectedId);
    if (typeof idx !== 'number' || !this.slots[idx]) {
      ring.visible = false;
      return;
    }
    const s = this.slots[idx];
    const y = this.hall ? this.hall.reliefAt(s.x, s.z) : 0;
    ring.position.set(s.x, y + 0.1, s.z);
    ring.scale.setScalar(s.radius * 1.9);
    ring.visible = true;
    const mat = ring.material as THREE.MeshBasicMaterial;
    mat.color.set(0xffffff);
  }

  /* ========================= 小地图 ========================= */

  /**
   * 绑定小地图画布（由 React 渲染并传入）。
   * 移植自参考生成器的 minimap：俯视布局 + 相机位置/朝向指示。
   * 对本项目而言它不只是"好看"——厂房很大而故障设备只有 1–2 台，
   * 俯视图能让异常设备一眼可定位。
   */
  attachMinimap(canvas: HTMLCanvasElement | null): void {
    this.miniCanvas = canvas;
    this.miniCtx = canvas ? canvas.getContext('2d') : null;
    this.drawMinimap();
  }

  /** 重绘小地图。由 build / 选中变化 / 帧循环（节流）调用。 */
  drawMinimap(): void {
    drawSceneMinimap({
      canvas: this.miniCanvas,
      context: this.miniCtx,
      hall: this.hall,
      slots: this.slots,
      slotStatus: this.slotStatus,
      equipment: this.equipment,
      selectedId: this.selectedId,
      camera: this.camera,
      direction: this.miniDir,
    });
  }

  /* ========================= 统计 / 释放 ========================= */

  /** 遍历场景统计三角面：InstancedMesh 需乘以实例数。 */
  /**
   * 统计三角面数。
   * @param visibleOnly 只统计可见对象（独占模式下被隐藏的设备不再计入）
   */
  countTriangles(visibleOnly = false): number {
    let n = 0;
    const walk = (o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      const anyMesh = mesh as unknown as { isMesh?: boolean; isInstancedMesh?: boolean; count?: number };
      if (!anyMesh.isMesh) return;
      const g = mesh.geometry as THREE.BufferGeometry | undefined;
      if (!g || !g.attributes?.position) return;
      const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      const inst = anyMesh.isInstancedMesh ? anyMesh.count ?? 1 : 1;
      n += t * inst;
    };
    if (visibleOnly) this.root.traverseVisible(walk);
    else this.root.traverse(walk);
    return Math.round(n);
  }

  /** 统计可见网格数 ≈ 主渲染通道的 drawcall 数（InstancedMesh 每个算 1 次）。
   *  不使用 renderer.info.render.calls：它反映的是"上一帧"，首次构建时为 0。
   *  @param visibleOnly 只统计可见对象（独占模式下被隐藏的设备不再计入） */
  countDrawables(visibleOnly = false): number {
    let n = 0;
    const walk = (o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh & { isMesh?: boolean };
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      const list = Array.isArray(mat) ? mat : [mat];
      if (list.some((m) => m.visible !== false)) n++;
    };
    if (visibleOnly) this.root.traverseVisible(walk);
    else this.root.traverse(walk);
    return n;
  }

  /**
   * 实时可见统计（供性能条显示）。
   *
   * 用 traverseVisible 而不是 traverse：前者会跳过 visible=false 的**整棵子树**，
   * 正好对应 hideDeviceInstances 把整台设备的 devGroup 隐藏的做法 ——
   * 于是独占模式下性能条如实显示「设备数 1 / 三角面与 drawcall 只算这一台」，
   * 而不是继续显示构建期登记的 16 台。
   */
  liveStats(): { devices: number; triangles: number; drawCalls: number } {
    return {
      devices: this.equipment?.visibleDeviceCount() ?? 0,
      triangles: this.countTriangles(true),
      drawCalls: this.countDrawables(true),
    };
  }

  /**
   * 释放一个子组。
   * 关键：跳过 userData.shared 的几何体 —— 它们来自模块级缓存，
   * 下一次重建还要继续用；一旦释放，第二次重建就会白屏。
   */
  private disposeGroup(group: THREE.Object3D): void {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean; dispose?: () => void };
      // InstancedMesh 的实例缓冲（instanceMatrix/instanceColor）必须显式释放，
      // 否则每次重建（尤其拖动密度/间距滑块时）都会泄漏 GPU 缓冲。
      // dispose() 只释放实例属性，不碰共享的 geometry/material，安全。
      if (mesh.isInstancedMesh && typeof mesh.dispose === 'function') mesh.dispose();
      const g = mesh.geometry as THREE.BufferGeometry | undefined;
      if (g && !g.userData?.shared) g.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (m) {
        const list = Array.isArray(m) ? m : [m];
        for (const mat of list) mat.dispose();
      }
    });
    group.clear();
  }

  /* ========================= 帧循环 ========================= */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.update(dt);
      // 状态动画：旋转件转动 / 指示灯闪烁 / 故障抖动。
      // 只更新"激活"的实例（running 才转、alert 才闪），静止设备零开销。
      this.animTime += dt;
      this.equipment?.animate(this.animTime);
      this.animateWorkOrderRings(this.animTime);
      this.animateFaultPropagation(this.animTime);
      this.animateSafetyBoundaries(this.animTime);
      this.animateWorkers(this.animTime, dt);
      this.hall?.update(dt);
      this.fluidFlow?.update(dt, this.animTime);
      // 三级层级各自的动画：产线（机械臂/传送带/物料箱/浮标）、厂区扫描环、故障定位标
      this.productionLine?.update(dt, this.animTime);
      // 环境细节层：灯柱呼吸 / 指针微摆 / 铭牌远景裁剪（同一暂停开关控制）
      this.workshopDetails?.update(dt, this.animTime, this.camera.position);
      this.factory?.update(dt, this.animTime);
      // 传相机：故障标签要按锚点的屏幕位置决定向左还是向右展开，否则会被右侧详情面板挡住
      this.faultLocator.update(dt, this.animTime, this.camera);
      // 聚焦层检修作业现场：扫描环旋转 + 脚下光圈脉冲（同一暂停开关控制）
      // 传相机：数据气泡/检修卡片按屏幕槽位摆放，镜头一转就要重排，否则会挤成一坨
      this.focusDecor?.update(dt, this.animTime);
      // 故障呼吸灯：0.8~1.2 之间起伏，退出聚焦（intensity 归 0）即停
      if (this.faultGlow.intensity > 0) {
        this.faultGlow.intensity = 1 + Math.sin(this.animTime * 2.6) * 0.2;
      }
      // ⚠️ 必须把相机传进去：气泡/卡片是按屏幕槽位反解出来的，镜头一动就要重排
      this.focusCallouts?.update(dt, this.animTime, this.camera);
      this.animateChrome(this.animTime, dt);
      // 小地图只需跟随相机更新，约 8fps 重绘足够，避免占用主线程
      this.miniTimer += dt;
      if (this.miniTimer >= 0.12) {
        this.miniTimer = 0;
        this.drawMinimap();
      }
      // 后处理链存在时走 composer（RenderPass→Bloom→OutputPass），否则直渲；
      // 护栏③的 direct 基线期强制直渲，故按渲染调用单独计时（不含 update）
      const tRender0 = performance.now();
      const useComposer = this.composer !== null && (!this.bloomProbe || this.bloomProbe.phase === 'bloom');
      if (useComposer) this.composer!.render();
      else this.renderer.render(this.scene, this.camera);
      this.sampleBloomProbe(performance.now() - tRender0);
      this.trackFps(dt);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private trackFps(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 40) this.frameTimes.shift();
    if (this.frameTimes.length >= 12) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.fps = avg > 0 ? 1 / avg : 0;
      this.onFrame?.(this.fps);
    }
  }

  getFps(): number {
    return this.fps;
  }

  /** 阻尼相机 + 行车往复 —— 与参考实现 update() 一致。 */
  update(dt: number): void {
    // 完工恢复推镜：1.6s 后把轨道半径还原（收→放的阻尼过渡由下方插值完成）
    if (this.recoveryPush) {
      this.recoveryPush.t += dt;
      if (this.recoveryPush.t >= 1.6) {
        this.orbit.radius = this.recoveryPush.r0;
        this.recoveryPush = null;
      }
    }
    const o = this.orbit;
    const k = 1 - Math.exp(-dt * 9);
    o.sTheta += (o.theta - o.sTheta) * k;
    o.sPhi += (o.phi - o.sPhi) * k;
    o.sRadius += (o.radius - o.sRadius) * k;
    o.sTarget.lerp(o.target, k);

    const sinPhi = Math.sin(o.sPhi);
    this.camera.position.set(
      o.sTarget.x + o.sRadius * sinPhi * Math.sin(o.sTheta),
      o.sTarget.y + o.sRadius * Math.cos(o.sPhi),
      o.sTarget.z + o.sRadius * sinPhi * Math.cos(o.sTheta)
    );
    this.camera.lookAt(o.sTarget);

    if (this.crane && this.craneRange > 0) {
      this.craneT += dt * 0.12;
      const x = Math.sin(this.craneT) * this.craneRange;
      this.crane.position.x = x;
      // 小车横向移动，制造"正在作业"的感觉（引用构建时已缓存，逐帧零分配）
      if (this.trolley) this.trolley.position.z = Math.sin(this.craneT * 1.7) * this.craneRange * 0.42;
    }
    void this.dirty;
  }

  /* ========================= 销毁 ========================= */

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onWindowResize);
    const el = this.renderer.domElement;
    el.removeEventListener('contextmenu', this.onContextMenu);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);

    this.disposeGroup(this.hallGroup);
    this.disposeGroup(this.equipGroup);
    this.disposeGroup(this.propsGroup);
    this.disposeGroup(this.helperGroup);
    this.disposeProductionLine();
    this.disposeFactory();
    this.disposeFocusDecor();
    this.disposeFocusCallouts();
    this.faultLocator.dispose();
    this.safety.dispose();
    this.workOrderRings.clear();
    this.currentWorkOrderMap.clear();
    this.workOrderGroup.clear();
    this.ringMatPending.dispose();
    this.ringMatInProgress.dispose();
    this.ringMatCompleted.dispose();
    if (this.workOrderRingGeo) {
      this.workOrderRingGeo.dispose();
      this.workOrderRingGeo = null;
    }
    this.fluidFlow?.dispose();
    this.scene.remove(this.root);

    if (this.skyMesh) {
      this.scene.remove(this.skyMesh);
      (this.skyMesh.material as THREE.Material).dispose();
      this.skyMesh = null;
    }
    this.skyGeo?.dispose();
    this.skyGeo = null;
    this.envKey = null;
    this.skyKey = null;
    this.shadowKey = 0;
    this.miniCanvas = null;
    this.miniCtx = null;
    this.slotStatus = [];
    for (const l of [this.sun, this.hemi, this.ambient]) {
      if (l) {
        l.dispose?.();
        this.scene.remove(l);
      }
    }
    this.envRT?.dispose();
    this.envSource?.dispose();
    this.envRT = null;
    this.envSource = null;
    this.pmrem?.dispose();
    this.pmrem = null;
    this.scene.environment = null;
    this.disposeComposer();
    this.applySelectionEmissive(null);
    this.bgParticles = null;
    this.particleSpeeds = null;

    this.renderer.dispose();
    if (el.parentNode) el.parentNode.removeChild(el);
    this.picks = [];
    this.slots = [];
    this.devices = [];
    this.equipment = null;
    this.hall = null;
    this.crane = null;
    this.trolley = null;
    this.selectedId = null;
    this.lastBuiltPresetId = null;
    this.lastBuiltQuality = null;
    this.lastBuiltDetail = null;
    this.lastBuiltDeviceCount = 0;
  }
}
