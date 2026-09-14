// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { callDashScopeJson, handleAiRouteError } from "../services/aiClient.ts";
import { addAuditLog } from "../services/auditService.ts";
import { AI_EXPERT_SYSTEM } from "../services/aiExpert.ts";
import { findRelevantKnowledge } from "../services/knowledgeRetrieval.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { generateWorkOrderAiSchema, rootCauseAnalysisSchema, generateMaintenancePlanSchema } from "../schemas/ai.ts";
import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { EquipmentRepository, WorkOrderRepository } from "../../db/repositories/index.ts";
import { runMaintenancePlanCore, runFaultDiagnosisCore } from "../services/aiCapabilityService.ts";
import { createPendingAiReview } from "../services/aiReviewService.ts";

// ---------- 功能 1：智能工单生成 ----------
export const handleGenerateWorkOrder = async (req: any, res: any) => {
  try {
    const { equipmentId, abnormalDescription, telemetrySnapshot } = req.body;
    const eq = await EquipmentRepository.getById(equipmentId);
    if (!eq) {
      return res.status(404).json({ success: false, error: "设备不存在，请核对 equipmentId" });
    }
    const historyOrders = (await WorkOrderRepository.getAll({ equipmentId })).slice(0, 5);
    const historyCtx = historyOrders
      .map((w: any) => `- [${w.orderNo}] ${w.title} (状态:${w.status}/故障类型:${w.faultType}/处置结论:${w.repairLog?.causeAnalysis || "无"})`)
      .join("\n") || "无";

    const userPrompt = `请依据以下现场信息，为设备生成一张可直接执行的检修工单草稿。
【设备档案】名称: ${eq.name} | 编码: ${eq.code} | 类别: ${eq.category} | 型号: ${eq.model || "未知"} | 车间: ${eq.workshop} | 健康分: ${eq.healthScore}
【异常描述】${abnormalDescription}
【遥测快照】${JSON.stringify(telemetrySnapshot || eq.telemetry)}
【该设备历史工单】
${historyCtx}

严格按如下 JSON 结构输出:
{
  "title": "简洁专业的工单标题 (30字内)",
  "description": "详细故障描述 (含现象/影响/初步判断, 150字内)",
  "priority": "urgent|high|medium|low 之一",
  "priorityReason": "优先级评定理由",
  "suggestedSteps": ["检修步骤1", "步骤2", "步骤3 (3-6步)"],
  "spareParts": [{"name": "备件名称", "spec": "规格型号", "qty": 1}],
  "estimatedHours": 3.5
}`;

    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    addAuditLog(req, {
      actionType: "AI_GENERATE_WORK_ORDER",
      module: "ai",
      detail: `AI 生成检修工单草稿「${data.title}」(设备: ${eq.name})`,
      status: "SUCCESS",
      metadata: { equipmentId, priority: data.priority, model: DASHSCOPE_CHAT_MODEL },
    });
    res.json({
      success: true,
      draft: data,
      equipment: { id: eq.id, name: eq.name, code: eq.code, workshop: eq.workshop },
      model: DASHSCOPE_CHAT_MODEL,
    });
  } catch (err: any) {
    handleAiRouteError(res, err, "AI_GENERATE_WORK_ORDER", req);
  }
};

