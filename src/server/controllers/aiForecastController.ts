// 重构说明：本模块自 server.ts 拆出。（因 aiGenerationController 按单文件 ≤400 行约束拆分，劣化趋势/报告/风险评估三个子域独立成模块）
// 劣化趋势的统计口径不在本文件里算，统一走 services/degradationTrend.ts（正常路径与降级路径共用一个引擎）。
import { callDashScopeJson, handleAiRouteError } from "../services/aiClient.ts";
import { addAuditLog } from "../services/auditService.ts";
import { AI_EXPERT_SYSTEM } from "../services/aiExpert.ts";
import { findRelevantKnowledge } from "../services/knowledgeRetrieval.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { scoreOrUnscored } from "../utils/promptValue.ts";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { healthForecastSchema, generateReportSchema, safetyRiskAssessmentSchema } from "../schemas/ai.ts";
import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { EquipmentRepository, WorkOrderRepository, TelemetryRepository, InspectionRepository, SafetyPermitRepository, AiAnalysisLogRepository } from "../../db/repositories/index.ts";
import { runSafetyRiskAssessmentCore } from "../services/aiCapabilityService.ts";
import { createPendingAiReview } from "../services/aiReviewService.ts";
import { detectSafetyNotice, getPromptVersion, createInputDigest, TraceabilityInfo } from "../services/promptVersion.ts";
import { evaluateDegradation, toStatisticsView, trendDigest, ruleBasedForecast } from "../services/degradationTrend.ts";
import { logger } from "../../utils/logger.ts";

// ---------- 功能 4：设备健康劣化趋势预警 ----------
export const handleHealthForecast = async (req: any, res: any) => {
  try {
    const { equipmentId, hours = 168 } = req.body;
    const eq = await EquipmentRepository.getById(equipmentId);
    if (!eq) {
      return res.status(404).json({ success: false, error: "设备不存在，请核对 equipmentId" });
    }
    const history = await TelemetryRepository.getHistory(equipmentId, Math.min(hours, 72));
    if (!history.length) {
      return res.status(404).json({ success: false, error: "该设备暂无遥测历史数据，无法进行劣化趋势分析" });
    }

    const report = evaluateDegradation(history);
    const ruleRating = report.summary.riskLevel;

    const userPrompt = `以下是设备遥测序列的**确定性统计结果**（最小二乘回归 + EWMA 平滑 + R² 置信门限，引擎版本 ${getPromptVersion("health-forecast")}）。
数字已经算好，你**不需要也不允许重新计算或修改任何数值**；你的任务只是在这些事实之上做工业场景解读：判断可能的劣化机理、给出可执行的处置建议。
凡是统计结果标为"不可信"的指标，不得在输出里描述为上升或下降；凡是没有给出"预计 X 小时后触及警戒线"的指标，不得自行编造时间。

【设备档案】${eq.name} (${eq.code}) | 类别: ${eq.category} | 当前健康分: ${scoreOrUnscored(eq.healthScore)} | 当前状态: ${eq.status}
【最近 ${history.length} 小时遥测劣化趋势分析（振动警戒带取 ISO 10816-3 C/D 区界 4.5 mm/s）】
${trendDigest(report)}
【规则引擎评级】${ruleRating}（口径：温度与振动同时越限=危险，任一越限=警告，仅可信上升=关注，其余=正常）

严格按如下 JSON 结构输出（这是对已算好的劣化趋势做**解读与处置建议**，不是对未来的预测）:
{
  "healthRating": "正常|关注|警告|危险 之一，须与规则引擎评级一致",
  "ratingReason": "评级理由，引用上面的具体数值",
  "trends": [{"metric": "指标名", "direction": "上升|下降|平稳", "rateDescription": "变化速率描述", "description": "趋势解读"}],
  "failureRisks": [{"mode": "潜在故障模式", "basis": "判断依据"}],
  "watchWindowHours": 72,
  "watchWindowNote": "建议重点关注的时间窗口说明",
  "recommendations": ["建议措施1 (加强巡检/安排检修/更换备件等)"]
}`;

    const __cached = aiCacheGet("health-forecast", req.body);
    if (__cached) {
      return res.json(Object.assign({}, __cached.value, { fromCache: true, cachedAt: __cached.cachedAt, model: "cache" }));
    }
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    addAuditLog(req, {
      actionType: "AI_HEALTH_FORECAST",
      module: "ai",
      detail: `AI 劣化趋势解读 (${eq.name}): 评级 ${data.healthRating}，规则评级 ${ruleRating}`,
      status: "SUCCESS",
      metadata: { equipmentId, dataPoints: history.length, healthRating: data.healthRating, ruleRating, model: DASHSCOPE_CHAT_MODEL },
    });
    const __body = {
      success: true,
      forecast: data,
      trend: report,
      ruleRating,
      statistics: toStatisticsView(report),
      dataPoints: history.length,
      model: DASHSCOPE_CHAT_MODEL,
    };
    aiCacheSet("health-forecast", req.body, __body, { equipmentId: equipmentId });
    res.json(__body);
  } catch (err: any) {
    // 规则引擎降级：直接返回确定性趋势引擎的研判（200 + degraded 标记，不含任何模型生成内容）
    return handleAiRouteError(res, err, "AI_HEALTH_FORECAST", req, async () => {
      const history = await TelemetryRepository.getHistory(req.body.equipmentId, 72);
      if (!history.length) {
        return { success: false, degraded: true, message: "该设备暂无遥测历史数据，无法进行劣化趋势分析" };
      }
      const report = evaluateDegradation(history);
      return {
        success: true,
        degraded: true,
        message: "AI 服务暂不可用，已返回确定性劣化趋势引擎结果",
        forecast: ruleBasedForecast(report),
        trend: report,
        ruleRating: report.summary.riskLevel,
        statistics: toStatisticsView(report),
        dataPoints: history.length,
      };
    });
  }
};

