// 《检修大师》2D 横版闯关：物理引擎 + 关卡设计守卫。
//
// 这一层全是纯函数（无 React、无 canvas、无 three.js），所以能把"能不能玩"钉成断言。
// 重点守三类事：
//   ① **跳跃能力与关卡设计必须自洽**：跳跃最高点只有 ~117px（理论 122.5px，
//      半隐式欧拉积分会低一点），任何一块栈桥如果抬升超过它，玩家就会
//      "看着能跳其实跳不上去" —— 这是横版游戏最劝退的一类缺陷，
//      而且静态截图里完全看不出来（桥就摆在那儿，很合理的样子）；
//   ② **物理不许穿模 / 不许掉出世界**：地面横跨整个世界宽度（没有掉坑死亡），
//      侧向撞上矮台要被推出来、单帧下落距离不许超过"身高 + 桥厚"（否则穿过薄桥）；
//   ③ **关卡结构**：4 关机制各不相同、设备都在世界内、同关设备不重叠、
//      题目必须来自真实规程（没规程的设备不许进关卡）。
import { describe, it, expect } from "vitest";
import {
  createCamera,
  createPlayer,
  followCamera,
  nearDevice,
  playerBox,
  screenToWorld,
  solidsOf,
  stepPlayer,
  worldToScreen,
  JUMP_HEIGHT,
  PLAYER,
  VIEW_H,
  VIEW_W,
  type Input,
  type PlayerState,
  type WorldLayout,
} from "../src/components/game/platformerEngine.ts";
import {
  buildMasterLevels,
  GROUND_Y,
  MAX_GAP,
  MAX_RISE,
  nextRankHint,
  rankFor,
  RANK_NAME,
  RANK_ORDER,
  type MasterLevel,
} from "../src/components/game/masterLevels.ts";
import type { Equipment, MaintenanceProcedure } from "../src/types/index.ts";

/* ============================ 夹具与工具 ============================ */

const NO_INPUT: Input = { left: false, right: false, jump: false };
const right = (jump = false): Input => ({ left: false, right: true, jump });
const left = (jump = false): Input => ({ left: true, right: false, jump });

const DT = 1 / 60;

/** 固定 dt 推进 n 秒（不用墙钟，断言才可复现） */
function simulate(
  world: WorldLayout,
  inputAt: (t: number, p: PlayerState) => Input,
  seconds: number,
  start = createPlayer(120, world.groundY),
  dt = DT
): PlayerState[] {
  const frames = Math.round(seconds / dt);
  const trail: PlayerState[] = [start];
  let p = start;
  for (let i = 0; i < frames; i++) {
    p = stepPlayer(p, inputAt(i * dt, p), world, dt);
    trail.push(p);
  }
  return trail;
}

const flatWorld = (width = 2000, platforms: WorldLayout["platforms"] = []): WorldLayout => ({
  width,
  groundY: GROUND_Y,
  platforms,
});

const riseOf = (world: WorldLayout, trail: PlayerState[]): number =>
  world.groundY - Math.min(...trail.map((p) => p.y));

/* ---------------------------- 设备/规程夹具 ---------------------------- */

const eq = (over: Partial<Equipment> = {}): Equipment =>
  ({
    id: "eq-101",
    code: "EQ-101",
    name: "11# 高压给水泵",
    category: "水泵",
    workshop: "主厂房",
    status: "running",
    healthScore: 62,
    telemetry: { temperature: 92.5, vibration: 7.4, loadRate: 88 },
    ...over,
  }) as unknown as Equipment;

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
    {
      step_no: 3,
      name: "机械密封检查",
      content: "检查密封冲洗管路；测量泄漏量；必要时更换密封件",
      tools: "扳手、塞尺",
      safety: "泄压后方可拆解",
      acceptance: "泄漏量合格",
    },
  ],
  ...over,
});

