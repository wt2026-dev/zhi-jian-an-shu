// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { streamAiStructured } from "../services/aiClient.ts";
import { AI_EXPERT_SYSTEM } from "../services/aiExpert.ts";
import { findRelevantKnowledge } from "../services/knowledgeRetrieval.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { WorkOrderRepository, EquipmentRepository, TelemetryRepository, InspectionRepository } from "../../db/repositories/index.ts";

// ==================== 五个 AI 流式 SSE 路由的 prepare/buildSuccessBody/buildDegraded 组装 ====================

export async function handleRootCauseAnalysisStream(req: any, res: any) {
  await streamAiStructured(res, req, {
    actionType: "AI_ROOT_CAUSE_ANALYSIS_STREAM",
    cacheType: "root-cause-analysis",
    cacheParams: function () { return req.body; },
    prepare: async function () {
      var equipmentId = req.body.equipmentId || "";
      var description = req.body.faultDescription || "";
      var orderNo = "";
      var orderCtx = "无关联工单";
      if (req.body.workOrderId) {
        var wo = await WorkOrderRepository.getById(req.body.workOrderId);
        if (wo) {
          equipmentId = wo.equipmentId;
          description = description || wo.description || wo.title;
          orderNo = wo.orderNo;
          orderCtx = `工单 ${wo.orderNo}「${wo.title}」故障类型: ${wo.faultType}, 维修记录: ${wo.repairLog ? wo.repairLog.causeAnalysis || "无" : "未填报"}`;
        }
      }
      var eq = equipmentId ? await EquipmentRepository.getById(equipmentId) : null;
      var historyOrders = equipmentId ? (await WorkOrderRepository.getAll({ equipmentId: equipmentId })).filter(function (w: any) { return w.orderNo !== orderNo; }).slice(0, 3) : [];
      var kb = await findRelevantKnowledge([eq?.category || "", "故障", "故障树", "根因"], 3);
      var historyCtx = historyOrders.map(function (w: any) { return `- [${w.orderNo}] ${w.title}`; }).join("\n") || "无";
      var kbCtx = kb.map(function (k: any) { return `- 《${k.title}》(${k.category})`; }).join("\n") || "无";
      var user = `请对以下工业设备故障进行深度根因分析 (RCA)。\n【设备】${eq ? eq.name + " (" + eq.code + ")" : "未知"}\n【关联工单】${orderCtx}\n【故障描述】${description}\n【历史故障】\n${historyCtx}\n【知识库】\n${kbCtx}\n严格按 JSON 输出: {"summary":"...","fiveWhys":[{"level":1,"question":"...","reason":"...","evidence":"..."}],"rootCauses":[{"type":"直接原因","cause":"...","probability":"72%","evidence":"..."}],"correctiveActions":{"shortTerm":["..."],"longTerm":["..."]},"references":["..."]}`;
      return {
        system: AI_EXPERT_SYSTEM, user: user,
        ctx: { equipmentName: eq ? eq.name : "未知设备", historyOrders: historyOrders, kb: kb, description: description },
      };
    },
    buildSuccessBody: function (ctx: any, data: any) {
      return { success: true, analysis: data, model: DASHSCOPE_CHAT_MODEL };
    },
    buildDegraded: function (ctx: any) {
      return {
        data: {
          summary: (ctx.description || "").slice(0, 90) || "故障现象摘要缺失",
          fiveWhys: [
            { level: 1, question: "为什么出现该故障现象？", reason: "结合遥测与现场描述的初步判定", evidence: "现场描述与遥测特征" },
            { level: 2, question: "为什么会产生该直接原因？", reason: "需结合历史维修记录进一步检查", evidence: "同类设备经验规则" },
          ],
          rootCauses: [
            { type: "直接原因", cause: "需现场进一步排查确认", probability: "参考", evidence: "故障现象映射" },
            { type: "根本原因", cause: ctx.historyOrders.length ? "历史同类隐患未彻底闭环" : "预防性维护策略待完善", probability: "参考", evidence: "历史工单记录" },
          ],
          correctiveActions: { shortTerm: ["立即执行 LOTO 停电挂牌并隔离设备"], longTerm: ["将该故障模式纳入预防性维护计划"] },
          references: ctx.kb.map(function (k: any) { return k.title; }).slice(0, 3),
        },
        message: "AI 服务暂不可用，已返回规则引擎结果",
      };
    },
  });
}

