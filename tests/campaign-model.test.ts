// 《庖丁检修师》七幕主线纯逻辑测试。
// 红线：报警与操作题只能由真实台账/规程推导；挑不出来时必须返回 null/空，不得造数。
import { describe, it, expect } from "vitest";
import type { Equipment, MaintenanceProcedure } from "../src/types";
import {
  ACTS,
  actOf,
  actScoreOf,
  achievementsUnlocked,
  ACHIEVEMENTS,
  factoryBoardOf,
  nextAct,
  pickIncident,
  RANKS,
  rankFor,
  runGrade,
  toIncidentPick,
  xpForRun,
  type ActOutcome,
  type ActId,
} from "../src/components/campaign/campaignModel.ts";
import { buildRepairSteps, judgeOrder, shuffledDeterministic } from "../src/components/campaign/campaignSteps.ts";
import { applyRun, EMPTY_PROGRESS, type FinishedRun } from "../src/components/campaign/campaignProgress.ts";

const NORMAL = { temperature: 62, vibration: 2.4, loadRate: 55 };

/** 线上台账实测出现的状态，比 `EquipmentStatus` 联合类型多一项；测试要把它构造出来 */
const CRITICAL = "critical" as unknown as Equipment["status"];

const equipment = (over: Partial<Equipment> = {}): Equipment => ({
  id: "eq_1",
  code: "PUMP-2024-03",
  name: "5# 给水泵",
  category: "泵类设备",
  model: "DG85-45",
  workshop: "动力车间",
  location: "泵房 A 跨",
  installDate: "2021-05-10",
  manufacturer: "沈阳鼓风机",
  status: "running",
  healthScore: 88,
  criticality: "主要生产",
  telemetry: { ...NORMAL, voltage: 380, current: 42, lastUpdated: "2026-09-20T10:00:00Z" },
  specs: {},
  maintenanceHistory: [],
  nextInspectionDate: "2026-10-01",
  qrCode: "QR-eq_1",
  ...over,
});

const procedure = (over: Partial<MaintenanceProcedure> = {}): MaintenanceProcedure => ({
  id: "proc_1",
  title: "离心式高压给水泵机械密封更换规程",
  equipmentType: "水泵",
  maintenanceLevel: "状态检修",
  steps: [
    {
      step_no: 1,
      name: "解体前检查与断电",
      content: "先盘车确认无卡阻；再拆卸联轴器护罩；最后标记电机中心线。",
      tools: "塞尺、百分表、铜棒",
      safety: "检修前必须完成断电、验电并挂牌上锁（LOTO）",
      acceptance: "护罩拆除且中心线标记清晰",
    },
    {
      step_no: 2,
      name: "拆卸旧密封",
      content: "松开压盖螺栓；取出动环；清理密封腔并检查轴套磨损。",
      tools: "内六角扳手、拉马",
      safety: "禁止用锤直接敲击轴套",
      acceptance: "旧密封件全部取出，轴套无径向划痕",
    },
    {
      step_no: 3,
      name: "装配新密封",
      content: "清洁配合面；按顺序装入静环与动环；对角均匀紧固压盖螺栓。",
      tools: "力矩扳手",
      safety: "装配过程保持配合面无油污",
      acceptance: "压盖端面间隙均匀，偏差 ≤0.05mm",
    },
    {
      step_no: 4,
      name: "回装与试运行",
      content: "复装联轴器并找正；点动确认转向；空载运行 30 分钟测振。",
      tools: "百分表、测振仪",
      safety: "试运行期间人员撤离旋转面",
      acceptance: "振动 ≤4.5mm/s 且无渗漏",
    },
  ],
  ...over,
});

const outcome = (over: Partial<ActOutcome> = {}): ActOutcome => ({
  actId: "repair",
  firstTryRate: 1,
  mistakes: 0,
  seconds: 60,
  ...over,
});

/* ============================ 幕次结构 ============================ */

