// 「检修闯关」三步关卡逻辑测试。
//
// 这一层是纯函数（无 React、无 three.js），所以可以逐条把"数据红线"钉死：
//   ① 异常判定必须复用项目既有阈值（温度 80/95/110、振动 4.5/7/10、负载 85/95/100），
//      不得在这里另抄一份 —— 边界值就是最容易被抄歪的地方，故逐个断言；
//   ② 没有阈值口径的指标（电流/电压/压力）只如实显示读数，绝不判异常；
//   ③ 读数缺失必须是 null（UI 显示"未接入"），绝不用 0 顶替；
//   ④ 遥测全正常时**不许编造故障** —— 改为按真实规程文本问"该重点检查哪里"。
import { describe, it, expect } from "vitest";
import {
  MAX_LIVES,
  STEP_SECONDS,
  buildDeviceLevel,
  buildHuntSpots,
  gradeFor,
  scoreStep,
  worstSpot,
  type HuntSpot,
  type OrderStep,
  type ToolStep,
} from "../src/components/game/levelPlay.ts";
import type { Equipment, MaintenanceProcedure } from "../src/types/index.ts";

/* ============================ 夹具 ============================ */

const proc = (over: Partial<MaintenanceProcedure> = {}): MaintenanceProcedure => ({
  id: "proc-pump-lvl1",
  title: "离心式高压给水泵一级维保与机械密封调校规程",
  equipmentType: "水泵",
  maintenanceLevel: "一级检修",
  estimatedMinutes: 60,
  steps: [
    {
      step_no: 1,
      name: "停机与能量隔离",
      content: "办理作业票与 LOTO 挂牌；断开主电源并验电；关闭进出口阀门并泄压",
      tools: "绝缘扳手、验电笔、LOTO 锁具",
      safety: "作业前必须办理 LOTO 挂牌上锁",
      acceptance: "现场无残留能量",
    },
    {
      step_no: 2,
      name: "轴承温度与振动检测",
      content: "测量轴承座振动值；记录轴温；与历史趋势比对",
      tools: "测振仪、红外测温枪",
      safety: "禁止在运行中触碰旋转部件",
      acceptance: "振动值在允许范围内",
    },
  ],
  ...over,
});

/** 第二份规程：只用来提供"真实工具池"，验证干扰项来自真实数据而不是编造 */
const otherProc = (): MaintenanceProcedure => ({
  id: "proc-motor-lvl2",
  title: "大型电机二级检修规程",
  equipmentType: "电机",
  maintenanceLevel: "二级检修",
  estimatedMinutes: 120,
  steps: [
    {
      step_no: 1,
      name: "绝缘电阻测量",
      content: "停电验电；摇测绝缘电阻；记录数据",
      tools: "兆欧表、接地线、绝缘手套",
      safety: "摇测后必须放电",
      acceptance: "绝缘电阻合格",
    },
  ],
});

const eq = (telemetry: Record<string, unknown> | null): Equipment =>
  ({
    id: "eq-101",
    code: "EQ-101",
    name: "12# 连铸结晶器冷却循环泵",
    category: "泵类设备",
    workshop: "连铸车间",
    status: "running",
    healthScore: 42,
    telemetry,
  }) as unknown as Equipment;

const spotOf = (spots: HuntSpot[], key: string): HuntSpot => {
  const hit = spots.find((s) => s.key === key);
  if (!hit) throw new Error(`测点 ${key} 不存在`);
  return hit;
};

/* ============================ 测点构造 ============================ */