export async function handleGenerateMaintenancePlanStream(req: any, res: any) {
  await streamAiStructured(res, req, {
    actionType: "AI_GENERATE_MAINTENANCE_PLAN_STREAM",
    cacheType: "generate-maintenance-plan",
    cacheParams: function () { return req.body; },
    equipmentId: function (ctx: any) { return ctx.equipmentId; },
    prepare: async function () {
      var equipmentId = req.body.equipmentId;
      var eq = await EquipmentRepository.getById(equipmentId);
      if (!eq) throw new Error("设备不存在，请核对 equipmentId");
      var sop = await findRelevantKnowledge(["SOP", "规程", eq.category || "", eq.name || "", "检修"], 3);
      var sopTitles = sop.map(function (k: any) { return k.title; });
      var sopCtx = sop.map(function (k: any) { return "- 《" + k.title + "》"; }).join("\n") || "无";
      var user = `请为以下设备故障编制检修作业指导书。\n【设备】${eq.name} (${eq.code}) | 类别: ${eq.category} | 车间: ${eq.workshop}\n【故障描述】${req.body.faultDescription}\n【知识库 SOP】\n${sopCtx}\n严格按 JSON 输出: {"overview":"...","steps":[{"step":1,"operation":"...","qualityStandard":"..."}],"safetyMeasures":{"lotoPoints":["..."],"ppe":["..."],"highRiskNotes":["..."]},"tools":[{"name":"...","spec":"..."}],"spareParts":[{"name":"...","spec":"...","qty":1}],"qualityCheckpoints":["..."],"estimatedHours":4,"workers":2}`;
      return {
        system: AI_EXPERT_SYSTEM, user: user,
        ctx: { equipmentId: equipmentId, equipmentName: eq.name, eqCategory: eq.category, sopTitles: sopTitles },
      };
    },
    buildSuccessBody: function (ctx: any, data: any) {
      return { success: true, plan: data, model: DASHSCOPE_CHAT_MODEL };
    },
    buildDegraded: function (ctx: any) {
      var st = ctx.sopTitles[0] || "通用检修规程";
      return {
        data: {
          overview: `基于《${st}》与设备 ${ctx.eqCategory} 类别生成的标准检修作业框架，请结合现场实际细化。`,
          steps: [
            { step: 1, operation: `执行 LOTO 停电挂牌：隔离 ${ctx.equipmentName} 动力回路并验证零能量状态`, qualityStandard: "验电确认无电压，锁具双人签字" },
            { step: 2, operation: `按《${st}》逐项拆检故障部位`, qualityStandard: "拆检记录完整，部件外观无二次损伤" },
            { step: 3, operation: "更换/修复故障部件并复装", qualityStandard: "紧固扭矩达标，装配间隙符合手册要求" },
            { step: 4, operation: "试运行并复测运行参数", qualityStandard: "温度/振动/电流回归受控范围" },
          ],
          safetyMeasures: {
            lotoPoints: [`${ctx.equipmentName} 主回路断路器`, "控制电源与二次回路"],
            ppe: ["绝缘手套", "安全帽", "防护目镜", "劳保鞋"],
            highRiskNotes: ["严禁带电作业", "试运行前确认人员撤离"],
          },
          tools: [{ name: "万用表", spec: "CAT III 600V" }, { name: "扭矩扳手", spec: "按紧固扭矩选型" }],
          spareParts: [], qualityCheckpoints: ["隔离验证记录", "复装扭矩记录", "试运行参数记录"],
          estimatedHours: 4, workers: 2,
        },
        message: "AI 服务暂不可用，已返回规则引擎结果",
      };
    },
  });
}

