// 三层下钻面板的真实数据聚合（纯函数、DOM-free，供全国层/城市层与单测共用）。
// 数据纪律：所有指标均由 /api/v1 真实载荷推导；系统未采集的指标（工业产值、
// 研发投入、出口额等）不在面板出现，而不是留「未接入」占位。
// 口径纪律：厂区设备数/健康分一律取 /factories/:id 的设备明细，不取 /factories 的
// stats 聚合列（详见 FactoryTruth 注释）。
import type { FactorySummary } from "../../api/factoryApi";
import { equipmentStatusCss, equipmentStatusLabel } from "./mapStyle";

export interface OrderLike {
  status?: string;
  priority?: string;
  equipmentId?: string;
  createdTimestamp?: number;
  createdAt?: string;
}

/** 设备行：兼容 /equipments（camelCase）与 /factories/:id（snake_case，调用侧已归一） */
export interface EquipmentLike {
  id?: string;
  status: string;
  healthScore?: number;
}

export interface StatusRow {
  key: string;
  label: string;
  css: string;
  count: number;
  share: number;
}

/**
 * 厂区真实台账行：设备明细来自 /factories/:id 的 equipments 数组，告警数按设备 ID 归属工单。
 * 刻意不使用 /factories 返回的 stats —— 它的 equipment_count 是 SQL
 * `COUNT(e.id)` 配 work_orders LEFT JOIN 的结果，带进行中工单的设备会被重复计数
 * （广州主厂真实 16 台被报成 18 台），avg_health 同样被这份重复加权带偏。
 */
export interface FactoryTruth {
  id: string;
  name: string;
  city: string;
  region: string;
  lng: number;
  lat: number;
  status: string;
  isDemo: boolean;
  equipmentCount: number;
  runningCount: number;
  faultCount: number;
  alertCount: number;
  avgHealth: number | null;
  /** 设备数占全国最大厂区的比例（0-1，供条形宽度） */
  share: number;
}

/** 区域聚合行（健康分为区域内全部设备的真均值） */
export interface RegionRow {
  region: string;
  factoryCount: number;
  equipmentCount: number;
  faultCount: number;
  alertCount: number;
  avgHealth: number | null;
  share: number;
}

export interface MapTotals {
  factoryCount: number;
  equipmentCount: number;
  faultCount: number;
  alertCount: number;
  avgHealth: number | null;
}

export interface DayBucket {
  /** MM-DD */
  label: string;
  /** 当日 00:00 的本地时间戳 */
  at: number;
  count: number;
}

/** 进行中的工单状态（未闭环）：与后端厂区 alert_count 的口径一致，含待派单 */
export const OPEN_ORDER_STATUSES = new Set(["created", "dispatched", "in_progress", "pending_acceptance"]);

/** 本地日期键（YYYY-MM-DD），避免用 toISOString 把 UTC 当成今天 */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 兼容后端两种时间写法：`2026/9/14 14:57:22`（zh-CN 本地串）与 ISO 串。
 * 注意不能先把 / 换成 - ——`2026-9-14T14:57:22` 在 V8 里是非法格式，会静默变 NaN。
 */
function parseLooseMs(raw: string): number | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0).getTime();
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/** 工单创建时间（epoch ms）：优先 createdTimestamp，回退解析 createdAt */
export function orderCreatedAtMs(o: OrderLike): number | null {
  if (typeof o.createdTimestamp === "number" && o.createdTimestamp > 0) return o.createdTimestamp;
  if (!o.createdAt) return null;
  return parseLooseMs(o.createdAt);
}

/**
 * 设备在线率口径：运行台数 / 总台数（与驾驶舱 CockpitDashboardView 保持一致），
 * 一台设备只有处于 running 才计入在线，预警/检修/故障均不算。
 */
export function onlineRateOf(equipments: EquipmentLike[]): number | null {
  if (equipments.length === 0) return null;
  const running = equipments.filter((e) => e.status === "running").length;
  return Math.round((running / equipments.length) * 1000) / 10;
}

/** 设备状态分布（按台数降序，占比供条形使用） */
export function statusRowsOf(equipments: EquipmentLike[]): StatusRow[] {
  const counts = new Map<string, number>();
  for (const e of equipments) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
  const total = equipments.length || 1;
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: equipmentStatusLabel(key),
      css: equipmentStatusCss(key),
      count,
      share: count / total,
    }))
    .sort((a, b) => b.count - a.count);
}

