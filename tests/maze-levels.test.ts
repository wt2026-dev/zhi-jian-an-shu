/**
 * 俯视「工厂迷宫」payload 守卫 —— 纯逻辑，node 环境直接跑。
 *
 * 这一层没有画面可看，能钉的就只有三件事：
 *   ① **关卡骨架对得上产品口径**：网格 3/5/7/9、故障 1/2/3/4、机制逐关叠加
 *      （干扰项 / 门禁卡 / 倒计时 + 扩散），且卡数 ≥ 锁数（少一张就是死局）；
 *   ② **数据红线**：每台故障设备都得有真实规程撑腰（steps 非空、题面能追到规程原文），
 *      没有规程的设备永远不进故障位；台账填不满时只许降级、不许编设备，
 *      `degraded` 要说清"缺到第几台"；读数缺失只能是 null（「未接入」），不能是 0；
 *   ③ **可复现**：同一份台账两次构建必须逐字节相等 —— `buildGameLevel` 内部用
 *      `Math.random` 抽干扰项，`mazeLevels` 的确定性化一旦漏掉，Godot 侧的
 *      payload 快照比对就会在"什么都没改"的前提下报红。
 * 外加一条只有跨模块才看得见的坑：关卡引用的每个 id 都必须活在 16 台名单里。
 */
import { describe, it, expect } from "vitest";
import {
  buildMazeLevels,
  buildMazePayload,
  buildMazeRoster,
  faultTargetFor,
  mazeGridFor,
  orderStepOf,
  FAULT_TARGET_BY_LEVEL,
  MAZE_GRID_BY_LEVEL,
  MAZE_LEVEL_COUNT,
  MAZE_ROSTER_LIMIT,
  MAZE_VERSION,
  type MazeLevelDTO,
} from "../src/components/game/mazeLevels.ts";
import { findProcedureForEquipment, parseTools } from "../src/components/game/gameData.ts";
import type { Equipment, MaintenanceProcedure, TelemetryData } from "../src/types/index.ts";

/* ============================ 夹具 ============================ */

/**
 * 遥测夹具：**故意**缺字段。真实台账里就是会有测点没接线（`TelemetryData` 的
 * `voltage` 必填只是类型上的乐观假设），缺的那些正是「未接入」契约的靶子。
 */
const tel = (over: Partial<TelemetryData>): TelemetryData => over as TelemetryData;

/**
 * 类别取的是 `src/types/index.ts` 里 `Equipment['category']` 的真值域。
 * 注意规程按**类别**匹配：`泵类设备 → 水泵`、`大型电机 → 电机`、`压缩机 →（包含匹配）空压机`
 * 走的是 `gameData.CATEGORY_ALIAS` / 宽松包含那条路，别以为写个不存在的类别也能命中。
 */
const eq = (over: Partial<Equipment> = {}): Equipment =>
  ({
    id: "eq-pump-11",
    code: "P-1101",
    name: "11# 高压给水泵",
    category: "泵类设备",
    model: "DG460-100×10",
    workshop: "主泵房",
    status: "running",
    healthScore: 61,
    criticality: "关键核心",
    // pressure 故意缺省：它就是「未接入」那条契约的靶子
    telemetry: tel({ temperature: 92.5, vibration: 7.4, loadRate: 88, voltage: 380, current: 15, lastUpdated: "2026-09-21T02:00:00.000Z" }),
    ...over,
  }) as unknown as Equipment;

