// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { getAiClient, AiUnavailableError, callDashScopeJson, handleAiRouteError } from "../services/aiClient.ts";
import { addAuditLog } from "../services/auditService.ts";
import { AI_EXPERT_SYSTEM, generateFallbackExpertReply } from "../services/aiExpert.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { aiChatSchema, suggestFollowupsSchema, equipmentSummarySchema, recommendAssigneeSchema, alarmCorrelationSchema } from "../schemas/ai.ts";
import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { EquipmentRepository, WorkOrderRepository, TelemetryRepository, InspectionRepository, UserRepository } from "../../db/repositories/index.ts";
export const handleAiChat = async (req: any, res: any) => {
  const { message, history = [] } = req.body;
  const chatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ai = getAiClient();
  if (ai) {
    try {
      // DashScope qwen-plus 多轮对话 (OpenAI 兼容 messages)
      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        {
          role: "system",
          content: "你是一位拥有20年工业重型设备（旋转机械、动力管网、流体机械）检修与安全生产管理经验的特级专家。回答必须结构清晰、分步骤、具备强工程可操作性与严谨技术依据。涉及高处、有限空间、带电、动火等危险作业时，必须在回答开头或单独小节醒目标注【安全警示】，严格遵循 GB 30871 危险作业安全规范与 LOTO（上锁挂牌）能量隔离程序。",
        },
        ...history
          .filter((h: { role: string; content: string }) => h.content)
          .map((h: { role: string; content: string }) => ({
            role: (h.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
            content: h.content,
          })),
        { role: "user", content: message },
      ];
      const response = await ai.chat.completions.create({
        model: DASHSCOPE_CHAT_MODEL,
        messages,
        temperature: 0.7,
      });
      return res.json({
        success: true,
        chatId,
        reply: response.choices?.[0]?.message?.content || "",
        model: DASHSCOPE_CHAT_MODEL,
      });
    } catch (e: any) {
      console.warn("DashScope v1 Chat error:", e?.message || e);
    }
  }
  const reply = await generateFallbackExpertReply(message, {});
  res.json({ success: true, degraded: true, chatId, reply, model: "industrial-expert-knowledge-fallback" });
};
// ---------- 任务一：AI 对话流式输出 (SSE) ----------
export const handleAiChatStream = async (req: any, res: any) => {
  // SSE 响应头
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as any).flushHeaders === "function") (res as any).flushHeaders();

  const sendEvent = (payload: any) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {}
  };

  try {
    const chatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    sendEvent({ chatId });
    const { message, history = [], contextData = {} } = req.body;
    const ai = getAiClient();
    if (!ai) {
      throw new AiUnavailableError(
        "AI 服务未配置：请在 .env 中配置 DASHSCOPE_API_KEY 后重启服务。"
      );
    }

    const systemPrompt = `你是一位拥有20年工业重型设备（压缩机、离心泵、减速机、大型变频电机、数控机床、工业机器人）检修与安全运行经验的"特级设备检修与安全专家"。
当前系统是《设备检修知识检索与作业系统 v2.0.0》。
上下文信息:
${JSON.stringify(contextData, null, 2)}

请针对用户提出的工业设备故障排查、SOP规程、检修技巧、安全防护（如LOTO停电挂牌、动火安全）、参数异常等问题，提供专业、清晰、分步骤、具备工程可操作性的指导。
回答要求：
1. 结构清晰，使用 Markdown 格式（小标题、序号步骤、加粗重点）。
2. 如涉及危险作业（高压、高温、易燃易爆、机械卷入），必须包含【安全警示与防护措施】。
3. 给出可能原因、排查优先级、所需工具/备件、处理方案及预防性维护建议。`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      ...history
        .filter((h: { role: string; content: string }) => h.content)
        .map((h: { role: string; content: string }) => ({
          role: (h.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
          content: h.content,
        })),
      { role: "user", content: message },
    ];

    // DashScope OpenAI 兼容流式调用
    const stream = await ai.chat.completions.create({
      model: DASHSCOPE_CHAT_MODEL,
      messages,
      temperature: 0.7,
      stream: true,
    });

    let fullText = "";
    for await (const chunk of stream as any) {
      if (res.writableEnded) break;
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (delta) {
        fullText += delta;
        sendEvent({ content: delta });
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
    addAuditLog(req, {
      actionType: "AI_CHAT_STREAM",
      module: "ai",
      detail: `AI 流式对话完成 (${fullText.length} 字)，模型 ${DASHSCOPE_CHAT_MODEL}`,
      status: "SUCCESS",
      metadata: { model: DASHSCOPE_CHAT_MODEL, replyLength: fullText.length },
    });
  } catch (err: any) {
    // 流中出错：推送错误事件后正常关闭，不崩溃
    if (err instanceof AiUnavailableError) {
      sendEvent({ error: err.message, degraded: true });
    } else {
      console.error("[AI:CHAT_STREAM] 调用失败:", err?.message || err);
      sendEvent({ error: `AI 流式调用失败: ${err?.message || err}` });
    }
    res.write("data: [DONE]\n\n");
    res.end();
    addAuditLog(req, {
      actionType: "AI_CHAT_STREAM",
      module: "ai",
      detail: `AI 流式对话失败: ${err?.message || err}`,
      status: "FAILED",
      metadata: { error: String(err?.message || err).slice(0, 200) },
    });
  }
};
// ---------- 功能 7：AI 智能追问建议 ----------
export const handleSuggestFollowups = async (req: any, res: any) => {
  try {
    const { lastUserMessage, lastAiReply } = req.body;
    const userPrompt = `用户刚完成了一轮工业检修问答。
【用户问题】${lastUserMessage.slice(0, 500)}
【AI 回复摘要】${lastAiReply.slice(0, 800)}

请生成 3 个用户最可能继续追问的简短问题。要求：
- 每个问题不超过 20 字，口语化、可直接点击发送
- 紧扣上一轮回答内容深入追问 (如检修步骤、备件、工时、安全措施、验收标准等)

严格按 JSON 输出: {"suggestions": ["问题1", "问题2", "问题3"]}`;

    const { data } = await callDashScopeJson("你是工业检修问答助手的追问引导器，必须严格输出合法 JSON。", userPrompt, 0.5);
    addAuditLog(req, {
      actionType: "AI_SUGGEST_FOLLOWUPS",
      module: "ai",
      detail: `AI 生成追问建议 ${data.suggestions?.length || 0} 条`,
      status: "SUCCESS",
      metadata: { count: data.suggestions?.length, model: DASHSCOPE_CHAT_MODEL },
    });
    res.json({ success: true, suggestions: (data.suggestions || []).slice(0, 3), model: DASHSCOPE_CHAT_MODEL });
  } catch (err: any) {
    handleAiRouteError(res, err, "AI_SUGGEST_FOLLOWUPS", req);
  }
};
// ---------- 功能 8：设备健康画像 / 摘要 ----------
export const handleEquipmentSummary = async (req: any, res: any) => {
  try {
    const { equipmentId } = req.body;
    const eq = await EquipmentRepository.getById(equipmentId);
    if (!eq) {
      return res.status(404).json({ success: false, error: "设备不存在，请核对 equipmentId" });
    }
    // 最近 3 天遥测统计 (库内实际存量为准)
    const telemetry = await TelemetryRepository.getHistory(equipmentId, 72);
    const avg = (arr: number[]) => (arr.length ? Number((arr.reduce((a: number, b: number) => a + b, 0) / arr.length).toFixed(2)) : 0);
    const max = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);
    const telemetryStats = {
      dataPoints: telemetry.length,
      avgTemperature: avg(telemetry.map((t: any) => t.temperature)),
      maxTemperature: max(telemetry.map((t: any) => t.temperature)),
      avgVibration: avg(telemetry.map((t: any) => t.vibration)),
      maxVibration: max(telemetry.map((t: any) => t.vibration)),
      avgLoadRate: avg(telemetry.map((t: any) => t.loadRate)),
    };
    const recentOrders = (await WorkOrderRepository.getAll({ equipmentId })).slice(0, 3);
    const ordersCtx = recentOrders
      .map((w: any) => `- [${w.createdAt}] ${w.orderNo} ${w.title} (状态:${w.status}, 优先级:${w.priority})`)
      .join("\n") || "无近期工单";
    // 巡检异常记录 (items 中该设备异常测点)
    const inspections = await InspectionRepository.getAll();
    const abnormalPoints: string[] = [];
    for (const task of inspections.slice(0, 20)) {
      for (const item of task.items || []) {
        if ((item.equipmentId === equipmentId || item.equipmentName === eq.name) && (item.status === "abnormal" || item.isPass === false)) {
          abnormalPoints.push(`- [${task.scheduledDate || ""}] ${item.checkPoint || item.checkItem}: 实测 ${item.recordedValue ?? "异常"} ${item.unit || ""} (标准 ${item.standard || ""})`);
        }
      }
    }
    const abnormalCtx = abnormalPoints.slice(0, 3).join("\n") || "近期无巡检异常";

    const userPrompt = `请为以下设备生成一份简洁的 AI 健康画像摘要。
【设备档案】${eq.name} (${eq.code}) | 类别: ${eq.category} | 型号: ${eq.model || "未知"} | 车间: ${eq.workshop} | 当前健康分: ${eq.healthScore} | 状态: ${eq.status}
【遥测统计 (最近${telemetryStats.dataPoints}小时)】${JSON.stringify(telemetryStats)}
【近期工单】
${ordersCtx}
【近期巡检异常】
${abnormalCtx}

严格按如下 JSON 结构输出:
{
  "healthRating": "正常|关注|警告|危险 之一",
  "healthSummary": "一句话健康总结 (60字内)",
  "timeline": [{"time": "时间/日期", "event": "关键事件描述"}],
  "risks": ["当前主要风险点1"],
  "recommendations": ["建议措施1"]
}
其中 timeline 取 3-5 条近期关键事件 (依据工单/巡检/遥测越限记录)。`;

    const __cached = aiCacheGet("equipment-summary", req.body);
    if (__cached) {
      return res.json(Object.assign({}, __cached.value, { fromCache: true, cachedAt: __cached.cachedAt, model: "cache" }));
    }
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    addAuditLog(req, {
      actionType: "AI_EQUIPMENT_SUMMARY",
      module: "ai",
      detail: `AI 设备健康画像 (${eq.name}): 评级 ${data.healthRating}`,
      status: "SUCCESS",
      metadata: { equipmentId, healthRating: data.healthRating, model: DASHSCOPE_CHAT_MODEL },
    });
    const __body = { success: true, summary: data, model: DASHSCOPE_CHAT_MODEL };
    aiCacheSet("equipment-summary", req.body, __body, { equipmentId: equipmentId });
    res.json(__body);
  } catch (err: any) {
    // 规则引擎降级：基于健康分与遥测阈值生成简化画像（200 + degraded 标记）
    return handleAiRouteError(res, err, "AI_EQUIPMENT_SUMMARY", req, async () => {
      const eq2 = await EquipmentRepository.getById(req.body.equipmentId);
      const telemetry = await TelemetryRepository.getHistory(req.body.equipmentId, 72);
      const avg = (arr: number[]) => (arr.length ? Number((arr.reduce((a: number, b: number) => a + b, 0) / arr.length).toFixed(2)) : 0);
      const mx = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);
      const telemetryStats = {
        dataPoints: telemetry.length,
        avgTemperature: avg(telemetry.map((t: any) => t.temperature)),
        maxTemperature: mx(telemetry.map((t: any) => t.temperature)),
        avgVibration: avg(telemetry.map((t: any) => t.vibration)),
        maxVibration: mx(telemetry.map((t: any) => t.vibration)),
      };
      const hs = eq2?.healthScore ?? 50;
      const rating = hs >= 85 ? "正常" : hs >= 70 ? "关注" : hs >= 50 ? "警告" : "危险";
      const recentOrders = (await WorkOrderRepository.getAll({ equipmentId: req.body.equipmentId })).slice(0, 4);
      const timeline = recentOrders.map((w: any) => ({ time: w.createdAt || "", event: `${w.orderNo} ${w.title}（${w.status}）` }));
      const risks: string[] = [];
      if (telemetryStats.maxTemperature > 75) risks.push(`轴承温度峰值 ${telemetryStats.maxTemperature}°C 超警戒值 75°C`);
      if (telemetryStats.maxVibration > 4.5) risks.push(`振动峰值 ${telemetryStats.maxVibration} mm/s 超 ISO 10816-3 警戒值 4.5 mm/s`);
      if ((eq2?.status || "") === "fault") risks.push("设备当前处于故障停机状态");
      if (risks.length === 0) risks.push("主要指标处于受控范围，暂无明显风险点");
      return {
        success: true, degraded: true,
        message: "AI 服务暂不可用，已返回规则引擎结果",
        summary: {
          healthRating: rating,
          healthSummary: `当前健康分 ${hs}/100，依据遥测阈值与近期工单记录综合评定。`,
          timeline: timeline,
          risks: risks,
          recommendations: [
            rating === "正常" ? "维持现有巡检周期，持续监测关键指标" : "缩短巡检周期，重点关注温度与振动趋势",
            risks.length > 1 ? "建议安排检修窗口进行专项检查" : "保持预警监测，按计划维保",
          ],
        },
      };
    });
  }
};
// ---------- 功能 9：AI 辅助派单 (推荐主修人 + 工时) ----------
export const handleRecommendAssignee = async (req: any, res: any) => {
  try {
    const { equipmentId, faultDescription, priority } = req.body;
    const eq = await EquipmentRepository.getById(equipmentId);
    if (!eq) {
      return res.status(404).json({ success: false, error: "设备不存在，请核对 equipmentId" });
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

    const __cached = aiCacheGet("recommend-assignee", req.body);
    if (__cached) {
      return res.json(Object.assign({}, __cached.value, { fromCache: true, cachedAt: __cached.cachedAt, model: "cache" }));
    }
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    addAuditLog(req, {
      actionType: "AI_RECOMMEND_ASSIGNEE",
      module: "ai",
      detail: `AI 推荐派单 (${eq.name}): 主修 ${data.recommended?.name || "N/A"}，预估 ${data.estimatedHours}h`,
      status: "SUCCESS",
      metadata: { equipmentId, recommended: data.recommended?.name, estimatedHours: data.estimatedHours, model: DASHSCOPE_CHAT_MODEL },
    });
    const __body = { success: true, recommendation: data, model: DASHSCOPE_CHAT_MODEL };
    aiCacheSet("recommend-assignee", req.body, __body, { equipmentId: equipmentId });
    res.json(__body);
  } catch (err: any) {
    handleAiRouteError(res, err, "AI_RECOMMEND_ASSIGNEE", req);
  }
};
// ---------- 功能 10：报警智能关联分析 ----------
export const handleAlarmCorrelation = async (req: any, res: any) => {
  try {
    const { alarms } = req.body;
    const eqDetails = await Promise.all(
      alarms.map(async (a: any) => {
        const eq = await EquipmentRepository.getById(a.equipmentId);
        return {
          alarmType: a.alarmType,
          value: a.value,
          timestamp: a.timestamp,
          equipment: eq
            ? `${eq.name} (${eq.code}) | 类别: ${eq.category} | 车间: ${eq.workshop} | 位置: ${eq.location} | 健康分: ${eq.healthScore} | 状态: ${eq.status}`
            : `未知设备 (${a.equipmentId})`,
        };
      })
    );
    const alarmsCtx = eqDetails
      .map((d: any, i: number) => `${i + 1}. 报警类型: ${d.alarmType} | 数值: ${JSON.stringify(d.value ?? "")} | 时间: ${d.timestamp || "最近"} | 设备: ${d.equipment}`)
      .join("\n");

    const userPrompt = `厂区多台设备同时/连续发生报警，请做智能关联分析，识别根因报警与衍生报警。
【报警清单】
${alarmsCtx}
【分析方法提示】请结合设备的车间/位置/类别拓扑关系 (同车间、同生产线、同一动力回路、上下游工艺链) 与报警类型物理机理进行关联。

严格按如下 JSON 结构输出:
{
  "summary": "关联分析结论摘要 (100字内)",
  "rootAlarm": {"index": 1, "equipment": "设备名", "reason": "判定为根因的依据"},
  "derivedAlarms": [{"index": 2, "equipment": "设备名", "relation": "与根因的因果关联说明"}],
  "correlationGraph": "报警关联图谱文字描述 (如: 报警1 →(动力回路失压)→ 报警2/3)",
  "actionPlan": ["处置建议1 (明确先处理哪个)"]
}`;

    const __cached = aiCacheGet("alarm-correlation", req.body);
    if (__cached) {
      return res.json(Object.assign({}, __cached.value, { fromCache: true, cachedAt: __cached.cachedAt, model: "cache" }));
    }
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    addAuditLog(req, {
      actionType: "AI_ALARM_CORRELATION",
      module: "ai",
      detail: `AI 报警关联分析: ${alarms.length} 条报警, 根因: ${data.rootAlarm?.equipment || "N/A"}`,
      status: "SUCCESS",
      metadata: { alarmCount: alarms.length, rootAlarm: data.rootAlarm?.equipment, model: DASHSCOPE_CHAT_MODEL },
    });
    const __body = { success: true, analysis: data, model: DASHSCOPE_CHAT_MODEL };
    aiCacheSet("alarm-correlation", req.body, __body);
    res.json(__body);
  } catch (err: any) {
    handleAiRouteError(res, err, "AI_ALARM_CORRELATION", req);
  }
};