// ---------- 功能 2：根因分析 (RCA / 5Why / 故障树) ----------
export const handleRootCauseAnalysis = async (req: any, res: any) => {
  try {
    const { workOrderId, equipmentId, faultDescription } = req.body;
    let targetEquipmentId = equipmentId;
    let description = faultDescription || "";
    let orderCtx = "无关联工单";
    let orderNo = "";

    if (workOrderId) {
      const wo = await WorkOrderRepository.getById(workOrderId);
      if (!wo) {
        return res.status(404).json({ success: false, error: "工单不存在，请核对 workOrderId" });
      }
      targetEquipmentId = wo.equipmentId;
      description = faultDescription || wo.description || wo.title;
      orderNo = wo.orderNo;
      orderCtx = `工单 ${wo.orderNo}「${wo.title}」故障类型: ${wo.faultType}, 状态: ${wo.status}, 维修记录: ${
        wo.repairLog ? `原因分析: ${wo.repairLog.causeAnalysis || "无"}; 处理步骤: ${wo.repairLog.resolutionSteps || "无"}` : "未填报"
      }`;
    }

    if (!targetEquipmentId) {
      return res.status(400).json({ success: false, error: "未能确定关联设备" });
    }
    const eq = await EquipmentRepository.getById(targetEquipmentId);
    const historyOrders = (await WorkOrderRepository.getAll({ equipmentId: targetEquipmentId }))
      .filter((w: any) => w.orderNo !== orderNo)
      .slice(0, 3);
    const historyCtx = historyOrders
      .map((w: any) => `- [${w.orderNo}] ${w.title} (结论:${w.repairLog?.causeAnalysis || "无"})`)
      .join("\n") || "无";
    const kbArticles = await findRelevantKnowledge(
      [eq?.category || "", eq?.name || "", "故障", "故障树", "根因", ...(description || "").slice(0, 40).split(/[，,、\s]+/)].filter(Boolean),
      3
    );
    const kbCtx = kbArticles.map((k: any) => `- 《${k.title}》(${k.category}): ${k.summary}`).join("\n") || "无";

    const userPrompt = `请对以下工业设备故障进行深度根因分析 (RCA)。
【设备档案】${eq ? `${eq.name} (${eq.code}) | 类别: ${eq.category} | 型号: ${eq.model || "未知"} | 车间: ${eq.workshop} | 健康分: ${eq.healthScore}` : "设备档案缺失"}
【关联工单】${orderCtx}
【故障现象描述】${description}
【同设备历史故障】
${historyCtx}
【知识库相关规程】
${kbCtx}

严格按如下 JSON 结构输出:
{
  "summary": "故障现象摘要 (100字内)",
  "fiveWhys": [
    {"level": 1, "question": "为什么会出现该现象?", "reason": "原因", "evidence": "判断依据"},
    "... 共5层递进"
  ],
  "rootCauses": [
    {"type": "直接原因", "cause": "...", "probability": "72%", "evidence": "..."},
    {"type": "间接原因", "cause": "...", "probability": "...", "evidence": "..."},
    {"type": "根本原因", "cause": "...", "probability": "...", "evidence": "..."}
  ],
  "correctiveActions": { "shortTerm": ["短期遏制措施1", "..."], "longTerm": ["长期预防措施1", "..."] },
  "references": ["引用的知识库文章标题1", "..."]
}`;

    const __cached = aiCacheGet("root-cause-analysis", req.body);
    if (__cached) {
      return res.json(Object.assign({}, __cached.value, { fromCache: true, cachedAt: __cached.cachedAt, model: "cache" }));
    }
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    addAuditLog(req, {
      actionType: "AI_ROOT_CAUSE_ANALYSIS",
      module: "ai",
      detail: `AI 根因分析完成 (${orderNo || eq?.name || equipmentId})，根本原因: ${data.rootCauses?.find((r: any) => r.type === "根本原因")?.cause || "N/A"}`,
      status: "SUCCESS",
      metadata: { workOrderId, equipmentId, model: DASHSCOPE_CHAT_MODEL },
    });
    const __body = { success: true, analysis: data, model: DASHSCOPE_CHAT_MODEL };
    aiCacheSet("root-cause-analysis", req.body, __body, { equipmentId: equipmentId });
    res.json(__body);
  } catch (err: any) {
    // 规则引擎降级：基于故障类型映射 + 历史维修记录生成简化 RCA（200 + degraded 标记）
    return handleAiRouteError(res, err, "AI_ROOT_CAUSE_ANALYSIS", req, async () => {
      var eqId2 = req.body.equipmentId || "";
      var eq2 = eqId2 ? await EquipmentRepository.getById(eqId2) : null;
      var desc2 = req.body.faultDescription || "";
      var historyOrders = eqId2 ? (await WorkOrderRepository.getAll({ equipmentId: eqId2 })).filter(function (w: any) { return !req.body.workOrderId || w.id !== req.body.workOrderId; }).slice(0, 3) : [];
      var kbArticles = await findRelevantKnowledge([eq2?.category || "", "故障", "故障树", "根因"], 3);
      var faultMap: Record<string, string[]> = {
        "机械振动": ["轴承磨损或润滑不良", "联轴器对中偏差超标", "转子不平衡或地脚松动"],
        "轴承过热": ["润滑脂过期或不足", "轴承游隙不当或预紧过大", "冷却/散热条件恶化"],
        "电气短路": ["接线端子松动或氧化", "绝缘老化受潮", "过载引起绕组损伤"],
        "密封泄漏": ["机械密封磨损", "安装同轴度超差", "冲洗管路堵塞"],
        "结构磨损": ["齿面点蚀或胶合", "润滑不良导致的异常磨耗", "材质疲劳"],
      };
      var key = Object.keys(faultMap).find(function (k) { return (desc2 || "").indexOf(k) >= 0; }) || "机械振动";
      var causes = faultMap[key] || ["需现场进一步排查确认"];
      var hist = historyOrders.filter(function (w: any) { return w.repairLog; }).slice(0, 2);
      return {
        success: true, degraded: true,
        message: "AI 服务暂不可用，已返回规则引擎结果",
        analysis: {
          summary: (desc2 || "").slice(0, 90) || "故障现象摘要缺失",
          fiveWhys: [
            { level: 1, question: "为什么出现该故障现象？", reason: causes[0], evidence: "现场描述与遥测特征" },
            { level: 2, question: "为什么会产生该直接原因？", reason: causes[1] || "需进一步检查", evidence: "同类设备经验规则" },
            { level: 3, question: "为什么未提前发现？", reason: hist.length ? "历史维修记录提示的隐患未闭环" : "预防性维护覆盖不足", evidence: "近期工单/巡检记录" },
          ],
          rootCauses: [
            { type: "直接原因", cause: causes[0], probability: "参考", evidence: "故障现象映射" },
            { type: "间接原因", cause: causes[1] || "维护保养不到位", probability: "参考", evidence: "设备类别经验规则" },
            { type: "根本原因", cause: hist.length ? "历史同类隐患未彻底闭环" : "预防性维护策略待完善", probability: "参考", evidence: "近 3 条历史工单记录" },
          ],
          correctiveActions: {
            shortTerm: ["立即执行 LOTO 停电挂牌并隔离设备", "按检修 SOP 组织现场检查与备件更换"],
            longTerm: ["将该故障模式纳入预防性维护计划", "完善点检标准与监测阈值"],
          },
          references: (kbArticles || []).map(function (k: any) { return k.title; }).slice(0, 3),
        },
      };
    });
  }
};

