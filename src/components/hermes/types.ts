/**
 * Hermes 智能业务管家 - 前端类型契约（单一事实来源）
 *
 * 全部字段由后端 /api/v1/business-loops 系列接口返回，本文件不含任何演示数据。
 * 环节 ↔ AI 能力对应（与后端 businessLoopService 对齐）：
 * - 环节 1 (现场报修): generate-work-order 工单草稿
 * - 环节 2 (高危作业票): safety-risk-assessment (JSA)
 * - 环节 3 (LOTO能量隔离): safety-interlock 规则隔离建议
 * - 环节 4 (检修执行): generate-maintenance-plan
 * - 环节 5/6: 归档时由 generate-report / suggest-contribution 生成
 */

export type StageId =
  | 'stage_report'       // 1. 现场报修
  | 'stage_permit'       // 2. 高危作业票
  | 'stage_loto'         // 3. LOTO能量隔离
  | 'stage_execution'    // 4. 检修执行
  | 'stage_completion'   // 5. 完工
  | 'stage_archive';     // 6. 质检归档

export type StageStatus = 'completed' | 'in_progress' | 'pending';

/** 人工修订留痕（服务端 prefill.humanRevised：确认落库前人改过的字段清单） */
export interface HumanRevisionRecord {
  by: string;
  at: string;
  fields: string[];
}

/** 环节 AI 预填内容（来自 stages.ai_prefill_json，前端原样渲染；degraded 必须如实展示） */
export interface StageAiPrefill {
  engine?: string;
  status?: 'ok' | 'degraded';
  generatedAt?: string;
  /** 一句话结论/摘要（真实 AI 或规则结果） */
  content?: string | null;
  /** 工作台建议正文（工单草稿要点 / JSA 措施 / LOTO 说明 / SOP 概述） */
  advice?: string | null;
  /** 已持久化的人工修订（无修订为 null） */
  revised?: HumanRevisionRecord | null;
  /** 原始 JSON（可自由渲染） */
  raw?: unknown;
}

export interface StageStepMeta {
  id: StageId;
  order: number;
  title: string;
  status: StageStatus;
  aiBadge: string;
  outputSummary: string;
  targetPage: string;
  targetTabKey: string;
  duration: string;
  completedTime?: string;
  aiPrefill?: StageAiPrefill;
}

export interface LotoConfirmationItem {
  id: string;
  type: string;
  point: string;
  requirement: string;
  lockNumber: string;
  /** 隔离点出处：JSA 评估输出 / 类别规则兜底 / 人工登记（降级清单需现场核对） */
  basis?: string;
  confirmed: boolean;
  /** 现场操作人（可由确认人改填实际挂牌的人） */
  operator: string;
  confirmTime?: string;
  /** 确认人：只取登录身份，不可手填 */
  confirmedBy?: string | null;
  /** 该行被谁改过（人工修订留痕） */
  editedBy?: string | null;
  editedAt?: string | null;
  /** AI/规则原值留底（改过的字段才在此，供 tooltip 对照） */
  aiOriginal?: Record<string, string> | null;
}

/** LOTO 行内现场登记字段（服务端白名单） */
export interface LotoFieldDraft {
  type?: string;
  point?: string;
  requirement?: string;
  lockNumber?: string;
  operator?: string;
}

/**
 * 确认闸门随附的人工修订（与服务端 HUMAN_EDITABLE_FIELDS 白名单一致）：
 * 只有这里列出的字段会被采纳，其他键服务端直接丢弃。
 */
export interface StageHumanEdits {
  workOrderDraft?: {
    title?: string;
    faultType?: string;
    priority?: string;
    estimatedHours?: number;
    description?: string;
  };
  assessment?: { riskLevel?: string; riskReason?: string };
  plan?: { overview?: string; estimatedHours?: number; workers?: number };
}

export interface ArtifactItem {
  id: string;
  code: string;
  name: string;
  stageId: StageId;
  status: 'ready' | 'pending';
  category: string;
  previewContent: string;
}

export interface ButlerSuggestion {
  id: string;
  type: 'todo' | 'risk' | 'next';
  title: string;
  content: string;
  tag: string;
  actionText?: string;
}

