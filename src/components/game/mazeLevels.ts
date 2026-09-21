/**
 * 俯视「工厂迷宫」版的 Godot payload —— 纯逻辑，无 React、无引擎依赖，可直接单测。
 *
 * ## 为什么要另开一份 payload，而不是改 `buildGodotPayload`
 *
 * `GodotGameView.buildGodotPayload`（消息类型 `repair-data`）服务的是横版闯关：4 关的
 * 目标设备数依次是 **1/3/1/1**（只有「紧急抢修」那关摆 3 台），这个节奏是从"沿地面跑过去修"
 * 长出来的。迷宫版的设计是"在 3×3 → 9×9 的房间里找故障"，每关故障数必须是 **1/2/3/4**，
 * 而且网格边长要和故障数配套（9×9 = 81 间房只放 1 台，玩家大半张图都在空跑）。
 * 两套计数塞不进同一份关卡表：真去改 `masterLevels`，就会把横版那套跳台坐标约束
 * （`MAX_RISE` / `MAX_GAP`，由 `tests/maintenance-master-platformer.test.ts` 钉着）一起拽坏。
 * 所以这里独立出一份 `maze-data`，横版原样不动 —— 也是并行会话的文件所有权要求。
 *
 * ## 数据红线（本模块口径，与 AGENTS.md 一致）
 *
 * 1. **设备只来自台账、题目只来自规程**：故障位的题目一律走
 *    `findProcedureForEquipment` + `buildDeviceMiniGames`（即"真实规程 → 三道小关"那条既有链路）。
 *    没命中规程的设备永远不进故障位；命中了规程但规程是空的（一步真实题目都抽不出来）同样不进。
 * 2. **读数只来自 `buildHuntSpots`**：沿用项目里唯一那套阈值口径，缺读数就是 `null`
 *    （渲染层显示「未接入」），绝不在这层重新抄阈值、也绝不用 0 顶替。
 * 3. **填不满就如实降级**：台账里可玩设备比本关要用的少时，故障数就少给几台，
 *    并把原因写进 `MazeLevelDTO.degraded`（UI/Godot 直接念"台账里没有第 N 台有规程的可玩设备"）。
 *    只有整池为空时才返回 `[]`（与 `buildMasterLevels` 同一口径）—— 空关会直接卡死玩家。
 * 4. **纯函数**：本模块自己不调 `Math.random` / `Date.now`。⚠️ 但 `buildGameLevel`（
 *    `gameData` 里）内部用 `Math.random` 抽工具干扰项、打乱选项顺序、以及在规程没写安全句时
 *    从通用题库随机抽一题 —— 于是同一份台账两次构建的 payload 会不一样。迷宫侧要拿 payload
 *    做快照比对与失败回放（Godot 的 headless 自检），抖一下就是误报，所以 `mazeSteps()`
 *    把所有随机量重新按规程文本定下来（选项池仍然 100% 是真实工具名，只是取法可复现）。
 */
import type { Equipment, MaintenanceProcedure } from '../../types';
// 只取类型（`import type` 编译期擦除），因此这个纯逻辑模块在 node 测试里不会把 React 拖进来；
// 换来的是"迷宫题型与横版完全同构"这件事由类型系统保证，而不是靠注释口头约定。
import type { GodotStepDTO } from './GodotGameView';
import { buildDeviceMiniGames, findProcedureForEquipment, iconKindForCategory, parseTools, type MiniGame } from './gameData';
import { buildHuntSpots, type SpotSeverity } from './levelPlay';

/* ============================ 关卡骨架（产品定的量） ============================ */

export const MAZE_VERSION = 1;

/** 消息类型：Godot 侧 `maze-data` 分支监听这个值 */
export const MAZE_MESSAGE_TYPE = 'maze-data';

/** 共 4 关（与 `MAZE_GRID_BY_LEVEL` 等长，改关数要一起改） */
export const MAZE_LEVEL_COUNT = 4;

/**
 * 每关地图边长（间数）：3 / 5 / 7 / 9。
 * 只给边长不给像素 —— 迷宫格子尺寸由 Godot 侧决定，React 这边只管拓扑量。
 */
