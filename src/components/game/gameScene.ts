/**
 * 「检修闯关」3D 关卡地图场景。
 *
 * 取代原来的"设备卡片列表"：把 16 台设备摆成一个**车间俯视关卡地图**，
 * 每台设备一个关卡点位，点一下就相机俯冲拉近、进入检修关卡。
 *
 * ## 与车间层的模型一致性
 *
 * 设备模型走 `src/components/equipment3d/equipment.ts` 的 `loadEquipmentGLB` +
 * `EQUIPMENT_GLB_MAP` —— 与数字孪生大屏**同一份 GLB 映射与同一条加载管线**
 * （含 `normalizeGLBMaterials` 的 Physical→Standard 降级与 gltfCache 复用），
 * 因此不会出现"闯关里的泵和车间里的泵不是一个东西"。
 *
 * ## ⚠️ 释放纪律（踩过坑）
 *
 * `loadEquipmentGLB` 返回的是模块级缓存模型的 `clone(true)`，**几何与材质是按引用共享的**
 * （`Object3D.clone()` 不深拷贝 geometry/material）。所以拆场景时**绝不能**遍历 dispose
 * GLB 子树 —— 那会把缓存里的原件和别人的场景一起弄坏。
 * 本文件只释放自己 `new` 出来的资源（地坪 / 光环 / 光柱 / 拾取代理 / 网格），
 * 全部登记在 `owned` 里；GLB 子树只做 `remove`。
 *
 * ## 视觉基线
 *
 * 配色直接取 `styles.ts` 的 `industrial` 预设（深色科技蓝：地坪 0x101e32、
 * 强调色 0x22d3ee），与大屏同一套色，不做卡通化。
 */
import * as THREE from 'three';
import { EQUIPMENT_GLB_MAP, loadEquipmentGLB } from '../equipment3d/equipment';
import { prototypeFor, PROTOTYPE_BOUNDS } from '../equipment3d/equipmentPrototype';
import { loadGameCharacter, type CharacterMood, type GameCharacter } from './gameCharacter';

/* ============================ 对外类型 ============================ */

/** 点位状态：绿=已通关 / 黄=可挑战 / 红=未解锁（无规程） */
export type StationState = 'cleared' | 'current' | 'locked';

export interface StationSpec {
  id: string;
  /** 关卡序号（从 1 开始） */
  index: number;
  name: string;
  code: string;
  category?: string;
  workshop?: string;
  state: StationState;
  /** 有可玩规程才允许进入 */
  playable: boolean;
  /** 历史最佳评级（S/A/B/C），无则 null */
  bestGrade?: string | null;
}

/** 第一步"找故障点"的场景热点 */
export interface FaultSpotSpec {
  key: string;
  label: string;
  /** 真实遥测判定为异常 */
  abnormal: boolean;
  /** 该部位的实测读数文案；无数据时必须显式传 null（不编造） */
  reading: string | null;
}

export interface GameSceneHooks {
  /** 点位被点击（相机俯冲开始前） */
  onStationPick?: (id: string) => void;
  /** 俯冲结束、已经贴到设备跟前 */
  onDiveEnd?: (id: string) => void;
  /** 故障热点被点击 */
  onFaultPick?: (key: string) => void;
  /** 悬停目标变化（null = 离开） */
  onHover?: (id: string | null) => void;
}

export interface GameSceneOptions {
  /** 数字人 GLB 路径 */
  characterUrl?: string;
  hooks?: GameSceneHooks;
}

/* ============================ 视觉常量 ============================ */

const PAL = {
  floor: 0x101e32,
  floorAlt: 0x14263e,
  lane: 0xe4b83f,
  wall: 0x162a43,
  column: 0x29445e,
  steel: 0x7895ad,
  accent: 0x22d3ee,
  fog: 0x0b1220,
};

const STATE_COLOR: Record<StationState, number> = {
  cleared: 0x27c46b, // 绿：已通关
  current: 0xf2c327, // 黄：可挑战
  locked: 0xe03b2f, // 红：未解锁
};

const STATE_LABEL: Record<StationState, string> = {
  cleared: '已通关',
  current: '可挑战',
  locked: '未解锁',
};

const STATION_SPACING_X = 12;
const STATION_SPACING_Z = 12;
const DIVE_MS = 1150;
const OVERVIEW_MS = 900;

/**
 * 关卡特写机位（球坐标方位角/俯仰角）。
 * `stationFraming` 算相机位置、`placeCharacterFor` 反解数字人站位，**必须共用同一套角度**：
 * 站位是按"机位的右向/朝向"分解的，两边一旦不一致，人就会站到画面外或钻到设备里。
 */
const DIVE_YAW = 0.42;
const DIVE_PITCH = 0.34;

const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _box = new THREE.Box3();

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ============================ 点位布局 ============================ */

/**
 * 蛇形（serpentine）网格布点 —— 关卡地图的经典排布：
 * 第 0 行从左到右，第 1 行从右到左，依次类推，连线就是一条不交叉的通关路径。
 */
export function layoutStations(count: number): Array<{ x: number; z: number; angle: number }> {
  // 列数上限 5：26 台设备在 4 列下会排成 4×7 的细长条，俯视时行距被透视压扁、
  // 铭牌全糊在一起；5 列得到 5×6 的方正布局，更像"关卡地图"。
  const cols = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(Math.max(1, count)))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const out: Array<{ x: number; z: number; angle: number }> = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const inRow = i % cols;
    const col = row % 2 === 0 ? inRow : cols - 1 - inRow;
    out.push({
      x: (col - (cols - 1) / 2) * STATION_SPACING_X,
      z: (row - (rows - 1) / 2) * STATION_SPACING_Z,
      // 一律朝向 +Z（默认俯视相机的方向），让铭牌/正面朝着观众
      angle: Math.PI,
    });
  }
  return out;
}

