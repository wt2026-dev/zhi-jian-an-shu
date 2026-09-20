// 三层下钻纯逻辑测试：面板指标只能由真实载荷推导，且全国/城市/驾驶舱共用同一口径。
import { describe, it, expect } from "vitest";
import {
  pillarStateOf,
  pillarPaletteOf,
  easeInOutCubic,
  MAJOR_CITIES,
  equipmentStatusLabel,
  DIVE_MS,
} from "../src/components/equipment3d/mapStyle.ts";
import {
  buildMapDashboard,
  bucketOrdersByDay,
  factoryPillarStatusOf,
  localDayKey,
  onlineRateOf,
  orderCreatedAtMs,
  ordersInLast24h,
  ordersToday,
  statusRowsOf,
  toFactoryTruth,
  truthTotals,
} from "../src/components/equipment3d/mapStats.ts";
import type { EquipmentLike, OrderLike } from "../src/components/equipment3d/mapStats.ts";
import type { FactorySummary } from "../src/api/factoryApi.ts";

const DAY = 86400000;

/** /factories 列表项：stats 故意填后端被 JOIN 放大过的数（18 台 / 79.4），
 *  真实台账以 devices 明细为准 —— 面板读数必须来自后者。 */
const factory = (over: Partial<FactorySummary> = {}): FactorySummary => ({
  id: "factory_gz",
  name: "广州智能制造总厂",
  city: "广州",
  region: "华南",
  geo: { lng: 113.31, lat: 23.12 },
  address: "广州市黄埔区",
  status: "running",
  isDemo: false,
  stats: { equipmentCount: 18, faultCount: 1, alertCount: 15, avgHealth: 79.4 },
  ...over,
});

const dev = (id: string, status = "running", healthScore = 80): EquipmentLike => ({ id, status, healthScore });

describe("光柱状态配色", () => {
  it("正常/告警/故障三态按语义分色，未登记状态按正常处理", () => {
    expect(pillarStateOf("running")).toBe("normal");
    expect(pillarStateOf("standby")).toBe("normal");
    expect(pillarStateOf("warning")).toBe("alert");
    expect(pillarStateOf("maintenance")).toBe("alert");
    expect(pillarStateOf("overhauling")).toBe("alert");
    expect(pillarStateOf("fault")).toBe("fault");
    expect(pillarStateOf("critical")).toBe("fault");
    expect(pillarStateOf(undefined)).toBe("normal");
  });

  it("三态主色互不相同，故障为红、告警为橙、正常为青", () => {
    expect(pillarPaletteOf("fault").core).toBe(0xf43f5e);
    expect(pillarPaletteOf("warning").core).toBe(0xf59e0b);
    expect(pillarPaletteOf("running").core).toBe(0x22d3ee);
  });
});

describe("下钻过渡缓动", () => {
  it("easeInOutCubic 端点归一、中点 0.5、且慢进慢出", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
    // 前 1/4 行程应小于线性进度（缓入），后 1/4 相反（缓出）
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
    // 越界输入被夹住，避免相机出现负半径
    expect(easeInOutCubic(-2)).toBe(0);
    expect(easeInOutCubic(5)).toBe(1);
  });

  it("过渡时长为需求规定的 2 秒", () => {
    expect(DIVE_MS).toBe(2000);
  });
});

describe("城市标注表", () => {
  it("覆盖需求点名的主要城市，且厂区城市被标记", () => {
    const names = MAJOR_CITIES.map((c) => c.name);
    for (const n of ["北京", "上海", "广州", "成都", "武汉", "西安"]) expect(names).toContain(n);
    expect(MAJOR_CITIES.filter((c) => c.plant).map((c) => c.name).sort()).toEqual(["南京", "广州", "成都", "武汉"]);
  });

  it("坐标落在中国境内且无重名", () => {
    for (const c of MAJOR_CITIES) {
      expect(c.lng).toBeGreaterThan(72);
      expect(c.lng).toBeLessThan(136);
      expect(c.lat).toBeGreaterThan(17);
      expect(c.lat).toBeLessThan(54);
    }
    expect(new Set(MAJOR_CITIES.map((c) => c.name)).size).toBe(MAJOR_CITIES.length);
  });
});

