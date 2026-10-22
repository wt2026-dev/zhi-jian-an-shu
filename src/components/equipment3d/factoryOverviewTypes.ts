/**
 * 厂区总览数据契约域（自 factoryOverview.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：分区/建筑/大门/排序口径/视图投影的类型契约（FactoryZoneSpec、
 * FactoryBuildingSpec、FactoryGate、FactoryRankMetric、FactoryZoneView、
 * FactoryOverviewOptions、PlacedBuilding、ResolvedZone）、园区布局常量
 * （建筑基准尺寸/场地网格/象限/标牌锚点/分区调色板）与共享小工具
 * （hexOf / workshopFromLabel / RANK_LABEL / defaultBuildingSpecs）。
 * facilityLedgerSpecs、ProductionHUD、scene 等外部消费方 import 同步指向本文件。
 */
import { clamp } from './rand';
import type { BuildingType } from './factoryBuildingTypes';

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
  /** outputValue / yieldRate 为台账派生估算口径 → 标牌打「估算」角标 */
  estimated?: boolean;
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
  /** 在岗人数。台账未给出 → undefined → 标牌如实显示"未接入" */
  staffCount?: number;
  /** 年产值（万元）。未接入 → undefined；字符串口径已废弃，避免标牌兜底编数 */
  outputValue?: number;
  /** staffCount / outputValue 为台账派生估算口径 → 标牌打「估算」角标 */
  estimated?: boolean;
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
  /** 产值 / 良率 / 在岗为台账派生估算 → HUD 打「估算」角标 */
  estimated: boolean;
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

export interface PlacedBuilding extends FactoryBuildingSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  zoneId: string;
  /** 外观类型（由车间名 + 分区/分区内序号解析，只决定画成什么样） */
  type: BuildingType;
}

export interface ResolvedZone extends FactoryZoneSpec {
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
export const BUILDING_W = 40;
export const BUILDING_D = 28;
export const BUILDING_H = 13;

/** 分区站点间距（米）。紧凑排布 → 建筑在取景中占更大画面，接近参考图 r1 的观感。 */
export const SITE_X = BUILDING_W * 2 + 12;
export const SITE_Z = BUILDING_D * 2 + 28;

/** 分区内厂房的局部网格间距（米）。 */
export const LOCAL_X = BUILDING_W + 22;
export const LOCAL_Z = BUILDING_D + 24;

/** 分区地块外扩（米）。 */
export const ZONE_PAD = 15;

/**
 * 分区站点排布（归一化方位）。
 * 1 区居中；2 区东西对望；3 区呈三角（更接近「地图分布」而非一排）；
 * 4 区四象限。排布完成后按质心回正，保证任何分区数都居中。
 */
export const ZONE_SITE_SETS: Array<Array<{ sx: number; sz: number }>> = [
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
export const QUADRANTS = [
  { sx: -1, sz: -1 },
  { sx: 1, sz: -1 },
  { sx: -1, sz: 1 },
  { sx: 1, sz: 1 },
];

/**
 * 三块分区立牌的锚点样式，按分区序号循环：A 地块西北角 / B 东南角 / C 东北角+最高带。
 * fx/fz 是地块半宽的倍数（±1 = 地块边缘），band 是"高出本区最高屋顶"的米数。
 *
 * 为什么不能都悬在各自地块正上方：这些牌子是**恒定屏幕尺寸**
 * （sizeAttenuation:false，见 makeBillboard 的注释），远景下世界坐标挪二十米
 * 只平移十几个像素，三块 267×104 的牌 + 四块出入口牌 + 在建牌一旦与相机视线同轴
 * 就叠成一片 —— 上一轮验收的 "南门牌压 C 区牌 58px" 就是这么来的。
 * 尤其园区远端（+Z 一侧）角度压缩最厉害，横向几乎挤不动，只能靠高度带拉开。
 *
 * 这九个数字全部由 scratch/label-overlap-probe.ts 按 scene.frameFactory() 的取景
 * 相机反解投影试出来：1920×1080 下 13 块贴牌两两零重叠、八块大字牌净距 ≥80px；
 * 1024×768 / 860×800 窄屏因为贴牌按视口高度定尺寸、相对更大，退到 ≥58px 零重叠。
 * 改取景参数须重跑该探针 + tests/factory-label-decollision.test.ts。
 */
export const ZONE_SIGN_ANCHORS: Array<{ fx: number; fz: number; band: number }> = [
  { fx: -0.98, fz: -0.75, band: 34 },
  { fx: 0.36, fz: 0.34, band: 13 },
  { fx: 0.55, fz: 0.44, band: 74 },
];

/** 深色科技风分区调色板：青 / 紫 / 琥珀 / 翠。 */
export const ZONE_PALETTE = [0x22d3ee, 0x8b5cf6, 0xf59e0b, 0x10b981];

export function hexOf(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * 从厂房标签反解车间名（"3 号厂房・机加工车间" → "机加工车间"）。
 * 调用方没传 workshopId 时的兜底，只用于外观类型判定，不参与任何数值口径。
 */
export function workshopFromLabel(label: string): string {
  const s = String(label ?? '');
  const i = s.lastIndexOf('・');
  return i >= 0 ? s.slice(i + 1) : s;
}


export const RANK_LABEL: Record<FactoryRankMetric, string> = {
  output: '工业产值',
  failureRate: '设备故障率（低→高）',
  health: '设备健康分（高→低）',
};




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
