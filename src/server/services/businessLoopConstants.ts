/**
 * 业务闭环口径常量域（自 businessLoopService.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：五环节定义（StageDef / STAGE_DEFS / stageDef）、产物档案目录
 * （ARTIFACT_DEFS）、遥测告警限值（TEMP_LIMIT / VIB_LIMIT / LOAD_LIMIT，取自
 * degradationTrend）、JSA 风险等级映射与遥测取数归一（telemetryValueOrNull）。
 * 阈值口径与 degradationTrend.ts 同源，改限值先改那边。
 */
import { TREND_METRICS } from "./degradationTrend.ts";

export interface StageDef {
  no: number;
  key: string;
  stageId: string; // 前端 StageId
  title: string;
  aiBadge: string;
  outputSummary: string;
  pageRef: string; // 对应页面路由（前端 tabKey 同名）
  durationText: string;
  minutes: number;
}

export const STAGE_DEFS: StageDef[] = [
  { no: 1, key: "field_report", stageId: "stage_report", title: "现场报修", aiBadge: "AI 诊断", outputSummary: "AI 工单草稿 · 检修工单", pageRef: "work_orders", durationText: "预计 15min", minutes: 15 },
  { no: 2, key: "hazard_permit", stageId: "stage_permit", title: "高危作业票", aiBadge: "JSA 识别", outputSummary: "JSA 风险等级 · 安全与LOTO", pageRef: "safety", durationText: "预计 25min", minutes: 25 },
  { no: 3, key: "loto", stageId: "stage_loto", title: "LOTO能量隔离", aiBadge: "LOTO 规则", outputSummary: "隔离清单建议 · 安全与LOTO", pageRef: "safety", durationText: "预计 30min", minutes: 30 },
  { no: 4, key: "repair_execution", stageId: "stage_execution", title: "检修执行", aiBadge: "SOP 推理", outputSummary: "检修方案 · 作业指引", pageRef: "procedures", durationText: "预计 90min", minutes: 90 },
  { no: 5, key: "completion", stageId: "stage_completion", title: "完工", aiBadge: "巡检比对", outputSummary: "完工验收 · 巡检作业", pageRef: "inspections", durationText: "预计 30min", minutes: 30 },
  { no: 6, key: "quality_archive", stageId: "stage_archive", title: "质检归档", aiBadge: "知识提炼", outputSummary: "质检报告 · 知识库", pageRef: "knowledge", durationText: "预计 20min", minutes: 20 },
];

export function stageDef(no: number): StageDef {
  return STAGE_DEFS[no - 1];
}

/** 产出物类型定义（8 项标准业务资料，与迁移 artifact_type CHECK 约束一致） */
export const ARTIFACT_DEFS: Array<{ type: string; title: string; stageNo: number }> = [
  { type: "work_order", title: "智能检修工单", stageNo: 1 },
  { type: "hazard_permit", title: "高危作业安全许可票", stageNo: 2 },
  { type: "loto_checklist", title: "LOTO 能量隔离挂牌清单", stageNo: 3 },
  { type: "work_guide", title: "检修作业指引", stageNo: 4 },
  { type: "acceptance", title: "修后现场质量验收记录", stageNo: 5 },
  { type: "quality_report", title: "综合质检闭环评估报告", stageNo: 6 },
  { type: "knowledge_entry", title: "检修知识沉淀条目", stageNo: 6 },
  { type: "archive_pack", title: "闭环电子档案综合包", stageNo: 6 },
];

/** 温度/振动共用同一组台账-趋势侧经验限值（degradationTrend.ts TREND_METRICS 单一事实来源） */
export const TEMP_LIMIT = TREND_METRICS.find((m) => m.key === "temperature")?.warnThreshold ?? 75;
export const VIB_LIMIT = TREND_METRICS.find((m) => m.key === "vibration")?.warnThreshold ?? 4.5;
export const LOAD_LIMIT = TREND_METRICS.find((m) => m.key === "loadRate")?.warnThreshold ?? 85;

/** JSA 四档结论 → 站内作业票风险等级口径（与安全台账 Level 1-4 显示约定对齐） */
export const JSA_RISK_TO_LEVEL: Record<string, string> = {
  极高: "极大风险 (Level 1)",
  高: "较大风险 (Level 2)",
  中: "一般风险 (Level 3)",
  低: "低风险 (Level 4)",
};


export function telemetryValueOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