/* ============================ 内部视图对象 ============================ */

interface StationView {
  spec: StationSpec;
  pos: THREE.Vector3;
  angle: number;
  radius: number;
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  pillar: THREE.Mesh;
  pillarMat: THREE.MeshBasicMaterial;
  proxy: THREE.Mesh;
  /** GLB 就绪前的程序化替身 */
  placeholder: THREE.Group;
  /** GLB 容器（加载成功后才存在），关卡内聚焦时用于压暗其余设备 */
  glbContainer: THREE.Group | null;
  labelEl: HTMLDivElement;
  /** 铭牌上的设备名（重叠时会被收起来，只留序号徽标） */
  labelName: HTMLSpanElement;
  /** 最佳评级徽标（可能不存在） */
  labelGrade: HTMLSpanElement | null;
  loaded: boolean;
}

interface FaultSpotView {
  key: string;
  abnormal: boolean;
  group: THREE.Group;
  marker: THREE.Mesh;
  markerMat: THREE.MeshBasicMaterial;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  proxy: THREE.Mesh;
}

interface CamAnim {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t0: number;
  dur: number;
  /** 俯冲目标点位；null 表示"回到总览" */
  stationId: string | null;
  onEnd?: () => void;
}

/* ============================ 场景类 ============================ */

export class GameScene {
  private host: HTMLElement;
  private hooks: GameSceneHooks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private labelLayer: HTMLDivElement;

  private raf = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private elapsed = 0;

  private stations: StationView[] = [];
  private stationById = new Map<string, StationView>();
  private pathLine: THREE.Line | null = null;

  private character: GameCharacter | null = null;
  private characterHome = new THREE.Vector3();

  private faultSpots: FaultSpotView[] = [];
  private faultRoot = new THREE.Group();

  /** 相机轨道（阻尼目标 + 当前值） */
  private orbit = { yaw: 0, pitch: 0.72, dist: 78, target: new THREE.Vector3(0, 2.2, 0) };
  private want = { yaw: 0, pitch: 0.72, dist: 78, target: new THREE.Vector3(0, 2.2, 0) };
  private camAnim: CamAnim | null = null;

  private hoveredId: string | null = null;
  /** 关卡内悬停的故障热点 key（与 hoveredId 分开：两者互斥，点位代理进关卡后已停用） */
  private hoveredFaultKey: string | null = null;
  private focusedId: string | null = null;
  private dragging = false;
  private dragMoved = 0;
  private lastPointer = { x: 0, y: 0 };

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private stationPickTargets: THREE.Object3D[] = [];
  private faultPickTargets: THREE.Object3D[] = [];
  /** 铭牌尺寸缓存（避免每帧 26 次 getBoundingClientRect 触发强制重排） */
  private labelSize = new WeakMap<HTMLElement, { w: number; h: number }>();

  /** 只登记本文件 new 出来的资源；GLB 子树共享缓存，绝不在此列 */
  private owned: Array<{ dispose(): void }> = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(host: HTMLElement, stations: StationSpec[], opts: GameSceneOptions = {}) {
    this.host = host;
    this.hooks = opts.hooks ?? {};

    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(host.clientWidth || 800, host.clientHeight || 600, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    host.appendChild(this.renderer.domElement);

    // DOM 标签层：用 DOM 而不是 Sprite —— 文字清晰、随主题走、也免掉 canvas 贴图在
    // jsdom 下没有 2D context 的麻烦（那会让测试里的标签分支被整体跳过）。
    this.labelLayer = document.createElement('div');
    Object.assign(this.labelLayer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      overflow: 'hidden',
    } as CSSStyleDeclaration);
    host.appendChild(this.labelLayer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PAL.fog);
    this.scene.fog = new THREE.FogExp2(PAL.fog, 0.0072);

    this.camera = new THREE.PerspectiveCamera(46, (host.clientWidth || 800) / (host.clientHeight || 600), 0.1, 900);

    this.buildEnvironment();
    this.buildStations(stations);
    this.buildPath();
    this.scene.add(this.faultRoot);

    void this.loadCharacter(opts.characterUrl ?? '/models/engineer/worker_talk.glb');

    this.attachEvents();
    this.syncCamera();
  }

  /* ---------------- 环境 ---------------- */

  private own<T extends { dispose(): void }>(r: T): T {
    this.owned.push(r);
    return r;
  }

  private buildEnvironment(): void {
    const scene = this.scene;

    scene.add(new THREE.HemisphereLight(0x8ccfe9, PAL.fog, 1.05));

    const sun = new THREE.DirectionalLight(0xc5eaff, 2.1);
    sun.position.set(38, 62, 26);
    sun.castShadow = false; // 阴影 pass 会把 GLB 的几百个 mesh 再画一遍，地图层不开
    scene.add(sun);

    const rim = new THREE.DirectionalLight(PAL.accent, 0.75);
    rim.position.set(-34, 22, -30);
    scene.add(rim);

    // 地坪：深色科技蓝 + 轻微金属感，与大屏地坪同色
    const floorGeo = this.own(new THREE.PlaneGeometry(400, 400));
    const floorMat = this.own(
      new THREE.MeshStandardMaterial({ color: PAL.floor, roughness: 0.86, metalness: 0.18 })
    );
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = false;
    scene.add(floor);

    // 网格：关卡地图的"格子感"
    const grid = this.own(new THREE.GridHelper(400, 100, PAL.accent, PAL.floorAlt));
    const gridMat = grid.material as THREE.Material | THREE.Material[];
    for (const m of Array.isArray(gridMat) ? gridMat : [gridMat]) {
      m.transparent = true;
      m.opacity = 0.16;
      m.depthWrite = false;
    }
    grid.position.y = 0.02;
    scene.add(grid);

    // 安全通道（暖黄实线），呼应工业车间的通道标线
    const laneMat = this.own(
      new THREE.MeshBasicMaterial({ color: PAL.lane, transparent: true, opacity: 0.5, depthWrite: false })
    );
    const laneGeo = this.own(new THREE.PlaneGeometry(6, 400));
    for (const x of [-STATION_SPACING_X * 2.6, STATION_SPACING_X * 2.6]) {
      const lane = new THREE.Mesh(laneGeo, laneMat);
      lane.rotation.x = -Math.PI / 2;
      lane.position.set(x, 0.03, 0);
      scene.add(lane);
    }

    // 远景柱网：给一点车间体量感，不挡视线
    const colMat = this.own(new THREE.MeshStandardMaterial({ color: PAL.column, roughness: 0.7, metalness: 0.35 }));
    const colGeo = this.own(new THREE.BoxGeometry(1.5, 12, 1.5));
    for (const x of [-34, 34]) {
      for (let i = -2; i <= 2; i++) {
        const c = new THREE.Mesh(colGeo, colMat);
        c.position.set(x, 6, i * 26);
        scene.add(c);
      }
    }
  }

