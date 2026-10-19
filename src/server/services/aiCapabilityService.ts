// 重构说明：AI 能力核心层——自各 AI 控制器抽取的"提示词构建 + DashScope 调用 + 规则降级"纯逻辑，
// 供原控制器（保持 HTTP 行为不变）与 AI 协同任务编排服务（aiPipelineService）共同复用，避免复制代码。
// 每个核心函数返回统一结果结构：{ outcome, body, message?, errorMessage? }，
// outcome: 'cache'（缓存命中）| 'success'（AI 成功）| 'degraded'（规则引擎降级）| 'unavailable'（未配置密钥）| 'failed'（失败无降级）。
// 审计日志仍由调用方（控制器/编排服务）写入，保持原审计语义。

import { getAiClient, callDashScopeJson, extractAiJson, AiUnavailableError } from "./aiClient.ts";
import { generateFallbackDiagnosis, AI_EXPERT_SYSTEM } from "./aiExpert.ts";
import { findRelevantKnowledge } from "./knowledgeRetrieval.ts";
import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { EquipmentRepository, WorkOrderRepository, SafetyPermitRepository, UserRepository } from "../../db/repositories/index.ts";
import { logger } from "../../utils/logger.ts";

export type CapabilityOutcome = "cache" | "success" | "degraded" | "unavailable" | "failed";

export interface CapabilityResult {
  outcome: CapabilityOutcome;
  body: any;
  /** 底层 AI 失败原因（degraded/failed 时用于审计日志） */
  errorMessage?: string;
  /** 实际检索命中的知识库文章 id 列表（供 AI 生成内容审核台做知识溯源；不进响应体） */
  knowledgeSources?: string[];
}

/** handleAiRouteError 最终兜底响应的等价构造（保持 200 + degraded 语义） */
function failedBody(err: any) {
  return {
    success: false,
    degraded: true,
    message: `AI 服务暂不可用（${String(err?.message || err).slice(0, 120)}），请稍后重试。`,
  };
}

// ==================== 能力 1：智能故障诊断（/api/v1/ai/diagnose 核心逻辑） ====================