/** 一份"可玩的设备台账"：4 个不同类别，保证第 2 关三台设备拿到不同题目 */
const pool = (): { equipments: Equipment[]; procs: MaintenanceProcedure[] } => {
  const cats = [
    { cat: "水泵", name: "11# 高压给水泵" },
    { cat: "电机", name: "12# 送风机电机" },
    { cat: "风机", name: "13# 引风机" },
    { cat: "换热器", name: "14# 板式换热器" },
  ];
  return {
    equipments: cats.map((c, i) =>
      eq({
        id: `eq-${i}`,
        code: `EQ-${i}`,
        name: c.name,
        category: c.cat as any,
        telemetry: { temperature: 92.5, vibration: 7.4, loadRate: 88, voltage: 380, current: 15, lastUpdated: new Date().toISOString() },
      })
    ),
    procs: cats.map((c, i) => proc({ id: `proc-${i}`, equipmentType: c.cat, title: `${c.name} 一级检修规程` })),
  };
};

const build = (): MasterLevel[] => {
  const { equipments, procs } = pool();
  return buildMasterLevels(equipments, procs);
};

/* ============================ 物理：重力与落地 ============================ */

describe("检修大师 · 物理（重力/落地）", () => {
  it("重力把玩家拉向地面并稳稳停住（脚底贴地，不抖动、不下陷）", () => {
    const world = flatWorld();
    const trail = simulate(world, () => NO_INPUT, 2, createPlayer(120, world.groundY - 200));
    const end = trail[trail.length - 1];

    expect(end.y).toBeCloseTo(world.groundY, 1);
    expect(end.onGround).toBe(true);
    expect(end.vy).toBe(0);

    // 落地后不能来回抖：最后 30 帧的 y 必须完全一致
    expect(new Set(trail.slice(-30).map((p) => p.y)).size).toBe(1);
  });

  it("实测跳跃最高点不低于理论值（半隐式欧拉会略微过冲，但不许偏太多）", () => {
    const world = flatWorld();
    // 一直按住跳 → 拿到满高度
    const rise = riseOf(world, simulate(world, () => right(true), 1.2));
    expect(rise).toBeGreaterThanOrEqual(JUMP_HEIGHT);
    expect(rise).toBeLessThan(JUMP_HEIGHT + 10);
    // 常量本身必须由物理量推导，别手写一个数字
    expect(JUMP_HEIGHT).toBeCloseTo((PLAYER.JUMP_V ** 2) / (2 * PLAYER.GRAVITY), 6);
  });

  it("跳跃高度对「松手时机」敏感：提前松手会明显截断（这是特性，不是 bug）", () => {
    const world = flatWorld();
    // 起跳后立刻松手 → JUMP_CUT 把上升速度截到 -260，只剩一个小跳
    const cut = riseOf(
      world,
      simulate(world, (_t, p) => right(p.onGround), 0.8)
    );
    const full = riseOf(world, simulate(world, () => right(true), 0.8));
    expect(cut).toBeLessThan(full * 0.35);
    expect(cut).toBeGreaterThan(5);
  });

  it("松手跳得更低（可变跳跃高度）：轻点的高度明显小于按住不放", () => {
    const world = flatWorld();
    const held = riseOf(world, simulate(world, () => right(true), 0.8));
    const tapped = riseOf(world, simulate(world, (t) => right(t < 0.05), 0.8));
    expect(tapped).toBeLessThan(held * 0.75);
    expect(tapped).toBeGreaterThan(20); // 但也不能一点都跳不起来
  });

  it("土狼时间：刚走出平台边缘的一瞬间仍能起跳", () => {
    const top = GROUND_Y - 104;
    const world = flatWorld(2000, [{ x: 400, y: top, w: 200, h: 16 }]);

    // 从桥上向右走，直到脚离开桥面
    let p = createPlayer(560, top);
    let walkedOff: PlayerState | null = null;
    for (let i = 0; i < 240 && !walkedOff; i++) {
      const next = stepPlayer(p, right(), world, DT);
      if (!next.onGround) walkedOff = next;
      p = next;
    }
    expect(walkedOff, "走了 4 秒都没走出桥面，夹具有问题").not.toBeNull();
    expect(walkedOff!.coyote).toBeGreaterThan(0);

    // 土狼窗口内按跳 → 应该真的起跳（而不是只受重力）
    const jumped = stepPlayer(walkedOff!, right(true), world, DT);
    expect(jumped.vy).toBe(PLAYER.JUMP_V);
  });

  it("跳跃缓冲：落地前提前按跳，落地后一帧内自动起跳", () => {
    const world = flatWorld();
    let p = createPlayer(120, world.groundY - 40);
    let buffered = false;
    for (let i = 0; i < 60; i++) {
      const wasGround = p.onGround;
      p = stepPlayer(p, right(true), world, DT);
      if (!wasGround && p.onGround) {
        // 落地这一帧还没起跳（coyote 是落地后才建立的）
        expect(p.vy).toBe(0);
        const next = stepPlayer(p, right(true), world, DT);
        expect(next.vy).toBe(PLAYER.JUMP_V);
        buffered = true;
        break;
      }
    }
    expect(buffered).toBe(true);
  });

  it("水平跑动会加速到 RUN_SPEED 并封顶", () => {
    const world = flatWorld();
    const trail = simulate(world, () => right(), 3);
    const top = Math.max(...trail.map((p) => Math.abs(p.vx)));
    expect(top).toBeLessThanOrEqual(PLAYER.RUN_SPEED + 1e-6);
    expect(top).toBeCloseTo(PLAYER.RUN_SPEED, 0);
  });

  it("松开方向键会因摩擦停下（vx 收敛到 0）", () => {
    const world = flatWorld();
    let p = simulate(world, () => right(), 1).pop()!;
    expect(Math.abs(p.vx)).toBeGreaterThan(100);
    for (let i = 0; i < 120; i++) p = stepPlayer(p, NO_INPUT, world, DT);
    expect(Math.abs(p.vx)).toBeLessThan(1);
  });

  it("朝向随输入翻转（渲染层靠它镜像角色，翻错就变成倒着跑）", () => {
    const world = flatWorld();
    expect(simulate(world, () => right(), 0.5).pop()!.facing).toBe(1);
    expect(simulate(world, () => left(), 0.5).pop()!.facing).toBe(-1);
    // 不按方向键时保持原朝向
    const still = simulate(world, () => NO_INPUT, 0.5, createPlayer(120, world.groundY)).pop()!;
    expect(still.facing).toBe(1);
  });

  it("跑步动画相位只在跑动时快速推进（站着是呼吸节奏）", () => {
    const world = flatWorld();
    const running = simulate(world, () => right(), 1);
    const standing = simulate(world, () => NO_INPUT, 1);
    const runGain = running.pop()!.animT - running[0].animT;
    const idleGain = standing.pop()!.animT - standing[0].animT;
    expect(runGain).toBeGreaterThan(idleGain * 1.5);
  });
});

