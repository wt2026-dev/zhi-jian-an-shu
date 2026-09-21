/**
 * 厂房类型口径（纯逻辑层：不依赖 three.js / DOM，可在 node 环境单测）。
 *
 * 口径边界：本文件**只决定"画成什么样"**（屋顶形式、体量倍率、门窗与烟囱数量、
 * 是否带行车门廊），不产出任何业务数值。设备台数、故障率、健康分一律由
 * factoryOverview 侧的真实台账聚合，产值/良率走 factoryMetrics 的估算口径。
 *
 * 角色判定顺序：真实车间名关键词优先（台账里就叫"动力一车间""重型热轧车间"），
 * 未命中才退回分区序号派生，保证任何台账下四类厂房都会出现，不会全成同一种盒子。
 */

export type FactoryRole = 'power' | 'heavy' | 'light' | 'storage';

/** 屋顶形式：平顶（含采光天窗）/ 双坡 / 锯齿形采光带 / 四坡。 */
export type RoofStyle = 'flat' | 'gable' | 'sawtooth' | 'hip';

export interface BuildingType {
  role: FactoryRole;
  roofStyle: RoofStyle;
  /** 主体高度倍率，夹在 [0.6, 1.4]，避免撑破既有相机取景 */
  heightScale: number;
  /** 面宽倍率，夹在 [0.8, 1.2]（分区地块包围盒按 w/d 算，故收紧） */
  widthScale: number;
  /** 主立面门洞宽度（米） */
  doorWidth: number;
  /** 烟囱段数（0 = 无烟囱） */
  chimneys: number;
  /** 是否带门廊钢架 + 露出的行车（吊车） */
  craneBay: boolean;
  /** 正立面每层窗格数 */
  windowCols: number;
  /** 窗层数 */
  windowRows: number;
  /** 锯齿采光跨数（roofStyle=sawtooth 时生效） */
  sawtoothBays: number;
}

export interface BuildingTypeInput {
  /** 分区序号，0 = A 区 */
  zoneIndex: number;
  /** 分区显示名，如 "A 区" */
  zoneName: string;
  /** 真实车间名（台账 workshop 字段 / 厂房标签里的车间段） */
  workshopName: string;
  /** 分区内第几栋，0 起 */
  indexInZone: number;
}

/** 关键词按"真实台账里出现过的车间名"整理；每组都带裸字兜底（成品库 / 总装车间）。 */
const POWER_RE = /动力|公用|能源|配电|变电|锅炉|水泵|风机|压缩|空压|制氧|燃气/;
const HEAVY_RE = /重型|热轧|冷轧|轧钢|烧结|炼铁|炼钢|铸造|锻|机加|machining/i;
const STORAGE_RE = /仓库|库房|仓储|库|物流|堆场|办公|综合楼|食堂|中心机房/;
const LIGHT_RE = /装配|总装|组装|包装|精整|电子|仪表|轻|线束|涂|注塑/;

/** 体量倍率的硬边界：任何输入都不允许把厂房拉出相机取景框。 */
const LIMITS = {
  height: [0.6, 1.4] as const,
  width: [0.8, 1.2] as const,
  doorWidth: [5, 18] as const,
  windowCols: [3, 10] as const,
  windowRows: [1, 3] as const,
  chimneys: [0, 3] as const,
  sawtoothBays: [0, 6] as const,
};

const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v));

/** 车间名 → 厂房角色。关键词优先，未命中按分区序号轮转。 */
export function roleOfWorkshop(workshopName: string, zoneIndex = 0, indexInZone = 0): FactoryRole {
  const name = String(workshopName ?? '');
  if (STORAGE_RE.test(name)) return 'storage';
  if (POWER_RE.test(name)) return 'power';
  if (HEAVY_RE.test(name)) return 'heavy';
  if (LIGHT_RE.test(name)) return 'light';
  const fallback: FactoryRole[] = ['power', 'heavy', 'light', 'storage'];
  return fallback[(Math.max(0, zoneIndex) + Math.max(0, indexInZone)) % fallback.length];
}