describe("检修闯关 · 测点构造（遥测 → 可点击部位）", () => {
  it("六个测点恒存在，键与顺序稳定（3D 场景按 key 布点，不能缺项）", () => {
    const spots = buildHuntSpots(eq({}));
    expect(spots.map((s) => s.key)).toEqual([
      "temperature",
      "vibration",
      "loadRate",
      "current",
      "voltage",
      "pressure",
    ]);
  });

  it("读数按单位格式化：mm/s 1 位、MPa 2 位、≥100 取整、其余 1 位", () => {
    const spots = buildHuntSpots(
      eq({ temperature: 72.44, vibration: 3.21, loadRate: 128.4, pressure: 0.617 })
    );
    expect(spotOf(spots, "temperature").reading).toBe("72.4 ℃");
    expect(spotOf(spots, "vibration").reading).toBe("3.2 mm/s");
    expect(spotOf(spots, "loadRate").reading).toBe("128 %");
    expect(spotOf(spots, "pressure").reading).toBe("0.62 MPa");
  });

  it("复用项目既有阈值：温度 80/95/110 三个边界分别判 warning/fault/critical", () => {
    expect(spotOf(buildHuntSpots(eq({ temperature: 79.9 })), "temperature").severity).toBe("normal");
    expect(spotOf(buildHuntSpots(eq({ temperature: 80 })), "temperature").severity).toBe("warning");
    expect(spotOf(buildHuntSpots(eq({ temperature: 95 })), "temperature").severity).toBe("fault");
    expect(spotOf(buildHuntSpots(eq({ temperature: 110 })), "temperature").severity).toBe("critical");
  });

  it("复用项目既有阈值：振动 4.5/7/10 与负载 85/95/100 同样按 ≥ 判定", () => {
    expect(spotOf(buildHuntSpots(eq({ vibration: 4.4 })), "vibration").severity).toBe("normal");
    expect(spotOf(buildHuntSpots(eq({ vibration: 4.5 })), "vibration").severity).toBe("warning");
    expect(spotOf(buildHuntSpots(eq({ vibration: 7 })), "vibration").severity).toBe("fault");
    expect(spotOf(buildHuntSpots(eq({ vibration: 10 })), "vibration").severity).toBe("critical");

    expect(spotOf(buildHuntSpots(eq({ loadRate: 84 })), "loadRate").severity).toBe("normal");
    expect(spotOf(buildHuntSpots(eq({ loadRate: 85 })), "loadRate").severity).toBe("warning");
    expect(spotOf(buildHuntSpots(eq({ loadRate: 95 })), "loadRate").severity).toBe("fault");
    expect(spotOf(buildHuntSpots(eq({ loadRate: 100 })), "loadRate").severity).toBe("critical");
  });

  it("只有超阈值的测点才算 abnormal（normal / unrated / nodata 都不算）", () => {
    const spots = buildHuntSpots(eq({ temperature: 96, vibration: 3, loadRate: 50, current: 999, pressure: 9.9 }));
    expect(spotOf(spots, "temperature").abnormal).toBe(true);
    expect(spotOf(spots, "vibration").abnormal).toBe(false);
    expect(spotOf(spots, "loadRate").abnormal).toBe(false);
    // 电流 999A 看着离谱，但项目没有电流阈值口径 ⇒ 不得自行判异常
    expect(spotOf(spots, "current").abnormal).toBe(false);
    expect(spotOf(spots, "pressure").abnormal).toBe(false);
  });

  it("无阈值口径的指标标记 unrated，但读数照实显示（不隐藏、不判异常）", () => {
    const spots = buildHuntSpots(eq({ current: 268.5, voltage: 380, pressure: 0.62 }));
    for (const key of ["current", "voltage", "pressure"]) {
      expect(spotOf(spots, key).severity).toBe("unrated");
      expect(spotOf(spots, key).abnormal).toBe(false);
      expect(spotOf(spots, key).reading).not.toBeNull();
    }
  });

  it("读数缺失一律 nodata + reading===null（绝不用 0 顶替）", () => {
    const spots = buildHuntSpots(eq({}));
    for (const s of spots) {
      expect(s.severity).toBe("nodata");
      expect(s.reading).toBeNull();
      expect(s.abnormal).toBe(false);
    }
  });

  it("遥测整体缺失 / 非法值（NaN、Infinity、字符串）同样走 nodata", () => {
    for (const telemetry of [null, undefined, {}, { temperature: NaN }, { temperature: Infinity }, { temperature: "96" }]) {
      const spots = buildHuntSpots(eq(telemetry as Record<string, unknown> | null));
      expect(spotOf(spots, "temperature").severity).toBe("nodata");
      expect(spotOf(spots, "temperature").reading).toBeNull();
    }
  });
});

/* ============================ 最严重测点 ============================ */

describe("检修闯关 · worstSpot", () => {
  it("取最严重的一个；同级时取先出现的", () => {
    const spots = buildHuntSpots(eq({ temperature: 82, vibration: 11, loadRate: 86 }));
    expect(worstSpot(spots)?.key).toBe("vibration");

    const tie = buildHuntSpots(eq({ temperature: 82, loadRate: 86 }));
    expect(worstSpot(tie)?.key).toBe("temperature");
  });

  it("全正常 / 全未接入时返回 null（调用方据此走「不编造故障」分支）", () => {
    expect(worstSpot(buildHuntSpots(eq({ temperature: 70, vibration: 3, loadRate: 60 })))).toBeNull();
    expect(worstSpot(buildHuntSpots(eq({})))).toBeNull();
  });
});