/* ============================ 物理：不许穿模 / 不许掉出世界 ============================ */

describe("检修大师 · 物理（不许穿模 / 不许掉出世界）", () => {
  it("地面横跨整个世界宽度：玩家永远掉不出世界下边界", () => {
    const world = flatWorld(2000);
    const ground = solidsOf(world)[0];
    expect(ground.x).toBeLessThanOrEqual(0);
    expect(ground.x + ground.w).toBeGreaterThanOrEqual(world.width);

    // 随机输入乱跑 20 秒：不许穿地、不许越界、不许出 NaN
    let p = createPlayer(200, world.groundY);
    for (let i = 0; i < 1200; i++) {
      const goRight = i % 97 < 55;
      const input: Input = { left: !goRight, right: goRight, jump: i % 13 === 0 };
      p = stepPlayer(p, input, world, DT);
      expect(p.y).toBeLessThanOrEqual(world.groundY + 2);
      expect(p.x).toBeGreaterThanOrEqual(-PLAYER.W);
      expect(p.x).toBeLessThanOrEqual(world.width + PLAYER.W);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx) && Number.isFinite(p.vy)).toBe(true);
    }
  });

  it("矮台会挡住跑动（必须跳过去），玩家不会从台子里穿过去", () => {
    // 台面只有 40px 高 ⇒ 落在玩家身高范围内，是真正的障碍
    const world = flatWorld(2000, [{ x: 500, y: GROUND_Y - 40, w: 120, h: 16 }]);
    let p = createPlayer(300, world.groundY);
    for (let i = 0; i < 240; i++) p = stepPlayer(p, right(), world, DT);

    const b = playerBox(p);
    const inside = b.x1 > 500 && b.x0 < 620 && b.y1 > GROUND_Y - 40 && b.y0 < GROUND_Y - 24;
    expect(inside, "玩家卡进矮台里了").toBe(false);
    expect(p.x).toBeLessThan(500); // 被挡在台子左侧
  });

  it("能从下方跳上栈桥并站稳（落点判定不吃掉落脚）", () => {
    const top = GROUND_Y - 104;
    const world = flatWorld(2000, [{ x: 600, y: top, w: 200, h: 16 }]);
    let p = createPlayer(480, GROUND_Y);
    let landed = false;
    for (let i = 0; i < 300; i++) {
      // 真人操作：在桥前起跳，然后按住不放直到越过最高点（松手会截断跳跃高度）
      const jump = p.onGround ? p.x > 520 && p.x < 600 : p.vy < 0;
      p = stepPlayer(p, right(jump), world, DT);
      if (p.onGround && Math.abs(p.y - top) < 2 && p.x > 600 && p.x < 800) {
        landed = true;
        break;
      }
    }
    expect(landed, `没能跳上栈桥（最终 x=${p.x.toFixed(0)}，y=${p.y.toFixed(0)}）`).toBe(true);
  });

  it("单帧最大下落距离 ≤ 身高 + 桥厚（否则快速下落会穿过薄栈桥）", () => {
    const maxStep = 0.05; // stepPlayer 里的 dt 上限
    const minPlatformThickness = 16; // masterLevels 里所有栈桥的 h
    const perFrame = PLAYER.MAX_FALL * maxStep;
    expect(perFrame).toBeLessThanOrEqual(PLAYER.H + minPlatformThickness);

    // 顺带守住"关卡里没有更薄的桥"，不然上面的推导就失效了
    for (const l of build()) {
      for (const s of l.world.platforms) expect(s.h).toBeGreaterThanOrEqual(minPlatformThickness);
    }
  });

  it("超大 dt（掉帧/切回标签页）不会穿透地面", () => {
    const world = flatWorld();
    let p = createPlayer(120, world.groundY - 3000);
    for (let i = 0; i < 200; i++) p = stepPlayer(p, NO_INPUT, world, 5); // 每次都传 5 秒
    expect(p.y).toBeCloseTo(world.groundY, 1);
    expect(p.onGround).toBe(true);
  });

  it("零 / 负数 dt 不产生 NaN（首帧时间戳可能是 0）", () => {
    const world = flatWorld();
    const p = createPlayer(120, world.groundY);
    for (const dt of [0, -0.016, Number.EPSILON]) {
      const s = stepPlayer(p, right(true), world, dt);
      expect(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.vx) && Number.isFinite(s.vy)).toBe(true);
    }
  });
});

