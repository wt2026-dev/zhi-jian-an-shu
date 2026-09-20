/**
 * 《检修大师》关卡设计 —— 4 关，每关一种玩法机制。
 *
 * | 关 | 名称 | 机制 |
 * | --- | --- | --- |
 * | 1 | 新手入职 | 教学：跟着箭头跑 → 点设备 → 跟着指引点按钮 |
 * | 2 | 紧急抢修 | 多台同时报警 + 全关倒计时，跑到各台旁选对工具 |
 * | 3 | 故障解谜 | 一台设备，逐个点部位查读数找原因，再定检修方案 |
 * | 4 | BOSS 战 | 最重要设备，分 3 阶段，每阶段独立限时 |
 *
 * **关卡内容全部来自真实规程**：每台设备的题目由 `buildDeviceLevel()` 生成
 * （复用 `levelPlay` 的真实阈值与规程文本），这里只负责"把哪台设备放在哪、
 * 限时多少、用什么玩法"。绝不在这里编造故障或步骤。
 */
import type { Equipment, MaintenanceProcedure } from '../../types';
import { findProcedureForEquipment } from './gameData';
import { buildDeviceLevel, type DeviceLevel } from './levelPlay';
import type { Platform, WorldLayout } from './platformerEngine';

export type LevelKind = 'tutorial' | 'emergency' | 'puzzle' | 'boss';

/** 地面顶面 y（虚拟分辨率 960×540 里，留出下方 110px 的地板厚度） */
export const GROUND_Y = 430;

export interface LevelDeviceSpec {
  equipmentId: string;
  equipmentName: string;
  /** 设备在世界里的 x（设备中心，底部贴地） */
  x: number;
  /** 是否一直闪警灯 */
  alarming: boolean;
  /** 是否只有"当前目标"才可交互（教学关是顺序推进的） */
  sequential: boolean;
}

export interface MasterLevel {
  index: number;
  kind: LevelKind;
  name: string;
  /** 关卡开场白（师傅的话 / 调度台播报） */
  brief: string;
  /** 全关限时（秒）；0 = 不限时 */
  timeLimit: number;
  /** BOSS 关：每阶段独立限时（秒） */
  phaseSeconds: number[];
  world: WorldLayout;
  devices: LevelDeviceSpec[];
  /** 每台设备的三步内容（真实规程生成，与设备一一对应） */
  levels: DeviceLevel[];
  /** 教学关的箭头指向（= 目标设备 x） */
  arrowTo: number;
}

function plat(x: number, y: number, w: number, h = 16): Platform {
  return { x, y, w, h };
}

/**
 * 栈桥摆放的硬约束（由 `tests/maintenance-master-platformer.test.ts` 守住）。
 *
 * 跳跃最高点只有 `JUMP_HEIGHT ≈ 122.5px`（= JUMP_V² / 2·GRAVITY），
 * 而且水平方向一次起跳只能走 `RUN_SPEED × 滞空时间 ≈ 300 × 0.7 = 210px`。
 * 所以每块栈桥都必须能从「地面或另一块栈桥」跳上去，否则它只是画着好看、
 * 玩家跳半天上不去 —— 这种"看着能跳其实跳不上去"的关最劝退。
 *
 * 留出余量：抬升 ≤ `MAX_RISE`、水平缺口 ≤ `MAX_GAP`。
 * 注意实测最高点比理论值略低：半隐式欧拉积分下只有 ≈117px（理论 122.5px），
 * 所以余量要按 117 来留 —— 104 是留了 13px 落脚空间的安全值。
 */
export const MAX_RISE = 104;
export const MAX_GAP = 160;

/**
 * 挑出"有真实规程可玩"的设备。
 *
 * ⚠️ 规程是按**设备类别**（`equipmentType`）匹配的，不是按 equipmentId
 * （见 `gameData.findProcedureForEquipment`）。所以同类别的设备会拿到同一份规程内容 ——
 * 关卡里要**优先选不同类别**，否则第 2 关三台设备的题目会一模一样。
 */
function playable(equipments: Equipment[], procs: MaintenanceProcedure[]): Array<{ eq: Equipment; proc: MaintenanceProcedure }> {
  const out: Array<{ eq: Equipment; proc: MaintenanceProcedure }> = [];
  const seenCat = new Set<string>();
  const rest: Array<{ eq: Equipment; proc: MaintenanceProcedure }> = [];
  for (const eq of equipments) {
    const proc = findProcedureForEquipment(eq, procs);
    if (!proc) continue;
    const row = { eq, proc };
    if (!seenCat.has(eq.category)) {
      seenCat.add(eq.category);
      out.push(row);
    } else {
      rest.push(row);
    }
  }
  return [...out, ...rest];
}

