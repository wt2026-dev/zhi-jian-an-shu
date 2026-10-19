/**
 * 《智检修士》七幕主线的纯逻辑层 —— **无 React、无 three.js、无 DOM**，可直接单测。
 *
 * 定位：把项目的业务流程串成一条可玩的主线（工厂运转 → 故障来袭 → AI 诊断 → 制定方案 →
 * 现场检修 → AI 质检 → 归档复盘）。每一幕都对应一个真实功能模块，读数一律来自接口。
 *
 * ## 数据红线（沿用项目既有口径）
 *
 * - 报警不随机造：故障设备从真实台账里按"状态严重度 → 真实遥测异常 → 健康分"排出来，
 *   同一批入参必须得到同一个结果（可重放、可断言）。
 * - 报警文案只写真实读数；遥测缺失时明说"未接入读数"，不用 0 或编造值顶替。
 * - 阈值判定不另抄一份：复用 `levelPlay.buildHuntSpots`（其内部走 `statusMapping.telemetryToStatus`）。
 * - 评级复用 `levelPlay.gradeFor`，与检修闯关同一套 S/A/B/C 口径，跨页面可比。
 * - 等级/积分/成就是**游戏元数据**，只存本地（见 `campaignProgress.ts`）；
 *   业务侧的工单、LOTO、备件、知识贡献全部走真实接口落库。
 */
import type { Equipment } from "../../types";
import type { StationSpec } from "../game/gameScene";
import { buildHuntSpots, gradeFor, worstSpot, type Grade } from "../game/levelPlay";

/* ============================ 七幕定义 ============================ */

export type ActId = "overview" | "incident" | "diagnose" | "plan" | "repair" | "qc" | "archive";

export interface ActDef {
  id: ActId;
  /** 幕序号，从 1 开始 */
  index: number;
  title: string;
  /** 一句话玩法 */
  brief: string;
  /** 这一幕对应项目里的哪个功能（结算与教学卡片都要如实列出来） */
  feature: string;
  /** 该幕的合理用时（秒），用于速度加成；量级取自真实操作耗时，不是拍脑袋的平衡数 */
  parSeconds: number;
}

export const ACTS: ActDef[] = [
  {
    id: "overview",
    index: 1,
    title: "工厂运转",
    brief: "3D 工厂俯瞰，看板上的在线率与健康分都来自设备台账。",
    feature: "数字孪生大屏 · 设备监测",
    parSeconds: 45,
  },
  {
    id: "incident",
    index: 2,
    title: "故障来袭",
    brief: "台账里最不正常的那台设备报警，你按下报修单，工单真实入库。",
    feature: "工单系统 · 故障定位 · 3D 设备视图",
    parSeconds: 60,
  },
  {
    id: "diagnose",
    index: 3,
    title: "AI 诊断",
    brief: "把真实遥测交给 AI 诊断引擎，拿回故障机理、风险等级与排查步骤。",
    feature: "AI 诊断引擎 · 故障树诊断",
    parSeconds: 90,
  },
  {
    id: "plan",
    index: 4,
    title: "制定方案",
    brief: "AI 生成检修方案，你决定派谁、什么优先级、领哪些备件。",
    feature: "AI 生成方案 · 工单派工 · 备件管理",
    parSeconds: 120,
  },
  {
    id: "repair",
    index: 5,
    title: "现场检修",
    brief: "相机俯冲进 3D 设备，按规程做断电挂牌、拆、换、装四步。",
    feature: "3D 设备视图 · 检修规程 · LOTO 能量隔离",
    parSeconds: 240,
  },
  {
    id: "qc",
    index: 6,
    title: "AI 质检",
    brief: "上传现场照片，AI 视觉模型判断安装是否到位，结论写进验收意见。",
    feature: "AI 视觉质检 · 多模态识别",
    parSeconds: 90,
  },
  {
    id: "archive",
    index: 7,
    title: "归档复盘",
    brief: "工单验收闭环，检修经验沉淀进知识库，最后按用时与失误结算。",
    feature: "工单闭环 · 知识沉淀 · 数据统计",
    parSeconds: 60,
  },
];

export function actOf(id: ActId): ActDef {
  const hit = ACTS.find((a) => a.id === id);
  if (!hit) throw new Error(`未知幕次: ${id}`);
  return hit;
}

