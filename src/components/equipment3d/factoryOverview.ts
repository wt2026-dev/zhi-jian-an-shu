/**
 * 厂区总览层 —— 对标参考图 r1（深色科技风「集团各分区工厂分布」大屏）。
 *
 * 视觉要素（逐项对标 r1）：
 *   1. 分区地图     —— 建筑群按**分区**成簇布置（非均匀排一排），每区有地面地块色块、
 *                      发光描边、分区名标牌，整体呈园区平面图形态；
 *   2. 出口分布     —— 主出入口 / 物流货运口 / 人流口 / 物料周转口，标记点 + 脉冲光环
 *                      + 通向园区主路的虚线连线；
 *   3. 工业产值     —— 分区产值数字标牌（悬浮于分区上方）+ 排名角标；
 *   4. 在建工程     —— 塔吊 + 黄色脚手架线框 + 悬浮徽章，落位在空闲分区地块；
 *   5. 点击下钻     —— 拾取体（厂房 / 分区地块）透传给 scene.ts，由其切换层级。
 *
 * 数据纪律（与项目既有约定一致，见 ProductionHUD 顶部注释）：
 *   - 本模块**不产生任何业务数值**。设备数 / 异常台数 / 故障率 / 健康分 / 在岗 / 工单
 *     全部由调用方从真实台账传入；
 *   - 系统未接入的数据源（产值 / 良品率）保持 `undefined`，标牌如实显示"未接入"，
 *     **不编造金额、不模拟**；
 *   - 分区（zone）只是**空间分组**视图概念：分区名与归属由调用方给出，缺省按序号
 *     自动编号（A 区 / B 区…），不臆造"精密制造区"这类业务含义。
 *
 * 约束：
 *  - 只示意级写实（不追求贴图级），与参考图观感一致；
 *  - 不引入新库；厂房外壳用共享 BoxGeometry + 每分区共享材质，控制 Draw Call；
 *  - `document` 不存在（SSR / jsdom）时跳过所有 Canvas 贴牌，纯几何仍可构建。
 */

import * as THREE from 'three';
import { mulberry32, clamp } from './rand';

/* ============================ 数据契约 ============================ */

/** 分区（园区地块）。分区名与归属由调用方提供。 */
export interface FactoryZoneSpec {
  id: string;
  /** 分区显示名，如 "A 区" / "精密制造区" */
  name: string;
  /** 分区主题色（0xRRGGBB）。省略时按内置调色板按序分配 */
  color?: number;
  /** 分区产值（万元）。数据源未接入 → undefined → 标牌显示"未接入" */
  outputValue?: number;
  /** 良品率 %。数据源未接入 → undefined */
  yieldRate?: number;
  /** 在建工程位置说明（真实项目信息由调用方提供） */
  constructionNote?: string;
}

export interface FactoryBuildingSpec {
  id: string;
  /** 顶部标签文字，如 "1 号厂房・机加车间" */
  name: string;
  /** 所属分区 id。缺省时按序号自动分区 */
  zoneId?: string;
  /** 下钻目标车间标识（透传给调用方，本模块不解释） */
  workshopId?: string;
  /** 在岗人员数（来自真实台账/班组数据或由调用方提供） */
  staffCount?: number;
  /** 产值文案（沿用既有字符串口径；分区数字口径走 zone.outputValue） */
  outputValue?: string;
  /** 车间内设备数量 */
  deviceCount?: number;
  /** 异常设备台数（真实台账 + 遥测派生） */
  abnormalCount?: number;
  /** 设备故障率 % = 异常台数 / 设备总数（真实可算） */
  failureRate?: number;
  /** 平均健康分 0–100（真实台账派生） */
  healthAvg?: number;
  /** 未闭环工单数 */
  openWorkOrders?: number;
  /** 运行状态 */
  status?: 'normal' | 'warning' | 'fault';
}

/** 园区出入口 / 物流口标记。 */
export interface FactoryGate {
  id: string;
  name: string;
  kind: 'main' | 'logistics' | 'person' | 'buffer';
  /** 世界坐标（XZ 平面） */
  x: number;
  z: number;
  /** 朝向（弧度，绕 Y 轴） */
  heading: number;
  /** 虚线连线终点（通向园区主路） */
  linkTo: { x: number; z: number };
}

/** 分区排名口径。`output` 需接入真实产值；未接入时自动退回可算指标。 */
export type FactoryRankMetric = 'output' | 'failureRate' | 'health';

/** 供大屏 HUD 消费的分区视图（全部为真实派生值，null = 未接入）。 */
export interface FactoryZoneView {
  id: string;
  name: string;
  /** '#rrggbb' */
  color: string;
  buildingIds: string[];
  buildingNames: string[];
  deviceCount: number;
  abnormalCount: number;
  /** 设备故障率 %（无设备数据 → null） */
  failureRate: number | null;
  /** 平均健康分（无数据 → null） */
  healthAvg: number | null;
  /** 在岗人数（调用方未提供 → null） */
  staffCount: number | null;
  /** 未闭环工单数（调用方未提供 → null） */
  openWorkOrders: number | null;
  /** 产值（万元，未接入 → null） */
  outputValue: number | null;
  /** 良品率 %（未接入 → null） */
  yieldRate: number | null;
  /** 名次（1 = 最优，按 rankMetric 口径） */
  rank: number;
  rankMetric: FactoryRankMetric;
  /** 分区状态：任一台异常设备 → warning；全部故障 → fault */
  status: 'normal' | 'warning' | 'fault';
  /** 在建工程位置说明（未提供 → null） */
  constructionNote: string | null;
}

export interface FactoryOverviewOptions {
  seed: number;
  buildings: FactoryBuildingSpec[];
  /** 分区定义。省略时按厂房序号自动分为 1–4 个「A 区 / B 区…」 */
  zones?: FactoryZoneSpec[];
  shadows: boolean;
  detail: number;
  /** 排名口径。省略时：有产值 → 'output'，否则 'failureRate' */
  rankMetric?: FactoryRankMetric;
}

interface PlacedBuilding extends FactoryBuildingSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  zoneId: string;
}