// ---------- 功能 3：检修方案 / 作业指导书生成 ----------
export const handleGenerateMaintenancePlan = async (req: any, res: any) => {
  try {
    const { equipmentId, faultDescription, workOrderId } = req.body;
    const eq = await EquipmentRepository.getById(equipmentId);
    if (!eq) {
      return res.status(404).json({ success: false, error: "设备不存在，请核对 equipmentId" });
    }
    // 核心逻辑抽取至 services/aiCapabilityService.runMaintenancePlanCore，此处保留缓存命中外的审计与 HTTP 语义
    const result = await runMaintenancePlanCore({ equipmentId, faultDescription, workOrderId });
    if (result.outcome === "cache") {
      return res.json(result.body);
    }
    if (result.outcome === "success") {
      addAuditLog(req, {
        actionType: "AI_GENERATE_MAINTENANCE_PLAN",
        module: "ai",
        detail: `AI 生成检修方案 (${eq.name})，共 ${result.body.plan?.steps?.length || 0} 个步骤`,
        status: "SUCCESS",
        metadata: { equipmentId, workOrderId, model: DASHSCOPE_CHAT_MODEL },
      });
      // AI 生成内容审核台：登记待审核记录并在响应附加 reviewId（不改变原响应字段）
      const reviewId = await createPendingAiReview({
        aiEndpoint: "/api/v1/ai/generate-maintenance-plan",
        sourceType: "maintenance_plan",
        content: result.body.plan,
        knowledgeSources: result.knowledgeSources,
      });
      return res.json({ ...result.body, reviewId });
    }
    if (result.outcome === "unavailable") {
      addAuditLog(req, {
        actionType: "AI_GENERATE_MAINTENANCE_PLAN",
        module: "ai",
        detail: `AI 功能降级 (未配置密钥): ${result.errorMessage}`,
        status: "FAILED",
        metadata: { degraded: true },
      });
      return res.status(200).json(result.body);
    }
    // degraded：规则引擎降级结果
    addAuditLog(req, {
      actionType: "AI_GENERATE_MAINTENANCE_PLAN",
      module: "ai",
      detail: `AI 调用失败: ${result.errorMessage}`,
      status: "FAILED",
      metadata: { error: String(result.errorMessage).slice(0, 200) },
    });
    return res.status(200).json(result.body);
  } catch (err: any) {
    return handleAiRouteError(res, err, "AI_GENERATE_MAINTENANCE_PLAN", req);
  }
};

// ---------- 功能：智能故障诊断向导 (Fault Diagnosis Wizard, /api/v1/ai/diagnose) ----------
export const handleAiDiagnose = async (req: any, res: any) => {
  try {
    const { equipmentName, equipmentCode, category, symptoms, telemetry, errorCodes } = req.body;
    const result = await runFaultDiagnosisCore({ equipmentName, equipmentCode, category, symptoms, telemetry, errorCodes });
    addAuditLog(req, {
      actionType: "AI_DIAGNOSE",
      module: "ai",
      detail: `AI 故障诊断完成 (${equipmentName || equipmentCode || "未指定设备"})，结论: ${result.body?.diagnosis?.summary || "无"}`,
      status: result.body?.success ? "SUCCESS" : "FAILED",
      metadata: { equipmentName, equipmentCode, outcome: result.outcome },
    });
    return res.json(result.body);
  } catch (error: any) {
    console.error("Diagnose error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