describe("七幕主线结构", () => {
  it("幕次固定七幕、序号连续、顺序即玩法主线", () => {
    expect(ACTS.map((a) => a.id)).toEqual<ActId[]>(["overview", "incident", "diagnose", "plan", "repair", "qc", "archive"]);
    expect(ACTS.map((a) => a.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("每一幕都写清对应的项目功能与非零合理用时", () => {
    for (const a of ACTS) {
      expect(a.feature.length).toBeGreaterThan(3);
      expect(a.parSeconds).toBeGreaterThan(0);
      expect(a.brief.length).toBeGreaterThan(6);
    }
  });

  it("nextAct 串到最后一幕返回 null，actOf 拒绝未知幕", () => {
    let cur = actOf("overview");
    let steps = 0;
    while (nextAct(cur.id)) {
      cur = nextAct(cur.id)!;
      steps += 1;
    }
    expect(steps).toBe(6);
    expect(cur.id).toBe("archive");
    expect(() => actOf("nope" as ActId)).toThrow();
  });
});

/* ============================ 等级与经验 ============================ */

describe("等级与经验", () => {
  it("六级职称按 XP 阈值升序，边界落在本级", () => {
    expect(RANKS.map((r) => r.title)).toEqual(["检修学徒", "检修工", "技师", "高级技师", "检修主管", "总工"]);
    expect(rankFor(259).current.title).toBe("检修学徒");
    expect(rankFor(260).current.title).toBe("检修工");
    expect(rankFor(4200).current.title).toBe("总工");
    expect(rankFor(4200).next).toBeNull();
    expect(rankFor(4200).progress).toBe(1);
  });

  it("进度比例单调递增且夹在 0~1", () => {
    const a = rankFor(300).progress;
    const b = rankFor(500).progress;
    expect(b).toBeGreaterThan(a);
    expect(rankFor(-5).progress).toBeGreaterThanOrEqual(0);
  });

  it("评级越高经验越多，重复刷同一台收益递减且不低于 20%", () => {
    expect(xpForRun("S", 1)).toBeGreaterThan(xpForRun("A", 1));
    expect(xpForRun("A", 1)).toBeGreaterThan(xpForRun("B", 1));
    expect(xpForRun("B", 1)).toBeGreaterThan(xpForRun("C", 1));
    expect(xpForRun("S", 2)).toBe(165);
    expect(xpForRun("S", 9)).toBe(Math.round(220 * 0.2));
  });
});

/* ============================ 计分与评级 ============================ */

describe("幕得分与主线评级", () => {
  it("满分表现拿到基础 100 + 速度加成，且不超 150", () => {
    const perfect = actScoreOf(outcome({ seconds: 0 }));
    expect(perfect).toBe(150);
    expect(actScoreOf(outcome({ seconds: actOf("repair").parSeconds * 2 }))).toBe(100);
  });

  it("失误按每次 15 分扣，扣到 0 封底不为负", () => {
    expect(actScoreOf(outcome({ seconds: 999, mistakes: 1 }))).toBe(85);
    expect(actScoreOf(outcome({ seconds: 999, mistakes: 9, firstTryRate: 0 }))).toBe(0);
  });

  it("零失误全通过给 S，出现失误即降级（与检修闯关同一套 gradeFor）", () => {
    const acts = ACTS.map((a) => outcome({ actId: a.id, seconds: 0 }));
    expect(runGrade(acts)).toBe("S");
    expect(runGrade(acts.map((o, i) => ({ ...o, mistakes: i === 0 ? 2 : 0, firstTryRate: i === 0 ? 0.5 : 1 })))).toBe("B");
  });
});

/* ============================ 报警挑选 ============================ */

describe("报警只从真实台账里挑", () => {
  it("空台账或全厂正常时不演故障", () => {
    expect(pickIncident([])).toBeNull();
    expect(pickIncident([equipment(), equipment({ id: "eq_2" })])).toBeNull();
  });

  it("严重度优先：critical > fault > warning", () => {
    const pool = [
      equipment({ id: "eq_w", name: "预警机", status: "warning" }),
      equipment({ id: "eq_c", name: "严重机", status: CRITICAL }),
      equipment({ id: "eq_f", name: "故障机", status: "fault" }),
    ];
    expect(pickIncident(pool)?.equipment.id).toBe("eq_c");
    expect(pickIncident(pool, ["eq_c"])?.equipment.id).toBe("eq_f");
    expect(pickIncident(pool, ["eq_c", "eq_f"])?.equipment.id).toBe("eq_w");
    expect(pickIncident(pool, ["eq_c", "eq_f", "eq_w"])).toBeNull();
  });

  it("状态正常但遥测超限时照样报警，读数写进文案", () => {
    const pick = pickIncident([equipment({ status: "running", telemetry: { ...NORMAL, vibration: 8.2 } as Equipment["telemetry"] })]);
    expect(pick).not.toBeNull();
    expect(pick!.abnormalLabel).toBe("轴承座振动测点");
    expect(pick!.brief).toContain("8.2 mm/s");
    expect(pick!.orderTitle).toContain("轴承座振动测点异常");
  });

  it("读数都在阈值内却台账标了异常时，如实说明而不是硬编超限部位", () => {
    const pick = toIncidentPick(equipment({ status: "fault" }));
    expect(pick.abnormalLabel).toBeNull();
    expect(pick.brief).toContain("各测点读数均在阈值内");
    expect(pick.faultType).toContain("遥测读数正常");
  });

  it("遥测缺失时显示未接入，不拿 0 顶替", () => {
    const bare = equipment({ status: "fault", telemetry: { voltage: 380, current: 42, lastUpdated: "" } as unknown as Equipment["telemetry"] });
    const pick = toIncidentPick(bare);
    expect(pick.brief).toContain("遥测未接入有效读数");
    expect(pick.abnormalReading).toBeNull();
  });

  it("同分设备按 id 定序，重复调用结果一致（可重放）", () => {
    const pool = [
      equipment({ id: "eq_b", status: "fault" }),
      equipment({ id: "eq_a", status: "fault" }),
      equipment({ id: "eq_c", status: "fault" }),
    ];
    expect(pickIncident(pool)?.equipment.id).toBe("eq_a");
    expect(pickIncident(pool)?.equipment.id).toBe("eq_a");
  });
});

/* ============================ 第 1 幕看板 ============================ */

describe("工厂看板口径", () => {
  const pool = [
    equipment({ id: "a", status: "running", healthScore: 90 }),
    equipment({ id: "b", status: "running", healthScore: 80 }),
    equipment({ id: "c", status: "warning", healthScore: 70 }),
    equipment({ id: "d", status: "fault", healthScore: 40 }),
    equipment({ id: "e", status: CRITICAL, healthScore: 20 }),
  ];

  it("在线率 = 运行台数 / 台账台数，预警与故障都不算在线", () => {
    const board = factoryBoardOf(pool);
    expect(board).toMatchObject({ total: 5, running: 2, warning: 1, fault: 2, onlineRate: 40 });
    expect(board.avgHealth).toBe(60);
  });

  it("空台账返回 null 而不是 0%", () => {
    expect(factoryBoardOf([]).onlineRate).toBeNull();
    expect(factoryBoardOf([]).avgHealth).toBeNull();
  });
});

/* ============================ 成就 ============================ */

describe("成就判定", () => {
  const base = {
    runCompleted: true,
    mistakes: 0,
    grade: "S" as const,
    runSeconds: 600,
    bestRunSeconds: null,
    lotoRegistered: true,
    usedAiDiagnose: true,
    usedAiPlan: true,
    visionQc: true,
    knowledgeContributed: true,
  };

  it("全条件满足时八条成就全中", () => {
    expect(achievementsUnlocked(base).sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
  });

  it("没走完七幕不给「首次独立检修」与「零失误通关」", () => {
    const hit = achievementsUnlocked({ ...base, runCompleted: false });
    expect(hit).not.toContain("first_run");
    expect(hit).not.toContain("zero_mistake");
  });

  it("有历史更快纪录时不再刷新「最快维修记录」", () => {
    expect(achievementsUnlocked({ ...base, bestRunSeconds: 300 })).not.toContain("fastest");
    expect(achievementsUnlocked({ ...base, bestRunSeconds: 900 })).toContain("fastest");
  });

  it("成就清单与判定逻辑一一对应，不出现孤儿 id", () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const id of achievementsUnlocked(base)) expect(ids.has(id)).toBe(true);
  });
});

/* ============================ 第 5 幕四步操作 ============================ */

describe("现场检修四步全部来自真实规程", () => {
  it("无规程时返回空数组，UI 据此禁用这一幕", () => {
    expect(buildRepairSteps({ procedure: null })).toEqual([]);
    expect(buildRepairSteps({ procedure: procedure({ steps: [] }) })).toEqual([]);
  });

  it("四步固定为 LOTO → 拆解 → 更换 → 复装", () => {
    const steps = buildRepairSteps({ procedure: procedure() });
    expect(steps.map((s) => s.kind)).toEqual(["loto", "disassemble", "replace", "reassemble"]);
  });

  it("动作清单取自规程 content，不自己编", () => {
    const steps = buildRepairSteps({ procedure: procedure() });
    const disassemble = steps.find((s) => s.kind === "disassemble")!;
    expect(disassemble.actions).toContain("再拆卸联轴器护罩");
    expect(disassemble.tools).toContain("塞尺");
    expect(disassemble.safety).toContain("LOTO");
    expect(disassemble.acceptance).toContain("中心线标记");
  });

  it("LOTO 来源标注：AI 方案给了隔离点用 ai-plan，否则退回标准四步并如实标源", () => {
    const fromPlan = buildRepairSteps({
      procedure: procedure(),
      plan: { safetyMeasures: { lotoPoints: ["断开进料泵配电柜 A 路", "挂禁止合闸牌", "验电放压"] } },
    });
    expect(fromPlan[0].source).toBe("ai-plan");
    const fallback = buildRepairSteps({ procedure: procedure({ steps: [{ step_no: 1, name: "解体前检查", content: "先盘车确认无卡阻；再拆卸护罩；最后标记中心线。" }] }) });
    expect(fallback[0].source).toBe("loto-standard");
    expect(fallback[0].actions).toEqual(["确认设备停机并通知岗位操作工", "断开动力电源并挂牌上锁", "验电确认零能量", "释放残余压力与储能"]);
  });

  it("备件清单只出现在更换步；AI 没给方案时为空，不虚构消耗", () => {
    const steps = buildRepairSteps({ procedure: procedure(), plan: { spareParts: [{ name: "机械密封", spec: "104-45", qty: 1 }] } });
    expect(steps.find((s) => s.kind === "replace")!.parts).toEqual([{ name: "机械密封", qty: 1 }]);
    expect(steps.every((s) => (s.kind === "replace" ? s.parts.length === 1 : s.parts.length === 0))).toBe(true);
    expect(buildRepairSteps({ procedure: procedure() }).find((s) => s.kind === "replace")!.parts).toEqual([]);
  });

  it("顺序判定：完全一致才算一次通过", () => {
    const step = buildRepairSteps({ procedure: procedure() }).find((s) => s.kind === "reassemble")!;
    expect(judgeOrder(step, step.actions)).toBe(true);
    expect(judgeOrder(step, step.actions.slice().reverse())).toBe(step.actions.length === 1);
    expect(judgeOrder(step, step.actions.slice(0, -1))).toBe(false);
  });

  it("确定性打乱：同 key 同结果，且是原数组的一个排列", () => {
    const items = ["a", "b", "c", "d"];
    expect(shuffledDeterministic(items, "step-2")).toEqual(shuffledDeterministic(items, "step-2"));
    expect(shuffledDeterministic(items, "step-2").slice().sort()).toEqual(items);
    expect(shuffledDeterministic(items, "step-3")).not.toEqual(shuffledDeterministic(items, "step-2"));
  });
});

/* ============================ 本地进度结算 ============================ */

describe("本地进度结算", () => {
  const run = (over: Partial<FinishedRun> = {}): FinishedRun => ({
    equipmentId: "eq_1",
    equipmentName: "5# 给水泵",
    workOrderId: "wo_1",
    orderNo: "WO-2026-0001",
    outcomes: ACTS.map((a) => outcome({ actId: a.id, seconds: 0 })),
    totalSeconds: 600,
    mistakes: 0,
    grade: "S",
    score: 1000,
    completed: true,
    flags: { lotoRegistered: true, usedAiDiagnose: true, usedAiPlan: true, visionQc: true, knowledgeContributed: true },
    finishedAt: 1789000000000,
    ...over,
  });

  it("首次通关拿到全额经验并解锁成就", () => {
    const s = applyRun(EMPTY_PROGRESS, run());
    expect(s.xpGained).toBe(220);
    expect(s.progress.xp).toBe(220);
    expect(s.newAchievements).toContain("first_run");
    expect(s.progress.clearedEquipmentIds).toEqual(["eq_1"]);
    expect(s.rankTitle).toBe("检修学徒");
  });

  it("重复刷同一台设备经验递减，成就不重复解锁", () => {
    const first = applyRun(EMPTY_PROGRESS, run());
    expect(first.newAchievements).toContain("fastest"); // 第一条纪录即"最快维修记录"
    const second = applyRun(first.progress, run({ totalSeconds: 500, finishedAt: 1789000600000 }));
    expect(second.xpGained).toBe(165);
    expect(second.newAchievements).toEqual([]);
    expect(second.progress.achievements.filter((id) => id === "first_run")).toHaveLength(1);
    expect(second.progress.bestRunSeconds).toBe(500);
  });

  it("没走完七幕不给经验，也不记为已通关设备", () => {
    const s = applyRun(EMPTY_PROGRESS, run({ completed: false, grade: "C", mistakes: 5 }));
    expect(s.xpGained).toBe(0);
    expect(s.progress.clearedEquipmentIds).toEqual([]);
    expect(s.progress.runs).toBe(1);
  });

  it("历史最佳只留更好的那次，明细最多留 20 条", () => {
    let p = applyRun(EMPTY_PROGRESS, run({ grade: "A", totalSeconds: 900 })).progress;
    p = applyRun(p, run({ grade: "B", totalSeconds: 1200 })).progress;
    expect(p.bestGrade).toBe("A");
    expect(p.bestRunSeconds).toBe(900);
    for (let i = 0; i < 25; i++) p = applyRun(p, run({ finishedAt: 1789000000000 + i })).progress;
    expect(p.history).toHaveLength(20);
  });
});