/** 一份"真能抽出题目"的规程：3 步、每步有 tools/safety，第 3 步 content 能拆出 3 个动作 */
const proc = (over: Partial<MaintenanceProcedure>): MaintenanceProcedure => ({
  id: "proc-pump",
  title: "离心式高压给水泵一级维保与机械密封调校规程",
  equipmentType: "水泵",
  maintenanceLevel: "一级检修",
  estimatedMinutes: 60,
  steps: [
    {
      step_no: 1,
      name: "停机与能量隔离",
      content: "办理作业票并挂牌上锁；断开主电源并逐相验电；关闭进出口阀门后泄压",
      tools: "绝缘扳手、验电笔、LOTO 锁具",
      safety: "作业前必须完成 LOTO 挂牌上锁，未验电不得触碰电气部件",
      acceptance: "现场无残留能量",
    },
    {
      step_no: 2,
      name: "轴承温度与振动检测",
      content: "测量轴承座振动值并记录；同步采集轴温三点；与历史趋势比对劣化速率",
      tools: "测振仪、红外测温枪",
      safety: "禁止在设备运行中触碰旋转部件",
      acceptance: "振动值在允许范围内",
    },
    {
      step_no: 3,
      name: "机械密封检查与回装",
      content: "检查密封冲洗管路是否畅通；测量泄漏量并记录；必要时更换密封件并复紧",
      tools: "塞尺、力矩扳手、清洗液",
      safety: "泄压完成后方可拆解端盖",
      acceptance: "泄漏量 ≤ 3 滴/分钟",
    },
  ],
  ...over,
});

const PUMP = proc({});

const MOTOR = proc({
  id: "proc-motor",
  title: "三相异步电动机（10kV）一级检修规程",
  equipmentType: "电机",
  steps: [
    {
      step_no: 1,
      name: "停电与拆接线",
      content: "断开断路器并挂接地线；拆除电机引线并做相序标记；测量停机电阻",
      tools: "绝缘电阻表、接地线组、标记笔",
      safety: "验电确认无压后方可装设接地线",
      acceptance: "绕组绝缘电阻 ≥ 6 MΩ",
    },
    {
      step_no: 2,
      name: "轴承与端盖检修",
      content: "用液压拉马拆卸轴承；清洗并检查滚道麻点；按规定力矩复紧端盖螺栓",
      tools: "液压拉马、力矩扳手、清洗剂",
      safety: "禁止用锤击方式直接敲击轴承内圈",
      acceptance: "端盖螺栓力矩记录完整",
    },
    {
      step_no: 3,
      name: "空载试运行与验收",
      content: "解除联锁并点动确认转向；连续空载运行 30 分钟；记录三相电流不平衡度",
      tools: "钳形电流表、测速仪、记录本",
      safety: "试车前必须清场并确认无人作业",
      acceptance: "三相电流不平衡度 ≤ 5%",
    },
  ],
});

const COMPRESSOR = proc({
  id: "proc-compressor",
  title: "螺杆式空压机年度保养规程",
  equipmentType: "空压机",
  steps: [
    {
      step_no: 1,
      name: "停机泄压与挂牌",
      content: "停机后等待油气桶泄压；断开动力电源并挂牌；关闭供气总阀",
      tools: "氟表、挂牌锁、泄压阀扳手",
      safety: "油气桶未泄压前严禁打开加油盖",
      acceptance: "系统压力归零",
    },
    {
      step_no: 2,
      name: "油路与滤芯更换",
      content: "排放润滑油并收集；更换油分与空气滤芯；按规定量补注新油",
      tools: "废油桶、滤芯扳手、加油泵",
      safety: "废油须交由资质单位回收处置",
      acceptance: "油位处于视窗中线附近",
    },
    {
      step_no: 3,
      name: "气密性与加载测试",
      content: "涂抹检漏液检查各接头；分档加载测排气量；记录比功率",
      tools: "检漏液、流量计、转速表",
      safety: "加载测试期间禁止拆卸任何管路",
      acceptance: "各接头无渗漏气泡",
    },
  ],
});