const PROFILES: Record<FactoryRole, BuildingType> = {
  // 动力站房：体量最高、多烟囱、侧窗三层（高侧采光+通风）
  power: {
    role: 'power',
    roofStyle: 'flat',
    heightScale: 1.28,
    widthScale: 0.92,
    doorWidth: 6.4,
    chimneys: 3,
    craneBay: false,
    windowCols: 4,
    windowRows: 3,
    sawtoothBays: 0,
  },
  // 重型车间：面宽最大、宽门洞 + 行车、双坡屋顶带屋脊
  heavy: {
    role: 'heavy',
    roofStyle: 'gable',
    heightScale: 1.06,
    widthScale: 1.18,
    doorWidth: 15.5,
    chimneys: 1,
    craneBay: true,
    windowCols: 6,
    windowRows: 2,
    sawtoothBays: 0,
  },
  // 轻型/标准车间：锯齿形采光带 + 最密的规整窗带
  light: {
    role: 'light',
    roofStyle: 'sawtooth',
    heightScale: 0.86,
    widthScale: 1.0,
    doorWidth: 8.2,
    chimneys: 0,
    craneBay: false,
    windowCols: 8,
    windowRows: 2,
    sawtoothBays: 5,
  },
  // 仓库 / 办公楼：矮体量、四坡顶、开洞少
  storage: {
    role: 'storage',
    roofStyle: 'hip',
    heightScale: 0.68,
    widthScale: 1.05,
    doorWidth: 5.6,
    chimneys: 0,
    craneBay: false,
    windowCols: 5,
    windowRows: 1,
    sawtoothBays: 0,
  },
};

/**
 * 解析一栋厂房的外观类型。
 * `roofStyle` 会被降级：矮厂房（heightScale < 0.8）不做锯齿采光带，
 * 因为锯齿跨会顶穿屋顶轮廓，视觉上变成漂浮的板。
 */
export function resolveBuildingType(input: BuildingTypeInput): BuildingType {
  const zoneIndex = Math.max(0, Number.isFinite(input.zoneIndex) ? input.zoneIndex : 0);
  const indexInZone = Math.max(0, Number.isFinite(input.indexInZone) ? input.indexInZone : 0);
  const role = roleOfWorkshop(input.workshopName, zoneIndex, indexInZone);
  const base = PROFILES[role];
  const type: BuildingType = { ...base, role };

  // 同一分区内做小幅错落，避免五栋厂房完全一样；确定性输入 → 结果可重放
  const stagger = indexInZone % 3;
  type.heightScale = clamp(type.heightScale * [1, 0.93, 1.06][stagger], LIMITS.height);
  type.widthScale = clamp(type.widthScale * [1, 1.05, 0.95][stagger], LIMITS.width);
  if (stagger === 1 && type.role === 'heavy') type.roofStyle = 'hip';

  if (type.heightScale < 0.8 && type.roofStyle === 'sawtooth') type.roofStyle = 'flat';
  type.chimneys = clamp(type.chimneys - (stagger === 2 ? 1 : 0), LIMITS.chimneys);
  type.doorWidth = clamp(type.doorWidth, LIMITS.doorWidth);
  type.windowCols = clamp(type.windowCols, LIMITS.windowCols);
  type.windowRows = clamp(type.windowRows, LIMITS.windowRows);
  type.sawtoothBays = type.roofStyle === 'sawtooth' ? clamp(type.sawtoothBays, LIMITS.sawtoothBays) : 0;
  type.craneBay = type.role === 'heavy' && type.doorWidth >= 12;
  return type;
}

/** 分区角色说明文案（HUD 与屋顶标牌复用，避免出现第二套判定逻辑）。 */
export function roleLabel(role: FactoryRole): string {
  if (role === 'power') return '动力站房';
  if (role === 'heavy') return '重型车间';
  if (role === 'light') return '标准轻钢车间';
  return '仓储/办公';
}