export interface HistoryLoopItem {
  id: string;
  loopCode: string;
  targetGoal: string;
  equipmentName: string;
  status: 'completed' | 'archived';
  duration: string;
  artifactCount: number;
  knowledgeCount: number;
  closedDate: string;
  leadUser: string;
}

/**
 * 页头三颗实时指标：全部由 /business-loops 列表与 /history 现算，
 * 不允许写死；无样本时 avgDurationHours 为 null（页面显示「—」而不是假数）。
 */
export interface LoopHeaderStats {
  runningCount: number;
  archivedThisWeek: number;
  avgDurationHours: number | null;
}

export interface BusinessClosedLoopData {
  id: string;
  loopCode: string;
  status: 'running' | 'paused' | 'archived';
  businessGoal: string;
  equipment: {
    id: string;
    code: string;
    name: string;
    model: string;
    workshop: string;
    status: 'warning' | 'normal' | 'danger';
    /** 遥测缺测时为 null —— 界面必须显示「未接入」，不得显示 0（0 是可判定的真实读数） */
    temperature: number | null;
    temperatureThreshold: number;
    vibration: number | null;
    loadRate: number | null;
    healthScore: number | null;
  };
  initiator: {
    name: string;
    role: string;
    time: string;
  };
  progress: {
    currentStageOrder: number;
    totalStages: number;
    percent: number;
    estimatedTotalHours: number;
    elapsedHours: number;
  };
  stages: StageStepMeta[];
  lotoItems: LotoConfirmationItem[];
  artifacts: ArtifactItem[];
  suggestions: ButlerSuggestion[];
}

/** 业务目标解析结果（服务端识别出的设备与故障线索） */
export interface GoalParseResult {
  equipmentId: string | null;
  equipmentName: string | null;
  faultKeyword: string | null;
}

// ==================== ai_prefill_json 结构（与后端 businessLoopService 写入字段一致） ====================

/** 环节 1：generate-work-order 的工单草稿 */
export interface WorkOrderDraftPrefill {
  title?: string;
  faultType?: string;
  priority?: string;
  description?: string;
  estimatedHours?: number;
  recommendedSteps?: string[];
  safetyNotes?: string[];
}

export interface Stage1Prefill {
  workOrderDraft?: WorkOrderDraftPrefill | null;
  message?: string | null;
}

/** 环节 2：safety-risk-assessment 的 JSA 评估 */
export interface JsaMeasure {
  hazard?: string;
  control?: string;
}

export interface Stage2Prefill {
  assessment?: {
    riskLevel?: string;
    riskReason?: string;
    jsaMeasures?: JsaMeasure[];
    hazardIdentifications?: Array<{ category?: string; hazard?: string; level?: string }>;
    lotoAdvice?: { required?: boolean; lockCount?: number; isolationPoints?: string[] };
  } | null;
  degraded?: boolean;
  message?: string | null;
}

/** 环节 3：safety-interlock 规则推演的 LOTO 建议（含人工逐项确认状态） */
export interface Stage3Prefill {
  isolationPoints?: string[];
  lockRequired?: boolean;
  lockCount?: number;
  existingLocks?: Array<{ lockNo?: string; status?: string; pointName?: string }>;
  lotoItems?: Array<{
    id: string;
    type: string;
    point: string;
    requirement: string;
    lockNumber: string;
    confirmed: boolean;
    operator: string;
    confirmTime?: string;
  }>;
  standards?: string[];
  note?: string;
}

/** 环节 4：generate-maintenance-plan 的检修方案 */
export interface Stage4Prefill {
  plan?: {
    overview?: string;
    steps?: Array<{ step?: number; operation?: string; qualityStandard?: string }>;
    spareParts?: Array<{ name?: string; spec?: string; qty?: number }>;
    safetyMeasures?: { lotoPoints?: string[]; ppe?: string[] };
    estimatedHours?: number;
    workers?: number;
  } | null;
  degraded?: boolean;
  message?: string | null;
}

export interface Stage5Prefill {
  acceptanceSummary?: string | null;
}

/** 环节 6：归档时的 suggest-contribution 判定 */
export interface Stage6Prefill {
  contribution?: {
    worthContributing?: boolean;
    id?: string;
    title?: string;
    type?: string;
    equipment?: string;
    summary?: string;
    solution?: string;
    message?: string;
  } | null;
}
