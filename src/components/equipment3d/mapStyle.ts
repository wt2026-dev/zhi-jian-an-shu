// 三层下钻共用的视觉口径（全国 / 城市 / 过渡），DOM-free，可单测。
// 配色沿用车间层（scene.ts standard 预设）的状态色语义：青=正常、橙=告警/检修、红=故障。

export type PillarState = "normal" | "alert" | "fault";

export interface PillarPalette {
  /** 光柱主色（three.js 数值色） */
  core: number;
  /** 柱身渐变顶端色 */
  tip: number;
  /** 底座光晕 / 涟漪环色 */
  halo: number;
  /** CSS 十六进制色，供 HUD 文案与图例复用 */
  css: string;
  label: string;
}

export const PILLAR_PALETTE: Record<PillarState, PillarPalette> = {
  normal: { core: 0x22d3ee, tip: 0x67e8f9, halo: 0x0ea5b7, css: "#22d3ee", label: "正常" },
  alert: { core: 0xf59e0b, tip: 0xfcd34d, halo: 0xb45309, css: "#f59e0b", label: "告警" },
  fault: { core: 0xf43f5e, tip: 0xfb7185, halo: 0x9f1239, css: "#f43f5e", label: "故障" },
};

/**
 * 台账/厂区 status → 光柱三态。
 * fault/critical 归入故障；warning/overhauling/maintenance 归入告警；
 * running/standby/未知按正常处理（宁可少报红，不伪造故障）。
 */
export function pillarStateOf(status: string | null | undefined): PillarState {
  if (status === "fault" || status === "critical") return "fault";
  if (status === "warning" || status === "overhauling" || status === "maintenance") return "alert";
  return "normal";
}

export function pillarPaletteOf(status: string | null | undefined): PillarPalette {
  return PILLAR_PALETTE[pillarStateOf(status)];
}

/** 下钻过渡缓动：标准 easeInOutCubic（与 CSS cubic-bezier(0.645,0.045,0.355,1) 同一意图） */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** 层间过渡时长（ms）：相机俯冲与 CSS 交叉淡入淡出共用同一常数，避免两处口径漂移 */
export const DIVE_MS = 2000;

export interface MajorCity {
  name: string;
  lng: number;
  lat: number;
  /** true = 本系统真实接入的厂区所在城市（光柱由 /api/v1/factories 驱动） */
  plant?: boolean;
}

/**
 * 主要城市标注表：仅地理常识级坐标，用于地图识读；
 * 非厂区城市只出名称，不代表任何业务数据（避免造点）。
 */
export const MAJOR_CITIES: MajorCity[] = [
  { name: "北京", lng: 116.4, lat: 39.9 },
  { name: "上海", lng: 121.47, lat: 31.23 },
  { name: "广州", lng: 113.26, lat: 23.13, plant: true },
  { name: "成都", lng: 104.07, lat: 30.57, plant: true },
  { name: "武汉", lng: 114.31, lat: 30.6, plant: true },
  { name: "南京", lng: 118.78, lat: 32.05, plant: true },
  { name: "西安", lng: 108.95, lat: 34.34 },
  { name: "重庆", lng: 106.55, lat: 29.56 },
  { name: "郑州", lng: 113.63, lat: 34.75 },
  { name: "杭州", lng: 120.16, lat: 30.27 },
  { name: "深圳", lng: 114.06, lat: 22.55 },
  { name: "沈阳", lng: 123.43, lat: 41.8 },
  { name: "哈尔滨", lng: 126.53, lat: 45.8 },
  { name: "昆明", lng: 102.83, lat: 24.88 },
  { name: "兰州", lng: 103.83, lat: 36.06 },
  { name: "乌鲁木齐", lng: 87.62, lat: 43.79 },
  { name: "拉萨", lng: 91.11, lat: 29.97 },
  { name: "呼和浩特", lng: 111.75, lat: 40.84 },
];

/** 设备状态 → 中文（与驾驶舱 statusLabel 口径一致，集中一处供面板复用） */
export function equipmentStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "运行";
    case "warning":
      return "预警";
    case "fault":
      return "故障";
    case "overhauling":
      return "检修";
    case "maintenance":
      return "维护";
    case "standby":
      return "备用";
    case "critical":
      return "紧急";
    case "offline":
      return "离线";
    default:
      return status;
  }
}

/** 面板状态条配色（与 PILLAR_PALETTE 同一色语义） */
export function equipmentStatusCss(status: string): string {
  const state = pillarStateOf(status);
  if (state === "fault") return "#f87171";
  if (state === "alert") return "#fbbf24";
  if (status === "standby") return "#60a5fa";
  return "#34d399";
}