/* ============================ 关卡构建 ============================ */

describe("检修闯关 · 三步关卡构建", () => {
  it("固定三步且顺序为 hunt → tool → order", () => {
    const lv = buildDeviceLevel(eq({ temperature: 96 }), proc(), [proc(), otherProc()]);
    expect(lv.steps.map((s) => s.kind)).toEqual(["hunt", "tool", "order"]);
    expect(lv.equipmentId).toBe("eq-101");
    expect(lv.procedureId).toBe("proc-pump-lvl1");
    expect(lv.sourceStepNo).toBe(1);
    expect(lv.sourceStepName).toBe("停机与能量隔离");
  });

  it("有超限读数时：正确部位=最严重测点，且解释里带上真实读数与阈值档位", () => {
    const lv = buildDeviceLevel(eq({ temperature: 78, vibration: 8.2 }), proc(), [proc()]);
    const hunt = lv.steps[0];
    expect(hunt.kind).toBe("hunt");
    if (hunt.kind !== "hunt") return;
    expect(hunt.correctKey).toBe("vibration");
    expect(hunt.explain).toContain("8.2 mm/s");
    expect(hunt.explain).toContain("故障");
    expect(hunt.prompt).toContain("异常");
  });

  it("正确部位必定是场景里真实存在的测点（否则玩家点不到答案）", () => {
    const cases: Array<Record<string, unknown>> = [
      { temperature: 96 },
      { vibration: 11 },
      { loadRate: 88 },
      { temperature: 70 },
      {},
      { current: 300 },
    ];
    for (const telemetry of cases) {
      const lv = buildDeviceLevel(eq(telemetry), proc(), [proc()]);
      const hunt = lv.steps[0];
      if (hunt.kind !== "hunt") throw new Error("第一步必须是 hunt");
      expect(hunt.spots.map((s) => s.key)).toContain(hunt.correctKey);
    }
  });

  it("遥测全正常时**不编造故障**：文案明确说无超限，答案取自真实规程文本", () => {
    // 该规程第 2 步名为「轴承温度与振动检测」⇒ 文本提到"温度"，应指向 temperature
    const p2 = proc({
      steps: [
        {
          step_no: 1,
          name: "轴承温度检测",
          content: "测量轴承温度并记录；与历史趋势比对；超限则停机检查",
          tools: "红外测温枪、记录表",
        },
      ],
    });
    const lv = buildDeviceLevel(eq({ temperature: 70, vibration: 3 }), p2, [p2]);
    const hunt = lv.steps[0];
    if (hunt.kind !== "hunt") throw new Error("第一步必须是 hunt");
    expect(hunt.correctKey).toBe("temperature");
    expect(hunt.prompt).toContain("无超限");
    expect(hunt.explain).toContain("阈值内");
    // 关键：不能出现"已越过…阈值"这种凭空判定
    expect(hunt.explain).not.toContain("越过");
    for (const s of hunt.spots) expect(s.abnormal).toBe(false);
  });

  it("遥测完全未接入时：文案说「未接入」，且绝不给出任何读数", () => {
    const lv = buildDeviceLevel(eq({}), proc(), [proc()]);
    const hunt = lv.steps[0];
    if (hunt.kind !== "hunt") throw new Error("第一步必须是 hunt");
    expect(hunt.prompt).toContain("未接入");
    expect(hunt.explain).toContain("未接入");
    for (const s of hunt.spots) expect(s.reading).toBeNull();
  });

  it("工具关：正确项取自本步 tools 首项，且在选项里；干扰项全部来自真实工具池", () => {
    const p = proc();
    const all = [p, otherProc()];
    const lv = buildDeviceLevel(eq({ temperature: 96 }), p, all);
    const tool = lv.steps.find((s) => s.kind === "tool") as ToolStep | undefined;
    expect(tool).toBeTruthy();
    if (!tool) return;

    expect(tool.correct).toBe("绝缘扳手");
    expect(tool.options).toContain("绝缘扳手");
    expect(new Set(tool.options).size).toBe(tool.options.length);
    expect(tool.options.length).toBeLessThanOrEqual(4);

    const realPool = new Set(
      all.flatMap((pr) => pr.steps.flatMap((st) => (st.tools ?? "").split(/[、，,;；\n/·]+/).map((t) => t.trim())))
    );
    for (const o of tool.options) expect(realPool.has(o)).toBe(true);
    expect(tool.explain).toContain("绝缘扳手");
  });

  it("排序关：条目来自真实 content 拆句，且 explain 的顺序与 items 完全一致", () => {
    const lv = buildDeviceLevel(eq({ temperature: 96 }), proc(), [proc()]);
    const order = lv.steps.find((s) => s.kind === "order") as OrderStep | undefined;
    expect(order).toBeTruthy();
    if (!order) return;
    expect(order.items.length).toBeGreaterThanOrEqual(3);
    expect(order.items[0]).toContain("办理作业票");
    expect(order.explain).toBe(`正确顺序：${order.items.join(" → ")}`);
  });

  it("拆不出 3 段动作时该关被裁掉，不会留一个点不动的空排序关", () => {
    const p = proc({
      steps: [{ step_no: 1, name: "整机检查", content: "检查", tools: "扳手、抹布" }],
    });
    const lv = buildDeviceLevel(eq({ temperature: 96 }), p, [p]);
    expect(lv.steps.map((s) => s.kind)).toEqual(["hunt", "tool"]);
  });
});