describe("在线率与状态分布口径", () => {
  const eqs = [
    { status: "running" },
    { status: "running" },
    { status: "running" },
    { status: "warning" },
    { status: "fault" },
    { status: "standby" },
  ];

  it("在线率 = 运行台数 / 总台数（与驾驶舱同口径，预警不算在线）", () => {
    expect(onlineRateOf(eqs)).toBe(50);
    expect(onlineRateOf([{ status: "fault" }, { status: "warning" }])).toBe(0);
    expect(onlineRateOf([])).toBeNull();
  });

  it("状态分布按台数降序，标签与色值取自统一口径", () => {
    const rows = statusRowsOf(eqs);
    expect(rows[0]).toMatchObject({ key: "running", label: "运行", count: 3 });
    expect(rows.map((r) => r.count)).toEqual([3, 1, 1, 1]);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 6);
    expect(equipmentStatusLabel("overhauling")).toBe("检修");
  });
});

describe("工单时间归集", () => {
  const now = new Date(2026, 8, 20, 13, 0, 0).getTime();

  const order = (msAgo: number, status = "created") => ({
    status,
    createdTimestamp: now - msAgo,
  });

  it("优先用 createdTimestamp，缺失时回退解析 createdAt", () => {
    expect(orderCreatedAtMs({ createdTimestamp: 1789369042612 })).toBe(1789369042612);
    expect(orderCreatedAtMs({ createdAt: "2026/9/14 14:57:22" })).toBe(new Date(2026, 8, 14, 14, 57, 22).getTime());
    expect(orderCreatedAtMs({ createdAt: "2026-09-14T14:57:22" })).toBe(new Date(2026, 8, 14, 14, 57, 22).getTime());
    expect(orderCreatedAtMs({})).toBeNull();
  });

  it("今日异常按本地日切，不被 UTC 偏移偷走一天", () => {
    // 今天 13:00 往前 2h / 12h 仍是今天，往前 20h 已是昨天
    expect(ordersToday([order(2 * 3600000), order(12 * 3600000)], now)).toBe(2);
    expect(ordersToday([order(20 * 3600000)], now)).toBe(0);
    expect(ordersToday([order(DAY + 1000)], now)).toBe(0);
    expect(localDayKey(now)).toBe("2026-09-20");
  });

  it("近 24 小时窗口边界：恰好 24 小时前不算", () => {
    expect(ordersInLast24h([order(DAY - 1)], now)).toBe(1);
    expect(ordersInLast24h([order(DAY)], now)).toBe(0);
  });

  it("按日分桶保留空日以保证时间轴连续，且不越窗口取数", () => {
    const buckets = bucketOrdersByDay([order(0), order(DAY), order(3 * DAY), order(40 * DAY)], now, 14);
    expect(buckets).toHaveLength(14);
    expect(buckets[13]).toEqual({ label: "09-20", at: new Date(2026, 8, 20).getTime(), count: 1 });
    expect(buckets[12].count).toBe(1);
    expect(buckets[11].count).toBe(0);
    expect(buckets[10].count).toBe(1);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(3);
  });
});

describe("厂区真实台账口径", () => {
  const devices = [dev("e1", "running", 88), dev("e2", "fault", 41), dev("e3", "overhauling", 62)];
  const orders: OrderLike[] = [
    { status: "created", equipmentId: "e1" },
    { status: "dispatched", equipmentId: "e1" },
    { status: "completed", equipmentId: "e2" },
    { status: "in_progress", equipmentId: "e_other" },
  ];

  it("设备数按明细行计数，不受 stats 聚合列（JOIN 放大）影响", () => {
    const truth = toFactoryTruth(factory(), devices, orders);
    // /factories 的 stats 会把同一台设备按进行中工单数重复计数（18），明细行才是真值
    expect(truth.equipmentCount).toBe(3);
    expect(truth.runningCount).toBe(1);
    expect(truth.faultCount).toBe(2); // fault + overhauling，与驾驶舱同口径
    expect(truth.avgHealth).toBe(63.7); // (88+41+62)/3
  });

  it("告警数只算本厂设备的未闭环工单（含待派单），已闭环与他厂不计", () => {
    expect(toFactoryTruth(factory(), devices, orders).alertCount).toBe(2);
  });

  it("光柱颜色由真实故障/告警数决定，都没有时回退台账状态", () => {
    expect(factoryPillarStatusOf({ faultCount: 1, alertCount: 0, status: "running" })).toBe("fault");
    expect(factoryPillarStatusOf({ faultCount: 0, alertCount: 3, status: "running" })).toBe("warning");
    expect(factoryPillarStatusOf({ faultCount: 0, alertCount: 0, status: "maintenance" })).toBe("maintenance");
  });
});