  /* ---------------- 点位 ---------------- */

  private buildStations(specs: StationSpec[]): void {
    const slots = layoutStations(specs.length);

    specs.forEach((spec, i) => {
      const slot = slots[i] ?? { x: 0, z: 0, angle: Math.PI };
      const pos = new THREE.Vector3(slot.x, 0, slot.z);
      const proto = prototypeFor({ category: spec.category, name: spec.name });
      const bounds = PROTOTYPE_BOUNDS[proto];
      const radius = Math.max(2.6, Math.max(bounds.w, bounds.d) * 0.62);

      const group = new THREE.Group();
      group.position.copy(pos);
      this.scene.add(group);

      const color = STATE_COLOR[spec.state];

      // 地面光环
      const ringGeo = this.own(new THREE.RingGeometry(radius * 0.78, radius, 56));
      const ringMat = this.own(
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      );
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      group.add(ring);

      // 光柱：可挑战/未解锁的柱子更显眼，已通关的收细
      const pillarGeo = this.own(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, 1, 20, 1, true));
      const pillarMat = this.own(
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: spec.state === 'cleared' ? 0.13 : 0.26,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      );
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      const pillarH = spec.state === 'current' ? 13 : spec.state === 'cleared' ? 7 : 9;
      pillar.scale.y = pillarH;
      pillar.position.y = pillarH / 2;
      group.add(pillar);

      // 程序化替身（GLB 就绪前可见，加载失败则长期兜底 —— 绝不白屏）
      const placeholder = this.buildPlaceholder(bounds, radius, color);
      group.add(placeholder);

      // 拾取代理
      const proxyGeo = this.own(new THREE.BoxGeometry(radius * 1.9, Math.max(bounds.h, 3) * 1.15, radius * 1.9));
      const proxyMat = this.own(new THREE.MeshBasicMaterial({ visible: false }));
      const proxy = new THREE.Mesh(proxyGeo, proxyMat);
      proxy.position.y = Math.max(bounds.h, 3) * 0.55;
      proxy.userData.stationId = spec.id;
      group.add(proxy);

      // DOM 标签
      const label = this.buildLabel(spec);
      this.labelLayer.appendChild(label.el);
      // 立刻量一次"完整铭牌"尺寸并缓存：此时设备名一定可见，
      // 量到的是铭牌真实宽度（≈85–240px）。之后再也不重量 —— 否则会量到
      // 紧凑态（只留序号徽标，41px）的宽度，重叠剔除就永远失效了。
      this.measureLabel(label.el);

      const view: StationView = {
        spec,
        pos,
        angle: slot.angle,
        radius,
        group,
        ring,
        ringMat,
        pillar,
        pillarMat,
        proxy,
        placeholder,
        glbContainer: null,
        labelEl: label.el,
        labelName: label.nameEl,
        labelGrade: label.gradeEl,
        loaded: false,
      };
      this.stations.push(view);
      this.stationById.set(spec.id, view);
      this.stationPickTargets.push(proxy);
    });