/* ============================ 镜头与坐标 ============================ */

describe("检修大师 · 镜头与坐标换算", () => {
  it("镜头横向跟随并夹在世界内（不露出世界外的空白）", () => {
    const world = flatWorld(2000);
    let cam = createCamera();
    const p = { ...createPlayer(120, world.groundY), x: 1990 };
    for (let i = 0; i < 300; i++) cam = followCamera(cam, p, world, DT);
    expect(cam.x).toBeLessThanOrEqual(world.width - VIEW_W / 2 + 0.5);
    expect(cam.x).toBeGreaterThanOrEqual(VIEW_W / 2 - 0.5);
  });

  it("世界比视口窄时镜头居中（否则两侧会出现黑边）", () => {
    const world = flatWorld(600);
    let cam = createCamera();
    const p = { ...createPlayer(120, world.groundY), x: 300 };
    for (let i = 0; i < 300; i++) cam = followCamera(cam, p, world, DT);
    expect(cam.x).toBeCloseTo(VIEW_W / 2, 3);
  });

  it("worldToScreen / screenToWorld 互为逆运算（点击命中测试靠它）", () => {
    const cam = { x: 900, y: 0 };
    for (const [wx, wy] of [
      [900, GROUND_Y],
      [100, 200],
      [1999, 40],
    ]) {
      const s = worldToScreen(wx, wy, cam);
      const back = screenToWorld(s.x, s.y, cam);
      expect(back.x).toBeCloseTo(wx, 6);
      expect(back.y).toBeCloseTo(wy, 6);
    }
  });

  it("视口正中对应的世界点就是镜头中心（「看到哪点到哪」的前提）", () => {
    const cam = { x: 900, y: 0 };
    const s = worldToScreen(cam.x, VIEW_H / 2, cam);
    expect(s.x).toBeCloseTo(VIEW_W / 2, 6);
    expect(s.y).toBeCloseTo(VIEW_H / 2, 6);
  });
});