export const MAZE_GRID_BY_LEVEL: readonly number[] = [3, 5, 7, 9];

/** 每关的故障设备数：1 / 2 / 3 / 4（这就是和横版 1/3/1/1 分家的直接原因） */
export const FAULT_TARGET_BY_LEVEL: readonly number[] = [1, 2, 3, 4];

/** 名单上限：与 `GodotGameView` 里的 `ROSTER_LIMIT` 同值（那份没导出，改任一处都要记得同步） */
export const MAZE_ROSTER_LIMIT = 16;

/**
 * 第 2 关起最多摆几台健康设备当干扰项。
 *
 * 这个数不能开太大：关卡引用的所有 id（故障位 + 干扰项）必须都落在 16 台名单里，
 * 否则 Godot 拿着一个名单外的 id 就画不出那台设备。名单是"可玩设备优先"填的，
 * 所以只要 `最大故障数 + DISTRACTOR_CAP <= MAZE_ROSTER_LIMIT` 这条不变式成立就安全。
 */
const DISTRACTOR_CAP = 4;

/**
 * 第 3 关门禁：7×7 = 49 间房里锁 3 间、发 3 张卡。
 *
 * - **卡数必须 ≥ 锁数**：一张卡开一道锁，卡比锁少就意味着有一间房永远打不开，
 *   而那间房里可能正压着本关的故障 —— 死局，只能重开。这条由测试钉住。
 * - 3 间的取法：约 6% 的房间上锁，足够让玩家意识到"先找卡再推进"，
 *   又不至于把 49 格里的主要通路堵死。
 */
const LOCKED_ROOMS_L3 = 3;
const KEYCARDS_L3 = 3;

/**
 * 第 4 关 9×9 = 81 间房、还叠着倒计时：多给一张备用卡（4 锁 / 5 卡）。
 * 计时压力下"捡起卡却发现不是这扇门"的绕路很贵，多一张卡把它摊平。
 */
const LOCKED_ROOMS_L4 = 4;
const KEYCARDS_L4 = 5;

/**
 * 第 4 关全关限时（秒）。
 *
 * 从故障数推而不是手写常数：每台故障 ~75s（走完半张图 + 三道小关的实测预算），
 * 以后 `FAULT_TARGET_BY_LEVEL` 调整，倒计时会自然跟着变。
 *
 * ⚠️ 0 的含义是**不限时**，不是"0 秒"：`masterLevels` 就是这么定的，Godot 侧
 * `godot-game-2d/scripts/main.gd` 的 `time_limit_of()` 把它换算成 -1 才进计时器。
 * 那边注释里记着踩过的坑 —— 把 0 直接塞进 `time_left`，第一轮就判定"烧完了"，
 * 第 1 关开局 0.25s 直接结算、角色冻住，看起来像"按键没反应"。
 */
const TIME_LIMIT_L4 = FAULT_TARGET_BY_LEVEL[3] * 75;

interface LevelPlan {
  lockedRooms: number;
  keycardCount: number;
  /** 秒；0 = 不限时 */
  timeLimit: number;
  /** 未修的故障是否向相邻房间扩散 */
  spread: boolean;
  /** 是否摆放健康设备作干扰项（第 2 关起常驻） */
  distractors: boolean;
}

/** 每关的机制量；索引 0..3 对应关卡 1..4 */
const LEVEL_PLAN: readonly LevelPlan[] = [
  { lockedRooms: 0, keycardCount: 0, timeLimit: 0, spread: false, distractors: false },
  { lockedRooms: 0, keycardCount: 0, timeLimit: 0, spread: false, distractors: true },
  { lockedRooms: LOCKED_ROOMS_L3, keycardCount: KEYCARDS_L3, timeLimit: 0, spread: false, distractors: true },
  { lockedRooms: LOCKED_ROOMS_L4, keycardCount: KEYCARDS_L4, timeLimit: TIME_LIMIT_L4, spread: true, distractors: true },
];

