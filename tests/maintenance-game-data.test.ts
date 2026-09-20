// 「检修闯关」数据层红线测试：题目必须 100% 来自传入的真实规程字段，
// 设备类别与规程归类不一致时靠别名表对齐，而不是把有规程的设备判成"暂无规程"。
import { describe, it, expect } from "vitest";
import {
  parseTools,
  splitContentActions,
  findProcedureForEquipment,
  buildGameLevel,
  hasPlayableLevel,
} from "../src/components/game/gameData.ts";
import type { Equipment, MaintenanceProcedure } from "../src/types/index.ts";

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
      name: "拆卸联轴器护罩",
      content: "拆除护罩紧固件；标记联轴器相对位置；取下护罩并分类存放",
      tools: "套筒扳手、铜棒",
      safety: "禁止戴手套操作旋转部件",
      acceptance: "护罩无变形",
    },
    {
      step_no: 3,
      name: "机械密封分解",
      content: "拆卸压盖螺栓；取出动环与静环；清理密封腔；检查弹簧自由长度",
      tools: "拉马、紫铜棒、塞尺",
      safety: "密封腔泄压后方可拆卸压盖",
      acceptance: "密封面无划痕",
    },
  ],
  ...over,
});

const eq = (over: Partial<Equipment> = {}): Equipment => ({
  id: "eq-1",
  code: "EQ-1",
  name: "12# 连铸结晶器冷却循环泵",
  category: "泵类设备",
  workshop: "连铸车间",
  status: "running",
  healthScore: 42,
  ...over,
} as Equipment);

describe("检修闯关 · 规程解析", () => {
  it("parseTools 兼容中英文顿号、分号与换行，并过滤无意义短词", () => {
    expect(parseTools("绝缘扳手、验电笔；LOTO 锁具\n套筒扳手")).toEqual([
      "绝缘扳手",
      "验电笔",
      "LOTO 锁具",
      "套筒扳手",
    ]);
    expect(parseTools("")).toEqual([]);
    expect(parseTools("a、，、")).toEqual([]);
  });

  it("splitContentActions 拆得出 3 段以上才生成排序题，拆不出就返回空（不硬凑）", () => {
    expect(splitContentActions("拆卸压盖螺栓；取出动环与静环；清理密封腔").length).toBe(3);
    expect(splitContentActions("检查并记录")).toEqual([]);
  });
});

describe("检修闯关 · 设备与规程匹配", () => {
  it("台账 category（泵类设备）与规程 equipmentType（水泵）字面不等时，靠别名表命中", () => {
    const procs = [proc()];
    const hit = findProcedureForEquipment(eq(), procs);
    expect(hit?.id).toBe("proc-pump-lvl1");
  });

  it("equipmentType 完全相等优先于别名", () => {
    const pumpProc = proc();
    const motorProc = proc({ id: "proc-motor", equipmentType: "泵类设备", title: "同名类别规程" });
    expect(findProcedureForEquipment(eq(), [pumpProc, motorProc])?.id).toBe("proc-motor");
  });

  it("确实没有对应规程的类别返回 null，由界面提示暂无规程而不是乱配", () => {
    const robot = eq({ category: "工业机器人", name: "15# 成品自动码垛工业机器人" });
    expect(findProcedureForEquipment(robot, [proc()])).toBeNull();
  });
});

describe("检修闯关 · 关卡生成", () => {
  const procs = [proc(), proc({
    id: "proc-motor-daily",
    equipmentType: "电机",
    title: "三相异步电动机日常运行维护与润滑保养规程",
    steps: [
      { step_no: 1, name: "外观检查", content: "清扫电机外壳；检查地脚螺栓；记录轴承温度", tools: "抹布、力矩扳手", safety: "巡检时不得触碰旋转部位" },
      { step_no: 2, name: "绝缘测量", content: "拆开发接线盒；用兆欧表测量绝缘电阻；恢复接线", tools: "兆欧表、绝缘螺丝刀", safety: "测量前后必须对地放电" },
    ],
  })];

  it("每一步都至少有一道安全关，且题面原句来自该步骤的 safety 字段", () => {
    const level = buildGameLevel(procs[0], procs);
    expect(level.steps.length).toBe(3);
    for (const st of level.steps) {
      const safety = st.games.find((g) => g.kind === "safety");
      expect(safety).toBeDefined();
    }
    const first = level.steps[0].games.find((g) => g.kind === "safety") as any;
    expect(first.statement).toBe(procs[0].steps[0].safety);
    expect(first.answer).toBe(true);
  });

  it("工具关的正确项取自步骤 tools，干扰项全部来自真实工具池", () => {
    const level = buildGameLevel(procs[0], procs);
    const toolStep = level.steps.find((s) => s.games.some((g) => g.kind === "tool"))!;
    const tool = toolStep.games.find((g) => g.kind === "tool") as any;
    const realPool = new Set(procs.flatMap((p) => p.steps.flatMap((s) => parseTools(s.tools))));
    expect(tool.options.length).toBe(4);
    expect(tool.options).toContain(tool.correct);
    for (const opt of tool.options) expect(realPool.has(opt)).toBe(true);
  });

  it("验收排序关每 3 步出现一次，且 items 是 content 的原文切分", () => {
    const level = buildGameLevel(procs[0], procs);
    const orderSteps = level.steps
      .map((s, i) => ({ i, has: s.games.some((g) => g.kind === "order") }))
      .filter((x) => x.has);
    expect(orderSteps.map((x) => x.i)).toEqual([2]);
    const order = level.steps[2].games.find((g) => g.kind === "order") as any;
    for (const item of order.items) expect(procs[0].steps[2].content).toContain(item);
  });

  it("hasPlayableLevel：空步骤或某步无题都不可开局，不生成半成品关卡", () => {
    expect(hasPlayableLevel(buildGameLevel(procs[0], procs))).toBe(true);
    expect(hasPlayableLevel(buildGameLevel(proc({ steps: [] }), procs))).toBe(false);
    expect(hasPlayableLevel(null)).toBe(false);
  });
});