/* ============================ 交互距离 ============================ */

describe("检修大师 · 交互距离", () => {
  it("只有跑到设备附近才能点开检修（远处点击要给出提示而不是静默失败）", () => {
    const p = createPlayer(1000, GROUND_Y);
    expect(nearDevice(p, 1000)).toBe(true);
    expect(nearDevice(p, 1000 + 80)).toBe(true);
    expect(nearDevice(p, 1000 + 200)).toBe(false);
  });

  it("判定只看横向距离：站在栈桥上或跳在半空都算「在旁边」", () => {
    expect(nearDevice({ ...createPlayer(1000, GROUND_Y - 104), onGround: true }, 1000)).toBe(true);
    expect(nearDevice({ ...createPlayer(1000, GROUND_Y - 60), onGround: false }, 1000)).toBe(true);
  });
});

/* ============================ 关卡结构 ============================ */

describe("检修大师 · 关卡结构", () => {
  it("固定 4 关，序号 1..4，机制依次为教学 / 抢修 / 解谜 / BOSS", () => {
    const levels = build();
    expect(levels.map((l) => l.index)).toEqual([1, 2, 3, 4]);
    expect(levels.map((l) => l.kind)).toEqual(["tutorial", "emergency", "puzzle", "boss"]);
    expect(levels.map((l) => l.name)).toEqual(["新手入职", "紧急抢修", "故障解谜", "BOSS 战"]);
  });

  it("每关都至少有一台可挑战设备（空关 = 玩家无事可做）", () => {
    for (const l of build()) {
      expect(l.devices.length).toBeGreaterThanOrEqual(1);
      expect(l.levels.length).toBe(l.devices.length);
      expect(l.arrowTo).toBe(l.devices[0].x);
    }
  });

  it("设备与栈桥都摆在世界范围内（摆到世界外就永远走不到）", () => {
    for (const l of build()) {
      for (const d of l.devices) {
        expect(d.x).toBeGreaterThan(0);
        expect(d.x).toBeLessThan(l.world.width);
      }
      for (const s of l.world.platforms) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(l.world.width);
        expect(s.y).toBeGreaterThan(0);
        expect(s.y).toBeLessThan(GROUND_Y);
      }
    }
  });

  it("同一关内设备不重叠（点击命中是按顺序取第一个命中的）", () => {
    for (const l of build()) {
      const xs = l.devices.map((d) => d.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        // 设备命中盒半宽 62 ⇒ 中心间距至少要 2×62
        expect(xs[i] - xs[i - 1]).toBeGreaterThan(140);
      }
    }
  });

  it("教学关不限时，其余关都有限时或分阶段限时", () => {
    const [l1, l2, l3, l4] = build();
    expect(l1.timeLimit).toBe(0);
    expect(l1.phaseSeconds).toEqual([]);
    expect(l2.timeLimit).toBeGreaterThan(0);
    expect(l3.timeLimit).toBeGreaterThan(0);
    expect(l4.phaseSeconds.length).toBeGreaterThanOrEqual(2);
    expect(l4.phaseSeconds.every((s) => s > 0)).toBe(true);
  });

  it("每台设备的题目都由真实规程生成，且恒为三步（找异常 → 选工具 → 定顺序）", () => {
    const { equipments, procs } = pool();
    const knownIds = new Set(equipments.map((e) => e.id));
    for (const l of buildMasterLevels(equipments, procs)) {
      for (const d of l.devices) expect(knownIds.has(d.equipmentId)).toBe(true);
      for (const dl of l.levels) {
        expect(dl.steps.length).toBe(3);
        expect(dl.steps.map((s) => s.kind)).toEqual(["hunt", "tool", "order"]);
      }
    }
  });

  it("没有规程时返回空关卡表（页面显示载入态，而不是渲染出一个空世界）", () => {
    const { equipments } = pool();
    expect(buildMasterLevels(equipments, [])).toEqual([]);
    expect(buildMasterLevels([], [])).toEqual([]);
  });

  it("可玩设备只有 1 台时退化但仍可玩：4 关都有目标，不会出现空关", () => {
    const equipments = [eq({ id: "only", category: "水泵" as any })];
    const procs = [proc({ id: "p", equipmentType: "水泵" as any })];
    const levels = buildMasterLevels(equipments, procs);
    expect(levels.length).toBe(4);
    for (const l of levels) expect(l.devices.length).toBeGreaterThanOrEqual(1);
  });

  it("第 2 关三台设备的题目来自不同类别（规程按类别匹配，同类会变成三道一样的题）", () => {
    const { equipments, procs } = pool();
    const l2 = buildMasterLevels(equipments, procs)[1];
    expect(l2.devices.length).toBe(3);
    const cats = l2.devices.map((d) => equipments.find((e) => e.id === d.equipmentId)!.category);
    expect(new Set(cats).size).toBe(cats.length);
  });
});

