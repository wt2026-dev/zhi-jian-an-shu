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

// ---------- 功能 5：智能报告生成 (巡检 / 检修 / 月度) ----------
export const handleGenerateReport = async (req: any, res: any) => {
  try {
    const { reportType, startDate, endDate, workshop } = req.body;
    const inRange = (dateStr?: string | null) => {
      if (!dateStr) return false;
      const d = new Date(String(dateStr).replace(/-/g, "/"));
      if (isNaN(d.getTime())) return false;
      return d >= new Date(`${startDate}T00:00:00`) && d <= new Date(`${endDate}T23:59:59`);
    };

    const inspections = (await InspectionRepository.getAll(workshop ? { workshop } : undefined)).filter((t: any) => inRange(t.scheduledDate));
    const inspectionStats = {
      total: inspections.length,
      completed: inspections.filter((t: any) => t.status === "completed").length,
      inProgress: inspections.filter((t: any) => t.status === "in_progress").length,
      pending: inspections.filter((t: any) => t.status === "pending").length,
      abnormalTotal: inspections.reduce((s: number, t: any) => s + (t.abnormalCount || 0), 0),
      pointsTotal: inspections.reduce((s: number, t: any) => s + (t.totalPoints || 0), 0),
      pointsCompleted: inspections.reduce((s: number, t: any) => s + (t.completedPoints || 0), 0),
    };

    const orders = (await WorkOrderRepository.getAll(workshop ? { workshop } : undefined)).filter((w: any) => inRange(w.createdAt));
    const completedOrders = orders.filter((w: any) => w.status === "completed");
    const workHours = completedOrders.map((w: any) => Number(w.repairLog?.workHours) || 0).filter((h: number) => h > 0);
    const orderStats = {
      total: orders.length,
      completed: completedOrders.length,
      created: orders.filter((w: any) => w.status === "created").length,
      inProgress: orders.filter((w: any) => w.status === "in_progress").length,
      urgent: orders.filter((w: any) => w.priority === "urgent").length,
      // 没有工时记录 ⇒ null（"未采集"），不是 0 小时
      mttrHours: workHours.length ? Number((workHours.reduce((a: number, b: number) => a + b, 0) / workHours.length).toFixed(2)) : null,
      faultTypeTop: Object.entries(
        orders.reduce((acc: Record<string, number>, w: any) => {
          acc[w.faultType] = (acc[w.faultType] || 0) + 1;
          return acc;
        }, {})
      ).sort((a: any, b: any) => (b[1] as number) - (a[1] as number)).slice(0, 3).map(([type, count]) => `${type}(${count})`),
    };

    // ⚠️ 这一段会原样进 AI 提示词，模型会照着数字写结论。所以：
    // - `healthScore || 0` 会把"未评估"算成 0 分，把一台从未体检的设备拉成重度故障；
    // - MTTR 在没有任何工时记录时不能写 0 小时（那是"秒修"，比缺失更误导）。
    // 缺测一律写 null，并在提示词里明确"该项未采集"，让模型陈述缺失而不是编一个小数字。
    const equipments = await EquipmentRepository.getAll(workshop ? { workshop } : undefined);
    const scoredEquipments = equipments.filter((e: any) => typeof e.healthScore === "number");
    const equipmentStats = {
      total: equipments.length,
      running: equipments.filter((e: any) => e.status === "running").length,
      warning: equipments.filter((e: any) => e.status === "warning").length,
      fault: equipments.filter((e: any) => e.status === "fault" || e.status === "overhauling").length,
      avgHealth: scoredEquipments.length
        ? Math.round(scoredEquipments.reduce((s: number, e: any) => s + e.healthScore, 0) / scoredEquipments.length)
        : null,
      /** 未评估设备数：让模型知道 avgHealth 的分母只有这么多台 */
      healthUnscored: equipments.length - scoredEquipments.length,
      worst: [...scoredEquipments]
        .sort((a: any, b: any) => a.healthScore - b.healthScore)
        .slice(0, 3)
        .map((e: any) => `${e.name}(${scoreOrUnscored(e.healthScore, { withUnit: false })}分)`),
    };

    const permits = (await SafetyPermitRepository.getAll(workshop ? { workshop } : undefined)).filter((p: any) => inRange(p.appliedAt));
    const permitStats = {
      total: permits.length,
      approved: permits.filter((p: any) => p.status === "approved" || p.status === "active").length,
      closed: permits.filter((p: any) => p.status === "closed").length,
      pending: permits.filter((p: any) => p.status === "pending_approval").length,
    };

    const typeLabel = reportType === "inspection" ? "巡检报告" : reportType === "maintenance" ? "检修报告" : "月度设备运行报告";
    const userPrompt = `请基于以下 ${startDate} 至 ${endDate} 的真实统计数据，编制一份专业的工业${typeLabel}。
【巡检统计】${JSON.stringify(inspectionStats)}
【工单统计】${JSON.stringify(orderStats)}
【设备健康分布】${JSON.stringify(equipmentStats)}
【作业票统计】${JSON.stringify(permitStats)}

数据口径（必须遵守，不得自行补值）:
- 字段值为 null 表示**该项未采集**（例如 avgHealth 为 null = 区间内没有任何设备做过健康评估，
  mttrHours 为 null = 没记录过维修工时）。此时请在报告中写「未采集/暂无数据」，**禁止**当成 0 或
  自行估算一个数字；也不要用 null 反推"设备状况极差"这类结论。
- avgHealth 只覆盖有评估记录的设备，覆盖台数见 healthUnscored（未评估台数），写均值时请一并说明覆盖范围。

严格按如下 JSON 结构输出:
{
  "summary": "概览摘要 (关键指标+亮点+问题, 150字内)",
  "highlights": ["工作亮点1"],
  "problems": ["存在问题1"],
  "statistics": [{"label": "指标名", "value": "指标值"}],
  "topIssues": [{"title": "重点问题 (设备/故障类型)", "count": 3, "analysis": "问题分析"}],
  "suggestions": ["改进建议1"],
  "markdown": "完整的 markdown 格式报告正文 (含标题/小节/表格), 800字内"
}`;

    const __cached = aiCacheGet("generate-report", req.body);
    if (__cached) {
      return res.json(Object.assign({}, __cached.value, { fromCache: true, cachedAt: __cached.cachedAt, model: "cache" }));
    }
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt, 0.4);
    addAuditLog(req, {
      actionType: "AI_GENERATE_REPORT",
      module: "ai",
      detail: `AI 生成${typeLabel} (${startDate} ~ ${endDate}${workshop ? `, ${workshop}` : ""})`,
      status: "SUCCESS",
      metadata: { reportType, startDate, endDate, workshop, model: DASHSCOPE_CHAT_MODEL },
    });
    const __body = {
      success: true,
      report: data,
      meta: { reportType, reportTypeLabel: typeLabel, startDate, endDate, workshop: workshop || "全部车间" },
      model: DASHSCOPE_CHAT_MODEL,
    };
    aiCacheSet("generate-report", req.body, __body);
    // AI 生成内容审核台：报告类 AI 生成同样登记待审核（报告无知识库检索，knowledge_sources 如实为空）
    const reviewId = await createPendingAiReview({
      aiEndpoint: "/api/v1/ai/generate-report",
      sourceType: "report",
      content: data,
      knowledgeSources: [],
    });
    res.json({ ...__body, reviewId });
  } catch (err: any) {
    handleAiRouteError(res, err, "AI_GENERATE_REPORT", req);
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
