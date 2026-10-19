// 重构说明：自 aiForecastController 拆出（单文件 ≤300 行约束）。
// 功能 5：智能报告生成 —— 只做统计聚合 + 提示词编排 + 审计，统计口径见下方注释。
import { callDashScopeJson, handleAiRouteError } from "../services/aiClient.ts";
import { addAuditLog } from "../services/auditService.ts";
import { AI_EXPERT_SYSTEM } from "../services/aiExpert.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { scoreOrUnscored } from "../utils/promptValue.ts";
import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { createPendingAiReview } from "../services/aiReviewService.ts";
import {
  EquipmentRepository,
  WorkOrderRepository,
  InspectionRepository,
  SafetyPermitRepository,
} from "../../db/repositories/index.ts";

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