/** 关卡序号（1 起）→ 地图边长；越界时按最后一档收，保证调用方拿到数字而不是 undefined */
export function mazeGridFor(levelIndex: number): number {
  return MAZE_GRID_BY_LEVEL[clampIndex(levelIndex)] ?? MAZE_GRID_BY_LEVEL[MAZE_GRID_BY_LEVEL.length - 1];
}

/** 关卡序号（1 起）→ 本关要求的故障台数 */
export function faultTargetFor(levelIndex: number): number {
  return FAULT_TARGET_BY_LEVEL[clampIndex(levelIndex)] ?? FAULT_TARGET_BY_LEVEL[FAULT_TARGET_BY_LEVEL.length - 1];
}

function clampIndex(levelIndex: number): number {
  const i = Math.trunc(levelIndex) - 1;
  if (!Number.isFinite(i) || i < 0) return 0;
  return Math.min(i, MAZE_LEVEL_COUNT - 1);
}

/* ============================ DTO ============================ */

/**
 * 一个可点测点。相对 `HuntSpot` 去掉了 `metric`：那边 `metric` 与 `key` 恒等
 * （见 `levelPlay` 的 `METRICS` 表），payload 里留两份同值字段只会给下游歧义。
 */
export interface MazeSpotDTO {
  key: string;
  label: string;
  /** 实测读数文案，例如 `92.5 ℃`；无数据为 null —— UI 必须显示「未接入」 */
  reading: string | null;
  severity: SpotSeverity;
  abnormal: boolean;
}

export interface MazeDeviceDTO {
  id: string;
  no: string;
  name: string;
  category: string;
  /** 图标形状由 Godot 程序化绘制，这边只给种类 */
  icon: string;
  spots: MazeSpotDTO[];
}

/** 与 `GodotStepDTO` 同构：横版已经写好的解题面板代码可以直接吃迷宫的 steps */
export type MazeStepDTO = GodotStepDTO;

export interface MazeFaultDTO {
  deviceId: string;
  deviceName: string;
  /** 真实规程抽出来的小关序列；迷宫的"修"用的是其中的 `order` 题（见 `orderStepOf`） */
  steps: MazeStepDTO[];
  /** 第 4 关机制：放着不管会向相邻房间扩散 */
  spreadable: boolean;
}

export interface MazeLevelDTO {
  /** 1..4 */
  index: number;
  /** 地图边长（间数），网格 = gridRooms × gridRooms */
  gridRooms: number;
  faults: MazeFaultDTO[];
  /** 健康设备 id（绿圈）；与本单位 `faults` 一定不相交 */
  distractorIds: string[];
  lockedRooms: number;
  keycardCount: number;
  /** 秒；0 = 不限时 */
  timeLimit: number;
  /** 本关机制说明，由上面的数字拼出来（所以不会和数字对不上） */
  note: string;
  /** 降级原因；null = 本关按设计量满配下发 */
  degraded: string | null;
}

export interface MazePayload {
  type: typeof MAZE_MESSAGE_TYPE;
  version: number;
  devices: MazeDeviceDTO[];
  levels: MazeLevelDTO[];
}

/* ============================ 题目：复用 + 确定性化 ============================

 * 题型文案与 `GodotGameView` 里的 `KIND_META` 逐字对齐 —— 那份常量没导出，
 * 只能在这里复写一份。**改那边记得同步这里**（迷宫与横版共用解题面板的 UI 文案）。
 */
const STEP_META: Record<MiniGame['kind'], { title: string; prompt: (stepName: string) => string }> = {
  tool: { title: '选工具', prompt: (n) => `规程「${n}」应使用哪件工具？` },
  safety: { title: '安全判断', prompt: () => '判断下面这条安全说法是否正确' },
  order: { title: '排序题', prompt: () => '按正确顺序依次点击本步的作业动作' },
};

/**
 * 中文字符串比较统一按码位，不用 `localeCompare`：后者依赖运行环境的 ICU locale，
 * 浏览器与 node（以及以后可能有的 Godot 端校验脚本）排序结果不保证一致，
 * 那会让"同一份台账 → 同一份 payload"这个前提在跨端比对时假性失败。
 */