/* ============================ 计时与计分 ============================ */

describe("检修闯关 · 计时与计分", () => {
  it("三步限时各不相同且均为正；初始生命值 3", () => {
    expect(STEP_SECONDS.hunt).toBeGreaterThan(0);
    expect(STEP_SECONDS.tool).toBeGreaterThan(0);
    expect(STEP_SECONDS.order).toBeGreaterThan(0);
    expect(MAX_LIVES).toBe(3);
  });

  it("答错得 0 分（不给安慰分）", () => {
    expect(scoreStep({ firstTry: false, secondsLeft: 999 }, "hunt")).toBe(0);
    expect(scoreStep({ firstTry: false, secondsLeft: 0 }, "order")).toBe(0);
  });

  it("满分 150（基础 100 + 速度加成 50），时间用尽仍有基础 100", () => {
    expect(scoreStep({ firstTry: true, secondsLeft: STEP_SECONDS.hunt }, "hunt")).toBe(150);
    expect(scoreStep({ firstTry: true, secondsLeft: 0 }, "hunt")).toBe(100);
  });

  it("速度加成按「剩余时间占比」算，因此各步限时长短可直接比较", () => {
    // 都剩一半时间 ⇒ 都加 25
    expect(scoreStep({ firstTry: true, secondsLeft: 15 }, "hunt")).toBe(125);
    expect(scoreStep({ firstTry: true, secondsLeft: 11 }, "tool")).toBe(125);
    expect(scoreStep({ firstTry: true, secondsLeft: 20 }, "order")).toBe(125);
  });

  it("越界输入被夹紧：剩余时间超过限时不会超分，负数不会倒扣", () => {
    expect(scoreStep({ firstTry: true, secondsLeft: 9999 }, "tool")).toBe(150);
    expect(scoreStep({ firstTry: true, secondsLeft: -30 }, "tool")).toBe(100);
  });
});

/* ============================ 评级 ============================ */

describe("检修闯关 · S/A/B/C 评级", () => {
  it("零失误且全一次通过 = S", () => {
    expect(gradeFor({ mistakes: 0, firstTryRate: 1 })).toBe("S");
  });

  it("零失误但正确率不足 100% 只能是 A（拿不到 S）", () => {
    expect(gradeFor({ mistakes: 0, firstTryRate: 0.9 })).toBe("A");
  });

  it("失误 ≤1 且正确率 ≥66% = A；正确率跌破 66% 掉到 B", () => {
    expect(gradeFor({ mistakes: 1, firstTryRate: 0.66 })).toBe("A");
    expect(gradeFor({ mistakes: 1, firstTryRate: 0.65 })).toBe("B");
  });

  it("失误 ≤3 = B；4 次及以上 = C", () => {
    expect(gradeFor({ mistakes: 3, firstTryRate: 0 })).toBe("B");
    expect(gradeFor({ mistakes: 4, firstTryRate: 1 })).toBe("C");
  });
});