export function nextAct(id: ActId): ActDef | null {
  const idx = ACTS.findIndex((a) => a.id === id);
  return idx >= 0 && idx + 1 < ACTS.length ? ACTS[idx + 1] : null;
}

/* ============================ 报警挑选（真实台账，确定性） ============================ */

const STATUS_RANK: Record<string, number> = {
  critical: 4,
  fault: 3,
  overhauling: 2,
  warning: 1,
  standby: 0,
  running: 0,
};

export interface IncidentPick {
  equipment: Equipment;
  /** 真实遥测判出的最严重测点；遥测未接入或全部正常时为 null */
  abnormalLabel: string | null;
  abnormalReading: string | null;
  /** 报警一句话文案，只由真实读数拼出来 */
  brief: string;
  /** 工单标题（真实入库用） */
  orderTitle: string;
  /** 工单优先级：urgent/high/medium，与台账严重度同口径 */
  priority: "urgent" | "high" | "medium";
  /** 故障类型（工单字段） */
  faultType: string;
}

/** 台账里"最该修"的那台：先看状态，再看真实遥测严重度，最后看健康分。 */
function incidentRank(eq: Equipment): number {
  const spots = buildHuntSpots(eq);
  const worst = worstSpot(spots);
  const spotRank = worst ? { nodata: -1, normal: 0, unrated: 0, warning: 1, fault: 2, critical: 3 }[worst.severity] : -1;
  const status = STATUS_RANK[eq.status] ?? 0;
  // 状态占高位，遥测占中位，健康分做同分时的次序。
  // 未评估（null）不得按"100 分"参与排序 —— 那会把一台从未体检过的设备排到最后，
  // 让真正该优先复核的设备排在它后面。这里给 50（中性分），与"正常但不优"同档。
  return status * 100 + spotRank * 10 + (100 - (eq.healthScore ?? 50)) / 10;
}

/**
 * 从真实台账挑下一个报警设备。
 *
 * @param equipments 台账（已按业务口径过滤过的厂区设备）
 * @param excludeIds 本次会话已经修过的设备，不再重复报警
 * @returns 全部修过或台账为空时返回 null —— 调用方必须如实显示"暂无可报警设备"，不得造数
 */
export function pickIncident(equipments: Equipment[], excludeIds: string[] = []): IncidentPick | null {
  const pool = equipments.filter((e) => e && !excludeIds.includes(e.id));
  if (pool.length === 0) return null;
  const ranked = pool
    .map((eq) => ({ eq, rank: incidentRank(eq) }))
    .sort((a, b) => (b.rank - a.rank) || a.eq.id.localeCompare(b.eq.id));
  const best = ranked[0];
  if (best.rank <= 0) return null; // 全厂正常：没有故障就不演故障，主线停在这里
  return toIncidentPick(best.eq);
}

/**
 * 台账状态文案。`critical` 不在 `EquipmentStatus` 联合里，但线上库确实存在该取值
 * （`/api/v1/equipments` 实测有 1 台），所以这里按字符串兜住，不做窄化断言。
 */
const STATUS_LABEL: Record<string, string> = {
  critical: "严重故障",
  fault: "故障待修",
  warning: "预警",
  overhauling: "检修中",
  standby: "停机备用",
  scrapped: "已报废",
};

export function toIncidentPick(eq: Equipment): IncidentPick {
  const spots = buildHuntSpots(eq);
  const worst = worstSpot(spots);
  const abnormal = worst && worst.reading !== null ? worst : null;
  // 只看"有阈值口径"的测点（温度/振动/负载）：电流电压这类无阈值指标即便有读数，
  // 也不能拿来证明"遥测接入了"，否则会把未接入设备的文案写成"读数正常"。
  const noData = spots.filter((s) => s.severity !== "unrated").every((s) => s.reading === null);
  const status = String(eq.status);
  const statusLabel = STATUS_LABEL[status] ?? "状态异常";
  const priority: IncidentPick["priority"] = status === "critical" ? "urgent" : status === "fault" ? "high" : "medium";
  // 三种真实情形分开说：读数超限 / 根本没接遥测 / 读数正常但台账标了异常。
  // 最后一种不能硬编成"某某部位超限"，那是造数。
  const reason = abnormal
    ? `${abnormal.label}实测 ${abnormal.reading}，已越过阈值并被标为${statusLabel}`
    : noData
      ? `遥测未接入有效读数，台账状态为${statusLabel}`
      : `各测点读数均在阈值内，但台账状态为${statusLabel}`;
  return {
    equipment: eq,
    abnormalLabel: abnormal ? abnormal.label : null,
    abnormalReading: abnormal ? abnormal.reading : null,
    brief: `${eq.name}（${eq.code}）${reason}`,
    orderTitle: `${eq.name}${abnormal ? ` ${abnormal.label}异常` : " 运行异常"}`,
    priority,
    faultType: abnormal ? `${abnormal.label}读数异常` : noData ? `${statusLabel}（无遥测读数）` : `${statusLabel}（遥测读数正常）`,
  };
}