const EXCHANGER = proc({
  id: "proc-exchanger",
  title: "板式换热器清洗与垫片更换规程",
  equipmentType: "换热容器",
  steps: [
    {
      step_no: 1,
      name: "隔离与排空",
      content: "关闭一二次侧隔断阀；开启排污阀排空介质；挂禁止操作警示牌",
      tools: "管钳、警示牌、耐酸手套",
      safety: "介质温度降至 40℃ 以下才可开始拆解",
      acceptance: "两侧压力表均归零",
    },
    {
      step_no: 2,
      name: "拆板与清洗",
      content: "按编号顺序拆卸板片；高压水枪冲洗板面垢层；检查板片穿孔情况",
      tools: "高压水枪、扳手组、试压泵",
      safety: "高压水枪作业必须佩戴防护面罩",
      acceptance: "板面无明显结垢与穿孔",
    },
    {
      step_no: 3,
      name: "换垫与压紧复位",
      content: "铲除老化垫片并清洁粘接面；按原顺序复装板片；分次均匀压紧至规定尺寸",
      tools: "刀片刮铲、密封胶水、卷尺",
      safety: "压紧作业时需两人对称操作防止板片倾倒",
      acceptance: "压紧尺寸符合铭牌规定值",
    },
  ],
});

/** 一份"什么都能填满"的台账：5 个不同类别可玩 + 1 台同类别重复 + 2 台根本没规程 */
const ledger = (): { equipments: Equipment[]; procs: MaintenanceProcedure[] } => ({
  equipments: [
    eq(),
    eq({ id: "eq-motor-12", code: "M-1202", name: "12# 送风机电机", category: "大型电机", telemetry: tel({ temperature: 61, vibration: 5.2, loadRate: 40, voltage: 10000, current: 88, pressure: 0.42, lastUpdated: "2026-09-21T02:00:00.000Z" }) }),
    eq({ id: "eq-gearbox-13", code: "G-1303", name: "13# 立磨减速机", category: "传动减速机", telemetry: tel({ temperature: 55, vibration: 2.1, loadRate: 96, current: 40, lastUpdated: "2026-09-21T02:00:00.000Z" }) }),
    eq({ id: "eq-comp-14", code: "C-1404", name: "14# 螺杆空压机", category: "压缩机", telemetry: tel({ temperature: 58, vibration: 1.8, loadRate: 72, voltage: 380, current: 60, pressure: 0.8, lastUpdated: "2026-09-21T02:00:00.000Z" }) }),
    eq({ id: "eq-hx-15", code: "H-1505", name: "15# 板式换热器", category: "换热容器", telemetry: tel({ temperature: 47, vibration: 0.9, loadRate: 55, voltage: 380, current: 12, pressure: 0.35, lastUpdated: "2026-09-21T02:00:00.000Z" }) }),
    eq({ id: "eq-pump-16", code: "P-1606", name: "16# 凝结水泵", category: "泵类设备", telemetry: tel({ temperature: 52, vibration: 2.4, loadRate: 60, current: 30, pressure: 0.5, lastUpdated: "2026-09-21T02:00:00.000Z" }) }),
    eq({ id: "eq-cnc-17", code: "K-1707", name: "17# 数控车床", category: "数控机床", telemetry: tel({ temperature: 39, vibration: 1.2, loadRate: 45, current: 22, pressure: 0.6, lastUpdated: "2026-09-21T02:00:00.000Z" }) }),
    eq({ id: "eq-robot-18", code: "R-1808", name: "18# 焊接机器人", category: "工业机器人", telemetry: tel({ temperature: 41, vibration: 1.5, loadRate: 50, current: 18, pressure: 0.55, lastUpdated: "2026-09-21T02:00:00.000Z" }) }),
  ],
  procs: [PUMP, MOTOR, COMPRESSOR, EXCHANGER],
});

const build = (): MazeLevelDTO[] => {
  const { equipments, procs } = ledger();
  return buildMazeLevels(equipments, procs);
};

/** 设备在规程里的原文（题目可追溯性的比对基线） */
const procText = (procs: MaintenanceProcedure[]): string =>
  procs.map((p) => [p.title, ...p.steps.flatMap((s) => [s.name, s.content, s.tools ?? "", s.safety ?? "", s.acceptance ?? ""])].join("|")).join("||");