function cmpText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 全台账的真实工具池（干扰项的唯一来源，与 `buildGameLevel` 同源） */
function toolPool(procs: MaintenanceProcedure[]): string[] {
  return Array.from(new Set(procs.flatMap((p) => (p.steps ?? []).flatMap((st) => parseTools(st.tools)))));
}

/** 规程里第一句真实安全要求（`buildGameLevel` 只看第 1 步，这里跨步找，命中率更高） */
function firstRealSafety(proc: MaintenanceProcedure): string | null {
  for (const st of proc.steps ?? []) {
    const sentence = (st.safety || '')
      .split(/[。\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 6)[0];
    if (sentence) return sentence;
  }
  return null;
}

/**
 * 把工具题的选项钉死：正确项还是规程那件工具，3 个干扰项从"别的规程的真实工具"里
 * 按码位取最小的 3 个（原来是 `Math.random` 抽 + 随机打乱）。
 * 排除本规程自己的工具，是为了不把《…规程》第 2 步列的器具摆到第 1 步的题目里当假答案 ——
 * 玩家完全可能判它"也在规程上，凭什么算错"。规程总数本来就少，异源池子小到凑不出
 * 3 件时退一步只排掉正确项自身（仍是真实工具名，绝不为了好看编一个工具出来）。
 * 返回 null 表示连退一步仍不够，交给调用方回退到 `buildGameLevel` 给的那组真实选项。
 */
function canonicalToolOptions(
  correct: string,
  proc: MaintenanceProcedure,
  procs: MaintenanceProcedure[]
): string[] | null {
  const own = new Set((proc.steps ?? []).flatMap((st) => parseTools(st.tools)));
  const usable = (list: string[]) => list.filter((t) => t !== correct && !t.includes(correct) && !correct.includes(t));
  const others = toolPool(procs).filter((t) => !own.has(t));
  let distractors = usable(others);
  if (distractors.length < 3) distractors = usable(toolPool(procs));
  if (distractors.length < 3) return null;
  return [correct, ...distractors.sort(cmpText).slice(0, 3)].sort(cmpText);
}

/**
 * 一条真实规程 → 迷宫用的 steps。
 *
 * 题目来源仍是 `buildDeviceMiniGames`（选工具 / 安全判断 / 排序题，按这个顺序），
 * 这里只把它的三个随机量换成可复现的取法：
 * - `tool`：干扰项与选项顺序由 `canonicalToolOptions()` 重算；
 * - `safety`：只认真实安全句。**整条规程都没写安全要求时直接不给这道题**，
 *   而不是沿用 `buildGameLevel` 从通用题库随机抽的那一条 —— 少一关可以接受，
 *   一道"每台设备每次都不一样、又追不到规程原文"的题不行。
 * - `order`：迷宫的检修操作就是"按顺序点部位"，原样保留；`items` 不足 3 项时
 *   按既有口径丢掉（宁缺毋滥）。
 */
function mazeSteps(proc: MaintenanceProcedure, procs: MaintenanceProcedure[]): MazeStepDTO[] {
  const stepName = proc.steps?.[0]?.name || proc.title || '';
  const out: MazeStepDTO[] = [];
  for (const game of buildDeviceMiniGames(proc, procs)) {
    const base: MazeStepDTO = {
      kind: game.kind,
      title: STEP_META[game.kind].title,
      prompt: STEP_META[game.kind].prompt(stepName),
    };
    if (game.kind === 'tool') {
      const options = canonicalToolOptions(game.correct, proc, procs) ?? Array.from(new Set(game.options)).sort(cmpText);
      out.push({ ...base, options, correct: game.correct });
      continue;
    }
    if (game.kind === 'safety') {
      const statement = firstRealSafety(proc);
      if (!statement) continue;
      out.push({ ...base, statement, answer: true });
      continue;
    }
    if (game.items.length >= 3) out.push({ ...base, items: game.items });
  }
  return out;
}

/**
 * 迷宫的"修"是点部位排序，所以从 steps 里取那道 `order` 题。
 * 返回 null 表示这条规程给不出排序题（没有 3 个以上真实动作），
 * 引擎侧此时应退回 `steps[0]` 出题，而不是自己编一串动作。
 */
export function orderStepOf(steps: readonly MazeStepDTO[]): MazeStepDTO | null {
  return steps.find((s) => s.kind === 'order') ?? null;
}

/* ============================ 设备池 ============================ */

interface PlayableRow {
  eq: Equipment;
  proc: MaintenanceProcedure;
  steps: MazeStepDTO[];
  /** 真实遥测里确实有超限读数（决定它能不能被"诚实地"画成红色故障） */
  abnormal: boolean;
}

/**
 * 挑出"有真实规程、且真抽得出题目"的设备，顺序即关卡取用顺序。
 *
 * 排序里有两层讲究（都踩过坑）：
 * 1. **优先不同类别**。规程是按设备**类别**（`equipmentType`）匹配的，不是按 equipmentId
 *    （见 `gameData.findProcedureForEquipment`），同类别设备拿到同一份题目 ——
 *    第 4 关四台故障如果同类别，就是四份一模一样的排序题。
 * 2. **同类别组内再把"读数真的异常"的排前面**。迷宫把故障位画成红色，最硬的理由是台账遥测
 *    越过阈值；把异常设备先选走，剩下的健康设备正好当第 2 关的绿圈干扰项，
 *    两个诉求共用同一个顺序。台账里异常设备不够时，多出来的故障位只能由健康设备顶上
 *    （玩法需要 4 台），这层"红色没有读数支撑"是已知妥协，不改数据、也不假装看得见。
 */
function playablePool(equipments: Equipment[], procs: MaintenanceProcedure[]): PlayableRow[] {
  // 同一份规程会被同类别的多台设备命中，构建一次就够（也顺手让"题目相同"这件事显式化）
  const cache = new Map<string, MazeStepDTO[]>();
  const stepsOf = (proc: MaintenanceProcedure): MazeStepDTO[] => {
    const hit = cache.get(proc.id);
    if (hit) return hit;
    const built = mazeSteps(proc, procs);
    cache.set(proc.id, built);
    return built;
  };

  const byCategory: PlayableRow[] = [];
  const rest: PlayableRow[] = [];
  const seenCat = new Set<string>();
  for (const eq of equipments) {
    const proc = findProcedureForEquipment(eq, procs);
    if (!proc) continue;
    const steps = stepsOf(proc);
    if (!steps.length) continue; // 空规程 ⇒ 无题可出 ⇒ 不可玩
    const row: PlayableRow = {
      eq,
      proc,
      steps,
      abnormal: buildHuntSpots(eq).some((s) => s.abnormal),
    };
    if (seenCat.has(eq.category)) rest.push(row);
    else {
      seenCat.add(eq.category);
      byCategory.push(row);
    }
  }
  return [...partition(byCategory, (r) => r.abnormal), ...partition(rest, (r) => r.abnormal)];
}

/** 稳定二分：命中谓词的排前面，两组内部都保持原顺序（不许用 sort，sort 不稳定语义会打乱台账序） */
function partition<T>(list: T[], hit: (v: T) => boolean): T[] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const v of list) (hit(v) ? yes : no).push(v);
  return [...yes, ...no];
}

