// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。（因 aiGenerationController 按单文件 ≤400 行约束拆分，健康预测/报告/风险评估三个子域独立成模块）
import { callDashScopeJson, handleAiRouteError } from "../services/aiClient.ts";
import { addAuditLog } from "../services/auditService.ts";
import { AI_EXPERT_SYSTEM } from "../services/aiExpert.ts";
import { findRelevantKnowledge } from "../services/knowledgeRetrieval.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { healthForecastSchema, generateReportSchema, safetyRiskAssessmentSchema } from "../schemas/ai.ts";
import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { EquipmentRepository, WorkOrderRepository, TelemetryRepository, InspectionRepository, SafetyPermitRepository } from "../../db/repositories/index.ts";
import { runSafetyRiskAssessmentCore } from "../services/aiCapabilityService.ts";
import { createPendingAiReview } from "../services/aiReviewService.ts";

// ---------- 功能 4：设备健康趋势预测 ----------
export const handleHealthForecast = async (req: any, res: any) => {
  try {
    const { equipmentId, hours = 168 } = req.body;
    const eq = await EquipmentRepository.getById(equipmentId);
    if (!eq) {
      return res.status(404).json({ success: false, error: "设备不存在，请核对 equipmentId" });
    }
    const history = await TelemetryRepository.getHistory(equipmentId, Math.min(hours, 72));
    if (!history.length) {
      return res.status(404).json({ success: false, error: "该设备暂无遥测历史数据，无法进行趋势预测" });
    }

    const metrics = ["temperature", "vibration", "current", "pressure", "loadRate", "rpm"];
    const metricNames: Record<string, string> = {
      temperature: "轴承温度(°C)",
      vibration: "振动速度(mm/s)",
      current: "运行电流(A)",
      pressure: "系统压力(MPa)",
      loadRate: "负载率(%)",
      rpm: "运转转速(r/min)",
    };
    const stats: any = {};
    for (const m of metrics) {
      const series = history.map((h: any) => Number(h[m] || 0));
      const n = series.length;
      const mean = series.reduce((a: number, b: number) => a + b, 0) / n;
      const max = Math.max(...series);
      const min = Math.min(...series);
      // 简单线性回归斜率 (每小时变化量)
      const xMean = (n - 1) / 2;
      const numerator = series.reduce((acc: number, y: number, x: number) => acc + (x - xMean) * (y - mean), 0);
      const denominator = series.reduce((acc: number, _y: number, x: number) => acc + (x - xMean) ** 2, 0) || 1;
      const slope = numerator / denominator;
      const variance = series.reduce((acc: number, y: number) => acc + (y - mean) ** 2, 0) / n;
      const stdDev = Math.sqrt(variance);
      stats[m] = {
        mean: Number(mean.toFixed(2)),
        max: Number(max.toFixed(2)),
        min: Number(min.toFixed(2)),
        slopePerHour: Number(slope.toFixed(4)),
        volatility: Number(stdDev.toFixed(3)),
        exceedCount:
          m === "temperature"
            ? series.filter((v: number) => v > 75).length
            : m === "vibration"
            ? series.filter((v: number) => v > 4.5).length
            : m === "pressure"
            ? series.filter((v: number) => v > 2.5).length
            : m === "loadRate"
            ? series.filter((v: number) => v > 85).length
            : m === "current"
            ? series.filter((v: number) => v > 90).length
            : m === "rpm"
            ? series.filter((v: number) => v > 3000).length
            : 0,
      };
    }

    const userPrompt = `请基于以下设备遥测统计特征，研判设备劣化趋势并预测风险。
【设备档案】${eq.name} (${eq.code}) | 类别: ${eq.category} | 当前健康分: ${eq.healthScore} | 当前状态: ${eq.status}
【最近 ${history.length} 小时遥测统计】
${metrics.map((m: string) => `- ${metricNames[m]}: 均值 ${stats[m].mean}, 峰值 ${stats[m].max}, 谷值 ${stats[m].min}, 每小时趋势斜率 ${stats[m].slopePerHour}, 波动率(标准差) ${stats[m].volatility}${stats[m].exceedCount ? `, 越限次数 ${stats[m].exceedCount}` : ""}`).join("\n")}
【参考阈值】温度警戒 75°C / 振动警戒 4.5 mm/s (ISO 10816-3) / 系统压力警戒 2.5 MPa / 负载率警戒 85%

严格按如下 JSON 结构输出:
{
  "healthRating": "正常|关注|警告|危险 之一",
  "ratingReason": "评级理由",
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
      detail: `AI 健康趋势预测 (${eq.name}): 评级 ${data.healthRating}`,
      status: "SUCCESS",
      metadata: { equipmentId, dataPoints: history.length, healthRating: data.healthRating, model: DASHSCOPE_CHAT_MODEL },
    });
    const __body = { success: true, forecast: data, statistics: stats, dataPoints: history.length, model: DASHSCOPE_CHAT_MODEL };
    aiCacheSet("health-forecast", req.body, __body, { equipmentId: equipmentId });
    res.json(__body);
  } catch (err: any) {
    // 规则引擎降级：基于遥测统计特征直接判定（200 + degraded 标记）
    return handleAiRouteError(res, err, "AI_HEALTH_FORECAST", req, async () => {
      const history = await TelemetryRepository.getHistory(req.body.equipmentId, 72);
      if (!history.length) {
        return { success: false, degraded: true, message: "该设备暂无遥测历史数据，无法进行趋势预测" };
      }
      const metrics = ["temperature", "vibration", "current", "pressure", "loadRate", "rpm"];
      var metricNames: Record<string, string> = {
        temperature: "轴承温度(°C)",
        vibration: "振动速度(mm/s)",
        current: "运行电流(A)",
        pressure: "系统压力(MPa)",
        loadRate: "负载率(%)",
        rpm: "运转转速(r/min)",
      };
      var stats: any = {};
      for (var mi = 0; mi < metrics.length; mi++) {
        var m = metrics[mi];
        var series = history.map(function (h: any) { return Number(h[m] || 0); });
        var n = series.length;
        var mean = series.reduce(function (a: number, b: number) { return a + b; }, 0) / n;
        var xMean = (n - 1) / 2;
        var numerator = series.reduce(function (acc: number, y: number, x: number) { return acc + (x - xMean) * (y - mean); }, 0);
        var denominator = series.reduce(function (acc: number, _y: number, x: number) { return acc + (x - xMean) * (x - xMean); }, 0) || 1;
        var slope = numerator / denominator;
        stats[m] = {
          mean: Number(mean.toFixed(2)), max: Number(Math.max.apply(null, series).toFixed(2)),
          slopePerHour: Number(slope.toFixed(4)),
          exceedCount:
            m === "temperature"
              ? series.filter(function (v: number) { return v > 75; }).length
              : m === "vibration"
              ? series.filter(function (v: number) { return v > 4.5; }).length
              : m === "pressure"
              ? series.filter(function (v: number) { return v > 2.5; }).length
              : m === "loadRate"
              ? series.filter(function (v: number) { return v > 85; }).length
              : m === "current"
              ? series.filter(function (v: number) { return v > 90; }).length
              : m === "rpm"
              ? series.filter(function (v: number) { return v > 3000; }).length
              : 0,
        };
      }
      var tempAlert = stats.temperature.exceedCount > 0 || stats.temperature.max > 75;
      var vibAlert = stats.vibration.exceedCount > 0 || stats.vibration.max > 4.5;
      var healthRating = tempAlert && vibAlert ? "危险" : tempAlert || vibAlert ? "警告" : "正常";
      var dir = function (v: number) { return v > 0.01 ? "上升" : v < -0.01 ? "下降" : "平稳"; };
      var mk = function (key: string, unit: string) {
        return {
          metric: metricNames[key], direction: dir(stats[key].slopePerHour),
          rateDescription: `每小时变化 ${stats[key].slopePerHour} ${unit}`,
          description: `均值 ${stats[key].mean}${unit}，峰值 ${stats[key].max}${unit}`,
        };
      };
      var failureRisks: any[] = [];
      if (tempAlert) failureRisks.push({ mode: "轴承过热 / 润滑失效", basis: "温度越限且趋势上升" });
      if (vibAlert) failureRisks.push({ mode: "转子不平衡 / 对中不良", basis: "振动越限" });
      return {
        success: true, degraded: true,
        message: "AI 服务暂不可用，已返回规则引擎结果",
        forecast: {
          healthRating: healthRating,
          ratingReason: `温度越限 ${stats.temperature.exceedCount} 次、振动越限 ${stats.vibration.exceedCount} 次、压力越限 ${stats.pressure.exceedCount} 次（最近 ${history.length} 小时）`,
          trends: [
            mk("temperature", "°C"),
            mk("vibration", "mm/s"),
            mk("current", "A"),
            mk("pressure", "MPa"),
            mk("loadRate", "%"),
            mk("rpm", "r/min"),
          ],
          failureRisks: failureRisks.length ? failureRisks : [{ mode: "无显著故障模式", basis: "各指标均在受控范围内" }],
          watchWindowHours: 72,
          watchWindowNote: "建议未来 72 小时内加密巡检频次",
          recommendations: [healthRating === "正常" ? "维持现有巡检周期" : "加强巡检并安排检修窗口评估"],
        },
        statistics: stats,
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
      mttrHours: workHours.length ? Number((workHours.reduce((a: number, b: number) => a + b, 0) / workHours.length).toFixed(2)) : 0,
      faultTypeTop: Object.entries(
        orders.reduce((acc: Record<string, number>, w: any) => {
          acc[w.faultType] = (acc[w.faultType] || 0) + 1;
          return acc;
        }, {})
      ).sort((a: any, b: any) => (b[1] as number) - (a[1] as number)).slice(0, 3).map(([type, count]) => `${type}(${count})`),
    };

    const equipments = await EquipmentRepository.getAll(workshop ? { workshop } : undefined);
    const equipmentStats = {
      total: equipments.length,
      running: equipments.filter((e: any) => e.status === "running").length,
      warning: equipments.filter((e: any) => e.status === "warning").length,
      fault: equipments.filter((e: any) => e.status === "fault" || e.status === "overhauling").length,
      avgHealth: Math.round(equipments.reduce((s: number, e: any) => s + (e.healthScore || 0), 0) / (equipments.length || 1)),
      worst: [...equipments].sort((a: any, b: any) => (a.healthScore || 0) - (b.healthScore || 0)).slice(0, 3).map((e: any) => `${e.name}(${e.healthScore}分)`),
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
    if (result.outcome === "cache") {
      return res.json(result.body);
    }
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
      return res.json({ ...result.body, reviewId });
    }
    if (result.outcome === "unavailable") {
      addAuditLog(req, {
        actionType: "AI_SAFETY_RISK_ASSESSMENT",
        module: "ai",
        detail: `AI 功能降级 (未配置密钥): ${result.errorMessage}`,
        status: "FAILED",
        metadata: { degraded: true },
      });
      return res.status(200).json(result.body);
    }
    // failed：无规则降级，返回统一失败响应
    addAuditLog(req, {
      actionType: "AI_SAFETY_RISK_ASSESSMENT",
      module: "ai",
      detail: `AI 调用失败: ${result.errorMessage}`,
      status: "FAILED",
      metadata: { error: String(result.errorMessage).slice(0, 200) },
    });
    return res.status(200).json(result.body);
  } catch (err: any) {
    handleAiRouteError(res, err, "AI_SAFETY_RISK_ASSESSMENT", req);
  }
};
