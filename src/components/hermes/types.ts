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

/** 环节 AI 预填内容（来自 stages.ai_prefill_json，前端原样渲染；degraded 必须如实展示） */
export interface StageAiPrefill {
  engine?: string;
  status?: 'ok' | 'degraded';
  generatedAt?: string;
  /** 一句话结论/摘要（真实 AI 或规则结果） */
  content?: string | null;
  /** 工作台建议正文（工单草稿要点 / JSA 措施 / LOTO 说明 / SOP 概述） */
  advice?: string | null;
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
  confirmed: boolean;
  operator: string;
  confirmTime?: string;
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

export interface BusinessClosedLoopData {
  id: string;
  loopCode: string;
  businessGoal: string;
  equipment: {
    id: string;
    code: string;
    name: string;
    model: string;
    workshop: string;
    status: 'warning' | 'normal' | 'danger';
    temperature: number;
    temperatureThreshold: number;
    vibration: number;
    loadRate: number;
    healthScore: number;
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
  historyLoops: HistoryLoopItem[];
}

/** 业务目标解析结果（服务端识别出的设备与故障线索） */
export interface GoalParseResult {
  equipmentId: string | null;
  equipmentName: string | null;
  faultKeyword: string | null;
}