/* ============================ 第 1 幕看板口径 ============================ */

export interface FactoryBoard {
  total: number;
  running: number;
  warning: number;
  fault: number;
  /** 在线率 = 运行台数 / 台账台数，与驾驶舱/地图层同一口径 */
  onlineRate: number | null;
  avgHealth: number | null;
}

export function factoryBoardOf(equipments: Equipment[]): FactoryBoard {
  const total = equipments.length;
  if (total === 0) return { total: 0, running: 0, warning: 0, fault: 0, onlineRate: null, avgHealth: null };
  // 线上台账实测存在 status="critical"（类型定义里没有这一项），按字符串兜住，
  // 否则这台设备会从故障数里静默漏掉。
  const statuses = equipments.map((e) => String(e.status));
  const running = statuses.filter((s) => s === "running").length;
  const warning = statuses.filter((s) => s === "warning").length;
  const fault = statuses.filter((s) => s === "fault" || s === "critical").length;
  const scored = equipments.filter((e) => typeof e.healthScore === "number" && e.healthScore > 0);
  return {
    total,
    running,
    warning,
    fault,
    onlineRate: Math.round((running / total) * 1000) / 10,
    avgHealth: scored.length ? Math.round((scored.reduce((s, e) => s + e.healthScore, 0) / scored.length) * 10) / 10 : null,
  };
}

/* ============================ 3D 点位排布 ============================ */

/**
 * 台账 → 关卡地图点位。**顺序必须稳定**：`GameScene` 只在挂载时建点位，
 * 后续靠 id 改颜色，一旦每次渲染重排，相机与点位就错位了。
 *
 * `playable` 沿用检修闯关的口径（有可匹配规程才可进入），主线据此决定
 * 报警设备优先从"有规程可走完第 5 幕"的台子里挑。
 */
export function buildStations(
  equipments: Equipment[],
  opts: { playableIds?: string[]; clearedIds?: string[]; bestGradeOf?: (id: string) => string | null } = {}
): StationSpec[] {
  const playable = new Set(opts.playableIds ?? []);
  const cleared = new Set(opts.clearedIds ?? []);
  return equipments.map((eq, i) => {
    const canPlay = playable.has(eq.id);
    return {
      id: eq.id,
      index: i + 1,
      name: eq.name,
      code: eq.code,
      category: eq.category,
      workshop: eq.workshop,
      state: cleared.has(eq.id) ? "cleared" : canPlay ? "current" : "locked",
      playable: canPlay,
      bestGrade: opts.bestGradeOf?.(eq.id) ?? null,
    };
  });
}

/* ============================ 计分与评级 ============================ */

export interface ActOutcome {
  actId: ActId;
  /** 该幕各小步的一次通过率，0~1 */
  firstTryRate: number;
  mistakes: number;
  seconds: number;
}

/**
 * 单幕得分：通过率给基础分（≤100），速度给加成（≤50），失误每次扣 15，下限 0。
 * 刻意不按"绝对分数阈值"评级 —— 分数受各幕步数影响，跨幕不可比；评级只看失误与一次通过率。
 */
export function actScoreOf(outcome: ActOutcome): number {
  const par = actOf(outcome.actId).parSeconds;
  const base = Math.round(Math.max(0, Math.min(1, outcome.firstTryRate)) * 100);
  const speed = Math.round(Math.max(0, Math.min(1, 1 - outcome.seconds / (par * 2))) * 50);
  return Math.max(0, base + speed - outcome.mistakes * 15);
}

export function runGrade(outcomes: ActOutcome[]): Grade {
  const mistakes = outcomes.reduce((s, o) => s + o.mistakes, 0);
  const scored = outcomes.length ? outcomes.reduce((s, o) => s + Math.max(0, Math.min(1, o.firstTryRate)), 0) / outcomes.length : 0;
  return gradeFor({ mistakes, firstTryRate: scored });
}