/* ============================ 构建 ============================ */

function levelNote(index: number, gridRooms: number, faultCount: number, distractorCount: number, plan: LevelPlan): string {
  const bits = [`第 ${index} 关 · ${gridRooms}×${gridRooms} 房间 · ${faultCount} 台故障需定位并修复`];
  // 干扰项那句只看实际摆了几台：降级把池子见底时一台也没有，写上就是骗玩家去找绿圈
  if (distractorCount > 0) bits.push(`${distractorCount} 台绿圈健康设备是干扰项，别在它身上耗时间`);
  if (plan.lockedRooms > 0) bits.push(`${plan.lockedRooms} 间房上锁，先在图里找 ${plan.keycardCount} 张门禁卡`);
  if (plan.timeLimit > 0) bits.push(`全关倒计时 ${plan.timeLimit}s`);
  if (plan.spread) bits.push('迟迟不修的故障会向相邻房间扩散');
  return bits.join(' ｜ ');
}

/**
 * 台账 + 真实规程 → 迷宫 4 关。
 *
 * 故障位取法是"从池子头按关卡配额顺次取"：`pool[0]` 因此永远是第 1 关的教学设备，
 * 后面的关只是把窗口拉长（1 → 2 → 3 → 4 台），教学那台设备在四关里始终稳定出现。
 */
