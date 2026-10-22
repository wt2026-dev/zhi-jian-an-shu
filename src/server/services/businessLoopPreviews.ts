/**
 * 业务闭环档案预览域（自 businessLoopService.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：八类档案的预览文本生成器（工单/许可/LOTO/指引/验收/报告/知识/档案包，
 * 全部来自真实落库数据，禁止编造）、artifactDisplayCode 档案编号、categoryOf
 * 类别中文名、joinClauses 条目拼接与 fmtTimeOfDay 时间片段格式化。
 * settle* 落库预览与 buildLoopDetail/buildHistoryItems 共用同一份生成器。
 */
import { LOAD_LIMIT, TEMP_LIMIT, VIB_LIMIT, telemetryValueOrNull } from "./businessLoopConstants.ts";
import type { Equipment } from "../../types/index.ts";
import { fmtNow } from "./businessLoopService.ts";

// ---- 预览文本生成器（全部来自真实落库数据） ----

/** 条目级列表拼成一行：先剥掉条目自带的句末标点，避免出现「。；」这类重复标点 */
export function joinClauses(items: unknown[], sep = "；"): string {
  return items
    .map((item) => String(item).trim().replace(/[。；;]+$/, ""))
    .filter(Boolean)
    .join(sep);
}

export function buildWorkOrderPreview(order: any, loop: any): string {
  return [
    `【工单号】${order.orderNo}`,
    `【标题】${order.title}`,
    `【报修设备】${order.equipmentName}${order.equipmentCode ? ` (${order.equipmentCode})` : ""}`,
    `【优先级】${order.priority}｜状态：${order.status}`,
    `【业务闭环】${loop.loopNo}（AI 草稿 + 人工确认后落库，来源 source=business_loop）`,
    `【故障描述】${String(order.description || "").slice(0, 300)}`,
    `【创建时间】${order.createdAt}`,
  ].join("\n");
}

export function buildPermitPreview(permit: any): string {
  // 措施清单可能超过 5 条，人工修订留痕不能被 slice 掉——它会替票面说话，所以单列一行。
  const all = (permit.precautions || []).map((p: any) => String(p));
  const revisionLines = all.filter((p) => p.startsWith("【人工修订留痕】"));
  const measures = all.filter((p) => !p.startsWith("【人工修订留痕】"));
  return [
    `【作业票号】${permit.permitNo}`,
    `【作业类型】${permit.permitType}｜风险等级：${permit.riskLevel}`,
    `【关联设备】${permit.equipmentName || "—"}｜车间：${permit.workshop || "—"}`,
    `【申请人】${permit.applicant}${permit.applicantDept ? `（${permit.applicantDept}）` : ""}`,
    `【有效期至】${permit.validUntil}`,
    `【安全措施】${joinClauses(measures.slice(0, 5)) || "—（JSA 未输出，请人工补充）"}`,
    ...revisionLines,
    `【会签状态】${permit.status}（需现场监护与主管双人会签后方可生效）`,
  ].join("\n");
}

export function buildLotoPreview(loop: any, prefill: any): string {
  const items: any[] = prefill.lotoItems || [];
  const confirmed = items.filter((i) => i.confirmed).length;
  return [
    `【清单编号】${loop.loopNo}-LOTO`,
    `【隔离点位】${items.length} 处（${Array.from(new Set(items.map((i) => i.type))).join(" / ") || "无"})`,
    `【确认进度】${confirmed}/${items.length} 已由现场逐项确认`,
    ...items.map((i) => `- ${i.type}：${i.point}（锁号 ${i.lockNumber || "现场登记"}）${i.confirmed ? `✔ ${i.operator || ""} ${i.confirmTime || ""}` : " 待确认"}`),
    `【执行标准】${joinClauses(prefill.standards || [])}`,
  ].join("\n");
}

export function buildGuidePreview(loop: any, plan: any, degraded: boolean): string {
  if (!plan) return `【作业指引】${loop.loopNo}-SOP\n\n检修方案预填失败或为空，请以设备档案配套规程人工编制，勿以空指引替代工艺卡。`;
  return [
    `【作业指引】${loop.loopNo}-SOP${degraded ? "（AI 降级规则结果，需人工核校）" : ""}`,
    `【方案概述】${plan.overview || "—"}`,
    `【作业步骤】${(plan.steps || []).map((s: any) => `${s.step}. ${s.operation}${s.qualityStandard ? `（验收：${s.qualityStandard}）` : ""}`).join("\n") || "—"}`,
    `【LOTO 隔离点】${joinClauses(plan.safetyMeasures?.lotoPoints || []) || "以环节 3 清单为准"}`,
    `【PPE】${(plan.safetyMeasures?.ppe || []).join("、") || "按现场标准"}`,
    `【备件/工具】${(plan.spareParts || []).map((p: any) => `${p.name}${p.spec ? `（${p.spec}）` : ""}×${p.qty ?? 1}`).join("；") || "以现场领料为准"}`,
    `【预估工时】${plan.estimatedHours ?? "—"} 小时（${plan.workers ?? "—"} 人）`,
  ].join("\n");
}