export async function handleHealthForecastStream(req: any, res: any) {
  await streamAiStructured(res, req, {
    actionType: "AI_HEALTH_FORECAST_STREAM",
    cacheType: "health-forecast",
    cacheParams: function () { return req.body; },
    equipmentId: function (ctx: any) { return ctx.equipmentId; },
    prepare: async function () {
      var equipmentId = req.body.equipmentId;
      var eq = await EquipmentRepository.getById(equipmentId);
      if (!eq) throw new Error("设备不存在，请核对 equipmentId");
      var history = await TelemetryRepository.getHistory(equipmentId, 72);
      if (!history.length) throw new Error("该设备暂无遥测历史数据，无法进行趋势预测");
      var stats: any = {};
      ["temperature", "vibration", "current", "loadRate"].forEach(function (m: string) {
        var series = history.map(function (h: any) { return Number(h[m] || 0); });
        var n = series.length;
        var mean = series.reduce(function (a: number, b: number) { return a + b; }, 0) / n;
        var xMean = (n - 1) / 2;
        var slope = series.reduce(function (acc: number, y: number, x: number) { return acc + (x - xMean) * (y - mean); }, 0) /
          (series.reduce(function (acc: number, _y: number, x: number) { return acc + (x - xMean) * (x - xMean); }, 0) || 1);
        stats[m] = {
          mean: Number(mean.toFixed(2)), max: Number(Math.max.apply(null, series).toFixed(2)),
          slopePerHour: Number(slope.toFixed(4)),
          exceedCount: m === "temperature" ? series.filter(function (v: number) { return v > 75; }).length : m === "vibration" ? series.filter(function (v: number) { return v > 4.5; }).length : 0,
        };
      });
      var user = `请基于以下遥测统计研判设备劣化趋势。\n【设备】${eq.name} (${eq.code}) | 健康分: ${eq.healthScore}\n【统计】${JSON.stringify(stats)}\n严格按 JSON 输出: {"healthRating":"正常|关注|警告|危险","ratingReason":"...","trends":[{"metric":"...","direction":"上升|下降|平稳","rateDescription":"...","description":"..."}],"failureRisks":[{"mode":"...","basis":"..."}],"watchWindowHours":72,"watchWindowNote":"...","recommendations":["..."]}`;
      return {
        system: AI_EXPERT_SYSTEM, user: user,
        ctx: { equipmentId: equipmentId, equipmentName: eq.name, stats: stats, history: history },
      };
    },
    buildSuccessBody: function (ctx: any, data: any) {
      return { success: true, forecast: data, statistics: ctx.stats, dataPoints: ctx.history.length, model: DASHSCOPE_CHAT_MODEL };
    },
    buildDegraded: function (ctx: any) {
      var st = ctx.stats;
      var tempAlert = st.temperature.exceedCount > 0 || st.temperature.max > 75;
      var vibAlert = st.vibration.exceedCount > 0 || st.vibration.max > 4.5;
      var rating = tempAlert && vibAlert ? "危险" : tempAlert || vibAlert ? "警告" : "正常";
      return {
        data: {
          healthRating: rating,
          ratingReason: `温度越限 ${st.temperature.exceedCount} 次、振动越限 ${st.vibration.exceedCount} 次（最近 ${ctx.history.length} 小时）`,
          trends: Object.keys(st).map(function (k: string) {
            return { metric: k, direction: st[k].slopePerHour > 0.01 ? "上升" : st[k].slopePerHour < -0.01 ? "下降" : "平稳", description: `均值 ${st[k].mean}，峰值 ${st[k].max}` };
          }),
          failureRisks: [{ mode: tempAlert ? "轴承过热 / 润滑失效" : "无显著故障模式", basis: "统计阈值判定" }],
          watchWindowHours: 72,
          watchWindowNote: "建议未来 72 小时内加密巡检频次",
          recommendations: [rating === "正常" ? "维持现有巡检周期" : "加强巡检并安排检修窗口评估"],
        },
        message: "AI 服务暂不可用，已返回规则引擎结果",
      };
    },
  });
}