    // 总览相机：按点位包围盒自动取景
    this.frameOverview();
    this.loadStationModels();
  }

  private buildPlaceholder(bounds: { w: number; h: number; d: number }, radius: number, color: number): THREE.Group {
    const g = new THREE.Group();
    const mat = this.own(
      new THREE.MeshStandardMaterial({ color: PAL.steel, roughness: 0.55, metalness: 0.55, transparent: true, opacity: 0.5 })
    );
    const boxGeo = this.own(new THREE.BoxGeometry(bounds.w * 0.62, bounds.h * 0.7, bounds.d * 0.62));
    const body = new THREE.Mesh(boxGeo, mat);
    body.position.y = bounds.h * 0.35;
    g.add(body);
    const baseGeo = this.own(new THREE.BoxGeometry(radius * 1.5, 0.24, radius * 1.5));
    const baseMat = this.own(new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3, transparent: true, opacity: 0.55 }));
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.12;
    g.add(base);
    return g;
  }

  private buildLabel(spec: StationSpec): { el: HTMLDivElement; nameEl: HTMLSpanElement; gradeEl: HTMLSpanElement | null } {
    const el = document.createElement('div');
    // 数据属性：给端到端验收/调试一个稳定抓手（标签本身 pointer-events:none，点不到）
    el.dataset.stationId = spec.id;
    el.dataset.stationState = spec.state;
    el.dataset.stationIndex = String(spec.index);
    Object.assign(el.style, {
      position: 'absolute',
      // ⚠️ 必须显式钉死 left/top：绝对定位元素若不设偏移，会先按"静态流位置"排版
      // （第 26 个标签的静态 y ≈ 26×行高），再叠加 transform —— 结果每个铭牌都被自己的
      // 静态位置往下推，越靠后的点位偏得越多，最后全挤成屏幕中间一堵文字墙。
      left: '0',
      top: '0',
      transform: 'translate(-50%, -100%)',
      padding: '2px 7px',
      borderRadius: '4px',
      border: `1px solid rgba(34,211,238,0.35)`,
      background: 'rgba(6,14,26,0.82)',
      color: '#dbeafe',
      font: '500 11px/1.45 system-ui, "Microsoft YaHei", sans-serif',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      textShadow: '0 0 6px rgba(34,211,238,0.35)',
    } as CSSStyleDeclaration);
    const chip = document.createElement('span');
    Object.assign(chip.style, {
      display: 'inline-block',
      marginRight: '5px',
      padding: '0 4px',
      borderRadius: '3px',
      font: '700 10px/1.5 system-ui, sans-serif',
      color: '#04121f',
      background: `#${STATE_COLOR[spec.state].toString(16).padStart(6, '0')}`,
    } as CSSStyleDeclaration);
    chip.textContent = String(spec.index);
    const name = document.createElement('span');
    name.textContent = spec.name;
    el.appendChild(chip);
    el.appendChild(name);
    let gradeEl: HTMLSpanElement | null = null;
    if (spec.bestGrade) {
      const g = document.createElement('span');
      Object.assign(g.style, { marginLeft: '5px', color: '#5cffa3', fontWeight: '700' } as CSSStyleDeclaration);
      g.textContent = spec.bestGrade;
      el.appendChild(g);
      gradeEl = g;
    }
    return { el, nameEl: name, gradeEl };
  }

  /**
   * 并发受限地加载 GLB。16 台设备合计 80MB+，一次性并发会把网络和主线程都打满，
   * 因此限制 4 路并发，逐个替换替身。
   */
  private loadStationModels(): void {
    const queue = this.stations.filter((s) => EQUIPMENT_GLB_MAP[s.spec.id]);
    let active = 0;
    let cursor = 0;

    const pump = () => {
      while (active < 4 && cursor < queue.length) {
        const view = queue[cursor++];
        const url = EQUIPMENT_GLB_MAP[view.spec.id];
        active++;
        loadEquipmentGLB(url)
          .then((model) => {
            if (this.disposed) return;
            _box.setFromObject(model);
            const size = _box.getSize(_v3);
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const proto = prototypeFor({ category: view.spec.category, name: view.spec.name });
            const b = PROTOTYPE_BOUNDS[proto];
            const target = Math.max(b.w, b.h, b.d, 3.4);
            const s = target / maxDim;
            model.scale.setScalar(s);
            _box.setFromObject(model);
            const center = _box.getCenter(_v3b);
            model.position.set(-center.x, -_box.min.y, -center.z);

            // ⚠️ 转向必须加在**容器**上，不能写在 model 上：
            // model 的变换是 T(-center)·R·S，R 绕的是 model 自己的原点，
            // 于是几何中心被映射到 -center + R·center —— 当 angle=π 时变成
            // (-2·center.x, ·, -2·center.z)，整台设备会从点位中心平移出去（实测偏出约半个身位），
            // 结果"异常部位"光点飘在设备旁边的空气里。容器在点位原点上，绕它转才是对的。

            // ⚠️ 不投射阴影：GLB 未合批，每个 mesh 在 shadow pass 会再画一遍
            model.traverse((o) => {
              const m = o as THREE.Mesh;
              if (m.isMesh) {
                m.castShadow = false;
                m.receiveShadow = false;
              }
            });

            const container = new THREE.Group();
            container.name = `glb:${view.spec.id}`;
            container.rotation.y = view.angle;
            container.add(model);
            view.group.add(container);
            view.glbContainer = container;
            view.placeholder.visible = false;
            view.loaded = true;
            // 若加载完成时已经处于"聚焦某台设备"的关卡内，立即按聚焦规则处理
            if (this.focusedId && this.focusedId !== view.spec.id) container.visible = false;
          })
          .catch(() => {
            // 保留程序化替身，绝不白屏
          })
          .finally(() => {
            active--;
            pump();
          });
      }
    };
    pump();
  }

  /** 通关路径：把点位按序号连成一条发光折线，做出"关卡推进"的读图感。 */
  private buildPath(): void {
    if (this.stations.length < 2) return;
    const pts = this.stations.map((s) => new THREE.Vector3(s.pos.x, 0.9, s.pos.z));
    const geo = this.own(new THREE.BufferGeometry().setFromPoints(pts));
    const mat = this.own(
      new THREE.LineBasicMaterial({ color: PAL.accent, transparent: true, opacity: 0.5, toneMapped: false })
    );
    this.pathLine = new THREE.Line(geo, mat);
    this.scene.add(this.pathLine);
  }

  /* ---------------- 数字人 ---------------- */

  private async loadCharacter(url: string): Promise<void> {
    const char = await loadGameCharacter(url);
    if (this.disposed) {
      char.dispose();
      return;
    }
    // 站在地图前侧（靠近默认相机），面向观众
    const zMax = this.stations.reduce((m, s) => Math.max(m, s.pos.z), 0);
    const xMin = this.stations.reduce((m, s) => Math.min(m, s.pos.x), 0);
    this.characterHome.set(xMin - 7, 0, zMax + 9);
    char.root.position.set(this.characterHome.x, this.characterHome.y, this.characterHome.z);
    char.root.rotation.y = Math.PI * 0.86;
    this.scene.add(char.root);
    this.character = char;
    // 角色可能在"已经进关卡"之后才加载完 ⇒ 补一次站位
    this.placeCharacterFor(this.focusedId);
  }

  /**
   * 数字人站位：地图态站在地图前侧；关卡内站到设备的**画面右侧**。
   *
   * 为什么必须跟着走：庆祝（竖大拇指/挥手）与遗憾动作都在**结算那一刻**播放，
   * 而关卡内的相机已经俯冲到设备特写 —— 人还留在地图边上就等于演给空气看。
   *
   * 为什么不能直接给世界坐标加常量：站位要"落在画面右边"而不是"落在世界 +x"。
   * 特写机位是 yaw=DIVE_YAW 的斜视，世界 +x 在画面上是斜的；直接写死偏移量会让人
   * 压到画面正中 —— 而正中恰好被结算面板（`GradePanel`，约占画布中间 46% 宽）盖住，
   * 庆祝动作白做。所以按机位基向量分解：
   *   right    = (cos yaw, 0, -sin yaw)   —— 屏幕右
   *   towardCam = (sin yaw, 0,  cos yaw)  —— 屏幕里（靠近机位）
   * 横向让开画面中央、纵向略靠机位做成前景，庆祝时人就在面板右侧的空档里。
   */
  private placeCharacterFor(id: string | null): void {
    const char = this.character;
    if (!char) return;
    if (!id) {
      char.root.position.copy(this.characterHome);
      // 地图态：正对总览机位（yaw=0 ⇒ 机位在 +Z），再偏 0.5 rad 让出 3/4 侧脸、
      // 顺便朝向场地中心（角色站在 x 最小侧）。同样要减去模型自带前向 facing。
      char.root.rotation.y = -char.facing + 0.5;
      return;
    }
    const view = this.stationById.get(id);
    if (!view) return;
    const proto = prototypeFor({ category: view.spec.category, name: view.spec.name });
    const b = PROTOTYPE_BOUNDS[proto];
    // 横向至少让开半个设备身位 + 人身位，避免站在设备轮廓里；
    // 4.2 是实测出来的下限：结算面板占画布中间约 46% 宽（右缘在 ndc.x≈0.55），
    // 人要在 ndc.x≳0.65 才不会被面板盖住，3.4 时正好压边。
    const lat = Math.max(4.2, Math.max(b.w, b.d) * 0.78);
    const fwd = 2.4;
    const rx = Math.cos(DIVE_YAW);
    const rz = -Math.sin(DIVE_YAW);
    const cx = Math.sin(DIVE_YAW);
    const cz = Math.cos(DIVE_YAW);
    const px = view.pos.x + rx * lat + cx * fwd;
    const pz = view.pos.z + rz * lat + cz * fwd;
    char.root.position.set(px, 0, pz);
    // 朝向：对准"角色 → 机位"的水平方向，再减去模型自带的本地前向 `facing`。
    // ⚠️ 别写死 π+yaw：模型未必朝 -Z（实测这只 GLB 转 180° 才正对镜头，
    // 写死会拍到后脑勺挥手）。facing 由 gameCharacter 从脚踝→脚趾量出来。
    const cam = this.stationFraming(view).pos;
    char.root.rotation.y = Math.atan2(cam.x - px, cam.z - pz) - char.facing;
  }

  /* ---------------- 相机 ---------------- */

  private frameOverview(): void {
    if (!this.stations.length) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of this.stations) {
      minX = Math.min(minX, s.pos.x);
      maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z);
      maxZ = Math.max(maxZ, s.pos.z);
    }
    const spanX = Math.max(20, maxX - minX + 26);
    const spanZ = Math.max(20, maxZ - minZ + 26);
    const target = new THREE.Vector3((minX + maxX) / 2, 2.4, (minZ + maxZ) / 2);
    const dist = Math.min(200, Math.max(58, Math.max(spanX, spanZ) * 0.95));
    // 1.02 rad ≈ 58°：斜俯视下 6 行点位会被透视压成一条带，抬到接近俯视才像"关卡地图"
    const pitch = 1.02;
    this.want.target.copy(target);
    this.want.dist = dist;
    this.want.yaw = 0;
    this.want.pitch = pitch;
    this.orbit.target.copy(target);
    this.orbit.dist = dist;
    this.orbit.yaw = 0;
    this.orbit.pitch = pitch;
  }

  /** 相机位置 = target + 球坐标(yaw, pitch, dist) */
  private camPos(out: THREE.Vector3, yaw: number, pitch: number, dist: number, target: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(pitch);
    return out.set(
      target.x + dist * cp * Math.sin(yaw),
      target.y + dist * Math.sin(pitch),
      target.z + dist * cp * Math.cos(yaw)
    );
  }

  /** 首帧硬同步：把相机直接摆到当前轨道参数上，避免第一帧从原点飞过来。 */
  private syncCamera(): void {
    this.orbit.yaw = this.want.yaw;
    this.orbit.pitch = this.want.pitch;
    this.orbit.dist = this.want.dist;
    this.orbit.target.copy(this.want.target);
    this.camPos(this.camera.position, this.orbit.yaw, this.orbit.pitch, this.orbit.dist, this.orbit.target);
    this.camera.lookAt(this.orbit.target);
  }

  /** 计算某点位的贴脸取景 */
  private stationFraming(view: StationView): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const proto = prototypeFor({ category: view.spec.category, name: view.spec.name });
    const b = PROTOTYPE_BOUNDS[proto];
    const target = new THREE.Vector3(view.pos.x, Math.max(1.6, b.h * 0.55), view.pos.z);
    const dist = Math.max(11, Math.max(b.w, b.d) * 2.35);
    const pos = new THREE.Vector3(
      target.x + dist * Math.cos(DIVE_PITCH) * Math.sin(DIVE_YAW),
      target.y + dist * Math.sin(DIVE_PITCH) + 1.4,
      target.z + dist * Math.cos(DIVE_PITCH) * Math.cos(DIVE_YAW)
    );
    return { pos, target };
  }

  private startCamAnim(toPos: THREE.Vector3, toTarget: THREE.Vector3, dur: number, stationId: string | null, onEnd?: () => void): void {
    this.camAnim = {
      fromPos: this.camera.position.clone(),
      toPos: toPos.clone(),
      fromTarget: this.orbit.target.clone(),
      toTarget: toTarget.clone(),
      t0: performance.now(),
      dur,
      stationId,
      onEnd,
    };
  }

  /* ---------------- 交互 ---------------- */

  private attachEvents(): void {
    const el = this.renderer.domElement;
    el.style.cursor = 'grab';

    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.host);
    }
  }

  private updateNdc(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.dragMoved = 0;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragging && !this.camAnim) {
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.want.yaw -= dx * 0.005;
      this.want.pitch = Math.min(1.45, Math.max(0.16, this.want.pitch + dy * 0.004));
      return;
    }
    this.updateNdc(e);
    // 进入关卡后点位代理已停用（setFocused 会清空 stationPickTargets），
    // 此时悬停对象换成故障热点 —— 否则第一步"悬停可查看读数"就是一句空话。
    if (this.focusedId) {
      const fHit = this.raycaster.intersectObjects(this.faultPickTargets, false)[0];
      const key = (fHit?.object.userData?.faultKey as string | undefined) ?? null;
      if (key !== this.hoveredFaultKey) {
        this.hoveredFaultKey = key;
        this.renderer.domElement.style.cursor = key ? 'pointer' : 'grab';
        this.hooks.onHover?.(key);
      }
      return;
    }
    const hit = this.raycaster.intersectObjects(this.stationPickTargets, false)[0];
    const id = (hit?.object.userData?.stationId as string | undefined) ?? null;
    if (id !== this.hoveredId) {
      this.hoveredId = id;
      this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
      this.hooks.onHover?.(id);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasDragging = this.dragging;
    this.dragging = false;
    this.renderer.domElement.style.cursor = this.hoveredId ? 'pointer' : 'grab';
    if (!wasDragging || this.dragMoved > 6 || this.camAnim) return;

    this.updateNdc(e);
    // 故障热点优先：进入关卡后点位代理已停用
    if (this.faultPickTargets.length) {
      const fHit = this.raycaster.intersectObjects(this.faultPickTargets, false)[0];
      const key = fHit?.object.userData?.faultKey as string | undefined;
      if (key) {
        this.hooks.onFaultPick?.(key);
        return;
      }
      return;
    }
    const hit = this.raycaster.intersectObjects(this.stationPickTargets, false)[0];
    const id = hit?.object.userData?.stationId as string | undefined;
    if (id) this.hooks.onStationPick?.(id);
  };

  private onPointerLeave = (): void => {
    this.dragging = false;
    if (this.hoveredId) {
      this.hoveredId = null;
      this.hooks.onHover?.(null);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.camAnim || this.focusedId) return;
    this.want.dist = Math.min(220, Math.max(26, this.want.dist * (1 + Math.sign(e.deltaY) * 0.08)));
  };

  /* ---------------- 公开 API ---------------- */

  /** 俯冲进入某个点位 */
  diveTo(id: string): void {
    const view = this.stationById.get(id);
    if (!view) return;
    const { pos, target } = this.stationFraming(view);
    this.setHovered(null);
    this.startCamAnim(pos, target, DIVE_MS, id, () => {
      // ⚠️ 必须把**阻尼目标** want 一起搬到特写机位，只改 orbit 是不够的：
      // 帧循环每帧都在做 `orbit += (want - orbit) * damp`，want 还停在总览机位，
      // 镜头就会"冲进去又慢慢漂出来"——玩家看到的是刚对焦就被推走，
      // 而且射线命中位置会随时间整体偏移（点不到刚看到的那个测点）。
      this.want.yaw = DIVE_YAW;
      this.want.pitch = DIVE_PITCH;
      this.want.dist = Math.max(11, pos.distanceTo(target));
      this.want.target.copy(target);
      this.orbit.yaw = this.want.yaw;
      this.orbit.pitch = this.want.pitch;
      this.orbit.dist = this.want.dist;
      this.orbit.target.copy(this.want.target);
      this.hooks.onDiveEnd?.(id);
    });
  }

  /** 回到关卡地图总览 */
  resetView(): void {
    this.focusedId = null;
    this.clearFaultSpots();
    this.placeCharacterFor(null);
    this.frameOverview();
    const pos = this.camPos(new THREE.Vector3(), this.want.yaw, this.want.pitch, this.want.dist, this.want.target);
    this.startCamAnim(pos, this.want.target, OVERVIEW_MS, null, () => {
      this.orbit.yaw = this.want.yaw;
      this.orbit.pitch = this.want.pitch;
      this.orbit.dist = this.want.dist;
      this.orbit.target.copy(this.want.target);
    });
  }

  /** 进入某点位的"关卡内"状态：其余点位压暗、标签只留当前这台 */
  setFocused(id: string | null): void {
    this.focusedId = id;
    this.stationPickTargets = id ? [] : this.stations.map((s) => s.proxy);
    if (id === null) {
      // 退出关卡：热点已清，悬停状态一并归零，避免下次进关卡带着旧 key
      this.hoveredFaultKey = null;
      this.hooks.onHover?.(null);
    }
    this.placeCharacterFor(id);
    for (const v of this.stations) {
      const isTarget = id === null || v.spec.id === id;
      const dim = id !== null && !isTarget;
      v.ringMat.opacity = dim ? 0.08 : 0.9;
      v.pillarMat.opacity = dim ? 0.03 : v.spec.state === 'cleared' ? 0.13 : 0.26;
      v.labelEl.style.display = isTarget ? '' : 'none';
      v.placeholder.visible = !v.loaded && isTarget;
      // 关卡内只保留本台设备的模型：其余设备留在场上但隐藏，避免近距离时穿帮挡视线
      if (v.glbContainer) v.glbContainer.visible = isTarget;
    }
  }

  /** 更新点位状态（通关后回写颜色） */
  setStates(states: Record<string, StationState>): void {
    for (const v of this.stations) {
      const next = states[v.spec.id];
      if (!next || next === v.spec.state) continue;
      v.spec.state = next;
      const color = STATE_COLOR[next];
      v.ringMat.color.setHex(color);
      v.pillarMat.color.setHex(color);
      v.labelEl.dataset.stationState = next;
      const chip = v.labelEl.firstElementChild as HTMLElement | null;
      if (chip) chip.style.background = `#${color.toString(16).padStart(6, '0')}`;
      // ⚠️ 这里**不要**清 labelSize 缓存：清掉之后下一帧会在"紧凑态"下重量，
      // 把只留序号徽标的 41px 当成铭牌宽度缓存起来，重叠剔除就永久失效了。
      // 铭牌尺寸只由文字决定，构建期量一次即够。
    }
  }

  /** 设置数字人动作 */
  setCharacterMood(mood: CharacterMood): void {
    this.character?.setMood(mood);
  }

  /**
   * 在已聚焦的设备周围摆出故障热点。
   * 位置是**UI 锚点**（按包围盒均匀分布在设备四周与顶部），不是零件的真实三维坐标；
   * 但"哪个异常"完全由真实遥测阈值决定，不编造。
   */
  showFaultSpots(spots: FaultSpotSpec[]): void {
    this.clearFaultSpots();
    const view = this.focusedId ? this.stationById.get(this.focusedId) : null;
    if (!view) return;
    const proto = prototypeFor({ category: view.spec.category, name: view.spec.name });
    const b = PROTOTYPE_BOUNDS[proto];
    const cy = Math.max(1.8, b.h * 0.55);
    const rx = Math.max(2.2, b.w * 0.62);
    const rz = Math.max(1.8, b.d * 0.62);

    const anchors: Array<[number, number, number]> = [
      [0, cy * 1.32, rz * 0.9],
      [rx * 0.92, cy * 0.72, 0],
      [-rx * 0.92, cy * 0.72, 0],
      [0, cy * 0.5, -rz * 0.9],
      [rx * 0.6, cy * 1.02, rz * 0.7],
      [-rx * 0.6, cy * 1.02, rz * 0.7],
    ];

    spots.slice(0, anchors.length).forEach((spec, i) => {
      const [ax, ay, az] = anchors[i];
      const color = spec.abnormal ? 0xff5a3c : 0x22d3ee;
      const group = new THREE.Group();
      group.position.set(view.pos.x + ax, ay, view.pos.z + az);

      const markerMat = this.own(
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, toneMapped: false })
      );
      const marker = new THREE.Mesh(this.own(new THREE.SphereGeometry(0.34, 16, 12)), markerMat);
      group.add(marker);

      const haloMat = this.own(
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      );
      const halo = new THREE.Mesh(this.own(new THREE.RingGeometry(0.5, 0.72, 32)), haloMat);
      halo.rotation.x = -Math.PI / 2;
      group.add(halo);

      const proxyMat = this.own(new THREE.MeshBasicMaterial({ visible: false }));
      const proxy = new THREE.Mesh(this.own(new THREE.SphereGeometry(1.15, 10, 8)), proxyMat);
      proxy.userData.faultKey = spec.key;
      group.add(proxy);

      this.faultRoot.add(group);
      this.faultPickTargets.push(proxy);
      this.faultSpots.push({ key: spec.key, abnormal: spec.abnormal, group, marker, markerMat, halo, haloMat, proxy });
    });
  }

  clearFaultSpots(): void {
    for (const s of this.faultSpots) {
      this.faultRoot.remove(s.group);
      s.marker.geometry.dispose();
      s.halo.geometry.dispose();
      s.proxy.geometry.dispose();
      s.markerMat.dispose();
      s.haloMat.dispose();
      (s.proxy.material as THREE.Material).dispose();
    }
    this.faultSpots = [];
    this.faultPickTargets = [];
    this.hoveredFaultKey = null;
  }

  /** 当前是否有故障热点在场上（供 UI 判断） */
  get hasFaultSpots(): boolean {
    return this.faultSpots.length > 0;
  }

  /** 命中测试（供测试与外部探针使用） */
  pickStationAt(ndcX: number, ndcY: number): string | null {
    this.pointerNdc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObjects(this.stationPickTargets, false)[0];
    return (hit?.object.userData?.stationId as string | undefined) ?? null;
  }

  private setHovered(id: string | null): void {
    this.hoveredId = id;
    this.hooks.onHover?.(id);
  }

  /* ---------------- 帧循环 ---------------- */

  resize(): void {
    if (this.disposed) return;
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.raf || this.disposed) return;
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick(): void {
    const dt = Math.min(0.05, this.clock.getDelta() || 0.016);
    this.elapsed += dt;

    // 相机动画
    if (this.camAnim) {
      const a = this.camAnim;
      const raw = Math.min(1, (performance.now() - a.t0) / a.dur);
      const e = easeInOutCubic(raw);
      this.camera.position.lerpVectors(a.fromPos, a.toPos, e);
      this.orbit.target.lerpVectors(a.fromTarget, a.toTarget, e);
      this.camera.lookAt(this.orbit.target);
      if (raw >= 1) {
        this.camAnim = null;
        a.onEnd?.();
      }
    } else {
      const damp = 1 - Math.exp(-dt * 9);
      this.orbit.yaw += (this.want.yaw - this.orbit.yaw) * damp;
      this.orbit.pitch += (this.want.pitch - this.orbit.pitch) * damp;
      this.orbit.dist += (this.want.dist - this.orbit.dist) * damp;
      this.orbit.target.lerp(this.want.target, damp);
      this.camPos(this.camera.position, this.orbit.yaw, this.orbit.pitch, this.orbit.dist, this.orbit.target);
      this.camera.lookAt(this.orbit.target);
    }

    // 点位光环脉动：可挑战的最亮，未解锁的最沉
    for (const v of this.stations) {
      if (this.focusedId && v.spec.id !== this.focusedId) continue;
      const base = v.spec.state === 'current' ? 0.72 : v.spec.state === 'cleared' ? 0.62 : 0.5;
      const amp = v.spec.state === 'current' ? 0.28 : 0.14;
      const speed = v.spec.state === 'current' ? 2.6 : 1.5;
      const pulse = base + amp * (0.5 + 0.5 * Math.sin(this.elapsed * speed + v.pos.x * 0.2));
      const hoverBoost = this.hoveredId === v.spec.id ? 1.35 : 1;
      v.ringMat.opacity = Math.min(1, pulse * hoverBoost);
      const scale = 1 + (this.hoveredId === v.spec.id ? 0.06 : 0) + 0.02 * Math.sin(this.elapsed * speed);
      v.ring.scale.setScalar(scale);
    }

    // 故障热点脉动：异常点更快更亮
    for (const s of this.faultSpots) {
      const speed = s.abnormal ? 5.2 : 2.2;
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * speed);
      s.markerMat.opacity = s.abnormal ? 0.6 + 0.4 * pulse : 0.45 + 0.25 * pulse;
      s.haloMat.opacity = s.abnormal ? 0.35 + 0.5 * pulse : 0.2 + 0.25 * pulse;
      s.halo.scale.setScalar(1 + (s.abnormal ? 0.5 : 0.25) * pulse);
      s.marker.scale.setScalar(1 + (s.abnormal ? 0.22 : 0.1) * pulse);
    }

    this.character?.update(this.elapsed);
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 把点位世界坐标投影到屏幕，摆放 DOM 标签。
   *
   * 26 个点位在斜俯视下会挤在一起 —— 直接全画出来就是"一堵文字墙"（实测远处 7 行铭牌互相压叠，
   * 谁都读不清）。所以做一次**屏幕空间重叠剔除**：按离相机远近排序，近的优先占位；
   * 被压住的那块收起设备名、只留序号徽标（徽标带状态色，仍能一眼看出绿/黄/红）。
   * 悬停或聚焦的那台永远完整显示。
   */
  private updateLabels(): void {
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 600;
    const cands: Array<{ v: StationView; x: number; y: number; z: number; lw: number; lh: number }> = [];
    for (const v of this.stations) {
      if (this.focusedId && v.spec.id !== this.focusedId) continue;
      const proto = prototypeFor({ category: v.spec.category, name: v.spec.name });
      const b = PROTOTYPE_BOUNDS[proto];
      _v3.set(v.pos.x, Math.max(b.h * 0.9, 3.4), v.pos.z).project(this.camera);
      if (_v3.z > 1) {
        v.labelEl.style.display = 'none';
        continue;
      }
      const size = this.labelSize.get(v.labelEl) ?? { w: 120, h: 20 };
      cands.push({
        v,
        x: (_v3.x * 0.5 + 0.5) * w,
        y: (-_v3.y * 0.5 + 0.5) * h,
        z: _v3.z,
        lw: size.w,
        lh: size.h,
      });
    }

    cands.sort((a, b) => a.z - b.z);
    const taken: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    for (const c of cands) {
      const force = this.focusedId === c.v.spec.id || this.hoveredId === c.v.spec.id;
      const box = { x0: c.x - c.lw / 2, y0: c.y - c.lh, x1: c.x + c.lw / 2, y1: c.y };
      const clash = !force && taken.some((k) => box.x0 < k.x1 && box.x1 > k.x0 && box.y0 < k.y1 && box.y1 > k.y0);
      c.v.labelEl.style.display = '';
      c.v.labelEl.style.transform = `translate(-50%, -100%) translate(${Math.round(c.x)}px, ${Math.round(c.y)}px)`;
      c.v.labelEl.style.opacity = String(Math.max(0.25, 1 - c.z * 0.85));
      // 收起设备名（只留序号徽标）；徽标很窄，几乎不会互相压住
      c.v.labelName.style.display = clash ? 'none' : '';
      if (c.v.labelGrade) c.v.labelGrade.style.display = clash ? 'none' : '';
      if (!clash) taken.push(box);
    }
  }

  /** 量一次"完整铭牌"尺寸并缓存（只在构建期调用，见调用点注释） */
  private measureLabel(el: HTMLElement): { w: number; h: number } {
    const r = el.getBoundingClientRect();
    const size = { w: Math.max(24, r.width), h: Math.max(12, r.height) };
    if (r.width > 0 && r.height > 0) this.labelSize.set(el, size);
    return size;
  }

  /* ---------------- 释放 ---------------- */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();

    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.clearFaultSpots();
    this.character?.dispose();
    this.character = null;

    // 只释放自己 new 的资源；GLB 子树共享模块级缓存，绝不能 dispose（见文件头说明）
    for (const r of this.owned) {
      try {
        r.dispose();
      } catch {
        /* 单个资源释放失败不影响整体拆场景 */
      }
    }
    this.owned = [];
    this.stationPickTargets = [];
    this.stationById.clear();
    this.stations = [];

    this.labelLayer.remove();
    this.renderer.dispose();
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}

/** 供 UI 图例复用 */
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export const STATION_STATE_META: Record<StationState, { label: string; color: string }> = {
  cleared: { label: STATE_LABEL.cleared, color: hex(STATE_COLOR.cleared) },
  current: { label: STATE_LABEL.current, color: hex(STATE_COLOR.current) },
  locked: { label: STATE_LABEL.locked, color: hex(STATE_COLOR.locked) },
};