/** BOSS 选"最重要的那台"：优先名字里带"给水泵"的主循环设备，否则退回最后一台可玩设备 */
function pickBoss(pool: Array<{ eq: Equipment; proc: MaintenanceProcedure }>): number {
  const idx = pool.findIndex((p) => /给水泵/.test(p.eq.name));
  return idx >= 0 ? idx : pool.length - 1;
}

export function buildMasterLevels(
  equipments: Equipment[],
  procs: MaintenanceProcedure[]
): MasterLevel[] {
  const pool = playable(equipments, procs);
  if (!pool.length) return [];

  const lv = (i: number): DeviceLevel => buildDeviceLevel(pool[i].eq, pool[i].proc, procs);
  const dev = (i: number, x: number, opts: Partial<LevelDeviceSpec> = {}): LevelDeviceSpec => ({
    equipmentId: pool[i].eq.id,
    equipmentName: pool[i].eq.name,
    x,
    alarming: false,
    sequential: false,
    ...opts,
  });

  /* ---------------- 第 1 关：新手入职（教学） ---------------- */
  const l1DeviceX = 1500;
  const L1: MasterLevel = {
    index: 1,
    kind: 'tutorial',
    name: '新手入职',
    brief: '师傅：第一次进车间别乱跑，跟着箭头走到 11# 泵那儿，我教你怎么查。',
    timeLimit: 0,
    phaseSeconds: [],
    world: {
      width: 2000,
      groundY: GROUND_Y,
      // 一个矮栈桥：让玩家在到达设备前先学会跳一次
      platforms: [plat(880, GROUND_Y - 104, 170)],
    },
    devices: [dev(0, l1DeviceX, { alarming: false, sequential: true })],
    levels: [lv(0)],
    arrowTo: l1DeviceX,
  };

  /* ---------------- 第 2 关：紧急抢修 ---------------- */
  // 只有 1 台可玩设备时退化为单目标，而不是给出一个没有目标的空关（那会直接卡死）
  const e2 = [1, 2, 3].filter((i) => i < pool.length);
  if (!e2.length) e2.push(0);
  const e2x = [700, 1450, 2200];
  const L2: MasterLevel = {
    index: 2,
    kind: 'emergency',
    name: '紧急抢修',
    brief: '调度台：3 台设备同时报警！在倒计时结束前跑到每一台旁边，选对工具把故障处理掉。',
    timeLimit: 150,
    phaseSeconds: [],
    world: {
      width: 2800,
      groundY: GROUND_Y,
      // 两台设备之间摆一段两级栈桥：一级 104px、二级再抬 86px，都在跳跃能力内
      platforms: [plat(1000, GROUND_Y - 104, 150), plat(1200, GROUND_Y - 190, 130), plat(1750, GROUND_Y - 104, 150)],
    },
    devices: e2.map((i, k) => dev(i, e2x[k] ?? 700 + k * 400, { alarming: true })),
    levels: e2.map((i) => lv(i)),
    arrowTo: e2x[0],
  };

  /* ---------------- 第 3 关：故障解谜 ---------------- */
  const p3 = Math.min(4, pool.length - 1);
  const L3: MasterLevel = {
    index: 3,
    kind: 'puzzle',
    name: '故障解谜',
    brief: '这台设备报了个说不清的故障。逐个点开部位看真实读数，自己找出根因，再定检修方案。',
    timeLimit: 210,
    phaseSeconds: [],
    world: {
      width: 1500,
      groundY: GROUND_Y,
      platforms: [],
    },
    devices: [dev(p3, 750, { alarming: true, sequential: true })],
    levels: [lv(p3)],
    arrowTo: 750,
  };

  /* ---------------- 第 4 关：BOSS 战 ---------------- */
  const bossIdx = pickBoss(pool);
  const L4: MasterLevel = {
    index: 4,
    kind: 'boss',
    name: 'BOSS 战',
    brief: '主循环给水泵跳停了，全厂等着它。分三个阶段处理，每个阶段都有时间限制 —— 别慌。',
    timeLimit: 0,
    // 三个阶段各自限时：找异常点 / 选工具 / 定顺序
    phaseSeconds: [40, 30, 55],
    world: {
      width: 2000,
      groundY: GROUND_Y,
      // BOSS 左侧的两级栈桥，用来躲开"没时间"的焦虑感：跳一跳再上
      platforms: [plat(560, GROUND_Y - 104, 150), plat(760, GROUND_Y - 190, 130)],
    },
    devices: [dev(bossIdx, 1000, { alarming: true, sequential: true })],
    levels: [lv(bossIdx)],
    arrowTo: 1000,
  };

  return [L1, L2, L3, L4];
}