/* ============================ 关卡设计 vs 跳跃能力 ============================ */

describe("检修大师 · 关卡设计必须与跳跃能力自洽（最重要的一条）", () => {
  /**
   * 每块栈桥都必须能从「地面或另一块栈桥」跳上去。
   * 判定用真实物理常量，而不是我手填的"应该能跳上去"。
   * 这条守的是：以后改 JUMP_V / GRAVITY / 关卡坐标，都不会悄悄冒出跳不上去的桥。
   */
  const reachOf = (l: MasterLevel): Array<{ from: string; rise: number; gap: number }> => {
    const supports: Array<{ top: number; x0: number; x1: number; name: string }> = [
      { top: GROUND_Y, x0: -1e6, x1: 1e6, name: "地面" },
    ];
    const out: Array<{ from: string; rise: number; gap: number }> = [];
    // 从低到高处理 ⇒ 允许"桥踩桥"形成链条，而不是全靠地面
    for (const p of [...l.world.platforms].sort((a, b) => b.y - a.y)) {
      let best: { from: string; rise: number; gap: number } | null = null;
      for (const s of supports) {
        const rise = s.top - p.y;
        if (rise < 0) continue; // 比支撑面还低，走过去就行
        const gap = Math.max(0, Math.max(s.x0 - (p.x + p.w), p.x - s.x1));
        if (rise <= MAX_RISE && gap <= MAX_GAP && (!best || rise + gap < best.rise + best.gap)) {
          best = { from: s.name, rise, gap };
        }
      }
      out.push(best ?? { from: "❌ 没有可跳上去的支撑面", rise: Infinity, gap: Infinity });
      if (best) supports.push({ top: p.y, x0: p.x, x1: p.x + p.w, name: `栈桥@${p.x}` });
    }
    return out;
  };

  it("每块栈桥都跳得上去（抬升 ≤ MAX_RISE 且水平缺口 ≤ MAX_GAP）", () => {
    for (const l of build()) {
      for (const r of reachOf(l)) {
        expect(Number.isFinite(r.rise), `第 ${l.index} 关有栈桥跳不上去：${r.from}（抬升 ${r.rise}，缺口 ${r.gap}）`).toBe(true);
      }
    }
  });

  it("MAX_RISE / MAX_GAP 本身不超出实测物理能力（改物理常量必须同步改关卡约束）", () => {
    const world = flatWorld();
    // 用真实跑一遍量出来的最高点，而不是公式值（离散积分会过冲，公式是下界）
    const apex = riseOf(world, simulate(world, () => right(true), 1.2));
    const airTime = (2 * Math.abs(PLAYER.JUMP_V)) / PLAYER.GRAVITY;
    const horizontalReach = PLAYER.RUN_SPEED * airTime;
    expect(MAX_RISE).toBeLessThan(apex);
    expect(apex - MAX_RISE).toBeGreaterThanOrEqual(8); // 落脚余量
    expect(MAX_GAP).toBeLessThan(horizontalReach);
    expect(horizontalReach - MAX_GAP).toBeGreaterThanOrEqual(40); // 助跑余量
  });

  it("跳跃高度随帧率变化，但最差帧率下也够得着所有栈桥（沙箱软渲染只有 ~1fps）", () => {
    // 半隐式欧拉会让跳跃高度随 dt 变化：dt 越大过冲越多。
    // 实测 1/60 → 128.3px、0.05（dt 上限）→ 140px，而 dt→0 的理论极限是 122.5px。
    // 也就是说**最低**的跳跃高度是 122.5px —— 关卡设计必须按这个下限来留余量。
    const world = flatWorld();
    const rises = [1 / 120, 1 / 60, 1 / 30, 1 / 20, 0.05].map((dt) =>
      riseOf(world, simulate(world, () => right(true), 1.5, createPlayer(120, world.groundY), dt))
    );
    for (const r of rises) {
      expect(r).toBeGreaterThan(MAX_RISE + 8);
      expect(r).toBeLessThan(JUMP_HEIGHT + 20);
    }
    // 帧率越低跳得越高（过冲），但差别要可控（不能高到破坏关卡难度）
    expect(Math.max(...rises) - Math.min(...rises)).toBeLessThan(24);
  });

  it("所有栈桥都够高，玩家能直接从下面跑过去（否则关卡会变成必须跳，容易卡住）", () => {
    // 玩家身高 62 + 桥厚 16 ⇒ 桥面至少要在地面之上 78px
    const minClearance = PLAYER.H + 16;
    for (const l of build()) {
      for (const s of l.world.platforms) {
        expect(
          GROUND_Y - s.y,
          `第 ${l.index} 关的栈桥@${s.x} 离地只有 ${GROUND_Y - s.y}px，会挡住跑动路线`
        ).toBeGreaterThanOrEqual(minClearance);
      }
    }
  });

  it("栈桥不压住设备命中盒（否则站在桥上点不到设备）", () => {
    for (const l of build()) {
      for (const s of l.world.platforms) {
        for (const d of l.devices) {
          const deviceTop = GROUND_Y - 160; // 与 platformerRender.deviceHitBox 的取景一致
          if (s.x < d.x + 62 && s.x + s.w > d.x - 62) {
            expect(s.y, `第 ${l.index} 关栈桥@${s.x} 压住了设备命中盒`).toBeLessThan(deviceTop);
          }
        }
      }
    }
  });
});