export async function handleEquipmentSummaryStream(req: any, res: any) {
  await streamAiStructured(res, req, {
    actionType: "AI_EQUIPMENT_SUMMARY_STREAM",
    cacheType: "equipment-summary",
    cacheParams: function () { return req.body; },
    equipmentId: function (ctx: any) { return ctx.equipmentId; },
    prepare: async function () {
      var equipmentId = req.body.equipmentId;
      var eq = await EquipmentRepository.getById(equipmentId);
      if (!eq) throw new Error("设备不存在，请核对 equipmentId");
      var telemetry = await TelemetryRepository.getHistory(equipmentId, 72);
      var avg = function (arr: number[]) { return arr.length ? Number((arr.reduce(function (a: number, b: number) { return a + b; }, 0) / arr.length).toFixed(2)) : 0; };
      var mx = function (arr: number[]) { return arr.length ? Math.max.apply(null, arr) : 0; };
      var stats = {
        dataPoints: telemetry.length,
        avgTemperature: avg(telemetry.map(function (t: any) { return t.temperature; })),
        maxTemperature: mx(telemetry.map(function (t: any) { return t.temperature; })),
        avgVibration: avg(telemetry.map(function (t: any) { return t.vibration; })),
        maxVibration: mx(telemetry.map(function (t: any) { return t.vibration; })),
      };
      var orders = (await WorkOrderRepository.getAll({ equipmentId: equipmentId })).slice(0, 3);
      var user = `请为设备生成健康画像摘要。\n【设备】${eq.name} (${eq.code}) | 健康分: ${eq.healthScore} | 状态: ${eq.status}\n【遥测统计】${JSON.stringify(stats)}\n【近期工单】${orders.map(function (w: any) { return w.orderNo + " " + w.title + "(" + w.status + ")"; }).join("; ") || "无"}\n严格按 JSON 输出: {"healthRating":"正常|关注|警告|危险","healthSummary":"...","timeline":[{"time":"...","event":"..."}],"risks":["..."],"recommendations":["..."]}`;
      return {
        system: AI_EXPERT_SYSTEM, user: user,
        ctx: { equipmentId: equipmentId, equipmentName: eq.name, healthScore: eq.healthScore, stats: stats, orders: orders },
      };
    },
    buildSuccessBody: function (ctx: any, data: any) {
      return { success: true, summary: data, model: DASHSCOPE_CHAT_MODEL };
    },
    buildDegraded: function (ctx: any) {
      var hs = ctx.healthScore;
      var rating = hs >= 85 ? "正常" : hs >= 70 ? "关注" : hs >= 50 ? "警告" : "危险";
      var risks: string[] = [];
      if (ctx.stats.maxTemperature > 75) risks.push(`轴承温度峰值 ${ctx.stats.maxTemperature}°C 超警戒`);
      if (ctx.stats.maxVibration > 4.5) risks.push(`振动峰值 ${ctx.stats.maxVibration} mm/s 超警戒`);
      if (!risks.length) risks.push("主要指标处于受控范围");
      return {
        data: {
          healthRating: rating,
          healthSummary: `当前健康分 ${hs}/100，依据遥测阈值与近期工单记录综合评定。`,
          timeline: ctx.orders.map(function (w: any) { return { time: w.createdAt || "", event: `${w.orderNo} ${w.title}（${w.status}）` }; }),
          risks: risks,
          recommendations: [rating === "正常" ? "维持现有巡检周期" : "缩短巡检周期，重点关注温度与振动趋势"],
        },
        message: "AI 服务暂不可用，已返回规则引擎结果",
      };
    },
  });
}

export async function handleSafetyRiskAssessmentStream(req: any, res: any) {
  await streamAiStructured(res, req, {
    actionType: "AI_SAFETY_RISK_ASSESSMENT_STREAM",
    cacheType: "safety-risk-assessment",
    cacheParams: function () { return req.body; },
    prepare: async function () {
      var kb = await findRelevantKnowledge(["安全", "LOTO", "动火", "受限空间", req.body.permitType || ""], 3);
      var kbCtx = kb.map(function (k: any) { return "- 《" + k.title + "》"; }).join("\n") || "无";
      var user = `请对以下高危作业进行安全风险评估 (JSA)。\n【作业票类型】${req.body.permitType}\n【作业内容】${req.body.workDescription}\n【作业地点】${req.body.location || "未指定"}\n【知识库规程】\n${kbCtx}\n严格按 JSON 输出: {"riskLevel":"低|中|高|极高","riskReason":"...","hazardIdentifications":[{"category":"...","hazard":"...","level":"高|中|低"}],"jsaMeasures":[{"hazard":"...","control":"..."}],"ppeList":["..."],"lotoAdvice":{"required":true,"isolationPoints":["..."],"lockCount":2},"approvalFocusPoints":["..."]}`;
      return {
        system: AI_EXPERT_SYSTEM, user: user,
        ctx: {},
      };
    },
    buildSuccessBody: function (ctx: any, data: any) {
      return { success: true, assessment: data, model: DASHSCOPE_CHAT_MODEL };
    },
    buildDegraded: function (_ctx: any) {
      return {
        data: {
          riskLevel: "高",
          riskReason: "基于作业类型与现场条件的规则判定：请结合现场实际核实。",
          hazardIdentifications: [
            { category: "机械伤害", hazard: "检修过程旋转部件意外启动", level: "高" },
            { category: "电气", hazard: "带电作业触电风险", level: "高" },
          ],
          jsaMeasures: [
            { hazard: "旋转部件意外启动", control: "执行 LOTO 停电挂牌上锁并验证零能量" },
            { hazard: "带电作业触电", control: "验电确认无电压后作业" },
          ],
          ppeList: ["绝缘手套", "安全帽", "防护目镜", "劳保鞋"],
          lotoAdvice: { required: true, isolationPoints: ["主回路断路器", "控制电源"], lockCount: 2 },
          approvalFocusPoints: ["作业前安全交底记录", "气体检测数据", "LOTO 上锁确认单"],
        },
        message: "AI 服务暂不可用，已返回规则引擎结果",
      };
    },
  });
}