/* ============================ 限时规则 ============================ */

/**
 * BOSS 战第 `stepIdx` 阶段的限时（秒）；不分阶段限时的关卡返回 0。
 *
 * 取 `min` 兜底：万一 `phaseSeconds` 比步骤数短，最后一段限时会被复用，
 * 而不是让某个阶段变成"不限时"（那等于给玩家开天窗）。
 */
export function phaseLimitOf(level: MasterLevel, stepIdx: number): number {
  if (!level.phaseSeconds.length) return 0;
  return level.phaseSeconds[Math.min(stepIdx, level.phaseSeconds.length - 1)] ?? 0;
}

export interface TimerState {
  /** 限时剩余（秒）；-1 = 不限时 */
  timeLeft: number;
  lives: number;
  mistakes: number;
  /** 当前第几步（BOSS 战按阶段取限时要用） */
  stepIdx: number;
}

export interface TimerTick extends TimerState {
  /** 本 tick 发生了"阶段超时"（BOSS 战的分阶段限时），调用方据此提示玩家 */
  phaseTimedOut: boolean;
}

/**
 * 推进一个计时 tick（纯函数，可单测）。
 *
 * 两条计时路径：
 * - **全关限时**（`level.timeLimit > 0`）：烧完就把 `timeLeft` 停在 0，由调用方判负。
 * - **分阶段限时**（`level.phaseSeconds` 非空，仅 BOSS 战）：当前阶段烧完**不判负**，
 *   扣一条命并把**该阶段**重新起表；生命耗尽由调用方的 `lives <= 0` 统一判负
 *   （与"答错扣命"共用同一套失败语义）。
 *
 * 为什么抽成纯函数：这段逻辑原先埋在组件 effect 里、只有真浏览器能验，
 * 结果 `phaseSeconds` 被写进 state 之后**没人读**、BOSS 战实际没有时间限制也没被发现。
 */
export function tickTimer(state: TimerState, level: MasterLevel, dt: number): TimerTick {
  const next: TimerTick = { ...state, phaseTimedOut: false };
  if (next.timeLeft <= 0) return next; // -1 = 不限时
  next.timeLeft = Math.max(0, next.timeLeft - dt);
  if (next.timeLeft > 0) return next;
  if (level.phaseSeconds.length > 0) {
    next.lives = Math.max(0, next.lives - 1);
    next.mistakes += 1;
    next.timeLeft = phaseLimitOf(level, state.stepIdx);
    next.phaseTimedOut = true;
  }
  return next;
}

/* ============================ 等级（职称） ============================ */

export type Rank = 'apprentice' | 'technician' | 'senior' | 'chief';

export const RANK_NAME: Record<Rank, string> = {
  apprentice: '学徒',
  technician: '技师',
  senior: '高级技师',
  chief: '总工',
};

export const RANK_ORDER: Rank[] = ['apprentice', 'technician', 'senior', 'chief'];

export interface RankInput {
  /** 已通关的关卡数（0~4） */
  clearedLevels: number;
  /** 历史最高总分 */
  bestTotal: number;
  /** 是否拿过 S */
  hasS: boolean;
}

/**
 * 职称晋升：只看"通关数 + 是否拿过 S"，不看单次分数 ——
 * 这样玩家重玩低分关卡不会掉级（掉级对教学场景是负反馈）。
 */
export function rankFor({ clearedLevels, bestTotal, hasS }: RankInput): Rank {
  if (clearedLevels >= 4 && hasS) return 'chief';
  if (clearedLevels >= 3 || (clearedLevels >= 2 && bestTotal >= 900)) return 'senior';
  if (clearedLevels >= 1) return 'technician';
  return 'apprentice';
}

/** 升到下一级还差什么（UI 直接显示，别让玩家猜） */
export function nextRankHint(input: RankInput): string | null {
  const cur = rankFor(input);
  const i = RANK_ORDER.indexOf(cur);
  if (i >= RANK_ORDER.length - 1) return null;
  const next = RANK_ORDER[i + 1];
  const need: string[] = [];
  if (next === 'technician') need.push('通关第 1 关');
  if (next === 'senior') {
    if (input.clearedLevels < 3) need.push('累计通关 3 关');
    if (input.bestTotal < 900) need.push('单次总分 ≥ 900');
  }
  if (next === 'chief') {
    if (input.clearedLevels < 4) need.push('通关全部 4 关');
    if (!input.hasS) need.push('至少拿到一次 S 评级');
  }
  return need.length ? `再${need.join('，')}即可晋升「${RANK_NAME[next]}」` : null;
}