/** 健康分均值（无数据返回 null，面板显示 — 而不是 0） */
export function avgHealthOf(equipments: EquipmentLike[]): number | null {
  const scored = equipments.filter((e) => typeof e.healthScore === "number" && e.healthScore > 0);
  if (scored.length === 0) return null;
  return Math.round((scored.reduce((s, e) => s + (e.healthScore ?? 0), 0) / scored.length) * 10) / 10;
}

/** 区域聚合行（按设备数降序 + 归一化占比；健康分按设备数加权 = 区域内全体设备真均值） */
export function regionRowsOf(rows: FactoryTruth[]): RegionRow[] {
  const groups = new Map<string, FactoryTruth[]>();
  for (const r of rows) groups.set(r.region, [...(groups.get(r.region) ?? []), r]);
  const list = [...groups.values()].map((group) => {
    const equipmentCount = group.reduce((s, r) => s + r.equipmentCount, 0);
    const scored = group.filter((r) => r.avgHealth != null);
    const weight = scored.reduce((s, r) => s + r.equipmentCount, 0);
    return {
      region: group[0].region,
      factoryCount: group.length,
      equipmentCount,
      faultCount: group.reduce((s, r) => s + r.faultCount, 0),
      alertCount: group.reduce((s, r) => s + r.alertCount, 0),
      avgHealth: weight > 0 ? Math.round((scored.reduce((s, r) => s + (r.avgHealth ?? 0) * r.equipmentCount, 0) / weight) * 10) / 10 : null,
      share: 0,
    };
  });
  const max = list.reduce((m, r) => Math.max(m, r.equipmentCount), 0);
  return list
    .map((r) => ({ ...r, share: max > 0 ? r.equipmentCount / max : 0 }))
    .sort((a, b) => b.equipmentCount - a.equipmentCount);
}

/** 全国合计 */
export function truthTotals(rows: FactoryTruth[]): MapTotals {
  const t = {
    factoryCount: rows.length,
    equipmentCount: rows.reduce((s, r) => s + r.equipmentCount, 0),
    faultCount: rows.reduce((s, r) => s + r.faultCount, 0),
    alertCount: rows.reduce((s, r) => s + r.alertCount, 0),
    healthSum: 0,
    healthWeight: 0,
  };
  for (const r of rows) {
    if (r.avgHealth != null) {
      t.healthSum += r.avgHealth * r.equipmentCount;
      t.healthWeight += r.equipmentCount;
    }
  }
  return {
    factoryCount: t.factoryCount,
    equipmentCount: t.equipmentCount,
    faultCount: t.faultCount,
    alertCount: t.alertCount,
    avgHealth: t.healthWeight > 0 ? Math.round((t.healthSum / t.healthWeight) * 10) / 10 : null,
  };
}

/**
 * 单厂区真实台账：devices 取自 /factories/:id 的 equipments 明细（一行一台设备，无 JOIN 放大），
 * orders 为全部工单（内部只统计未闭环的那些，并按 equipmentId 归属到本厂设备）。
 */
export function toFactoryTruth(
  factory: FactorySummary,
  devices: EquipmentLike[],
  orders: OrderLike[]
): FactoryTruth {
  const ids = new Set(devices.map((d) => d.id).filter((id): id is string => typeof id === "string"));
  return {
    id: factory.id,
    name: factory.name,
    city: factory.city,
    region: factory.region,
    lng: factory.geo.lng,
    lat: factory.geo.lat,
    status: factory.status,
    isDemo: factory.isDemo,
    equipmentCount: devices.length,
    runningCount: devices.filter((d) => d.status === "running").length,
    faultCount: devices.filter((d) => d.status === "fault" || d.status === "overhauling").length,
    alertCount: orders.filter((o) => OPEN_ORDER_STATUSES.has(o.status ?? "") && ids.has(o.equipmentId ?? "")).length,
    avgHealth: avgHealthOf(devices),
    share: 0,
  };
}