/* ============================ 关卡骨架 ============================ */

describe("迷宫关卡骨架 · 网格与故障数按产品口径", () => {
  it("恒定 4 关，序号 1..4", () => {
    const levels = build();
    expect(levels.length).toBe(4);
    expect(MAZE_LEVEL_COUNT).toBe(4);
    expect(levels.map((l) => l.index)).toEqual([1, 2, 3, 4]);
  });

  it("网格边长依次 3/5/7/9，故障台数依次 1/2/3/4", () => {
    const levels = build();
    expect(MAZE_GRID_BY_LEVEL).toEqual([3, 5, 7, 9]);
    expect(FAULT_TARGET_BY_LEVEL).toEqual([1, 2, 3, 4]);
    expect(levels.map((l) => l.gridRooms)).toEqual([3, 5, 7, 9]);
    expect(levels.map((l) => l.faults.length)).toEqual([1, 2, 3, 4]);
  });

  it("mazeGridFor / faultTargetFor 按 1 起的关卡序号取值，越界时收到边界而不是 undefined", () => {
    expect([1, 2, 3, 4].map(mazeGridFor)).toEqual([3, 5, 7, 9]);
    expect([1, 2, 3, 4].map(faultTargetFor)).toEqual([1, 2, 3, 4]);
    expect(mazeGridFor(0)).toBe(3);
    expect(mazeGridFor(99)).toBe(9);
    expect(faultTargetFor(-5)).toBe(1);
    expect(faultTargetFor(99)).toBe(4);
  });

  it("note 里的数字与实际下发量一致（说明文案不能和字段各说各话）", () => {
    for (const l of build()) {
      expect(l.note).toContain(`第 ${l.index} 关`);
      expect(l.note).toContain(`${l.gridRooms}×${l.gridRooms}`);
      expect(l.note).toContain(`${l.faults.length} 台故障`);
      if (l.lockedRooms > 0) expect(l.note).toContain(`${l.lockedRooms} 间房上锁`);
      if (l.timeLimit > 0) expect(l.note).toContain(`倒计时 ${l.timeLimit}s`);
      // 降级把池子见底时一台干扰项都没有，文案也不许许诺"去找绿圈"
      if (l.distractorIds.length) expect(l.note).toContain(`${l.distractorIds.length} 台绿圈`);
      else expect(l.note).not.toContain("绿圈");
    }
  });
});

/* ============================ 机制逐关叠加 ============================ */