export function buildAcceptancePreview(loop: any, order: any | null, eq: Equipment | null, telemetry: any): string {
  const fmtBase = (v: unknown, unit: string, limit: number) => {
    const n = telemetryValueOrNull(v);
    return n == null ? `未接入（限值 ${limit}${unit}）` : `${n}${unit}（限值 ${limit}${unit}）`;
  };
  const hasBase = [telemetry?.temperature, telemetry?.vibration, telemetry?.loadRate]
    .some((v) => telemetryValueOrNull(v) != null);
  return [
    `【验收记录】${loop.loopNo}-ACC`,
    `【关联工单】${order ? `${order.orderNo}（当前状态 ${order.status}）` : "未生成工单记录"}`,
    `【设备】${eq ? `${eq.name}（${eq.code}）` : "未识别设备"}｜健康分 ${eq?.healthScore ?? "—"}`,
    hasBase
      ? `【修前基线】温度 ${fmtBase(telemetry.temperature, "°C", TEMP_LIMIT)}｜振动 ${fmtBase(telemetry.vibration, " mm/s", VIB_LIMIT)}｜负载率 ${fmtBase(telemetry.loadRate, "%", LOAD_LIMIT)}`
      : "【修前基线】遥测未接入，修前基线为空（不得据零值判定修后改善与否）",
    `【验收要求】修后实测回归经验限值以内；修前/修后对比与双签字请走「检修工单」页验收流程`,
    `【生成说明】本记录由业务闭环确认动作生成，数据源自设备台账遥测与工单状态`,
  ].join("\n");
}

export function buildReportPreview(loop: any, report: any | null): string {
  if (!report?.conclusion && !report?.summary) {
    return `【质检报告】${loop.loopNo}-QC\n\n质检报告 AI 生成失败（degraded），请人工在工单验收流程出具质量结论后再归档。`;
  }
  return [
    `【质检报告】${loop.loopNo}-QC`,
    `【结论】${report.conclusion || report.summary || "—"}`,
    report.qualityScore != null ? `【评分】${report.qualityScore}` : "",
    ...(Array.isArray(report.checks) ? report.checks.slice(0, 6).map((c: any) => `- ${typeof c === "string" ? c : [c.item, c.result, c.standard].filter(Boolean).join("｜")}`) : []),
    ...(Array.isArray(report.problems) && report.problems.length ? report.problems.slice(0, 4).map((p: string) => `【遗留问题】${p}`) : []),
  ].filter(Boolean).join("\n");
}

export function buildKnowledgePreview(contribution: any): string {
  return [
    `【知识条目】${contribution.id || "（已提交待审核）"}`,
    `【标题】${contribution.title || "工业检修排查案例"}`,
    `【类型】${contribution.type || "故障案例"}｜设备：${contribution.equipment || "—"}`,
    `【摘要】${contribution.summary || "—"}`,
    `【解决方案要点】${contribution.solution || "—"}`,
    `【状态】已提交至 AI 知识贡献审核台（status=pending，人工审核通过后进入 RAG 知识库）`,
  ].join("\n");
}

export function buildPackPreview(loop: any, counts: { total: number; generated: number; knowledgeCount: number }): string {
  return [
    `【档案综合包】${loop.loopNo}-PKG`,
    `【生成时间】${fmtNow()}`,
    `【内容】闭环 ${loop.loopNo} 全部 ${counts.total} 项标准资料，其中 ${counts.generated} 项为已生成状态（工单/作业票/LOTO 清单/作业指引/验收记录/质检报告/知识沉淀/档案包），知识沉淀 ${counts.knowledgeCount} 条`,
    `【数据纪律】所有单据均由本系统真实落库记录生成，未附带任何演示或占位数据`,
  ].join("\n");
}

export function artifactDisplayCode(loopNo: string, type: string): string {
  const prefixMap: Record<string, string> = {
    work_order: "WO",
    hazard_permit: "HWP",
    loto_checklist: "LOT",
    work_guide: "SOP",
    acceptance: "ACC",
    quality_report: "QC",
    knowledge_entry: "KB",
    archive_pack: "PKG",
  };
  return `${loopNo}-${prefixMap[type] || "DOC"}`;
}

export function categoryOf(type: string): string {
  const map: Record<string, string> = {
    work_order: "检修工单",
    hazard_permit: "安全许可",
    loto_checklist: "能量隔离",
    work_guide: "作业标准",
    acceptance: "现场验收",
    quality_report: "质量评估",
    knowledge_entry: "知识沉淀",
    archive_pack: "全量档案",
  };
  return map[type] || "业务资料";
}

// ---- 时间格式化 ----

export function fmtTimeOfDay(v: any): string {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