interface ResolvedZone extends FactoryZoneSpec {
  color: number;
  hex: string;
  /** 分区地块中心（世界坐标） */
  siteX: number;
  siteZ: number;
  /** 分区地块包围（世界坐标，含 padding） */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  buildings: PlacedBuilding[];
}

/* ============================ 尺寸常量 ============================ */

/** 单栋厂房的默认尺寸（米）。 */
const BUILDING_W = 40;
const BUILDING_D = 28;
const BUILDING_H = 13;

/** 分区站点间距（米）。 */
const SITE_X = BUILDING_W * 2 + 78;
const SITE_Z = BUILDING_D * 2 + 66;

/** 分区内厂房的局部网格间距（米）。 */
const LOCAL_X = BUILDING_W + 22;
const LOCAL_Z = BUILDING_D + 24;

/** 分区地块外扩（米）。 */
const ZONE_PAD = 15;

/**
 * 分区站点排布（归一化方位）。
 * 1 区居中；2 区东西对望；3 区呈三角（更接近「地图分布」而非一排）；
 * 4 区四象限。排布完成后按质心回正，保证任何分区数都居中。
 */
const ZONE_SITE_SETS: Array<Array<{ sx: number; sz: number }>> = [
  [{ sx: 0, sz: 0 }],
  [
    { sx: -1, sz: 0 },
    { sx: 1, sz: 0 },
  ],
  [
    { sx: -1, sz: -1 },
    { sx: 1, sz: -1 },
    { sx: 0, sz: 1 },
  ],
  [
    { sx: -1, sz: -1 },
    { sx: 1, sz: -1 },
    { sx: -1, sz: 1 },
    { sx: 1, sz: 1 },
  ],
];

/** 候选空闲地块（用于给在建工程找落位）。 */
const QUADRANTS = [
  { sx: -1, sz: -1 },
  { sx: 1, sz: -1 },
  { sx: -1, sz: 1 },
  { sx: 1, sz: 1 },
];

/** 深色科技风分区调色板：青 / 紫 / 琥珀 / 翠。 */
const ZONE_PALETTE = [0x22d3ee, 0x8b5cf6, 0xf59e0b, 0x10b981];