describe("全国看板模型", () => {
  const now = new Date(2026, 8, 20, 12).getTime();
  const south = toFactoryTruth(
    factory(),
    Array.from({ length: 12 }, (_, i) => dev(`gz_${i}`, "running", 80)),
    [{ status: "in_progress", equipmentId: "gz_1" }]
  );
  const east = toFactoryTruth(
    factory({ id: "factory_nj", name: "南京分厂", city: "南京", region: "华东", isDemo: true }),
    Array.from({ length: 10 }, (_, i) => dev(`nj_${i}`, "running", 90)),
    []
  );
  const devices = [
    ...Array.from({ length: 12 }, (_, i) => dev(`gz_${i}`, "running", 80)),
    ...Array.from({ length: 10 }, (_, i) => dev(`nj_${i}`, "running", 90)),
  ];
  const model = buildMapDashboard({
    factoryRows: [south, east],
    devices,
    orders: [
      { status: "in_progress", equipmentId: "gz_1", createdTimestamp: now - 3 * DAY },
      { status: "completed", equipmentId: "gz_2", createdTimestamp: now - 3 * DAY },
    ],
    now,
  });

  it("区域行按设备数降序 + 归一化占比，健康分按设备数加权（= 全体设备真均值）", () => {
    expect(model.regionRows.map((r) => r.region)).toEqual(["华南", "华东"]);
    expect(model.regionRows[0]).toMatchObject({ equipmentCount: 12, factoryCount: 1, share: 1, avgHealth: 80, alertCount: 1 });
    expect(model.regionRows[1].share).toBeCloseTo(10 / 12, 6);
    expect(model.regionRows[1]).toMatchObject({ avgHealth: 90, alertCount: 0 });
    expect(model.totals).toEqual({ factoryCount: 2, equipmentCount: 22, faultCount: 0, alertCount: 1, avgHealth: 84.5 });
  });

  it("厂区行按设备数降序，占比供条形宽度", () => {
    expect(model.factoryRows.map((f) => [f.id, f.equipmentCount])).toEqual([["factory_gz", 12], ["factory_nj", 10]]);
    expect(model.factoryRows[0].share).toBe(1);
  });

  it("工单指标逐条可溯源：总数/未闭环/紧急/今日/24h", () => {
    expect(model.totalOrders).toBe(2);
    expect(model.openOrders).toBe(1);
    expect(model.todayOrders).toBe(0);
    expect(model.last24hOrders).toBe(0);
    expect(model.urgentOrders).toBe(0);
    expect(model.onlineRate).toBe(100);
    expect(model.trendHasData).toBe(true);
    expect(model.trend.reduce((s, b) => s + b.count, 0)).toBe(2);
  });

  it("窗口内没有工单时 trendHasData 为假，面板据此显示空态而非造数", () => {
    const empty = buildMapDashboard({ factoryRows: [], devices: [], orders: [], now });
    expect(empty.trendHasData).toBe(false);
    expect(empty.onlineRate).toBeNull();
    expect(empty.totals.avgHealth).toBeNull();
    expect(empty.totals.factoryCount).toBe(0);
  });

  it("城市/厂区小计：健康分按设备数加权，不是各厂均值再平均", () => {
    const small = toFactoryTruth(factory(), [dev("a", "fault", 20)], []);
    const big = toFactoryTruth(factory({ id: "factory_cd" }), Array.from({ length: 3 }, (_, i) => dev(`c${i}`, "running", 100)), []);
    expect(truthTotals([small, big])).toMatchObject({ equipmentCount: 4, faultCount: 1, avgHealth: 80 });
  });
});