export function buildMazeLevels(equipments: Equipment[], procs: MaintenanceProcedure[]): MazeLevelDTO[] {
  const pool = playablePool(equipments, procs);
  if (!pool.length) return []; // 整池为空才给空表；单台都有的话每关至少 1 个真故障

  const levels: MazeLevelDTO[] = [];
  for (let i = 0; i < MAZE_LEVEL_COUNT; i++) {
    const index = i + 1;
    const gridRooms = MAZE_GRID_BY_LEVEL[i];
    const want = FAULT_TARGET_BY_LEVEL[i];
    const plan = LEVEL_PLAN[i];
    const picked = pool.slice(0, want);
    const have = picked.length;

    // 从 have 而不是 want 起跳：降级时故障位更少，干扰项窗口要跟着贴上去，
    // 且必须整段落在 picked 之外 —— 同一台设备既红又绿是最难查的那种 bug。
    const distractorIds = plan.distractors ? pool.slice(have, have + DISTRACTOR_CAP).map((r) => r.eq.id) : [];

    levels.push({
      index,
      gridRooms,
      faults: picked.map((r) => ({
        deviceId: r.eq.id,
        deviceName: r.eq.name,
        steps: r.steps.slice(),
        spreadable: plan.spread,
      })),
      distractorIds,
      lockedRooms: plan.lockedRooms,
      keycardCount: plan.keycardCount,
      timeLimit: plan.timeLimit,
      note: levelNote(index, gridRooms, have, distractorIds.length, plan),
      degraded:
        have < want
          ? `台账里没有第 ${want} 台有规程的可玩设备（实际 ${have} 台）：本关按 ${have} 台真实故障下发，未编造设备`
          : null,
    });
  }
  return levels;
}

function toDeviceDTO(eq: Equipment): MazeDeviceDTO {
  return {
    id: eq.id,
    no: eq.code || eq.id,
    name: eq.name,
    category: eq.category,
    icon: iconKindForCategory(eq.category),
    spots: buildHuntSpots(eq).map<MazeSpotDTO>(({ key, label, reading, severity, abnormal }) => ({
      key,
      label,
      reading,
      severity,
      abnormal,
    })),
  };
}

/**
 * 名单：可玩设备优先，余量按台账顺序补背景设备，最后截到 16 台。
 *
 * 为什么不能像横版那样直接 `equipments.slice(0, 16)`：迷宫的故障位来自"有规程"的设备，
 * 它们未必落在台账前 16 行里，名单一旦把它们裁掉，Godot 拿着 `deviceId` 就找不到实体。
 */
export function buildMazeRoster(equipments: Equipment[], procs: MaintenanceProcedure[]): MazeDeviceDTO[] {
  const out: MazeDeviceDTO[] = [];
  const seen = new Set<string>();
  const push = (eq: Equipment): void => {
    if (out.length >= MAZE_ROSTER_LIMIT || seen.has(eq.id)) return;
    seen.add(eq.id);
    out.push(toDeviceDTO(eq));
  };
  for (const row of playablePool(equipments, procs)) push(row.eq);
  for (const eq of equipments) push(eq);
  return out;
}

/** 台账 + 规程 → `maze-data` 消息体（Godot 侧 `postMessage` 收到的就是这个） */
export function buildMazePayload(equipments: Equipment[], procs: MaintenanceProcedure[]): MazePayload {
  return {
    type: MAZE_MESSAGE_TYPE,
    version: MAZE_VERSION,
    devices: buildMazeRoster(equipments, procs),
    levels: buildMazeLevels(equipments, procs),
  };
}