/** 光柱状态：先按真实故障/告警数，再回退厂区台账状态（不凭 isDemo 猜颜色） */
export function factoryPillarStatusOf(row: Pick<FactoryTruth, "faultCount" | "alertCount" | "status">): string {
  if (row.faultCount > 0) return "fault";
  if (row.alertCount > 0) return "warning";
  return row.status;
}

/** 按设备数降序并回填归一化占比（面板条形使用） */
export function withTruthShare(rows: FactoryTruth[]): FactoryTruth[] {
  const max = rows.reduce((m, r) => Math.max(m, r.equipmentCount), 0);
  return rows.map((r) => ({ ...r, share: max > 0 ? r.equipmentCount / max : 0 })).sort((a, b) => b.equipmentCount - a.equipmentCount);
}

/**
 * 按自然日分桶（含空日，保证时间轴连续），返回 windowDays 天、旧→新。
 * 报修趋势用真实工单创建时间，不做任何补零造假以外的推断。
 */
export function bucketOrdersByDay(orders: OrderLike[], now: number, windowDays = 14): DayBucket[] {
  const dayMs = 86400000;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const start = startOfDay.getTime() - (windowDays - 1) * dayMs;
  const buckets: DayBucket[] = [];
  const index = new Map<number, number>();
  for (let i = 0; i < windowDays; i++) {
    const at = start + i * dayMs;
    index.set(at, buckets.length);
    const d = new Date(at);
    buckets.push({ label: `${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`, at, count: 0 });
  }
  for (const o of orders) {
    const ms = orderCreatedAtMs(o);
    if (ms == null || ms < start || ms > now) continue;
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const slot = index.get(d.getTime());
    if (slot != null) buckets[slot].count += 1;
  }
  return buckets;
}

/** 近 24 小时新增报修数（诚实口径：多数时刻为 0，面板据此显示空态而非造数） */
export function ordersInLast24h(orders: OrderLike[], now: number): number {
  return orders.filter((o) => {
    const ms = orderCreatedAtMs(o);
    return ms != null && ms <= now && ms > now - 86400000;
  }).length;
}

/** 今日（本地 00:00 起）新增报修数 */
export function ordersToday(orders: OrderLike[], now: number): number {
  const key = localDayKey(now);
  return orders.filter((o) => {
    const ms = orderCreatedAtMs(o);
    return ms != null && localDayKey(ms) === key;
  }).length;
}

/** 未闭环工单数（待派单/待接单/检修中/待验收） */
export function openOrderCount(orders: OrderLike[]): number {
  return orders.filter((o) => OPEN_ORDER_STATUSES.has(o.status ?? "")).length;
}

/** 全国层面板所需的完整看板模型（一次算齐，组件只做渲染） */
export interface MapDashboard {
  totals: MapTotals;
  regionRows: RegionRow[];
  factoryRows: FactoryTruth[];
  statusRows: StatusRow[];
  onlineRate: number | null;
  todayOrders: number;
  last24hOrders: number;
  totalOrders: number;
  openOrders: number;
  completedOrders: number;
  urgentOrders: number;
  trend: DayBucket[];
  trendHasData: boolean;
}

export function buildMapDashboard(input: {
  /** 已按设备明细算好的厂区真实台账行（未归一化 share 也可，内部会重排） */
  factoryRows: FactoryTruth[];
  /** 全国设备台账（各厂区明细的并集），供状态分布与在线率 */
  devices: EquipmentLike[];
  orders: OrderLike[];
  now: number;
  windowDays?: number;
}): MapDashboard {
  const factoryRows = withTruthShare(input.factoryRows);
  const trend = bucketOrdersByDay(input.orders, input.now, input.windowDays ?? 14);
  return {
    totals: truthTotals(factoryRows),
    regionRows: regionRowsOf(factoryRows),
    factoryRows,
    statusRows: statusRowsOf(input.devices),
    onlineRate: onlineRateOf(input.devices),
    todayOrders: ordersToday(input.orders, input.now),
    last24hOrders: ordersInLast24h(input.orders, input.now),
    totalOrders: input.orders.length,
    openOrders: openOrderCount(input.orders),
    completedOrders: input.orders.filter((o) => o.status === "completed").length,
    urgentOrders: input.orders.filter((o) => o.priority === "urgent").length,
    trend,
    trendHasData: trend.some((b) => b.count > 0),
  };
}