// ---------- 功能 6：作业票 AI 风险评估 ----------
export const handleSafetyRiskAssessment = async (req: any, res: any) => {
  try {
    const { permitType, equipmentId, workDescription, location, hazards } = req.body;
    // 核心逻辑抽取至 services/aiCapabilityService.runSafetyRiskAssessmentCore，此处保留审计与 HTTP 语义
    const result = await runSafetyRiskAssessmentCore({ permitType, equipmentId, workDescription, location, hazards });
    const isDegraded = result.outcome === "unavailable" || result.outcome === "failed" || !!result.body?.degraded;
    const safetyNotice = detectSafetyNotice({
      input: req.body,
      output: result.body?.assessment,
      degraded: isDegraded,
    });
    const promptVersion = getPromptVersion("safety_risk");
    const inputDigest = createInputDigest({
      permitType,
      equipmentId,
      workDescription,
      location,
      hazards,
    });
    const traceability: TraceabilityInfo = {
      model: result.body?.model || DASHSCOPE_CHAT_MODEL,
      promptVersion,
      inputDigest,
      reviewStatus: result.outcome === "success" ? "pending" : "not_required",
    };

    if (result.outcome === "cache") {
      return res.json({ ...result.body, safetyNotice, traceability });
    }

    // 记录到 ai_analysis_log 追溯表
    AiAnalysisLogRepository.recordAiCall({
      endpoint: "/api/v1/ai/safety-risk-assessment",
      model: traceability.model,
      promptVersion: traceability.promptVersion,
      inputDigest: traceability.inputDigest,
      deviceModel: permitType || "高危作业",
      reviewStatus: traceability.reviewStatus,
      safetyNotice,
      body: result.body,
    }).catch((e) => logger.warn("AiAnalysisLog record error:", e));

    if (result.outcome === "success") {
      addAuditLog(req, {
        actionType: "AI_SAFETY_RISK_ASSESSMENT",
        module: "ai",
        detail: `AI 作业票风险评估 (${permitType}): 风险等级 ${result.body.assessment?.riskLevel}`,
        status: "SUCCESS",
        metadata: { permitType, equipmentId, riskLevel: result.body.assessment?.riskLevel, model: DASHSCOPE_CHAT_MODEL },
      });
      // AI 生成内容审核台：登记待审核记录并在响应附加 reviewId（不改变原响应字段）
      const reviewId = await createPendingAiReview({
        aiEndpoint: "/api/v1/ai/safety-risk-assessment",
        sourceType: "safety_risk",
        content: result.body.assessment,
        knowledgeSources: result.knowledgeSources,
      });
      return res.json({ ...result.body, reviewId, safetyNotice, traceability });
    }
    if (result.outcome === "unavailable") {
      addAuditLog(req, {
        actionType: "AI_SAFETY_RISK_ASSESSMENT",
        module: "ai",
        detail: `AI 功能降级 (未配置密钥): ${result.errorMessage}`,
        status: "FAILED",
        metadata: { degraded: true },
      });
      return res.status(200).json({ ...result.body, safetyNotice, traceability });
    }
    // failed：无规则降级，返回统一失败响应
    addAuditLog(req, {
      actionType: "AI_SAFETY_RISK_ASSESSMENT",
      module: "ai",
      detail: `AI 调用失败: ${result.errorMessage}`,
      status: "FAILED",
      metadata: { error: String(result.errorMessage).slice(0, 200) },
    });
    return res.status(200).json({ ...result.body, safetyNotice, traceability });
  } catch (err: any) {
    handleAiRouteError(res, err, "AI_SAFETY_RISK_ASSESSMENT", req);
  }
};