export async function handleGenerateSmartReportStream(req: any, res: any) {
  await streamAiStructured(res, req, {
    actionType: "AI_GENERATE_REPORT_STREAM",
    cacheType: "generate-report",
    cacheParams: function () { return req.body; },
    prepare: async function () {
      var reportType = req.body.reportType;
      var startDate = req.body.startDate, endDate = req.body.endDate, workshop = req.body.workshop;
      var inRange = function (dateStr?: string | null) {
        if (!dateStr) return false;
        var d = new Date(String(dateStr).replace(/-/g, "/"));
        if (isNaN(d.getTime())) return false;
        return d >= new Date(startDate + "T00:00:00") && d <= new Date(endDate + "T23:59:59");
      };
      var inspections = (await InspectionRepository.getAll(workshop ? { workshop: workshop } : undefined)).filter(function (t: any) { return inRange(t.scheduledDate); });
      var orders = (await WorkOrderRepository.getAll(workshop ? { workshop: workshop } : undefined)).filter(function (w: any) { return inRange(w.createdAt); });
      var typeLabel = reportType === "inspection" ? "巡检报告" : reportType === "maintenance" ? "检修报告" : "月度设备运行报告";
      var inspTotal = inspections.length;
      var inspCompleted = inspections.filter(function (t: any) { return t.status === "completed"; }).length;
      var abnormal = inspections.reduce(function (s: number, t: any) { return s + (t.abnormalCount || 0); }, 0);
      var woTotal = orders.length;
      var woCompleted = orders.filter(function (w: any) { return w.status === "completed"; }).length;
      var user = `请基于以下统计数据编制${typeLabel}（${startDate} 至 ${endDate}）。\n【巡检】总数${inspTotal} 完成${inspCompleted} 异常${abnormal}\n【工单】总数${woTotal} 完成${woCompleted}\n严格按 JSON 输出: {"summary":"...","highlights":["..."],"problems":["..."],"statistics":[{"label":"...","value":"..."}],"topIssues":[{"title":"...","count":3,"analysis":"..."}],"suggestions":["..."],"markdown":"...报告正文..."}`;
      return {
        system: AI_EXPERT_SYSTEM, user: user,
        ctx: { typeLabel: typeLabel, reportType: reportType, startDate: startDate, endDate: endDate, workshop: workshop },
      };
    },
    buildSuccessBody: function (ctx: any, data: any) {
      return {
        success: true, report: data,
        meta: { reportType: ctx.reportType, reportTypeLabel: ctx.typeLabel, startDate: ctx.startDate, endDate: ctx.endDate, workshop: ctx.workshop || "全部车间" },
        model: DASHSCOPE_CHAT_MODEL,
      };
    },
    buildDegraded: function (ctx: any) {
      return {
        data: {
          summary: "AI 服务暂不可用，已返回基于真实数据聚合的规则统计结果。",
          highlights: [] as string[],
          problems: [] as string[],
          statistics: [] as any[],
          topIssues: [] as any[],
          suggestions: ["建议稍后重试以获取 AI 分析结论"],
          markdown: `# ${ctx.typeLabel}\n\n统计区间：${ctx.startDate} 至 ${ctx.endDate}\n\n（AI 服务暂不可用，正文略。可稍后重新生成。）`,
        },
        message: "AI 服务暂不可用，已返回规则引擎结果",
      };
    },
  });
}