export async function runFaultDiagnosisCore(input: {
  equipmentName?: string;
  equipmentCode?: string;
  category?: string;
  symptoms?: string;
  telemetry?: any;
  errorCodes?: string;
}): Promise<CapabilityResult> {
  const { equipmentName, equipmentCode, category, symptoms, telemetry, errorCodes } = input;
  const ai = getAiClient();

  // 口径红线：缺失字段一律标注「未接入/未提供」，严禁编造具体读数或故障现象——
  // 编造的遥测会直接污染真实故障诊断结论（曾出现"无遥测设备被诊断为轴承温度超限"）。
  const fmtTelemetry = (v: any) =>
    typeof v === "number" && Number.isFinite(v) ? v : "未接入";
  const eqNameStr = equipmentName || "未提供设备名称";
  const eqCodeStr = equipmentCode || "未提供设备编码";
  const catStr = category || "未提供设备类型";
  const symStr = symptoms || "未描述现场故障现象";
  const errStr = errorCodes || "无（未提供报警代码）";

  const prompt = `请对以下工业设备进行深度故障诊断分析并返回专业诊断报告：
设备名称: ${eqNameStr} (${eqCodeStr})
设备类型: ${catStr}
现场故障现象/异常征兆: ${symStr}
遥测数据:
- 轴承温度: ${fmtTelemetry(telemetry?.temperature)} °C (正常阈值 < 70°C；标注"未接入"表示该测点无数据)
- 振动速度有效值(RMS): ${fmtTelemetry(telemetry?.vibration)} mm/s (正常阈值 < 4.5 mm/s；标注"未接入"表示该测点无数据)
- 工作电压: ${fmtTelemetry(telemetry?.voltage)} V (标注"未接入"表示该测点无数据)
- 运行电流: ${fmtTelemetry(telemetry?.current)} A (额定值见设备铭牌；标注"未接入"表示该测点无数据)
- 负载率: ${fmtTelemetry(telemetry?.loadRate)} (标注"未接入"表示该测点无数据)
报警代码: ${errStr}

【数据口径与诚实约束】字段标注"未接入"=该项遥测缺失未采集；标注"未提供/未描述"=前端未传入。
你**严禁**在缺失时编造任何温度/振动/电压/电流/负载率读数或具体故障现象。若关键遥测缺失，
请明确写"无法基于遥测判定"，并仅在"现场故障现象"已提供时结合现象给出方向性排查建议，不得虚构诊断结论。

请严格按 JSON 格式返回分析结果，格式如下：
{
  "severity": "严重" | "较高" | "一般" | "轻微",
  "urgencyScore": 85,
  "summary": "简明扼要的一句话诊断结论",
  "probableCauses": [
    { "cause": "可能原因名称", "probability": 85, "detail": "详细机理分析" }
  ],
  "safetyPrecautions": [
    "安全防范要求1", "安全防范要求2"
  ],
  "recommendedActions": [
    { "step": 1, "action": "具体检修排查步骤", "tools": "所需工具/仪器", "standard": "验收标准" }
  ],
  "spareParts": [
    { "name": "备件名称", "spec": "规格型号", "qty": 1, "unit": "套" }
  ],
  "estimatedRepairHours": 3.5
}`;

  if (ai) {
    try {
      const diagnoseSystemPrompt = `你是一位拥有20年工业重型设备（离心泵、压缩机、减速机、大型变频电机、数控机床、工业机器人）检修与故障诊断经验的高级工程师。你的职责是基于现场设备异常与遥测数据进行深度工程机理分析。
你的回答必须遵循以下规则：
1. 诊断结论客观严谨、结构清晰，深入根本机理，步骤具备现场工程可操作性，严禁空泛理论。
2. 涉及危险作业（高压断电、动火、受限空间、登高、吊装、机械卷入）时，在 safetyPrecautions 中必须明确包含【安全警示】并给出严格的 LOTO 能量隔离（停电挂牌上锁验证零能量）与 GB 30871 高危作业防护要点。
3. 关键排查步骤分点编号，备件型号推荐使用标准工业通用规格。
4. 必须严格输出合法 JSON，禁止输出任何 JSON 以外的解释文字或 markdown 标记。`;

      // DashScope qwen-plus 结构化故障诊断 (JSON 输出)
      const response = await ai.chat.completions.create({
        model: DASHSCOPE_CHAT_MODEL,
        messages: [
          {
            role: "system",
            content: diagnoseSystemPrompt,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      });

      const rawText = response.choices?.[0]?.message?.content?.trim() || "{}";
      const parsed = extractAiJson(rawText);
      if (parsed && (parsed.summary || parsed.probableCauses)) {
        return { outcome: "success", body: { success: true, diagnosis: parsed, model: DASHSCOPE_CHAT_MODEL } };
      }
    } catch (aiErr: any) {
      logger.error("DashScope Diagnose Error:", aiErr?.message || aiErr);
    }
  }

  const fallbackDiagnosis = await generateFallbackDiagnosis(equipmentName, symptoms, telemetry);
  return { outcome: "degraded", body: { success: true, degraded: true, diagnosis: fallbackDiagnosis } };
}

// ==================== 能力 2：检修方案生成（原 /api/v1/ai/generate-maintenance-plan 核心逻辑） ====================

export async function runMaintenancePlanCore(input: {
  equipmentId: string;
  faultDescription: string;
  workOrderId?: string;
}): Promise<CapabilityResult> {
  const { equipmentId, faultDescription, workOrderId } = input;
  const eq = await EquipmentRepository.getById(equipmentId);
  if (!eq) {
    // 与原控制器 404 语义对齐；控制器在调用前通常已校验
    return { outcome: "failed", body: { success: false, error: "设备不存在，请核对 equipmentId" } };
  }
  let workOrderCtx = "无关联工单";
  if (workOrderId) {
    const wo = await WorkOrderRepository.getById(workOrderId);
    if (wo) {
      workOrderCtx = `工单 ${wo.orderNo}「${wo.title}」安全要求: ${(wo.safetyRequirements || []).join("; ")}`;
    }
  }
  const sopArticles = await findRelevantKnowledge(["SOP", "规程", eq.category || "", eq.name || "", "检修", "润滑", "对中"], 3);
  const sopCtx = sopArticles
    .map((k: any) => `- 《${k.title}》: ${(k.content || k.summary || "").slice(0, 150)}`)
    .join("\n") || "无";
  const similarOrders = (await WorkOrderRepository.getAll({ equipmentId }))
    .filter((w: any) => w.repairLog)
    .slice(0, 2);
  const similarCtx = similarOrders
    .map((w: any) => `- [${w.orderNo}] ${w.title}: 处理步骤 ${w.repairLog.resolutionSteps || "无"}`)
    .join("\n") || "无";

  const userPrompt = `请为以下设备故障编制一份可现场执行的检修作业指导书。
【设备档案】${eq.name} (${eq.code}) | 类别: ${eq.category} | 型号: ${eq.model || "未知"} | 车间: ${eq.workshop} | 位置: ${eq.location}
【故障描述】${faultDescription}
【关联工单】${workOrderCtx}
【知识库检修SOP摘录】
${sopCtx}
【同设备历史检修记录】
${similarCtx}

严格按如下 JSON 结构输出:
{
  "overview": "方案概述 (80字内)",
  "steps": [{"step": 1, "operation": "操作内容与要点", "qualityStandard": "质量标准/验收值"}],
  "safetyMeasures": {
    "lotoPoints": ["能量隔离点1 (含隔离对象与锁具要求)"],
    "ppe": ["PPE 要求1"],
    "highRiskNotes": ["高危作业提示1"]
  },
  "tools": [{"name": "工具名称", "spec": "规格"}],
  "spareParts": [{"name": "备件名称", "spec": "规格", "qty": 1}],
  "qualityCheckpoints": ["关键质检点1"],
  "estimatedHours": 4,
  "workers": 2
}`;

  const __cached = aiCacheGet("generate-maintenance-plan", input);
  if (__cached) {
    return {
      outcome: "cache",
      body: Object.assign({}, __cached.value, { fromCache: true, cachedAt: __cached.cachedAt, model: "cache" }),
    };
  }
  try {
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    const body = { success: true, plan: data, model: DASHSCOPE_CHAT_MODEL };
    aiCacheSet("generate-maintenance-plan", input, body, { equipmentId: equipmentId });
    return { outcome: "success", body, knowledgeSources: sopArticles.map((k: any) => k.id).filter(Boolean) };
  } catch (err: any) {
    if (err instanceof AiUnavailableError) {
      return {
        outcome: "unavailable",
        errorMessage: err.message,
        body: { success: false, message: err.message, degraded: true },
      };
    }
    // 规则引擎降级：基于知识库 SOP 与设备类别生成标准作业框架（与原 degradedBuilder 逐字一致）
    const eq2 = await EquipmentRepository.getById(input.equipmentId);
    const eqName = eq2 ? eq2.name : "目标设备";
    const eqCategory = eq2 ? eq2.category : "旋转机电设备";
    const sopArticles = await findRelevantKnowledge(["SOP", "规程", eqCategory, eqName, "检修"], 3);
    const sopTitles = sopArticles.map((k: any) => k.title);
    return {
      outcome: "degraded",
      errorMessage: err?.message || String(err),
      body: {
        success: true,
        degraded: true,
        message: "AI 服务暂不可用，已返回规则引擎结果",
        plan: {
          overview: `基于《${sopTitles[0] || "通用检修规程"}》与设备 ${eqCategory} 类别生成的标准检修作业框架，请结合现场实际细化。`,
          steps: [
            { step: 1, operation: `执行 LOTO 停电挂牌：隔离 ${eqName} 动力回路并验证零能量状态`, qualityStandard: "验电确认无电压，锁具双人签字" },
            { step: 2, operation: `按《${sopTitles[0] || "检修规程"}》逐项拆检故障部位`, qualityStandard: "拆检记录完整，部件外观无二次损伤" },
            { step: 3, operation: "更换/修复故障部件并复装", qualityStandard: "紧固扭矩达标，装配间隙符合手册要求" },
            { step: 4, operation: "试运行并复测运行参数", qualityStandard: "温度/振动/电流回归受控范围" },
          ],
          safetyMeasures: {
            lotoPoints: [`${eqName} 主回路断路器`, "控制电源与二次回路"],
            ppe: ["绝缘手套", "安全帽", "防护目镜", "劳保鞋"],
            highRiskNotes: ["严禁带电作业", "试运行前确认人员撤离"],
          },
          tools: [{ name: "万用表", spec: "CAT III 600V" }, { name: "扭矩扳手", spec: "按紧固扭矩选型" }, { name: "塞尺", spec: "0.02-0.5mm" }],
          spareParts: [],
          qualityCheckpoints: ["隔离验证记录", "复装扭矩记录", "试运行参数记录"],
          estimatedHours: 4,
          workers: 2,
        },
      },
    };
  }
}

// ==================== 能力 3：作业安全风险评估 JSA（原 /api/v1/ai/safety-risk-assessment 核心逻辑） ====================

export async function runSafetyRiskAssessmentCore(input: {
  permitType: string;
  equipmentId?: string;
  workDescription: string;
  location?: string;
  hazards?: string[];
}): Promise<CapabilityResult> {
  const { permitType, equipmentId, workDescription, location, hazards } = input;
  const eq = equipmentId ? await EquipmentRepository.getById(equipmentId) : null;
  const kbArticles = await findRelevantKnowledge(
    ["安全", "LOTO", "动火", "受限空间", "高处", ...(permitType || "").split(""), ...(hazards || [])].filter(Boolean),
    5
  );
  const kbCtx = kbArticles.map((k: any) => `- 《${k.title}》: ${(k.content || k.summary || "").slice(0, 180)}`).join("\n") || "无";
  const similarPermits = (await SafetyPermitRepository.getAll())
    .filter((p: any) => (p.permitType || "").includes((permitType || "").slice(0, 2)))
    .slice(0, 4);
  const permitCtx = similarPermits
    .map((p: any) => `- [${p.permitNo}] ${p.title} (风险等级: ${p.riskLevel}, 状态: ${p.status}, LOTO: ${p.lotoNumber || "无"})`)
    .join("\n") || "无";

  const userPrompt = `请对以下高危作业进行安全风险评估 (JSA 作业安全分析)。
【作业票类型】${permitType}
【作业内容】${workDescription}
【作业地点】${location || "未指定"}
【关联设备】${eq ? `${eq.name} (${eq.code}) | ${eq.category} | ${eq.workshop}` : "无关联设备"}
【已辨识危害】${hazards?.length ? hazards.join("; ") : "无"}
【知识库安全规程摘录】
${kbCtx}
【历史同类作业票】
${permitCtx}

严格按如下 JSON 结构输出:
{
  "riskLevel": "低|中|高|极高 之一",
  "riskReason": "风险等级评定理由",
  "hazardIdentifications": [{"category": "机械伤害|电气|高处坠落|受限空间|火灾爆炸|中毒窒息|其他", "hazard": "具体危害", "level": "高|中|低"}],
  "jsaMeasures": [{"hazard": "对应的危害", "control": "控制措施"}],
  "ppeList": ["必须的 PPE 1"],
  "lotoAdvice": { "required": true, "isolationPoints": ["能量隔离点1"], "lockCount": 2 },
  "approvalFocusPoints": ["审批需重点核实项1"]
}`;

  const __cached = aiCacheGet("safety-risk-assessment", input);
  if (__cached) {
    return {
      outcome: "cache",
      body: Object.assign({}, __cached.value, { fromCache: true, cachedAt: __cached.cachedAt, model: "cache" }),
    };
  }
  try {
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    const body = { success: true, assessment: data, model: DASHSCOPE_CHAT_MODEL };
    aiCacheSet("safety-risk-assessment", input, body, { equipmentId: equipmentId });
    return { outcome: "success", body, knowledgeSources: kbArticles.map((k: any) => k.id).filter(Boolean) };
  } catch (err: any) {
    if (err instanceof AiUnavailableError) {
      return {
        outcome: "unavailable",
        errorMessage: err.message,
        body: { success: false, message: err.message, degraded: true },
      };
    }
    return { outcome: "failed", errorMessage: err?.message || String(err), body: failedBody(err) };
  }
}

// ==================== 能力 4：智能派单推荐（原 /api/v1/ai/recommend-assignee 核心逻辑） ====================

export async function runRecommendAssigneeCore(input: {
  equipmentId: string;
  faultDescription: string;
  priority?: string;
}): Promise<CapabilityResult> {
  const { equipmentId, faultDescription, priority } = input;
  const eq = await EquipmentRepository.getById(equipmentId);
  if (!eq) {
    return { outcome: "failed", body: { success: false, error: "设备不存在，请核对 equipmentId" } };
  }
  // 候选技师 (technician 角色) 与当前负载
  const users = await UserRepository.getAllUsers();
  const techs = users.filter((u: any) => u.role === "technician" || u.role === "manager");
  const allOrders = await WorkOrderRepository.getAll();
  const activeStatuses = ["dispatched", "in_progress", "pending_acceptance"];
  const techCtx = techs
    .map((u: any) => {
      const activeCount = allOrders.filter((w: any) => w.assigneeId === u.id && activeStatuses.includes(w.status)).length;
      const doneCount = allOrders.filter((w: any) => w.assigneeId === u.id && w.status === "completed").length;
      return `- ${u.name} (${u.roleTitle}, id=${u.id}, 部门:${u.department}) 当前在办 ${activeCount} 单 / 历史完成 ${doneCount} 单`;
    })
    .join("\n");
  // 历史类似工单处理人 (按设备 + 故障类型关键词)
  const keywords = faultDescription.slice(0, 30);
  const similarOrders = allOrders
    .filter((w: any) => w.assigneeId && (w.equipmentId === equipmentId || (w.title + (w.description || "")).includes(keywords.slice(0, 8))))
    .slice(0, 5);
  const similarCtx = similarOrders
    .map((w: any) => `- [${w.orderNo}] ${w.title} → 处理人: ${w.assignee || "未知"} (id=${w.assigneeId})`)
    .join("\n") || "无";

  const userPrompt = `请为以下检修工单推荐最合适的主修技师。
【设备】${eq.name} (${eq.code}) | 类别: ${eq.category} | 车间: ${eq.workshop}
【故障描述】${faultDescription}
【指定优先级】${priority || "未指定 (请给出建议)"}
【候选技师及当前负载】
${techCtx}
【历史类似工单处理人】
${similarCtx}

严格按如下 JSON 结构输出:
{
  "recommended": {"id": "技师id", "name": "姓名", "reason": "推荐理由 (技能匹配/负载/历史经验)"},
  "alternatives": [{"id": "技师id", "name": "姓名", "reason": "备选理由"}],
  "estimatedHours": 3.5,
  "suggestedPriority": "urgent|high|medium|low 之一"
}
alternatives 给 1-2 名。必须从候选技师中选人，不得虚构。`;

  const __cached = aiCacheGet("recommend-assignee", input);
  if (__cached) {
    return {
      outcome: "cache",
      body: Object.assign({}, __cached.value, { fromCache: true, cachedAt: __cached.cachedAt, model: "cache" }),
    };
  }
  try {
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    const body = { success: true, recommendation: data, model: DASHSCOPE_CHAT_MODEL };
    aiCacheSet("recommend-assignee", input, body, { equipmentId: equipmentId });
    return { outcome: "success", body };
  } catch (err: any) {
    if (err instanceof AiUnavailableError) {
      return {
        outcome: "unavailable",
        errorMessage: err.message,
        body: { success: false, message: err.message, degraded: true },
      };
    }
    return { outcome: "failed", errorMessage: err?.message || String(err), body: failedBody(err) };
  }
}
