/**
 * 主线进度本地存储 —— 等级、经验、成就、历史最佳。
 *
 * 口径：这些是**游戏元数据**，不是业务数据，因此只存浏览器本地，不进数据库
 * （新增 `game_sessions` 表要动 `src/db/**` 与共享 dev server，成本远大于收益）。
 * 业务侧的每一次真实动作（建单、派工、LOTO、备件出库、验收、知识沉淀）都走接口落库，
 * 结算面板上会把"本地分数"和"库里真实单据"分开标注，不让人误以为成绩进了系统。
 */
import type { Grade } from "../game/levelPlay";
import { achievementsUnlocked, rankFor, xpForRun, type ActOutcome, type AchievementContext } from "./campaignModel";

export const PROGRESS_KEY = "paoding-campaign-v1";

export interface RunRecord {
  finishedAt: number;
  equipmentId: string;
  equipmentName: string;
  workOrderId: string | null;
  orderNo: string | null;
  grade: Grade;
  score: number;
  seconds: number;
  mistakes: number;
  xpGained: number;
  newAchievements: string[];
}

export interface CampaignProgress {
  version: 1;
  xp: number;
  runs: number;
  bestGrade: Grade | null;
  bestRunSeconds: number | null;
  achievements: string[];
  /** 已完整走完主线的设备，用于"重复刷同一台收益递减" */
  clearedEquipmentIds: string[];
  history: RunRecord[];
}

export const EMPTY_PROGRESS: CampaignProgress = {
  version: 1,
  xp: 0,
  runs: 0,
  bestGrade: null,
  bestRunSeconds: null,
  achievements: [],
  clearedEquipmentIds: [],
  history: [],
};

const GRADE_ORDER: Record<Grade, number> = { C: 0, B: 1, A: 2, S: 3 };

function isProgress(v: unknown): v is CampaignProgress {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<CampaignProgress>;
  return p.version === 1 && typeof p.xp === "number" && Array.isArray(p.achievements) && Array.isArray(p.history);
}

/** 读本地进度；无 window（SSR/单测）或数据损坏时回落到空档，不抛错 */
export function loadProgress(): CampaignProgress {
  if (typeof window === "undefined") return { ...EMPTY_PROGRESS };
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { ...EMPTY_PROGRESS };
    const parsed: unknown = JSON.parse(raw);
    return isProgress(parsed) ? parsed : { ...EMPTY_PROGRESS };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

export function saveProgress(p: CampaignProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // 隐私模式 / 配额满：进度只留在内存里，不影响主线继续玩
  }
}

export function resetProgress(): CampaignProgress {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(PROGRESS_KEY);
    } catch {
      /* 忽略 */
    }
  }
  return { ...EMPTY_PROGRESS };
}

export interface FinishedRun {
  equipmentId: string;
  equipmentName: string;
  workOrderId: string | null;
  orderNo: string | null;
  outcomes: ActOutcome[];
  totalSeconds: number;
  mistakes: number;
  grade: Grade;
  score: number;
  /** 七幕是否全部走完（走不完不给"首次独立检修"） */
  completed: boolean;
  flags: Pick<AchievementContext, "lotoRegistered" | "usedAiDiagnose" | "usedAiPlan" | "visionQc" | "knowledgeContributed">;
  finishedAt?: number;
}

export interface RunSettlement {
  progress: CampaignProgress;
  record: RunRecord;
  xpGained: number;
  newAchievements: string[];
  rankTitle: string;
  rankLevel: number;
  nextRankTitle: string | null;
}

/**
 * 把一次主线结算进本地进度（纯函数：不读 window，方便单测；持久化由调用方 saveProgress 做）。
 */
export function applyRun(prev: CampaignProgress, run: FinishedRun): RunSettlement {
  const repeatCount = prev.clearedEquipmentIds.includes(run.equipmentId) ? 2 : 1;
  const xpGained = run.completed ? xpForRun(run.grade, repeatCount) : 0;
  const finishedAt = run.finishedAt ?? Date.now();
  const newAchievements = achievementsUnlocked({
    runCompleted: run.completed,
    mistakes: run.mistakes,
    grade: run.grade,
    runSeconds: run.totalSeconds,
    bestRunSeconds: prev.bestRunSeconds,
    lotoRegistered: run.flags.lotoRegistered,
    usedAiDiagnose: run.flags.usedAiDiagnose,
    usedAiPlan: run.flags.usedAiPlan,
    visionQc: run.flags.visionQc,
    knowledgeContributed: run.flags.knowledgeContributed,
  }).filter((id) => !prev.achievements.includes(id));

  const record: RunRecord = {
    finishedAt,
    equipmentId: run.equipmentId,
    equipmentName: run.equipmentName,
    workOrderId: run.workOrderId,
    orderNo: run.orderNo,
    grade: run.grade,
    score: run.score,
    seconds: run.totalSeconds,
    mistakes: run.mistakes,
    xpGained,
    newAchievements,
  };

  const bestGrade = prev.bestGrade === null || GRADE_ORDER[run.grade] > GRADE_ORDER[prev.bestGrade] ? run.grade : prev.bestGrade;
  const bestRunSeconds = prev.bestRunSeconds === null || run.totalSeconds < prev.bestRunSeconds ? run.totalSeconds : prev.bestRunSeconds;
  const rank = rankFor(prev.xp + xpGained);

  const progress: CampaignProgress = {
    ...prev,
    xp: prev.xp + xpGained,
    runs: prev.runs + 1,
    bestGrade,
    bestRunSeconds,
    achievements: [...prev.achievements, ...newAchievements],
    clearedEquipmentIds: run.completed && !prev.clearedEquipmentIds.includes(run.equipmentId) ? [...prev.clearedEquipmentIds, run.equipmentId] : prev.clearedEquipmentIds,
    history: [record, ...prev.history].slice(0, 20),
  };

  return {
    progress,
    record,
    xpGained,
    newAchievements,
    rankTitle: rank.current.title,
    rankLevel: rank.current.level,
    nextRankTitle: rank.next ? rank.next.title : null,
  };
}