describe("迷宫机制 · 干扰项 / 门禁卡 / 倒计时与扩散", () => {
  it("第 1 关是纯教学：没有锁门、没有门禁卡、不限时、也不摆干扰项", () => {
    const [l1] = build();
    expect(l1.lockedRooms).toBe(0);
    expect(l1.keycardCount).toBe(0);
    expect(l1.distractorIds).toEqual([]);
    // 0 = 不限时（Godot 的 time_limit_of 把它换算成 -1；塞 0 进计时器会开局即结算）
    expect(l1.timeLimit).toBe(0);
    expect(l1.faults.every((f) => !f.spreadable)).toBe(true);
    expect(l1.degraded).toBeNull();
  });

  it("第 2 关开始出现健康设备干扰项，且仍不上锁、不限时", () => {
    const l2 = build()[1];
    expect(l2.distractorIds.length).toBeGreaterThan(0);
    expect(l2.lockedRooms).toBe(0);
    expect(l2.timeLimit).toBe(0);
  });

  it("第 3 关有锁房与门禁卡，且卡数 ≥ 锁数（卡少了就是打不开的死局）", () => {
    const l3 = build()[2];
    expect(l3.lockedRooms).toBeGreaterThan(0);
    expect(l3.keycardCount).toBeGreaterThan(0);
    for (const l of build()) expect(l.keycardCount).toBeGreaterThanOrEqual(l.lockedRooms);
  });

  it("第 4 关有限时且故障会扩散；前三关都不扩散（机制不能提前泄漏）", () => {
    const levels = build();
    const [l1, l2, l3, l4] = levels;
    expect(l1.timeLimit).toBe(0);
    expect(l2.timeLimit).toBe(0);
    expect(l3.timeLimit).toBe(0);
    expect(l4.timeLimit).toBeGreaterThan(0);
    expect(Number.isInteger(l4.timeLimit)).toBe(true);
    expect(l4.faults.every((f) => f.spreadable)).toBe(true);
    expect([...l1.faults, ...l2.faults, ...l3.faults].every((f) => !f.spreadable)).toBe(true);
  });

  it("同一关内故障位与干扰项互斥（一台设备既闪红又挂绿圈是最难查的缺陷）", () => {
    for (const l of build()) {
      const faults = new Set(l.faults.map((f) => f.deviceId));
      expect(new Set(l.distractorIds).size).toBe(l.distractorIds.length);
      for (const id of l.distractorIds) expect(faults.has(id), `第 ${l.index} 关把故障设备 ${id} 又摆成了干扰项`).toBe(false);
    }
  });

  it("关卡窗口顺次拉长 ⇒ 第 1 关那台教学设备在 4 关里始终是同一台", () => {
    const levels = build();
    const tutorial = levels[0].faults[0].deviceId;
    for (const l of levels) expect(l.faults[0].deviceId).toBe(tutorial);
  });
});

/* ============================ 数据红线 ============================ */