/* ============================ 职称（等级） ============================ */

describe("检修大师 · 职称晋升", () => {
  it("四个职称齐全且顺序固定", () => {
    expect(RANK_ORDER).toEqual(["apprentice", "technician", "senior", "chief"]);
    for (const r of RANK_ORDER) expect(typeof RANK_NAME[r]).toBe("string");
    expect(RANK_NAME.apprentice).toBe("学徒");
    expect(RANK_NAME.technician).toBe("技师");
    expect(RANK_NAME.senior).toBe("高级技师");
    expect(RANK_NAME.chief).toBe("总工");
  });

  it("晋升只看通关数与 S 评级，不看单次分数：重玩低分关不会掉级", () => {
    expect(rankFor({ clearedLevels: 0, bestTotal: 0, hasS: false })).toBe("apprentice");
    expect(rankFor({ clearedLevels: 1, bestTotal: 100, hasS: false })).toBe("technician");
    expect(rankFor({ clearedLevels: 1, bestTotal: 0, hasS: false })).toBe("technician");
    expect(rankFor({ clearedLevels: 3, bestTotal: 0, hasS: false })).toBe("senior");
    expect(rankFor({ clearedLevels: 4, bestTotal: 0, hasS: false })).toBe("senior");
    expect(rankFor({ clearedLevels: 4, bestTotal: 0, hasS: true })).toBe("chief");
  });

  it("通关数与分数是「或」关系：2 关 + 高分也能到高级技师", () => {
    expect(rankFor({ clearedLevels: 2, bestTotal: 900, hasS: false })).toBe("senior");
    expect(rankFor({ clearedLevels: 2, bestTotal: 899, hasS: false })).toBe("technician");
  });

  it("职称单调不减：任一条件变好，等级都不会下降", () => {
    const samples = [
      { clearedLevels: 0, bestTotal: 0, hasS: false },
      { clearedLevels: 1, bestTotal: 300, hasS: false },
      { clearedLevels: 2, bestTotal: 700, hasS: false },
      { clearedLevels: 3, bestTotal: 950, hasS: false },
      { clearedLevels: 4, bestTotal: 1200, hasS: true },
    ];
    for (let i = 1; i < samples.length; i++) {
      const prev = RANK_ORDER.indexOf(rankFor(samples[i - 1]));
      const cur = RANK_ORDER.indexOf(rankFor(samples[i]));
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });

  it("晋升提示写清还差什么，顶级职称返回 null（UI 不显示空提示）", () => {
    expect(nextRankHint({ clearedLevels: 0, bestTotal: 0, hasS: false })).toContain("第 1 关");
    const seniorHint = nextRankHint({ clearedLevels: 2, bestTotal: 500, hasS: false });
    expect(seniorHint).toContain("3 关");
    expect(seniorHint).toContain("900");
    expect(nextRankHint({ clearedLevels: 4, bestTotal: 0, hasS: false })).toContain("S");
    expect(nextRankHint({ clearedLevels: 4, bestTotal: 1200, hasS: true })).toBeNull();
  });
});

/* ============================ 端到端：跑得到设备旁 ============================ */

describe("检修大师 · 端到端可玩性（用真实物理跑一遍）", () => {
  it("从出生点一路向右跑，能跑到第 1 关设备的交互范围内", () => {
    const [l1] = build();
    let p = createPlayer(120, l1.world.groundY);
    let reached = false;
    for (let i = 0; i < 60 * 20 && !reached; i++) {
      p = stepPlayer(p, right(), l1.world, DT);
      if (nearDevice(p, l1.devices[0].x)) reached = true;
    }
    expect(reached, `跑 20 秒都没能靠近设备（最终 x=${p.x.toFixed(0)}，设备 x=${l1.devices[0].x}）`).toBe(true);
  });

  it("第 2 关三台设备都能靠跑动依次到达（没有走不到的死点）", () => {
    const l2 = build()[1];
    let p = createPlayer(120, l2.world.groundY);
    const hit = new Set<number>();
    for (let i = 0; i < 60 * 60 && hit.size < l2.devices.length; i++) {
      p = stepPlayer(p, right(), l2.world, DT);
      l2.devices.forEach((d, k) => {
        if (nearDevice(p, d.x)) hit.add(k);
      });
    }
    expect([...hit].sort((a, b) => a - b)).toEqual(l2.devices.map((_, k) => k));
  });
});