export function runTotalScore(outcomes: ActOutcome[]): number {
  return outcomes.reduce((s, o) => s + actScoreOf(o), 0);
}

/* ============================ 等级与经验 ============================ */

export interface Rank {
  level: number;
  title: string;
  minXp: number;
}

/** 检修学徒 → 检修工 → 技师 → 高级技师 → 检修主管 → 总工 */
export const RANKS: Rank[] = [
  { level: 1, title: "检修学徒", minXp: 0 },
  { level: 2, title: "检修工", minXp: 260 },
  { level: 3, title: "技师", minXp: 700 },
  { level: 4, title: "高级技师", minXp: 1500 },
  { level: 5, title: "检修主管", minXp: 2600 },
  { level: 6, title: "总工", minXp: 4200 },
];

export interface RankView {
  current: Rank;
  next: Rank | null;
  /** 0~1，到下一级（满级恒为 1） */
  progress: number;
}

export function rankFor(xp: number): RankView {
  const safe = Math.max(0, Math.floor(xp || 0));
  let current = RANKS[0];
  for (const r of RANKS) if (safe >= r.minXp) current = r;
  const next = RANKS.find((r) => r.minXp > safe) ?? null;
  if (!next) return { current, next: null, progress: 1 };
  const span = next.minXp - current.minXp;
  return { current, next, progress: span > 0 ? Math.max(0, Math.min(1, (safe - current.minXp) / span)) : 1 };
}

const GRADE_XP: Record<Grade, number> = { S: 220, A: 160, B: 110, C: 60 };

/**
 * 一次主线的经验值。同一台设备反复刷收益递减（最低 20%），
 * 免得"刷同一台简单设备"变成最优解 —— 主线要推着人往下走。
 */
export function xpForRun(grade: Grade, repeatCount: number): number {
  const base = GRADE_XP[grade];
  const factor = Math.max(0.2, 1 - 0.25 * Math.max(0, repeatCount - 1));
  return Math.round(base * factor);
}

/* ============================ 成就 ============================ */

export interface Achievement {
  id: string;
  name: string;
  desc: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_run", name: "首次独立检修", desc: "完整走完七幕主线一次" },
  { id: "zero_mistake", name: "零失误通关", desc: "一次主线全程没有失误" },
  { id: "fastest", name: "最快维修记录", desc: "刷新自己的最短用时" },
  { id: "s_grade", name: "完美检修", desc: "拿到 S 级评价" },
  { id: "loto_first", name: "第一把锁", desc: "在主线里真实登记 LOTO 能量隔离" },
  { id: "ai_teamwork", name: "人机协同", desc: "同时用上 AI 诊断与 AI 方案" },
  { id: "qc_eye", name: "火眼金睛", desc: "用 AI 视觉质检完成验收" },
  { id: "knowledge", name: "经验留得下", desc: "把一次检修沉淀成知识库案例" },
];

export interface AchievementContext {
  /** 本次主线是否已完整走完七幕 */
  runCompleted: boolean;
  mistakes: number;
  grade: Grade;
  /** 本次用时 vs 历史最短（无历史传 null） */
  runSeconds: number;
  bestRunSeconds: number | null;
  lotoRegistered: boolean;
  usedAiDiagnose: boolean;
  usedAiPlan: boolean;
  visionQc: boolean;
  knowledgeContributed: boolean;
}

/** 返回本次**新**解锁的成就 id（已解锁的由调用方在 ctx 之外过滤，这里只做条件判定）。 */
export function achievementsUnlocked(ctx: AchievementContext): string[] {
  const hit: string[] = [];
  if (ctx.runCompleted) hit.push("first_run");
  if (ctx.runCompleted && ctx.mistakes === 0) hit.push("zero_mistake");
  if (ctx.bestRunSeconds === null || ctx.runSeconds < ctx.bestRunSeconds) hit.push("fastest");
  if (ctx.grade === "S") hit.push("s_grade");
  if (ctx.lotoRegistered) hit.push("loto_first");
  if (ctx.usedAiDiagnose && ctx.usedAiPlan) hit.push("ai_teamwork");
  if (ctx.visionQc) hit.push("qc_eye");
  if (ctx.knowledgeContributed) hit.push("knowledge");
  return hit;
}
