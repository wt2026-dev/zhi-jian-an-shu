/**
 * 业务闭环报告与知识沉淀域（自 businessLoopService.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：质检报告核心（runGenerateReportCore：汇总真实闭环数据后走 DashScope，
 * 失败如实 degraded、绝不伪造结论）与知识贡献判定（runSuggestContributionCore：
 * AI 判定「完整、可复用、现场验证过」的故障处理案例后才落知识库）。
 */
import { getAiClient, callDashScopeJson, AiUnavailableError } from "./aiClient.ts";
import { AI_EXPERT_SYSTEM } from "./aiExpert.ts";
import { getDb } from "../../db/db.ts";
import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { logger } from "../../utils/logger.ts";
import { BusinessLoopRepository } from "../../db/repositories/index.ts";
import type { CapabilityResult } from "./aiCapabilityService.ts";
import type { Equipment } from "../../types/index.ts";

// ==================== 质检报告核心（generate-report，DashScope 真实调用） ====================

/** 汇总真实闭环数据（目标/设备遥测/工单/JSA/LOTO/方案）后生成质检报告；失败如实 degraded，不伪造结论 */
export async function runGenerateReportCore(
  loop: any,
  eq: Equipment | null,
  order: any | null
): Promise<CapabilityResult> {
  const stages = await BusinessLoopRepository.listStages(loop.id);
  const jsaStage = stages.find((s) => s.stageNo === 2);
  const planStage = stages.find((s) => s.stageNo === 4);
  const lotoStage = stages.find((s) => s.stageNo === 3);
  const jsa = jsaStage?.aiPrefill?.assessment || null;
  const plan = planStage?.aiPrefill?.plan || null;
  const lotoItems: any[] = lotoStage?.aiPrefill?.lotoItems || [];

  const cacheInput = { loopId: loop.id, equipmentId: eq?.id || "", orderNo: order?.orderNo || "" };
  const cached = aiCacheGet("generate-report", cacheInput);
  if (cached?.value?.report) {
    return { outcome: "cache", body: { report: cached.value.report, fromCache: true, cachedAt: cached.cachedAt, model: "cache" } };
  }

  const prompts = `请基于以下本次闭环的真实记录，生成一份闭环质检评估报告（仅结果汇总，不落库）。
【业务目标】${loop.goal}
【设备与遥测】${eq ? `${eq.name}（${eq.code}），健康分 ${eq.healthScore ?? "未知"}` : "未识别设备，无遥测上下文"}
【关联工单】${order ? `${order.orderNo}《${order.title}》当前状态 ${order.status}` : "未落库工单"}
【JSA 结果】${jsa?.riskLevel ? `风险等级 ${jsa.riskLevel}：${jsa.riskReason || "无理由输出"}` : "环节 2 预填失败或缺失"}
【LOTO 确认】${lotoItems.filter((i) => i.confirmed).length}/${lotoItems.length} 项已确认
【检修方案】${plan?.overview || "环节 4 预填失败或缺失"}

严格按如下 JSON 结构输出:
{
  "conclusion": "一句话质检结论",
  "qualityScore": 0,
  "checks": [{"item": "检查项", "result": "结果", "standard": "对照标准"}],
  "problems": ["遗留问题或建议1"]
}`;

  try {
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, prompts);
    if (!data?.conclusion) {
      return { outcome: "degraded", errorMessage: "AI 返回缺少质检结论字段", body: { success: false, degraded: true, message: "质检报告 AI 生成失败，请人工出具质量结论" } };
    }
    aiCacheSet("generate-report", cacheInput, { report: data });
    return { outcome: "success", body: { report: data, model: DASHSCOPE_CHAT_MODEL } };
  } catch (err: any) {
    return {
      outcome: err instanceof AiUnavailableError ? "unavailable" : "failed",
      errorMessage: err?.message || String(err),
      body: { success: false, degraded: true, message: `质检报告 AI 生成失败（${String(err?.message || err).slice(0, 120)}），请人工出具质量结论` },
    };
  }
}

// ==================== 知识沉淀核心（suggest-contribution 同源判定 + 贡献表真实落库） ====================

const SUGGEST_CONTRIBUTION_SYSTEM = `你是一位拥有20年工业重型设备检修经验的知识管理员。判断下面这段检修过程是否包含一个"完整、可复用、现场验证过"的故障处理案例。
判定标准（全部满足才算）：①有明确设备（名称/位号）②有具体故障现象 ③有可操作的根因或解决方案 ④不是纯闲聊或纯理论。
严格输出 JSON（禁止输出 JSON 以外的任何文字）：
{"worthContributing":true/false,"title":"建议的案例标题","type":"故障案例|点检异常|检修技巧|安全规程","equipment":"设备名称","summary":"一句话摘要","solution":"核心解决方案要点"}
worthContributing=false 时其他字段全部为空字符串。`;

export async function runSuggestContributionCore(
  loopId: string,
  loop: any,
  eq: Equipment | null,
  order: any | null,
  report: any | null,
  user: any
): Promise<any> {
  const summaryCtx = [
    `业务目标：${loop.goal}`,
    `设备：${eq ? `${eq.name}（${eq.code}）` : "未识别"}`,
    `关联工单：${order ? `${order.orderNo}《${order.title}》状态 ${order.status}` : "无"}`,
    `检修方案概述：${order?.repairLog?.resolutionSteps || ""}`,
    `质检结论：${report?.conclusion || "无（AI 生成失败）"}`,
    `遗留问题：${(report?.problems || []).slice(0, 3).join("；")}`,
  ].join("\n");

  try {
    const { data } = await callDashScopeJson(SUGGEST_CONTRIBUTION_SYSTEM, summaryCtx, 0.2);
    const parsed = data?.worthContributing === undefined ? null : data;
    const suggestion = parsed
      ? {
          worthContributing: Boolean(parsed.worthContributing),
          title: String(parsed.title || "").trim(),
          type: String(parsed.type || "故障案例").trim(),
          equipment: String(parsed.equipment || eq?.name || "").trim(),
          summary: String(parsed.summary || "").trim(),
          solution: String(parsed.solution || "").trim(),
        }
      : null;

    if (suggestion?.worthContributing) {
      try {
        const db = await getDb();
        const id = `kc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await db.query(
          `INSERT INTO ai_knowledge_contributions (id, chat_id, title, type, equipment, summary, solution, contributor, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
          [
            id,
            `business-loop:${loopId}`,
            suggestion.title || "工业检修排查案例",
            suggestion.type || "故障案例",
            suggestion.equipment || "通用设备",
            suggestion.summary || "",
            suggestion.solution || "",
            user?.name || "业务管家",
          ]
        );
        return { ...suggestion, id };
      } catch (dbErr: any) {
        logger.error("[BusinessLoop] 知识贡献落库失败:", dbErr?.message || dbErr);
        return { ...suggestion, message: "贡献建议落库失败（AI 判定结论未入库，需人工在知识库提交）" };
      }
    }
    return suggestion || {
      worthContributing: false,
      message: "AI 未输出有效沉淀判定或返回结构异常（degraded）",
    };
  } catch (err: any) {
    return {
      worthContributing: false,
      message: `知识沉淀判定 AI 调用失败（${String(err?.message || err).slice(0, 100)}），未入库`,
    };
  }
}