function hexOf(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/* ============================ 主体 ============================ */

export class FactoryOverview {
  readonly group = new THREE.Group();
  /** 可拾取的厂房体块（userData.pick === 'building'） */
  readonly picks: THREE.Object3D[] = [];
  /** 可拾取的分区地块（userData.pick === 'zone'） */
  readonly zonePicks: THREE.Object3D[] = [];
  readonly placed: PlacedBuilding[] = [];
  /** 园区出入口标记（真实几何位置，供 HUD / 相机使用） */
  readonly gates: FactoryGate[] = [];

  private opts: FactoryOverviewOptions;
  private rng: () => number;
  private ownedTextures: THREE.Texture[] = [];
  private labelSprites: THREE.Sprite[] = [];
  private zoneSignSprites: THREE.Sprite[] = [];
  private gateSprites: THREE.Sprite[] = [];
  private roofHeatmaps: THREE.Mesh[] = [];
  private gateRings: THREE.Mesh[] = [];
  private gateBeacons: THREE.Mesh[] = [];
  private zonePlates: Array<{ zone: ResolvedZone; fill: THREE.Mesh; outline: THREE.LineLoop }> = [];
  private zoneWallMats = new Map<string, THREE.MeshStandardMaterial>();
  private zoneRoofMats = new Map<string, THREE.MeshStandardMaterial>();
  private zoneLineMats = new Map<string, THREE.LineBasicMaterial>();
  /** 地面网格呼吸用的扫描环（P3） */
  private scanRing: THREE.Mesh | null = null;
  private constructionGroup: THREE.Group | null = null;
  private zonesResolved: ResolvedZone[] = [];
  private zoneViews: FactoryZoneView[] = [];
  private rankMetric: FactoryRankMetric = 'failureRate';
  private activeZoneId: string | null = null;
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
    constructionLine: new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85 }),
    constructionMast: new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4, metalness: 0.5 }),
    constructionSlab: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.1 }),
    gatePost: new THREE.MeshStandardMaterial({ color: 0x1f3a56, roughness: 0.6, metalness: 0.35 }),
    gateLink: new THREE.LineDashedMaterial({
      color: 0x22d3ee,
      dashSize: 3.2,
      gapSize: 2.4,
      transparent: true,
      opacity: 0.7,
    }),
  };

  constructor(opts: FactoryOverviewOptions) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed + 4409);
    this.group.name = 'factoryOverview';

    this.resolveZones();
    this.layoutBuildings();
    this.recomputeZoneBoxes();
    this.buildGround();
    this.buildRoads();
    this.buildZonePlates();
    this.buildLotBoundaries();
    this.buildBuildings();
    this.buildUnderConstructionPlot();
    this.buildGates();
    this.buildZoneSignage();
    this.refreshZoneViews();
  }

  /* ======================== 分区解析与排布 ======================== */

  /** 把厂房归入分区：显式 zoneId 优先；否则按序号均分成 1–4 组。 */
  private resolveZones(): void {
    const specs = this.opts.buildings.slice(0, 5);
    const explicit = this.opts.zones?.length
      ? this.opts.zones.map((z, i) => ({ ...z, color: z.color ?? ZONE_PALETTE[i % ZONE_PALETTE.length] }))
      : null;

    let zoneSpecs: Array<FactoryZoneSpec & { color: number }>;
    let assign: (b: FactoryBuildingSpec, i: number) => string;

    if (explicit) {
      zoneSpecs = explicit;
      const known = new Set(zoneSpecs.map((z) => z.id));
      assign = (b) => (b.zoneId && known.has(b.zoneId) ? b.zoneId : zoneSpecs[0].id);
    } else {
      const n = Math.max(1, Math.min(specs.length || 1, 4));
      const letters = ['A', 'B', 'C', 'D'];
      zoneSpecs = Array.from({ length: n }, (_, i) => ({
        id: `zone-${letters[i].toLowerCase()}`,
        name: `${letters[i]} 区`,
        color: ZONE_PALETTE[i % ZONE_PALETTE.length],
      }));
      // 均分：5 栋 3 区 → 2/2/1；3 栋 3 区 → 1/1/1
      const per = Math.ceil(specs.length / n);
      assign = (_b, i) => zoneSpecs[Math.min(Math.floor(i / Math.max(1, per)), n - 1)].id;
    }

    // 站点排布 + 质心回正
    const set = ZONE_SITE_SETS[Math.min(zoneSpecs.length, 4) - 1];
    const cx = set.reduce((s, p) => s + p.sx, 0) / set.length;
    const cz = set.reduce((s, p) => s + p.sz, 0) / set.length;

    this.zonesResolved = zoneSpecs.map((z, i) => {
      const site = set[i] ?? { sx: 0, sz: 0 };
      return {
        ...z,
        hex: hexOf(z.color),
        siteX: (site.sx - cx) * SITE_X,
        siteZ: (site.sz - cz) * SITE_Z,
        minX: 0,
        maxX: 0,
        minZ: 0,
        maxZ: 0,
        buildings: [],
      };
    });

    this.zoneAssign = assign;
  }

  private zoneAssign: (b: FactoryBuildingSpec, i: number) => string = () => 'zone-a';

  /** 分区内 2 列网格排布（1 栋时居中）。 */
  private layoutBuildings(): void {
    const list = this.opts.buildings.slice(0, 5);
    const buckets = new Map<string, FactoryBuildingSpec[]>();
    for (const z of this.zonesResolved) buckets.set(z.id, []);
    list.forEach((b, i) => {
      const zid = this.zoneAssign(b, i);
      (buckets.get(zid) ?? buckets.get(this.zonesResolved[0].id)!).push(b);
    });

    for (const zone of this.zonesResolved) {
      const items = buckets.get(zone.id) ?? [];
      const cols = items.length <= 1 ? 1 : 2;
      const rows = Math.ceil(items.length / cols);
      items.forEach((b, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const rowCount = Math.min(cols, items.length - r * cols);
        const lx = (c - (rowCount - 1) / 2) * LOCAL_X;
        const lz = (r - (rows - 1) / 2) * LOCAL_Z;
        const jitterH = 1 + this.rng() * 0.18;
        const placed: PlacedBuilding = {
          ...b,
          zoneId: zone.id,
          x: zone.siteX + lx,
          z: zone.siteZ + lz,
          w: BUILDING_W * (0.94 + this.rng() * 0.12),
          d: BUILDING_D * (0.94 + this.rng() * 0.12),
          h: BUILDING_H * jitterH,
        };
        zone.buildings.push(placed);
        this.placed.push(placed);
      });
    }
  }

  private recomputeZoneBoxes(): void {
    for (const z of this.zonesResolved) {
      if (!z.buildings.length) {
        z.minX = z.siteX - 24;
        z.maxX = z.siteX + 24;
        z.minZ = z.siteZ - 20;
        z.maxZ = z.siteZ + 20;
        continue;
      }
      z.minX = Math.min(...z.buildings.map((b) => b.x - b.w / 2)) - ZONE_PAD;
      z.maxX = Math.max(...z.buildings.map((b) => b.x + b.w / 2)) + ZONE_PAD;
      z.minZ = Math.min(...z.buildings.map((b) => b.z - b.d / 2)) - ZONE_PAD;
      z.maxZ = Math.max(...z.buildings.map((b) => b.z + b.d / 2)) + ZONE_PAD;
    }
  }

  /** 整个厂区的包围尺寸（供相机取景）。 */
  get extent(): { halfX: number; halfZ: number; height: number } {
    let halfX = 40;
    let halfZ = 40;
    let height = 14;
    for (const b of this.placed) {
      halfX = Math.max(halfX, Math.abs(b.x) + b.w / 2);
      halfZ = Math.max(halfZ, Math.abs(b.z) + b.d / 2);
      height = Math.max(height, b.h);
    }
    // 在建工程 / 分区地块可能外扩到厂房之外
    if (this.constructionGroup) {
      halfX = Math.max(halfX, Math.abs(this.constructionGroup.position.x) + 20);
      halfZ = Math.max(halfZ, Math.abs(this.constructionGroup.position.z) + 16);
    }
    for (const z of this.zonesResolved) {
      halfX = Math.max(halfX, Math.abs(z.minX), Math.abs(z.maxX));
      halfZ = Math.max(halfZ, Math.abs(z.minZ), Math.abs(z.maxZ));
    }
    return { halfX: halfX + 34, halfZ: halfZ + 34, height };
  }

  /* ======================== 地面与道路 ======================== */

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

  /** 中央十字主干道 + 外环道路（园区平面图的"路网"骨架）。 */
  private buildRoads(): void {
    const { halfX, halfZ } = this.extent;
    const ROAD_W = 16;

    const addRoad = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.mat.road);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.01, z);
      m.receiveShadow = this.opts.shadows;
      this.group.add(m);
    };

    // 十字主干道：横轴分隔南北分区，纵轴分隔东西分区
    addRoad(halfX * 2.2, ROAD_W, 0, 0);
    addRoad(ROAD_W, halfZ * 2.2, 0, 0);

    // 外环路（四段）
    const ringW = 11;
    addRoad(halfX * 1.82, ringW, 0, -halfZ * 0.93);
    addRoad(halfX * 1.82, ringW, 0, halfZ * 0.93);
    addRoad(ringW, halfZ * 1.82, -halfX * 0.93, 0);
    addRoad(ringW, halfZ * 1.82, halfX * 0.93, 0);

    // 主干道中心虚线
    const dash = this.makeDashTexture();
    if (dash) {
      this.ownedTextures.push(dash);
      dash.repeat.set(halfX / 6, 1);
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(halfX * 2.2, 0.9),
        new THREE.MeshBasicMaterial({ map: dash, transparent: true, depthWrite: false, toneMapped: false })
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.03, 0);
      line.renderOrder = 2;
      this.group.add(line);

      const dash2 = dash.clone();
      dash2.needsUpdate = true;
      dash2.repeat.set(1, halfZ / 6);
      this.ownedTextures.push(dash2);
      const line2 = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, halfZ * 2.2),
        new THREE.MeshBasicMaterial({ map: dash2, transparent: true, depthWrite: false, toneMapped: false })
      );
      line2.rotation.x = -Math.PI / 2;
      line2.position.set(0, 0.03, 0);
      line2.renderOrder = 2;
      this.group.add(line2);
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

  /* ======================== 分区地块（地图形态） ======================== */

  private zoneWallMaterial(zone: ResolvedZone): THREE.MeshStandardMaterial {
    let m = this.zoneWallMats.get(zone.id);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x162a43, roughness: 0.8, metalness: 0.18 });
      // 分区色以低强度自发光方式渗入外墙（保持深色科技风，不喧宾夺主）
      m.emissive = new THREE.Color(zone.color);
      m.emissiveIntensity = 0.16;
      this.zoneWallMats.set(zone.id, m);
    }
    return m;
  }

  private zoneRoofMaterial(zone: ResolvedZone): THREE.MeshStandardMaterial {
    let m = this.zoneRoofMats.get(zone.id);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x223c58, roughness: 0.7, metalness: 0.35 });
      m.emissive = new THREE.Color(zone.color);
      m.emissiveIntensity = 0.12;
      this.zoneRoofMats.set(zone.id, m);
    }
    return m;
  }

  private zoneLineMaterial(zone: ResolvedZone): THREE.LineBasicMaterial {
    let m = this.zoneLineMats.get(zone.id);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.72 });
      this.zoneLineMats.set(zone.id, m);
    }
    return m;
  }

  private buildZonePlates(): void {
    for (const zone of this.zonesResolved) {
      const w = zone.maxX - zone.minX;
      const d = zone.maxZ - zone.minZ;
      const cx = (zone.minX + zone.maxX) / 2;
      const cz = (zone.minZ + zone.maxZ) / 2;

      // 地块底色（低透明度分区色 → 一眼看出"哪片是哪个区"）
      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({
          color: zone.color,
          transparent: true,
          opacity: 0.07,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        })
      );
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(cx, 0.06, cz);
      fill.renderOrder = 1;
      this.group.add(fill);

      // 发光描边
      const hx = w / 2;
      const hz = d / 2;
      const pts = [
        new THREE.Vector3(cx - hx, 0.09, cz - hz),
        new THREE.Vector3(cx + hx, 0.09, cz - hz),
        new THREE.Vector3(cx + hx, 0.09, cz + hz),
        new THREE.Vector3(cx - hx, 0.09, cz + hz),
      ];
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        this.zoneLineMaterial(zone)
      );
      this.group.add(outline);

      // 四角亮角标（强化"地块/地图"读感）
      const cornerLen = 6;
      const cornerPts: THREE.Vector3[] = [];
      const corners: Array<[number, number, number, number]> = [
        [cx - hx, cz - hz, 1, 1],
        [cx + hx, cz - hz, -1, 1],
        [cx + hx, cz + hz, -1, -1],
        [cx - hx, cz + hz, 1, -1],
      ];
      for (const [px, pz, sx, sz] of corners) {
        cornerPts.push(
          new THREE.Vector3(px + sx * cornerLen, 0.11, pz),
          new THREE.Vector3(px, 0.11, pz),
          new THREE.Vector3(px, 0.11, pz + sz * cornerLen)
        );
      }
      const cLine = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(cornerPts),
        new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.95 })
      );
      this.group.add(cLine);

      // 地块拾取体（点击地块 = 选中分区）
      const pick = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      pick.rotation.x = -Math.PI / 2;
      pick.position.set(cx, 0.12, cz);
      pick.userData = { pick: 'zone', zoneId: zone.id, zoneName: zone.name };
      this.group.add(pick);
      this.zonePicks.push(pick);

      this.zonePlates.push({ zone, fill, outline });
    }
  }

  /* ======================== 厂房 ======================== */

  private buildBuildings(): void {
    for (const b of this.placed) {
      const zone = this.zonesResolved.find((z) => z.id === b.zoneId) ?? this.zonesResolved[0];
      const g = new THREE.Group();
      g.name = `factoryBuilding:${b.id}`;
      g.position.set(b.x, 0, b.z);

      // 主体（共享 BoxGeometry，通过 scale 复用 → 无需为每栋新建几何）
      const body = new THREE.Mesh(this.geo.wall, this.zoneWallMaterial(zone));
      body.scale.set(b.w, b.h, b.d);
      body.position.y = b.h / 2;
      body.castShadow = this.opts.shadows;
      body.receiveShadow = this.opts.shadows;
      g.add(body);

      // 女儿墙 / 屋顶压顶
      const roof = new THREE.Mesh(this.geo.roof, this.zoneRoofMaterial(zone));
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

      // 发光檐口线（分区色 → 科技风描边 + 分区识别）
      const trimMat = new THREE.MeshStandardMaterial({
        color: zone.color,
        roughness: 0.3,
        metalness: 0.4,
        emissive: new THREE.Color(zone.color),
        emissiveIntensity: 0.55,
      });
      for (const sz of [b.d / 2 + 0.2, -b.d / 2 - 0.2]) {
        const trim = new THREE.Mesh(this.geo.strip, trimMat);
        trim.scale.set(b.w * 0.98, 0.5, 0.4);
        trim.position.set(0, b.h * 0.42, sz);
        g.add(trim);
      }

      // 产值热力顶面发光（分区色）
      const heatMat = new THREE.MeshBasicMaterial({
        color: zone.color,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
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
      this.addBuildingLabel(g, b, zone);

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
        zoneId: zone.id,
        zoneName: zone.name,
      };
      g.add(pick);
      this.picks.push(pick);

      this.group.add(g);
    }
  }

  /* ---------------- 地块边界与科技标线（每栋的场地线） ---------------- */

  private buildLotBoundaries(): void {
    for (const b of this.placed) {
      const zone = this.zonesResolved.find((z) => z.id === b.zoneId) ?? this.zonesResolved[0];
      const pad = 3.5;
      const lw = b.w + pad * 2;
      const ld = b.d + pad * 2;
      const hx = lw / 2;
      const hz = ld / 2;

      const pts = [
        new THREE.Vector3(-hx, 0.04, -hz),
        new THREE.Vector3(hx, 0.04, -hz),
        new THREE.Vector3(hx, 0.04, hz),
        new THREE.Vector3(-hx, 0.04, hz),
        new THREE.Vector3(-hx, 0.04, -hz),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.5 })
      );
      line.position.set(b.x, 0, b.z);
      this.group.add(line);
    }
  }

  /* ======================== 在建工程地块 ======================== */

  /** 在建工程落位：取离所有分区最远的空闲象限；四象限全占则放到外环之外。 */
  private constructionSite(): { x: number; z: number } {
    const used = this.zonesResolved.map((z) => ({
      sx: Math.abs(SITE_X) < 1 ? 0 : z.siteX / SITE_X,
      sz: Math.abs(SITE_Z) < 1 ? 0 : z.siteZ / SITE_Z,
    }));
    let best = QUADRANTS[0];
    let bestD = -1;
    for (const q of QUADRANTS) {
      let minD = Infinity;
      for (const u of used) minD = Math.min(minD, Math.hypot(q.sx - u.sx, q.sz - u.sz));
      if (minD > bestD) {
        bestD = minD;
        best = q;
      }
    }
    // 四象限全被分区占满 → 放到外环之外
    if (bestD < 0.5) return { x: 0, z: SITE_Z * 1.85 };
    // 分区站点已按质心回正；用同一组站点反推回正偏移，保证在建地块与分区同坐标系
    const sites = this.zonesResolved.map((z) => ({ sx: z.siteX / SITE_X, sz: z.siteZ / SITE_Z }));
    const cx = sites.reduce((s, p) => s + p.sx, 0) / Math.max(1, sites.length);
    const cz = sites.reduce((s, p) => s + p.sz, 0) / Math.max(1, sites.length);
    return { x: (best.sx - cx) * SITE_X, z: (best.sz - cz) * SITE_Z };
  }

  private buildUnderConstructionPlot(): void {
    const { x: cx, z: cz } = this.constructionSite();
    const cw = 32;
    const cd = 24;
    const ch = 9;

    const g = new THREE.Group();
    g.name = 'plot:underConstruction';
    g.position.set(cx, 0, cz);
    this.constructionGroup = g;

    const slab = new THREE.Mesh(new THREE.PlaneGeometry(cw, cd), this.mat.constructionSlab);
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(0, 0.03, 0);
    g.add(slab);

    const boxGeo = new THREE.BoxGeometry(cw, ch, cd);
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), this.mat.constructionLine);
    wire.position.set(0, ch / 2 + 0.05, 0);
    g.add(wire);

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

    const cablePts = [new THREE.Vector3(4, 17, -4), new THREE.Vector3(4, 7, -4)];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cablePts), new THREE.LineBasicMaterial({ color: 0x94a3b8 })));

    const sp = this.makeBillboard(
      (ctx, c) => {
        ctx.fillStyle = 'rgba(26, 18, 5, 0.88)';
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
      },
      512,
      180
    );
    if (sp) {
      sp.scale.set(0.2, 0.2 * (180 / 512), 1);
      sp.position.set(0, ch + 5, 0);
      g.add(sp);
    }

    this.group.add(g);
  }

  /* ======================== 园区出入口（标记点 + 连线） ======================== */

  private buildGates(): void {
    const { halfX, halfZ } = this.extent;
    const defs: Array<Omit<FactoryGate, 'heading' | 'linkTo'> & { heading: number; linkTo: { x: number; z: number } }> = [
      {
        id: 'gate-north',
        name: '厂区主出入口 · 北门',
        kind: 'main',
        x: 0,
        z: -halfZ * 0.99,
        heading: 0,
        linkTo: { x: 0, z: -halfZ * 0.55 },
      },
      {
        id: 'gate-east',
        name: '物流货运口 · 东门',
        kind: 'logistics',
        x: halfX * 0.99,
        z: 0,
        heading: Math.PI / 2,
        linkTo: { x: halfX * 0.55, z: 0 },
      },
      {
        id: 'gate-south',
        name: '人流出入口 · 南门',
        kind: 'person',
        x: 0,
        z: halfZ * 0.99,
        heading: Math.PI,
        linkTo: { x: 0, z: halfZ * 0.55 },
      },
      {
        id: 'gate-west',
        name: '物料周转口 · 西门',
        kind: 'buffer',
        x: -halfX * 0.99,
        z: halfZ * 0.42,
        heading: -Math.PI / 2,
        linkTo: { x: -halfX * 0.55, z: halfZ * 0.42 },
      },
    ];

    const GATE_COLOR: Record<FactoryGate['kind'], number> = {
      main: 0x22d3ee,
      logistics: 0x38bdf8,
      person: 0x10b981,
      buffer: 0xf59e0b,
    };
    const GATE_TAG: Record<FactoryGate['kind'], string> = {
      main: '主出入口',
      logistics: '物流口',
      person: '人流口',
      buffer: '周转口',
    };

    for (const d of defs) {
      const gate: FactoryGate = { ...d };
      this.gates.push(gate);

      const color = GATE_COLOR[gate.kind];
      const g = new THREE.Group();
      g.name = `factoryGate:${gate.id}`;
      g.position.set(gate.x, 0, gate.z);
      g.rotation.y = gate.heading;

      // 门柱 + 横梁（标记点本体）
      const postGeo = new THREE.BoxGeometry(0.8, 6, 0.8);
      const postMat = new THREE.MeshStandardMaterial({
        color: 0x1f3a56,
        roughness: 0.6,
        metalness: 0.35,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.22,
      });
      const postL = new THREE.Mesh(postGeo, postMat);
      postL.position.set(-6, 3, 0);
      const postR = new THREE.Mesh(postGeo, postMat);
      postR.position.set(6, 3, 0);
      g.add(postL, postR);

      const beam = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.7, 0.9), postMat);
      beam.position.set(0, 6, 0);
      g.add(beam);

      // 脉冲光环（标记点）
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(5.4, 6.6, 40),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.14;
      ring.renderOrder = 3;
      g.add(ring);
      this.gateRings.push(ring);

      // 竖直光柱信标（远处也能看见"出口在哪"）
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 26, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        })
      );
      beacon.position.set(0, 13, 0);
      g.add(beacon);
      this.gateBeacons.push(beacon);

      // 出口标牌
      const sp = this.makeBillboard(
        (ctx, c) => {
          ctx.fillStyle = 'rgba(6, 20, 36, 0.9)';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.strokeStyle = hexOf(color);
          ctx.lineWidth = 4;
          ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
          ctx.fillStyle = '#e0f7ff';
          ctx.font = '700 36px "Microsoft YaHei", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${GATE_TAG[gate.kind]} · ${gate.name.split(' · ')[1] ?? ''}`, c.width / 2, 54);
          ctx.fillStyle = hexOf(color);
          ctx.font = '500 22px monospace';
          ctx.fillText('GATE / 24H 智能道闸', c.width / 2, 100);
        },
        560,
        130
      );
      if (sp) {
        sp.scale.set(0.15, 0.15 * (130 / 560), 1);
        sp.position.set(0, 8.4, 0);
        g.add(sp);
        this.gateSprites.push(sp);
      }

      // 通向园区主路的虚线连线
      const linkPts = [
        new THREE.Vector3(gate.x, 0.16, gate.z),
        new THREE.Vector3(gate.linkTo.x, 0.16, gate.linkTo.z),
      ];
      const linkLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(linkPts),
        this.mat.gateLink.clone()
      );
      (linkLine.material as THREE.LineDashedMaterial).color = new THREE.Color(color);
      linkLine.computeLineDistances();
      this.group.add(linkLine);

      this.group.add(g);
    }
  }

  /* ======================== 分区产值标牌 + 排名 ======================== */

  private buildZoneSignage(): void {
    if (typeof document === 'undefined') return;
    for (const zone of this.zonesResolved) {
      const topY = Math.max(
        zone.buildings.length ? Math.max(...zone.buildings.map((b) => b.h)) : 12,
        12
      );
      const cx = (zone.minX + zone.maxX) / 2;
      const cz = (zone.minZ + zone.maxZ) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      this.paintZoneSign(ctx, canvas.width, canvas.height, zone, 0);

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      this.ownedTextures.push(tex);

      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
      );
      // Sprite scale ≈ 视口高度的比例（three 的 sizeAttenuation 会把深度乘回去 → 恒定屏幕尺寸）
      sp.scale.set(0.3, 0.3 * (300 / 720), 1);
      sp.position.set(cx, topY + 13, cz);
      sp.renderOrder = 32;
      sp.userData = { kind: 'zoneSign', zoneId: zone.id, canvas, ctx, tex };
      this.group.add(sp);
      this.zoneSignSprites.push(sp);
    }
  }

  /** 绘制分区产值标牌（产值 / 设备 / 故障率 / 排名角标）。 */
  private paintZoneSign(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    zone: ResolvedZone,
    rank: number
  ): void {
    const view = this.zoneViews.find((v) => v.id === zone.id);
    const colorHex = zone.hex;

    ctx.clearRect(0, 0, W, H);
    // 面板
    ctx.fillStyle = 'rgba(6, 20, 36, 0.88)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 5;
    ctx.shadowColor = colorHex;
    ctx.shadowBlur = 18;
    ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.shadowBlur = 0;

    // 左侧分区色条
    ctx.fillStyle = colorHex;
    ctx.fillRect(4, 4, 10, H - 8);

    // 分区名
    ctx.fillStyle = '#e6f6ff';
    ctx.font = '700 56px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(zone.name, 34, 62);

    // 排名角标
    if (rank > 0) {
      const label = `#${rank}`;
      ctx.font = '700 42px monospace';
      const tw = ctx.measureText(label).width;
      const bx = W - 30 - tw - 28;
      ctx.fillStyle = rank === 1 ? 'rgba(16,185,129,0.22)' : 'rgba(34,211,238,0.16)';
      ctx.fillRect(bx, 26, tw + 28, 62);
      ctx.strokeStyle = rank === 1 ? '#10b981' : colorHex;
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, 26, tw + 28, 62);
      ctx.fillStyle = rank === 1 ? '#6ee7b7' : '#a5f3fc';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 14, 58);
    }

    // 分隔线
    ctx.fillStyle = 'rgba(34,211,238,0.35)';
    ctx.fillRect(34, 106, W - 68, 2);

    // 产值（未接入如实标注）
    ctx.font = '500 26px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('工业产值', 34, 146);

    ctx.textAlign = 'right';
    if (view?.outputValue != null) {
      ctx.fillStyle = '#34d399';
      ctx.font = '700 52px "Microsoft YaHei", monospace';
      ctx.fillText(`${view.outputValue.toLocaleString('zh-CN')}`, W - 120, 148);
      ctx.font = '500 26px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#6ee7b7';
      ctx.fillText('万元', W - 34, 152);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.font = '500 34px "Microsoft YaHei", sans-serif';
      ctx.fillText('未接入', W - 34, 148);
    }

    // 设备 / 故障率 / 良品率
    ctx.textAlign = 'left';
    ctx.font = '500 25px "Microsoft YaHei", monospace';
    const devText = view ? `设备 ${view.deviceCount} 台` : '设备 —';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(devText, 34, 208);

    const frText = view && view.failureRate != null ? `故障率 ${view.failureRate.toFixed(1)}%` : '故障率 未接入';
    ctx.fillStyle = view && view.failureRate != null && view.failureRate > 0 ? '#fbbf24' : '#94a3b8';
    ctx.fillText(frText, 260, 208);

    const yrText = view && view.yieldRate != null ? `良品率 ${view.yieldRate.toFixed(1)}%` : '良品率 未接入';
    ctx.fillStyle = view && view.yieldRate != null ? '#34d399' : '#64748b';
    ctx.fillText(yrText, 34, 258);

    // 排名口径说明
    ctx.font = '400 20px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(148,163,184,0.85)';
    ctx.textAlign = 'right';
    ctx.fillText(`排名口径 · ${RANK_LABEL[this.rankMetric]}`, W - 34, 258);
  }

  /** 重绘所有分区标牌（排名 / 指标变化时调用）。 */
  private repaintZoneSigns(): void {
    for (const sp of this.zoneSignSprites) {
      const ud = sp.userData as {
        zoneId: string;
        canvas: HTMLCanvasElement;
        ctx: CanvasRenderingContext2D;
        tex: THREE.CanvasTexture;
      };
      const zone = this.zonesResolved.find((z) => z.id === ud.zoneId);
      if (!zone) continue;
      const rank = this.zoneViews.find((v) => v.id === zone.id)?.rank ?? 0;
      this.paintZoneSign(ud.ctx, ud.canvas.width, ud.canvas.height, zone, rank);
      ud.tex.needsUpdate = true;
    }
  }

  /* ======================== 分区指标聚合 ======================== */

  /** 从真实台账派生的分区视图（供大屏 HUD）。 */
  private refreshZoneViews(): void {
    const views: FactoryZoneView[] = this.zonesResolved.map((zone) => {
      const list = zone.buildings;
      const deviceCount = sum(list.map((b) => b.deviceCount).filter(isNum));
      const abnormalCount = sum(list.map((b) => b.abnormalCount).filter(isNum));
      const hasDevice = list.some((b) => isNum(b.deviceCount));
      const healths = list.map((b) => b.healthAvg).filter(isNum);
      const staffs = list.map((b) => b.staffCount).filter(isNum);
      const orders = list.map((b) => b.openWorkOrders).filter(isNum);
      const zoneSpec = this.zonesResolved.find((z) => z.id === zone.id)!;

      const failureRate = hasDevice && deviceCount > 0 ? (abnormalCount / deviceCount) * 100 : null;
      const healthAvg = healths.length ? sum(healths) / healths.length : null;
      const status: FactoryZoneView['status'] =
        list.some((b) => b.status === 'fault') && list.every((b) => b.status !== 'normal')
          ? 'fault'
          : abnormalCount > 0 || list.some((b) => b.status === 'warning' || b.status === 'fault')
            ? 'warning'
            : 'normal';

      return {
        id: zone.id,
        name: zone.name,
        color: zone.hex,
        buildingIds: list.map((b) => b.id),
        buildingNames: list.map((b) => b.name),
        deviceCount,
        abnormalCount,
        failureRate,
        healthAvg,
        staffCount: staffs.length ? sum(staffs) : null,
        openWorkOrders: orders.length ? sum(orders) : null,
        outputValue: isNum(zoneSpec.outputValue) ? zoneSpec.outputValue : null,
        yieldRate: isNum(zoneSpec.yieldRate) ? zoneSpec.yieldRate : null,
        rank: 0,
        rankMetric: this.rankMetric,
        status,
        constructionNote: zoneSpec.constructionNote ?? null,
      };
    });

    // 排名口径：显式指定 > 有产值则按产值 > 否则按故障率（唯一真实可算的经营性指标）
    const anyOutput = views.some((v) => v.outputValue != null);
    this.rankMetric = this.opts.rankMetric ?? (anyOutput ? 'output' : 'failureRate');
    this.applyRanks(views);
    this.zoneViews = views;
  }

  private applyRanks(views: FactoryZoneView[]): void {
    const metric = this.rankMetric;
    const keyOf = (v: FactoryZoneView): number | null => {
      if (metric === 'output') return v.outputValue;
      if (metric === 'health') return v.healthAvg;
      return v.failureRate;
    };
    // 产值 / 健康分：越大越好；故障率：越小越好
    const desc = metric !== 'failureRate';
    const scored = views
      .map((v) => ({ v, k: keyOf(v) }))
      .filter((x) => x.k != null) as Array<{ v: FactoryZoneView; k: number }>;
    scored.sort((a, b) => (desc ? b.k - a.k : a.k - b.k));
    scored.forEach((x, i) => {
      x.v.rank = i + 1;
      x.v.rankMetric = metric;
    });
    // 无数据的排在最后，不参与名次（rank = 0 → 标牌不显示角标）
    for (const v of views) if (!scored.some((x) => x.v === v)) v.rank = 0;
  }

  /* ======================== 对外 API ======================== */

  /** 分区视图（大屏 HUD 消费）。 */
  get zones(): FactoryZoneView[] {
    return this.zoneViews.map((v) => ({ ...v, buildingIds: [...v.buildingIds], buildingNames: [...v.buildingNames] }));
  }

  /** 厂房 → 分区 id。 */
  zoneOf(buildingId: string): string | null {
    return this.placed.find((b) => b.id === buildingId)?.zoneId ?? null;
  }

  /** 取某栋厂房的包围盒（供相机下钻取景）。 */
  boxOf(buildingId: string): { x: number; z: number; w: number; d: number; h: number } | null {
    const b = this.placed.find((p) => p.id === buildingId);
    if (!b) return null;
    return { x: b.x, z: b.z, w: b.w, d: b.d, h: b.h };
  }

  /** 取某分区的包围盒（供相机取景 / 下钻）。 */
  boxOfZone(zoneId: string): { x: number; z: number; w: number; d: number; h: number } | null {
    const z = this.zonesResolved.find((p) => p.id === zoneId);
    if (!z) return null;
    const h = Math.max(z.buildings.length ? Math.max(...z.buildings.map((b) => b.h)) : 12, 12);
    return {
      x: (z.minX + z.maxX) / 2,
      z: (z.minZ + z.maxZ) / 2,
      w: z.maxX - z.minX,
      d: z.maxZ - z.minZ,
      h,
    };
  }

  /** 更新排名口径并重绘标牌。 */
  setRankMetric(metric: FactoryRankMetric): void {
    this.rankMetric = metric;
    this.applyRanks(this.zoneViews);
    this.repaintZoneSigns();
  }

  get rankMetricValue(): FactoryRankMetric {
    return this.rankMetric;
  }

  /** 选中 / 取消选中分区：非选中分区的地块与标牌变暗。 */
  setActiveZone(zoneId: string | null): void {
    this.activeZoneId = zoneId;
    for (const plate of this.zonePlates) {
      const on = zoneId === null || plate.zone.id === zoneId;
      (plate.fill.material as THREE.MeshBasicMaterial).opacity = on ? (zoneId === null ? 0.07 : 0.16) : 0.02;
      const lineMat = plate.outline.material as THREE.LineBasicMaterial;
      lineMat.opacity = on ? (zoneId === null ? 0.72 : 1) : 0.18;
    }
    for (const sp of this.zoneSignSprites) {
      const m = sp.material as THREE.SpriteMaterial;
      m.opacity = zoneId === null ? 1 : sp.userData.zoneId === zoneId ? 1 : 0.28;
    }
    for (const sp of this.labelSprites) {
      const m = sp.material as THREE.SpriteMaterial;
      const bid = String(sp.userData.buildingId ?? '');
      const zid = this.zoneOf(bid);
      m.opacity = zoneId === null ? 1 : zid === zoneId ? 1 : 0.22;
    }
  }

  get activeZone(): string | null {
    return this.activeZoneId;
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
      const m = this.scanRing.material as THREE.MeshBasicMaterial;
      m.opacity = 0.1 + (Math.sin(t * 0.9) * 0.5 + 0.5) * 0.16;
      this.scanRing.rotation.z = t * 0.06;
    }
    // 厂房屋顶产值热力光波
    for (let i = 0; i < this.roofHeatmaps.length; i++) {
      const mat = this.roofHeatmaps[i].material as THREE.MeshBasicMaterial;
      mat.opacity = 0.2 + (Math.sin(t * 1.5 + i * 0.7) * 0.5 + 0.5) * 0.14;
    }
    // 出口脉冲光环：向外扩散 + 淡出
    for (let i = 0; i < this.gateRings.length; i++) {
      const ring = this.gateRings[i];
      const phase = (t * 0.55 + i * 0.3) % 1;
      const s = 0.75 + phase * 0.7;
      ring.scale.set(s, s, 1);
      const m = ring.material as THREE.MeshBasicMaterial;
      m.opacity = 0.55 * (1 - phase);
    }
    // 出口信标呼吸
    for (let i = 0; i < this.gateBeacons.length; i++) {
      const m = this.gateBeacons[i].material as THREE.MeshBasicMaterial;
      m.opacity = 0.1 + (Math.sin(t * 1.2 + i * 0.9) * 0.5 + 0.5) * 0.14;
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
    this.zoneSignSprites.length = 0;
    this.gateSprites.length = 0;
    this.roofHeatmaps.length = 0;
    this.gateRings.length = 0;
    this.gateBeacons.length = 0;
    this.zonePlates.length = 0;
    this.zonePicks.length = 0;
    this.picks.length = 0;
    this.placed.length = 0;
    this.gates.length = 0;
    this.zoneViews.length = 0;
    this.zonesResolved.length = 0;
    this.zoneWallMats.clear();
    this.zoneRoofMats.clear();
    this.zoneLineMats.clear();
    this.constructionGroup = null;
    this.group.clear();
  }

  /* ======================== 贴牌工具 ======================== */

  /** 生成一个恒定屏幕尺寸的贴牌 Sprite（SSR / 无 canvas 时返回 null）。 */
  private makeBillboard(
    paint: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void,
    w: number,
    h: number
  ): THREE.Sprite | null {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    paint(ctx, c);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.ownedTextures.push(tex);
    return new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
  }

  /* ======================== 厂房悬浮综合信息标牌 ======================== */

  private addBuildingLabel(parent: THREE.Group, b: PlacedBuilding, zone: ResolvedZone): void {
    const sp = this.makeBillboard(
      (ctx, c) => {
        // 半透明科技深色面板
        ctx.fillStyle = 'rgba(6, 20, 36, 0.86)';
        ctx.fillRect(0, 0, c.width, c.height);

        // 分区色发光外边框
        ctx.strokeStyle = zone.hex;
        ctx.lineWidth = 6;
        ctx.shadowColor = zone.hex;
        ctx.shadowBlur = 20;
        ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
        ctx.shadowBlur = 0;

        // 四角亮角标
        const corner = 24;
        ctx.fillStyle = zone.hex;
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

        // 分区归属徽章
        ctx.font = '600 26px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = zone.hex;
        ctx.fillText(`· ${zone.name}`, 66 + ctx.measureText('告警中').width + 22, 52);

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
        ctx.shadowColor = zone.hex;
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#e0f7ff';
        ctx.fillText(b.name, 44, 136);
        ctx.shadowBlur = 0;

        // 分隔横线
        if (typeof ctx.createLinearGradient === 'function') {
          const grad = ctx.createLinearGradient(44, 0, c.width - 44, 0);
          grad.addColorStop(0, hexAlpha(zone.hex, 0.8));
          grad.addColorStop(0.7, hexAlpha(zone.hex, 0.3));
          grad.addColorStop(1, hexAlpha(zone.hex, 0));
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = hexAlpha(zone.hex, 0.6);
        }
        ctx.fillRect(44, 192, c.width - 88, 3);

        // 底部运行指标（缺数据时显示"未接入"，不编造默认值）
        // 在岗人数仅在调用方提供真实班组数据时展示，否则该槽位改显示真实工单数。
        const firstText = isNum(b.staffCount)
          ? `在岗: ${b.staffCount} 人`
          : isNum(b.openWorkOrders)
            ? `工单: ${b.openWorkOrders} 单`
            : '在岗: 未接入';
        const deviceText = `设备: ${b.deviceCount ?? '未接入'} 台`;
        const frText = isNum(b.failureRate) ? `故障率: ${b.failureRate.toFixed(1)}%` : '故障率: 未接入';
        const outputText = b.outputValue ?? '未接入';

        ctx.font = '500 30px "Microsoft YaHei", monospace';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = isNum(b.staffCount) ? '#94a3b8' : '#a78bfa';
        ctx.fillText(firstText, 44, 260);

        ctx.fillStyle = '#38bdf8';
        ctx.fillText(deviceText, 330, 260);

        ctx.fillStyle = isNum(b.failureRate) && b.failureRate > 0 ? '#fbbf24' : '#94a3b8';
        ctx.fillText(frText, 620, 260);

        ctx.fillStyle = b.outputValue ? '#34d399' : '#94a3b8';
        ctx.textAlign = 'right';
        ctx.fillText(`产值: ${outputText}`, c.width - 44, 260);
      },
      1024,
      340
    );
    if (!sp) return;

    // 恒定屏幕尺寸：拉远到厂区总览也能读清厂房名与指标
    sp.scale.set(0.24, 0.24 * (340 / 1024), 1);
    sp.position.set(0, b.h + 6.8, 0);
    sp.renderOrder = 30;
    sp.userData = { kind: 'buildingLabel', buildingId: b.id };
    parent.add(sp);
    this.labelSprites.push(sp);
  }
}

/* ============================ 工具 ============================ */

const RANK_LABEL: Record<FactoryRankMetric, string> = {
  output: '工业产值',
  failureRate: '设备故障率（低→高）',
  health: '设备健康分（高→低）',
};

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