describe("数据红线 · 故障位必须有真实规程", () => {
  it("每台故障设备都 ≥1 道题（空 steps 就等于凭空造了台故障设备）", () => {
    for (const l of build()) {
      expect(l.faults.length).toBeGreaterThan(0);
      for (const f of l.faults) {
        expect(f.steps.length, `${f.deviceName} 没有真实题目`).toBeGreaterThan(0);
        for (const s of f.steps) {
          expect(["tool", "safety", "order"]).toContain(s.kind);
          expect(s.title.length).toBeGreaterThan(0);
          expect(s.prompt.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("题型与横版检修面板同构：tool / safety / order 三道，字段一套对齐", () => {
    const { equipments, procs } = ledger();
    const knownToolPool = new Set(procs.flatMap((p) => p.steps.flatMap((s) => parseTools(s.tools))));
    const text = procText(procs);
    const stepNamesOf = (deviceId: string): string[] => {
      const eqRow = equipments.find((e) => e.id === deviceId)!;
      return findProcedureForEquipment(eqRow, procs)!.steps.map((s) => s.name);
    };
    for (const l of build()) {
      for (const f of l.faults) {
        expect(f.steps.map((s) => s.kind)).toEqual(["tool", "safety", "order"]);
        for (const s of f.steps) {
          if (s.kind === "tool") {
            expect(s.options?.length).toBe(4);
            expect(s.options).toContain(s.correct);
            // 四个选项全是规程里的真工具，一个都不许多
            for (const o of s.options!) expect(knownToolPool.has(o), `凭空出现的工具：${o}`).toBe(true);
            // 题面点名了取材自规程的哪一步（横版 KIND_META 的文案，改那边要同步这边）
            const quoted = s.prompt.match(/^规程「(.+)」应使用哪件工具？$/);
            expect(quoted, `工具题文案变了：${s.prompt}`).not.toBeNull();
            expect(stepNamesOf(f.deviceId)).toContain(quoted![1]);
          }
          if (s.kind === "safety") {
            expect(s.answer).toBe(true);
            expect(text, `安全题追不到规程原文：${s.statement}`).toContain(s.statement!);
          }
          if (s.kind === "order") {
            expect(s.items!.length).toBeGreaterThanOrEqual(3);
            for (const item of s.items!) expect(text, `排序动作追不到规程原文：${item}`).toContain(item);
          }
        }
      }
    }
  });

  it("没有命中规程的设备永远进不了故障位", () => {
    const { equipments, procs } = ledger();
    const unplayable = new Set(equipments.filter((e) => !findProcedureForEquipment(e, procs)).map((e) => e.id));
    expect(unplayable.size, "夹具该有没规程的设备（减速机 / 车床 / 机器人）").toBeGreaterThan(0);
    for (const l of build()) for (const f of l.faults) expect(unplayable.has(f.deviceId)).toBe(false);
  });

  it("规程按类别匹配 ⇒ 同一关的故障位优先摊到不同类别（同类别会拿到一模一样的题）", () => {
    const { equipments } = ledger();
    const l4 = build()[3];
    const cats = l4.faults.map((f) => equipments.find((e) => e.id === f.deviceId)!.category);
    expect(new Set(cats).size).toBe(cats.length);
    const ids = l4.faults.map((f) => f.deviceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("台账为空或全无规程时返回空关卡表（页面显示无数据，而不是渲染一个空世界）", () => {
    const { equipments, procs } = ledger();
    expect(buildMazeLevels([], procs)).toEqual([]);
    expect(buildMazeLevels(equipments, [])).toEqual([]);
    const payload = buildMazePayload(equipments, []);
    expect(payload.levels).toEqual([]);
    expect(payload.type).toBe("maze-data");
  });
});

/* ============================ 降级诚实性 ============================ */

describe("降级 · 台账填不满时只许少给，不许编设备", () => {
  const single = (): { equipments: Equipment[]; procs: MaintenanceProcedure[] } => ({
    equipments: [
      eq(),
      eq({ id: "eq-cnc-17", code: "K-1707", name: "17# 数控车床", category: "数控机床" }),
      eq({ id: "eq-robot-18", code: "R-1808", name: "18# 焊接机器人", category: "工业机器人" }),
    ],
    procs: [PUMP],
  });

  it("只有 1 台有规程时：第 1 关满配，第 2~4 关报降级原因且仍只给那 1 台真故障", () => {
    const { equipments, procs } = single();
    const levels = buildMazeLevels(equipments, procs);
    expect(levels.length).toBe(4);
    expect(levels[0].faults.length).toBe(1);
    expect(levels[0].degraded).toBeNull();

    for (const want of [2, 3, 4]) {
      const l = levels[want - 1];
      expect(l.degraded, `第 ${want} 关没有如实降级`).not.toBeNull();
      expect(l.degraded).toContain(`台账里没有第 ${want} 台有规程的可玩设备`);
      expect(l.faults.length).toBe(1);
      expect(l.faults[0].deviceId).toBe("eq-pump-11");
      expect(l.faults[0].steps.length).toBeGreaterThan(0);
      expect(l.distractorIds).toEqual([]);
    }
    // 机制量不受降级影响：故障少了，9×9 的锁门与倒计时照旧（那是地图设计量，不是数据量）
    expect(levels[3].lockedRooms).toBeGreaterThan(0);
    expect(levels[3].timeLimit).toBeGreaterThan(0);
    expect(levels[3].faults.every((f) => f.spreadable)).toBe(true);
  });

  it("降级原因里的数字自洽：说缺到第 N 台，实际就是 N-1 台", () => {
    const { equipments, procs } = ledger();
    // 4 台里混了 1 台没规程的减速机 ⇒ 可玩池只有 3 台：第 3 关刚好满配，第 4 关缺 1 台
    const levels = buildMazeLevels(equipments.slice(0, 4), procs);
    expect(levels[2].degraded).toBeNull();
    expect(levels[2].faults.length).toBe(3);

    const l4 = levels[3];
    expect(l4.degraded).not.toBeNull();
    expect(l4.faults.length).toBe(3);
    expect(l4.degraded).toContain("台账里没有第 4 台");
    expect(l4.degraded).toContain("实际 3 台");
    // 缺的那 1 台不许由没规程的减速机顶位
    expect(l4.faults.map((f) => f.deviceId)).not.toContain("eq-gearbox-13");
    // 干扰项窗口贴着"实际故障数"往后取：既没把故障设备摆成绿的，池子见底时就干脆不摆
    expect(levels[1].distractorIds).toEqual(["eq-comp-14"]);
    expect(l4.distractorIds).toEqual([]);
  });
});

/* ============================ 可复现 ============================ */

describe("确定性 · 同一份台账两次构建必须逐字节相同", () => {
  it("buildMazeLevels 两次 deep-equal（buildGameLevel 里的 Math.random 已被压住）", () => {
    const { equipments, procs } = ledger();
    expect(buildMazeLevels(equipments, procs)).toEqual(buildMazeLevels(equipments, procs));
    expect(buildMazePayload(equipments, procs)).toEqual(buildMazePayload(equipments, procs));
  });

  it("工具题选项稳定：正确项在，且 3 个干扰项优先来自别的规程（不能把同规程另一步列的器具当假答案）", () => {
    const { equipments, procs } = ledger();
    const faults = buildMazePayload(equipments, procs).levels[3].faults;
    for (const f of faults) {
      const tool = f.steps.find((s) => s.kind === "tool")!;
      const own = new Set(
        findProcedureForEquipment(equipments.find((e) => e.id === f.deviceId)!, procs)!.steps.flatMap((s) => parseTools(s.tools))
      );
      expect(tool.options).toEqual([...tool.options!].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      expect(tool.options!.filter((o) => o === tool.correct).length).toBe(1);
      for (const o of tool.options!) if (o !== tool.correct) expect(own.has(o), `干扰项 ${o} 出自本规程，玩家会判它也对`).toBe(false);
    }
  });

  it("payload 可 JSON 往返（postMessage 只吃字符串，带函数或 undefined 会掉字段）", () => {
    const { equipments, procs } = ledger();
    const payload = buildMazePayload(equipments, procs);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

/* ============================ payload 外壳 ============================ */

describe("maze-data payload", () => {
  it("type 是 'maze-data'，version 与 MAZE_VERSION 一致", () => {
    const { equipments, procs } = ledger();
    const payload = buildMazePayload(equipments, procs);
    expect(payload.type).toBe("maze-data");
    expect(payload.version).toBe(MAZE_VERSION);
    expect(MAZE_VERSION).toBe(1);
    expect(Object.keys(payload).sort()).toEqual(["devices", "levels", "type", "version"]);
  });

  it("名单不超过 16 台，且关卡引用的每个 id 都活在名单里", () => {
    const { equipments, procs } = ledger();
    const many = Array.from({ length: 30 }, (_, i) => eq({ id: `eq-${i}`, code: `EQ-${i}`, name: `设备 ${i} 号` }));
    const crowded = buildMazePayload(many, procs);
    expect(crowded.devices.length).toBe(MAZE_ROSTER_LIMIT);
    expect(crowded.devices.length).toBeLessThanOrEqual(16);
    expect(new Set(crowded.devices.map((d) => d.id)).size).toBe(crowded.devices.length);

    const rosterIds = new Set(buildMazeRoster(equipments, procs).map((d) => d.id));
    for (const l of buildMazeLevels(equipments, procs)) {
      for (const f of l.faults) expect(rosterIds.has(f.deviceId), `故障设备 ${f.deviceId} 被名单裁掉了`).toBe(true);
      for (const id of l.distractorIds) expect(rosterIds.has(id), `干扰项 ${id} 被名单裁掉了`).toBe(true);
    }
  });

  it("设备条目带 icon 与六个测点，遥测缺项就是 reading:null（「未接入」契约，不许写 0）", () => {
    const { equipments, procs } = ledger();
    const payload = buildMazePayload(equipments, procs);
    const pump = payload.devices.find((d) => d.id === "eq-pump-11")!;
    expect(pump.no).toBe("P-1101");
    expect(pump.icon).toBe("pump");
    expect(pump.spots.length).toBe(6);

    const pressure = pump.spots.find((s) => s.key === "pressure")!;
    expect(pressure.reading).toBeNull();
    expect(pressure.severity).toBe("nodata");
    expect(pressure.abnormal).toBe(false);
    expect(pressure.reading).not.toBe("0");

    const temp = pump.spots.find((s) => s.key === "temperature")!;
    expect(temp.reading).toContain("℃");
    expect(temp.abnormal).toBe(true);
    // spots 里不许混进 reading 是数字类型这种脏东西
    for (const s of pump.spots) expect(s.reading === null || typeof s.reading === "string").toBe(true);
  });

  it("台账没有 code 时用 id 兜底显示位号", () => {
    const { procs } = ledger();
    const roster = buildMazeRoster([eq({ code: "" })], procs);
    expect(roster[0].no).toBe("eq-pump-11");
  });
});

/* ============================ 排序题（迷宫的"修"） ============================ */

describe("orderStepOf · 迷宫修复动作序列只认真实规程", () => {
  it("取到的是那道 order 题，items 就是本关要点的部位序列", () => {
    const steps = build()[0].faults[0].steps;
    const order = orderStepOf(steps);
    expect(order).not.toBeNull();
    expect(order!.kind).toBe("order");
    expect(order!.items!.length).toBeGreaterThanOrEqual(3);
    expect(order!.items).toContain("检查密封冲洗管路是否畅通");
  });

  it("有多个 order 时取第一个；没有 order 时返回 null（引擎侧此时退回 steps[0]，不许自己编动作）", () => {
    const steps = build()[0].faults[0].steps;
    const order = orderStepOf(steps)!;
    expect(orderStepOf([order, ...steps])).toBe(order);
    expect(orderStepOf(steps.filter((s) => s.kind !== "order"))).toBeNull();
    expect(orderStepOf([])).toBeNull();
  });
});

describe("故障位的红色要有读数支撑 · 设备池排序口径", () => {
  it("遥测越限的设备排在健康设备前面，先被选去当故障位", () => {
    const { equipments, procs } = ledger();
    const payload = buildMazePayload(equipments, procs);
    const abnormalIds = new Set(payload.devices.filter((d) => d.spots.some((s) => s.abnormal)).map((d) => d.id));
    // 夹具里可玩的 5 台：给水泵(轴温/振动/负载全越限) 与电机(振动预警) 异常，空压机/换热器/凝结水泵正常
    expect(abnormalIds.has("eq-pump-11")).toBe(true);
    expect(abnormalIds.has("eq-motor-12")).toBe(true);
    for (const id of ["eq-comp-14", "eq-hx-15", "eq-pump-16"]) expect(abnormalIds.has(id)).toBe(false);

    const faults = payload.levels[2].faults.map((f) => f.deviceId);
    expect(faults.slice(0, 2)).toEqual(["eq-pump-11", "eq-motor-12"]);
    // 第 3 台起才轮到读数正常的设备顶上（玩法需要 3 台，台账只给了 2 台越限的）
    expect(abnormalIds.has(faults[2])).toBe(false);
  });

  it("第 2 关的干扰项正是这些读数正常的设备（红/绿的取色口径与台账一致）", () => {
    const { equipments, procs } = ledger();
    const payload = buildMazePayload(equipments, procs);
    const spotsById = new Map(payload.devices.map((d) => [d.id, d.spots]));
    const l2 = payload.levels[1];
    for (const id of l2.distractorIds) {
      expect(spotsById.get(id)!.some((s) => s.abnormal), `干扰项 ${id} 读数本来就超限，画成绿的等于瞒报`).toBe(false);
    }
    expect(l2.distractorIds.length).toBeGreaterThan(0);
  });
});
