// ==============================================================================
// Hermes 智能业务管家 - 业务闭环编排服务
//
// 流程：业务目标(goal) → 解析真实设备定位 → 闭环 + 六环节落库 → 异步 AI 预填
//   环节1 现场报修:   generate-work-order（DashScope 真实调用，缓存命中不重复烧额度）
//   环节2 高危作业票: safety-risk-assessment（复用 aiCapabilityService 核心能力）
//   环节3 LOTO隔离:   safety-interlock 规则（真实隔离点建议 + 库内锁具匹配）
//   环节4 检修执行:   generate-maintenance-plan（复用 aiCapabilityService 核心能力）
//   环节5/6:          归档时 generate-report / suggest-contribution
//
// 数据纪律：
//   - AI 结果如实落库，outcome 降级/失败 → ai_status='degraded'，前端「AI 降级」徽章可见；
//   - 产出物 ref_id 只关联真实生成的业务记录（work_orders / safety_permits / 贡献表）；
//   - 全程禁止伪造遥测、伪造审批签章、伪造成功。
// ==============================================================================

import {
  BusinessLoopRepository,
  UserRepository,
  EquipmentRepository,
  WorkOrderRepository,
  SafetyPermitRepository,
  LotoLockRepository,
  generateLoopId,
  generateStageId,
  generateArtifactId,
  generateLoopNo,
} from "../../db/repositories/index.ts";
import { getDb } from "../../db/db.ts";
import {
  runSafetyRiskAssessmentCore,
  runMaintenancePlanCore,
  CapabilityResult,
} from "./aiCapabilityService.ts";
import { callDashScopeJson, AiUnavailableError, getAiClient, extractAiJson } from "./aiClient.ts";
import { AI_EXPERT_SYSTEM } from "./aiExpert.ts";
import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { TREND_METRICS } from "./degradationTrend.ts";
import { addAuditLog } from "./auditService.ts";
import { logger } from "../../utils/logger.ts";

// ==================== 闭环常量定义 ====================

export interface StageDef {
  no: number;
  key: string;
  stageId: string; // 前端 StageId
  title: string;
  aiBadge: string;
  outputSummary: string;
  pageRef: string; // 对应页面路由（前端 tabKey 同名）
  durationText: string;
  minutes: number;
}

const STAGE_DEFS: StageDef[] = [
  { no: 1, key: "field_report", stageId: "stage_report", title: "现场报修", aiBadge: "AI 诊断", outputSummary: "AI 工单草稿 · 检修工单", pageRef: "work_orders", durationText: "预计 15min", minutes: 15 },
  { no: 2, key: "hazard_permit", stageId: "stage_permit", title: "高危作业票", aiBadge: "JSA 识别", outputSummary: "JSA 风险等级 · 安全与LOTO", pageRef: "safety", durationText: "预计 25min", minutes: 25 },
  { no: 3, key: "loto", stageId: "stage_loto", title: "LOTO能量隔离", aiBadge: "LOTO 规则", outputSummary: "隔离清单建议 · 安全与LOTO", pageRef: "safety", durationText: "预计 30min", minutes: 30 },
  { no: 4, key: "repair_execution", stageId: "stage_execution", title: "检修执行", aiBadge: "SOP 推理", outputSummary: "检修方案 · 作业指引", pageRef: "procedures", durationText: "预计 90min", minutes: 90 },
  { no: 5, key: "completion", stageId: "stage_completion", title: "完工", aiBadge: "巡检比对", outputSummary: "完工验收 · 巡检作业", pageRef: "inspections", durationText: "预计 30min", minutes: 30 },
  { no: 6, key: "quality_archive", stageId: "stage_archive", title: "质检归档", aiBadge: "知识提炼", outputSummary: "质检报告 · 知识库", pageRef: "knowledge", durationText: "预计 20min", minutes: 20 },
];

export function stageDef(no: number): StageDef {
  return STAGE_DEFS[no - 1];
}

/** 产出物类型定义（8 项标准业务资料，与迁移 artifact_type CHECK 约束一致） */
const ARTIFACT_DEFS: Array<{ type: string; title: string; stageNo: number }> = [
  { type: "work_order", title: "智能检修工单", stageNo: 1 },
  { type: "hazard_permit", title: "高危作业安全许可票", stageNo: 2 },
  { type: "loto_checklist", title: "LOTO 能量隔离挂牌清单", stageNo: 3 },
  { type: "work_guide", title: "检修作业指引", stageNo: 4 },
  { type: "acceptance", title: "修后现场质量验收记录", stageNo: 5 },
  { type: "quality_report", title: "综合质检闭环评估报告", stageNo: 6 },
  { type: "knowledge_entry", title: "检修知识沉淀条目", stageNo: 6 },
  { type: "archive_pack", title: "闭环电子档案综合包", stageNo: 6 },
];

/** 温度/振动共用同一组台账-趋势侧经验限值（degradationTrend.ts TREND_METRICS 单一事实来源） */
const TEMP_LIMIT = TREND_METRICS.find((m) => m.key === "temperature")?.warnThreshold ?? 75;
const VIB_LIMIT = TREND_METRICS.find((m) => m.key === "vibration")?.warnThreshold ?? 4.5;
const LOAD_LIMIT = TREND_METRICS.find((m) => m.key === "loadRate")?.warnThreshold ?? 85;

/** JSA 四档结论 → 站内作业票风险等级口径（与安全台账 Level 1-4 显示约定对齐） */
const JSA_RISK_TO_LEVEL: Record<string, string> = {
  极高: "极大风险 (Level 1)",
  高: "较大风险 (Level 2)",
  中: "一般风险 (Level 3)",
  低: "低风险 (Level 4)",
};

// ==================== 业务异常（控制器统一转 HTTP 响应） ====================

export class BusinessLoopError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = "BUSINESS_LOOP_REJECTED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ==================== 业务目标解析（真实设备识别，禁止编造设备） ====================

/** 常见口语别名 → 设备库检索词（只做同义扩增，不虚构映射对象） */
const GOAL_ALIAS: Record<string, string> = {
  空压机: "压缩机",
  螺杆机: "压缩机",
  给水泵: "泵",
  冷却泵: "泵",
  循环泵: "泵",
  风机: "风机",
  减速箱: "减速箱",
};

export interface GoalParseResult {
  equipment: any | null;
  equipmentId: string | null;
  faultKeyword: string | null;
}

export async function resolveEquipment(
  goal: string,
  equipmentId?: string
): Promise<GoalParseResult> {
  const faultKeywords = ["振动", "温度", "过热", "高温", "泄漏", "异响", "噪音", "压力", "卡涩", "磨损", "跳停", "联锁", "报警", "锈蚀", "腐蚀"];
  const faultKeyword = faultKeywords.find((k) => goal.includes(k)) || null;

  if (equipmentId) {
    const eq = await EquipmentRepository.getById(equipmentId);
    if (!eq) {
      throw new BusinessLoopError(400, `指定的设备不存在（equipmentId=${equipmentId}），请从设备台账选择真实设备。`, "EQUIPMENT_NOT_FOUND");
    }
    return { equipment: eq, equipmentId: eq.id, faultKeyword };
  }

  // 无显式设备号：按目标文本与设备档案匹配（编号 / 序号 / 名称长共现子串 / 类别别名）
  const all = await EquipmentRepository.getAll();
  compact(goal);
  const goalCompact = compact(goal);
  let best: { eq: any; score: number } | null = null;
  for (const eq of all) {
    let score = 0;
    const nameTokens = String(eq.name || "").split(/\s*#/);
    const seq = (nameTokens[0] || "").match(/\d+/)?.[0];
    // ① 序号匹配（"2#" / "2号"）
    if (seq && (goalCompact.includes(`${seq}#`) || goalCompact.includes(`${seq}号`) || goalCompact.includes(`${seq}号机`))) {
      score += 100;
    }
    // ② 设备名长共现子串（最长前缀命中）
    for (const token of nameTokens) {
      const t = compact(token);
      if (t.length < 2) continue;
      for (let k = t.length; k >= 2; k--) {
        if (goalCompact.includes(t.slice(0, k))) {
          score += k * 10;
          break;
        }
      }
    }
    // ③ 类别别名
    const aliasToken = Object.entries(GOAL_ALIAS).find(([alias]) => goal.includes(alias));
    if (aliasToken && compact(String(eq.category || "")).includes(aliasToken[1])) {
      score += 20;
    }
    // ④ 设备编号（EQ-2024-COMP-02 → COMP）
    const codeToken = String(eq.code || "").toUpperCase();
    if (codeToken && goalCompact.toUpperCase().includes(codeToken)) score += 80;
    if (score > 0 && (!best || score > best.score)) best = { eq, score };
  }
  // 序号匹配最低门槛：匹配分要 >1 个孤字命中，避免"泵"字误中全部泵类
  if (best && best.score >= 60) {
    return { equipment: best.eq, equipmentId: best.eq.id, faultKeyword };
  }
  return { equipment: null, equipmentId: null, faultKeyword };
}

function compact(s: string): string {
  return String(s || "").replace(/[\s,，。·()（）\-_/]/g, "");
}

// ==================== 创建闭环 + 六环节 + 八项产出物 ====================

export async function createLoop(params: {
  goal: string;
  equipmentId?: string;
  user: any;
}): Promise<any> {
  const parsed = await resolveEquipment(params.goal, params.equipmentId);
  const eq = parsed.equipment;
  const loopId = generateLoopId();
  const loopNo = await generateLoopNo();

  const loop = await BusinessLoopRepository.createLoop({
    id: loopId,
    loopNo,
    goal: params.goal,
    equipmentId: parsed.equipmentId,
    initiatorId: params.user?.id ? String(params.user.id) : null,
    currentStage: 1,
    expectedMinutes: STAGE_DEFS.reduce((a, s) => a + s.minutes, 0),
  });
  if (!loop) throw new BusinessLoopError(500, "闭环创建失败，请稍后重试");

  // 六环节登记：环节1 置 in_progress，其余 pending
  for (const def of STAGE_DEFS) {
    await BusinessLoopRepository.insertStage({
      id: generateStageId(loopId, def.no),
      loopId,
      stageNo: def.no,
      stageKey: def.key,
      status: def.no === 1 ? "in_progress" : "pending",
      pageRef: def.pageRef,
    });
  }
  // 八项产出物先全部置 pending，待对应环节确认后生成（禁止预先生成假单据）
  let seq = 0;
  for (const art of ARTIFACT_DEFS) {
    await BusinessLoopRepository.insertArtifact({
      id: generateArtifactId(loopId, ++seq),
      loopId,
      artifactType: art.type,
      title: art.title,
      status: "pending",
    });
  }

  addAuditLog(null, {
    actionType: "BUSINESS_LOOP_CREATED",
    module: "业务管家",
    detail: `创建业务闭环 ${loopNo}：「${params.goal}」 设备=${eq ? `${eq.name}(${eq.code})` : "未识别"}`,
    status: "SUCCESS",
    metadata: { loopId, loopNo, equipmentId: parsed.equipmentId, goal: params.goal },
  });

  // 异步 AI 预填（fire-and-forget）：失败只如实标记 degraded，不抛给创建请求
  void prefillStages(loopId, params.goal, eq).catch((err: any) => {
    logger.error(`[BusinessLoop ${loopNo}] 预填编排异常:`, err?.message || err);
  });

  return buildLoopDetail(loopId);
}

// ==================== 异步 AI 预填编排（环节 1-4 串行，输出互为上下文） ====================

async function prefillStages(loopId: string, goal: string, eq: any | null): Promise<void> {
  try {
    await runPrefillSequence(loopId, goal, eq);
  } finally {
    await ensurePrefillOutcome(loopId);
  }
}

/** 兜底回写：预填编排异常中断时，把仍未回写的环节如实标 degraded，防止人工闸门被永久卡住 */
async function ensurePrefillOutcome(loopId: string): Promise<void> {
  for (const def of STAGE_DEFS.slice(0, 4)) {
    try {
      const stage = await BusinessLoopRepository.getStage(loopId, def.no);
      if (!stage || stage.aiStatus) continue;
      await BusinessLoopRepository.updateStagePrefill(loopId, def.no, {
        aiPrefillJson: JSON.stringify({
          degraded: true,
          workOrderDraft: null,
          assessment: null,
          plan: null,
          lotoItems: [],
          message: `环节 ${def.no} 的预填未回写（编排异常或服务中断），请人工填写要素后再确认`,
        }),
        aiEngine: PREFILL_ENGINES[def.no],
        aiStatus: "degraded",
      });
    } catch (err: any) {
      logger.error(`[BusinessLoop] 环节 ${def.no} 预填兜底回写失败:`, err?.message || err);
    }
  }
}

const PREFILL_ENGINES: Record<number, string> = {
  1: "generate-work-order",
  2: "safety-risk-assessment",
  3: "safety-interlock-rules",
  4: "generate-maintenance-plan",
};

async function runPrefillSequence(loopId: string, goal: string, eq: any | null): Promise<void> {
  const telemetry = eq?.telemetry || {};
  const eqCtx = eq
    ? `${eq.name} (${eq.code}) | 类别: ${eq.category || "未知"} | 型号: ${eq.model || "未知"} | 车间: ${eq.workshop || "未知"} | 位置: ${eq.location || "未知"}`
    : "未识别到具体设备（目标文本未命中设备台账）";
  const teleCtx = eq
    ? `温度 ${tele0(telemetry.temperature)}°C (经验限值 < ${TEMP_LIMIT}°C) | 振动 ${tele0(telemetry.vibration)} mm/s (限值 < ${VIB_LIMIT} mm/s) | 负载率 ${tele0(telemetry.loadRate)}% (限值 < ${LOAD_LIMIT}%) | 健康分 ${eq.healthScore ?? "未知"}`
    : "无遥测数据";

  // ---- 环节 1：工单草稿（generate-work-order，DashScope 真实调用） ----
  const draft = await runWorkOrderDraftCore({ goal, eq, telemetry, eqCtx, teleCtx });
  let draftOutcome = draft.outcome;
  if (draftOutcome === "failed" || draftOutcome === "unavailable") draftOutcome = "degraded";
  const stage1Success = draftOutcome === "success" || draftOutcome === "cache" || draftOutcome === "degraded";
  if (draft.body) {
    await BusinessLoopRepository.updateStagePrefill(loopId, 1, {
      aiPrefillJson: JSON.stringify({ workOrderDraft: draft.body.workOrderDraft || null, message: draft.body.message || draft.body.error || null }),
      aiEngine: "generate-work-order",
      aiStatus: stage1Success && draft.body.workOrderDraft ? "ok" : "degraded",
    });
  }

  const draftSteps: string[] = draft.body?.workOrderDraft?.recommendedSteps || [];
  const draftSafety: string[] = draft.body?.workOrderDraft?.safetyNotes || [];

  // ---- 环节 2：JSA 风险评估（复用 aiCapabilityService 核心） ----
  const jsa: CapabilityResult = await runSafetyRiskAssessmentCore({
    permitType: "设备检修作业票",
    equipmentId: eq?.id,
    workDescription: `${goal}${draftSteps.length ? `。工单建议步骤：${draftSteps.slice(0, 3).join("；")}` : ""}`,
    location: eq?.location || eq?.workshop,
    hazards: draftSafety.slice(0, 4),
  });
  const jsaAssessment = jsa.body?.assessment || null;
  await BusinessLoopRepository.updateStagePrefill(loopId, 2, {
    aiPrefillJson: JSON.stringify({
      assessment: jsaAssessment,
      degraded: jsa.outcome !== "success" && jsa.outcome !== "cache",
      message: jsa.body?.message || jsa.errorMessage || null,
    }),
    aiEngine: "safety-risk-assessment",
    aiStatus: jsa.outcome === "success" || jsa.outcome === "cache" ? "ok" : "degraded",
  });

  // ---- 环节 3：LOTO 隔离建议（safety-interlock 规则，非 AI） ----
  const lotoAdvisory = await buildLotoAdvisory(eq, jsaAssessment, loopId);
  await BusinessLoopRepository.updateStagePrefill(loopId, 3, {
    aiPrefillJson: JSON.stringify(lotoAdvisory),
    aiEngine: "safety-interlock-rules",
    aiStatus: "ok",
  });

  // ---- 环节 4：检修方案（复用 aiCapabilityService 核心） ----
  const plan: CapabilityResult = await runMaintenancePlanCore({
    equipmentId: eq ? eq.id : "",
    faultDescription: `${goal}${jsaAssessment?.riskLevel ? `。JSA 风险等级：${jsaAssessment.riskLevel}` : ""}`,
  });
  const planData = plan.body?.plan || null;
  await BusinessLoopRepository.updateStagePrefill(loopId, 4, {
    aiPrefillJson: JSON.stringify({
      plan: planData,
      degraded: plan.outcome !== "success" && plan.outcome !== "cache",
      message: plan.body?.message || plan.errorMessage || plan.body?.error || null,
    }),
    aiEngine: "generate-maintenance-plan",
    aiStatus: plan.outcome === "success" || plan.outcome === "cache" ? "ok" : "degraded",
  });
}

/** 兜底：telemetry 数值取 0 显示（不经手任何编造值） */
function tele0(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 环节 1 核心：工单草稿生成（与 /api/v1/ai/generate-work-order 同源 DashScope 通道 + aiCache） */
async function runWorkOrderDraftCore(input: {
  goal: string;
  eq: any | null;
  telemetry: any;
  eqCtx: string;
  teleCtx: string;
}): Promise<CapabilityResult> {
  const cacheKey = "generate-work-order";
  const cacheInput = { goal: input.goal, equipmentId: input.eq?.id || "" };
  const cached = aiCacheGet(cacheKey, cacheInput);
  if (cached) {
    return { outcome: "cache", body: { workOrderDraft: cached.value?.workOrderDraft || cached.value, fromCache: true, cachedAt: cached.cachedAt, model: "cache" } };
  }

  const fault = ["振动", "温度", "过热", "高温", "泄漏", "异响", "噪音", "压力", "卡涩", "磨损", "跳停", "联锁", "报警"].find((k) => input.goal.includes(k)) || "异常";
  const userPrompt = `请依据以下真实设备档案与业务目标，起草一份检修工单（仅草稿，不落库）。
【业务目标】${input.goal}
【设备档案】${input.eqCtx}
【实时遥测】${input.teleCtx}
【判别故障线索】${fault}

严格按如下 JSON 结构输出:
{
  "title": "工单标题（20字内，含设备名与故障）",
  "faultType": "机械振动|轴承温度|润滑系统|气路与密封|电气联锁|传动部件|其他",
  "priority": "urgent|high|medium|low 之一",
  "description": "现场情况描述（80字内，引用真实遥测数值）",
  "estimatedHours": 4,
  "recommendedSteps": ["检查/处置步骤1", "步骤2", "步骤3"],
  "safetyNotes": ["开工前安全注意事项1", "注意2"]
}`;

  try {
    const { data } = await callDashScopeJson(AI_EXPERT_SYSTEM, userPrompt);
    if (!data?.title) {
      return { outcome: "degraded", errorMessage: "AI 返回内容缺少工单标题字段", body: { success: false, degraded: true, message: "工单草稿 AI 预填失败（返回结构缺失），请人工填写工单要素" } };
    }
    const body = { success: true, workOrderDraft: data, model: DASHSCOPE_CHAT_MODEL };
    aiCacheSet(cacheKey, cacheInput, { workOrderDraft: data }, { equipmentId: input.eq?.id });
    return { outcome: "success", body };
  } catch (err: any) {
    if (err instanceof AiUnavailableError) {
      return { outcome: "degraded", errorMessage: err.message, body: { success: false, degraded: true, message: `AI 服务未配置或不可用：${err.message}` } };
    }
    return { outcome: "degraded", errorMessage: err?.message || String(err), body: { success: false, degraded: true, message: `AI 预填失败（${String(err?.message || err).slice(0, 120)}），请人工填写工单要素` } };
  }
}

/** 环节 3 核心：LOTO 隔离建议（safety-interlock 规则推演：JSA 隔离点 → 类别能量源兜底 + 库内真实锁具匹配） */
async function buildLotoAdvisory(eq: any | null, jsaAssessment: any, loopId: string) {
  const jsaPoints: string[] = Array.from(new Set((jsaAssessment?.lotoAdvice?.isolationPoints || []).map((s: any) => String(s))));
  // JSA（环节 2 的 AI 能力）未输出隔离点时，退到设备类别的通用能量源清单：
  // 只到「能量源 + 部位」粒度，不虚构点位编号与锁号，逐项人工确认的闸门一分不放。
  const ruleFallback = jsaPoints.length === 0;
  const seedItems = ruleFallback
    ? energySourceItemsFor(eq)
    : jsaPoints.map((point) => ({ type: classifyLotoType(point), point }));

  // 库内真实锁具按设备匹配（台账无 equipment_id 字段，按 pointName/energySource 归属判断）
  const locks = await LotoLockRepository.getAll();
  const eqLocks = eq
    ? locks.filter((l: any) => String(l.pointName || l.energySource || "").includes(eq.name || "\u0000"))
    : [];

  const lotoItems = seedItems.map((item: any, idx: number) => {
    // 锁具编号只取台账真实锁；未匹配到就留空，由现场登记（不编造锁号）
    const matchedLock = eqLocks.find((l: any) => classifyLotoType(l.pointName || l.energySource || "") === item.type);
    return {
      id: `loto-${loopId}-${idx + 1}`,
      type: item.type,
      point: item.point,
      requirement: lotoRequirement(item.type, item.point),
      lockNumber: matchedLock?.lockNo || "",
      basis: ruleFallback ? "类别规则兜底" : "JSA 评估输出",
      confirmed: false,
      operator: "待现场确认",
    };
  });

  const basisNote = ruleFallback
    ? (lotoItems.length
      ? `JSA 未输出隔离点，以下按设备类别「${eq?.category || "通用机组"}」的通用能量源清单推演（GB/T 33579），点位编号与锁号需现场核对后登记。`
      : "未识别到台账设备，无法按类别推演能量源；请依据 GB/T 33579 结合现场实际手动补充隔离点后再确认。")
    : "隔离点由 JSA 评估结果推演；锁具编号匹配设备台账真实锁具，未匹配项由现场登记后确认。";

  return {
    isolationPoints: lotoItems.map((i: any) => i.point),
    basis: ruleFallback ? "category-rule" : "jsa",
    lockRequired: jsaAssessment?.lotoAdvice?.required !== false,
    lockCount: jsaAssessment?.lotoAdvice?.lockCount || lotoItems.length,
    existingLocks: eqLocks.map((l: any) => ({ lockNo: l.lockNo, status: l.status, pointName: l.pointName })),
    lotoItems,
    standards: ["GB/T 33579-2017 机械安全 危险能量控制方法 锁定/挂牌", "GB 30871 危险化学品企业特殊作业安全规范"],
    note: basisNote,
  };
}

/** 类别 → 通用能量源清单（只在 JSA 降级时兜底；类型直接给定，避免关键字猜测） */
const ENERGY_SOURCE_RULES: Array<{ match: RegExp; items: Array<{ type: string; point: string }> }> = [
  {
    match: /压缩机/,
    items: [
      { type: "电气隔离", point: "主电源进线断路器与控制系统回路" },
      { type: "气源隔离", point: "排气总管与储气罐入口截止阀（压缩空气）" },
      { type: "残余能量", point: "停机后通气管路与油气分离腔泄放残压" },
      { type: "机械隔离", point: "联轴器与皮带传动部件" },
    ],
  },
  {
    match: /泵/,
    items: [
      { type: "电气隔离", point: "主电源进线断路器与控制系统回路" },
      { type: "液压隔离", point: "进口与出口隔离阀及管路介质" },
      { type: "残余能量", point: "泵腔与蓄能器泄放残压" },
      { type: "机械隔离", point: "联轴器与叶轮转动部件" },
    ],
  },
  {
    match: /齿轮|减速/,
    items: [
      { type: "电气隔离", point: "主电源进线断路器与控制系统回路" },
      { type: "液压隔离", point: "稀油站油泵与润滑管路" },
      { type: "机械隔离", point: "输入轴/输出轴联轴器与制动轮" },
      { type: "残余能量", point: "轴系残余应力与活动部件自重势能" },
    ],
  },
  {
    match: /电机/,
    items: [
      { type: "电气隔离", point: "主回路断路器与励磁、控制回路" },
      { type: "液压隔离", point: "冷却介质管路隔离阀与压力" },
      { type: "机械隔离", point: "联轴器与转子转动部件" },
    ],
  },
  {
    match: /机器人|机械臂/,
    items: [
      { type: "电气隔离", point: "控制柜主电源与伺服驱动器供电" },
      { type: "气源隔离", point: "气动夹爪与末端执行器气路截止阀" },
      { type: "残余能量", point: "各关节抱闸与弹簧残余力矩" },
      { type: "机械隔离", point: "机械臂各轴活动部件定位销与防坠支撑" },
    ],
  },
  {
    match: /换热|冷凝|加热器/,
    items: [
      { type: "电气隔离", point: "循环泵与风机主电源回路" },
      { type: "液压隔离", point: "一次侧与二次侧进出口隔离阀" },
      { type: "残余能量", point: "腔体余温与残余压力泄放（双表核读）" },
    ],
  },
  {
    match: /机床|数控/,
    items: [
      { type: "电气隔离", point: "总电源进线与伺服驱动回路" },
      { type: "气源隔离", point: "气动卡盘与换刀装置气路截止阀" },
      { type: "液压隔离", point: "液压站与管路残余压力" },
      { type: "机械隔离", point: "主轴与刀库传动部件" },
    ],
  },
];

const GENERIC_ENERGY_ITEMS = [
  { type: "电气隔离", point: "设备主电源进线断路器与控制回路" },
  { type: "机械隔离", point: "动力传动与活动部件" },
  { type: "残余能量", point: "停机后残余压力/张力泄放" },
];

function energySourceItemsFor(eq: any | null): Array<{ type: string; point: string }> {
  if (!eq) return [];
  const key = `${eq.category || ""}${eq.name || ""}`;
  const rule = ENERGY_SOURCE_RULES.find((r) => r.match.test(key));
  return rule ? rule.items : GENERIC_ENERGY_ITEMS;
}

function classifyLotoType(point: string): string {
  const p = compact(point);
  if (/电|断路器|电源|开关|验电/.test(p)) return "电气隔离";
  if (/气|阀|压缩空气|气压/.test(p)) return "气源隔离";
  if (/压|泄|残余|蓄能/.test(p)) return "残余能量";
  if (/皮|带|旋转|联轴|机械|传动/.test(p)) return "机械隔离";
  return "其他隔离";
}

function lotoRequirement(type: string, point: string): string {
  switch (type) {
    case "电气隔离":
      return "分闸断电，使用验电器三相验电确认无电压，挂「禁止合闸·有人工作」警示牌并上锁保管钥匙";
    case "气源隔离":
      return "沿时钟方向关闭隔离阀至全关位，加装锁闭夹具并挂牌，登记锁具编号，严禁擅自开阀";
    case "液压隔离":
      return "关闭进口与出口隔离阀至全关位并加装盲板/水封，挂牌上锁，登记锁具编号，严禁擅自开阀";
    case "残余能量":
      return "缓慢开启泄放阀至压力表归零（双表核读），现场拍照存证后挂牌";
    case "机械隔离":
      return "去除动力源并固定活动部件，插入定位销/皮带防护护罩摘除，挂牌上锁";
    default:
      return `按 GB/T 33579 对「${point}」实施能量隔离：上锁 → 挂牌 → 验证零能量 → 双人复核登记`;
  }
}

// ==================== 人工确认闸门 ====================

export async function confirmStage(params: {
  loopId: string;
  stageNo: number;
  user: any;
}): Promise<any> {
  const loop = await BusinessLoopRepository.getLoopById(params.loopId);
  if (!loop) throw new BusinessLoopError(404, "闭环不存在，请刷新列表", "LOOP_NOT_FOUND");
  if (loop.status !== "running") {
    throw new BusinessLoopError(409, `闭环当前状态为「${loop.status}」，处于该状态时不允许推进环节`, "LOOP_NOT_RUNNING");
  }
  if (loop.currentStage !== params.stageNo) {
    throw new BusinessLoopError(409, `确认环节 ${params.stageNo} 被拒绝：当前进行中环节为第 ${loop.currentStage} 环节`, "STAGE_SEQUENCE_MISMATCH");
  }

  const stage = await BusinessLoopRepository.getStage(params.loopId, params.stageNo);
  if (!stage) throw new BusinessLoopError(404, `环节 ${params.stageNo} 记录缺失，请联系管理员`, "STAGE_NOT_FOUND");
  if (stage.status !== "in_progress") {
    throw new BusinessLoopError(409, `环节 ${params.stageNo} 当前状态为「${stage.status}」，不可确认`, "STAGE_NOT_IN_PROGRESS");
  }
  // 环节 1-4 的确认要以预填为上下文（工单要素 / JSA 风险档与隔离点 / 检修方案）；
  // 预填还没落库就确认，会把真实 AI 结果错过并落成「未评级」的空单据。
  if (params.stageNo <= 4 && !stage.aiStatus) {
    throw new BusinessLoopError(
      409,
      `环节 ${params.stageNo} 的 AI 预填尚未回写（真实调用进行中），请等页面显示预填内容后再确认`,
      "PREFILL_PENDING"
    );
  }

  const eq = loop.equipmentId ? await EquipmentRepository.getById(loop.equipmentId) : null;
  const confirmBy = params.user?.name || params.user?.username || "未知用户";

  // 各环节闸门动作：落成真实业务记录（写现有 repository，禁止伪造记录）
  switch (params.stageNo) {
    case 1:
      await settleWorkOrder(loop, stage, eq, params.user);
      break;
    case 2:
      await settleSafetyPermit(loop, stage, eq, params.user);
      break;
    case 3:
      await assertLotoAllConfirmed(stage);
      await settleLotoChecklist(loop, stage);
      break;
    case 4:
      await settleWorkGuide(loop, stage);
      break;
    case 5:
      await settleAcceptance(loop, eq);
      break;
    case 6:
      // 归档动作在 complete 里完成（质检报告 + 知识沉淀）
      break;
    default:
      throw new BusinessLoopError(400, "环节编号超出 1-6 范围");
  }

  await BusinessLoopRepository.confirmStage(params.loopId, params.stageNo, confirmBy);

  const nextStageNo = params.stageNo < 6 ? params.stageNo + 1 : params.stageNo;
  if (params.stageNo < 6) {
    await BusinessLoopRepository.updateLoopCurrentStage(params.loopId, nextStageNo);
    await BusinessLoopRepository.setStageInProgress(params.loopId, nextStageNo);
  }

  addAuditLog(null, {
    actionType: "BUSINESS_LOOP_STAGE_CONFIRM",
    module: "业务管家",
    detail: `${confirmBy} 确认闭环 ${loop.loopNo} 环节${params.stageNo}（${stageDef(params.stageNo).title}）`,
    status: "SUCCESS",
    metadata: { loopId: params.loopId, stageNo: params.stageNo, confirmBy },
  });

  const detail = await buildLoopDetail(params.loopId);
  return detail;
}

/** 环节1 确认：工单草稿落成真实工单（work_orders） */
async function settleWorkOrder(loop: any, stage: any, eq: any | null, user: any) {
  if (stage.producedArtifactRef) return; // 幂等
  const draft = stage.aiPrefill?.workOrderDraft || {};
  const creator = user?.name || user?.username || "业务管家";
  const order = await WorkOrderRepository.create({
    title: draft.title || `${eq ? eq.name : "设备"}故障检修`,
    equipmentId: eq?.id || undefined,
    equipmentName: eq?.name || "未识别设备",
    equipmentCode: eq?.code || "",
    workshop: eq?.workshop || "",
    faultType: draft.faultType || "其他",
    priority: draft.priority || "medium",
    description: `${loop.goal}${Array.isArray(draft.recommendedSteps) && draft.recommendedSteps.length ? "\nAI 建议步骤：" + draft.recommendedSteps.join("；") : ""}${stage.aiPrefill?.message ? "\n（AI 预填状态：" + stage.aiPrefill.message + "）" : ""}`,
    safetyRequirements: Array.isArray(draft.safetyNotes) ? draft.safetyNotes.slice(0, 6) : [],
    creator,
    source: "business_loop",
  });
  if (!order) throw new BusinessLoopError(500, "工单落库失败，请稍后重试");
  await BusinessLoopRepository.markArtifactGenerated(loop.id, "work_order", {
    refId: order.id,
    status: "generated",
    previewText: buildWorkOrderPreview(order, loop),
    aiUsed: stage.aiEngine || "generate-work-order",
  });
  await BusinessLoopRepository.updatePrefillArtifactRef(loop.id, 1, order.orderNo);
}

/** 环节2 确认：JSA 预填落成真实作业票（safety_permits，状态 pending_approval 待双人会签） */
async function settleSafetyPermit(loop: any, stage: any, eq: any | null, user: any) {
  if (stage.producedArtifactRef) return; // 幂等
  const assessment = stage.aiPrefill?.assessment || {};
  // JSA 输出 4 档结论，作业票按站内 Level 1-4 口径登记（getRiskBadge 只认 Level 字样，
  // 传裸「高/中/低」会被兜底渲染成「低风险」）；未评定时如实标注，绝不落到最低档。
  const riskLevel = JSA_RISK_TO_LEVEL[String(assessment.riskLevel || "").trim()] || "待人工 JSA 评定（未评级）";
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`;
  // permit_no 列 UNIQUE：号序直接取本闭环的当日序号（PL-YYYYMMDD-NNN → SP-YYYYMMDD-LNNN），
  // 同一天两条闭环并发确认也不会撞号；用 HHMM/HHMMSS 计时会在同一秒内撞。
  const loopSeq = String(loop.loopNo || "").split("-").pop();
  const permitNo = `SP-${dateStr}-L${/^\d{3}$/.test(loopSeq || "") ? loopSeq : `${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`}`;
  const result = await SafetyPermitRepository.create({
    id: `sp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    permitNo,
    permitType: "设备检修作业票",
    riskLevel,
    title: `${eq ? eq.name : "设备"} 检修作业（业务闭环 ${loop.loopNo}）`,
    equipmentId: eq?.id || null,
    equipmentName: eq?.name || null,
    workshop: eq?.workshop || null,
    location: eq?.location || null,
    applicant: user?.name || user?.username || "业务管家",
    applicantDept: user?.department || null,
    appliedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString(),
    status: "pending_approval",
    precautions: Array.isArray(assessment.jsaMeasures) ? assessment.jsaMeasures.map((m: any) => `${m.hazard}: ${m.control}`) : [],
    lotoNumber: null,
    hazards: Array.isArray(assessment.hazardIdentifications) ? assessment.hazardIdentifications.map((h: any) => `${h.category}: ${h.hazard}（等级 ${h.level}）`) : [],
    safetyChecklist: [],
  });
  if (!result) throw new BusinessLoopError(500, "作业票落库失败，请稍后重试");
  await BusinessLoopRepository.markArtifactGenerated(loop.id, "hazard_permit", {
    refId: result.id,
    status: "generated",
    previewText: buildPermitPreview(result),
    aiUsed: stage.aiEngine || "safety-risk-assessment",
  });
  await BusinessLoopRepository.updatePrefillArtifactRef(loop.id, 2, permitNo);
}

/** 环节3 确认闸门：LOTO 必须全部人工逐项确认（与前端闸门同源的服务端硬校验） */
async function assertLotoAllConfirmed(stage: any) {
  const prefill = stage.aiPrefill || {};
  const items: any[] = Array.isArray(prefill.lotoItems) ? prefill.lotoItems : [];
  if (!items.length) {
    throw new BusinessLoopError(400, "LOTO 隔离清单为空，请先在安全与LOTO页确认隔离方案", "LOTO_EMPTY");
  }
  const unconfirmed = items.filter((i) => !i.confirmed);
  if (unconfirmed.length) {
    throw new BusinessLoopError(
      400,
      `LOTO 能量隔离要求 100% 确认（当前 ${items.length - unconfirmed.length}/${items.length} 项）：未确认项「${unconfirmed.map((i) => i.point).join("、")}」`,
      "LOTO_NOT_FULLY_CONFIRMED"
    );
  }
}

/** 环节3 确认：LOTO 清单落成已生成档案 */
async function settleLotoChecklist(loop: any, stage: any) {
  await BusinessLoopRepository.markArtifactGenerated(loop.id, "loto_checklist", {
    refId: `${loop.loopNo}-LOTO`,
    status: "generated",
    previewText: buildLotoPreview(loop, stage.aiPrefill || {}),
    aiUsed: stage.aiEngine || "safety-interlock-rules",
  });
}

/** 环节4 确认：检修方案落成作业指引档案 */
async function settleWorkGuide(loop: any, stage: any) {
  const plan = stage.aiPrefill?.plan || null;
  await BusinessLoopRepository.markArtifactGenerated(loop.id, "work_guide", {
    refId: `${loop.loopNo}-SOP`,
    status: "generated",
    previewText: buildGuidePreview(loop, plan, stage.aiPrefill?.degraded === true),
    aiUsed: stage.aiEngine || "generate-maintenance-plan",
  });
}

/** 环节5 确认：验收记录（引用真实工单状态与遥测限值） */
async function settleAcceptance(loop: any, eq: any | null) {
  const woArtifact = await BusinessLoopRepository.getArtifactByType(loop.id, "work_order");
  const order = woArtifact?.refId ? await WorkOrderRepository.getById(woArtifact.refId) : null;
  const telemetry = eq?.telemetry || {};
  await BusinessLoopRepository.markArtifactGenerated(loop.id, "acceptance", {
    refId: order?.id || woArtifact?.refId || null,
    status: "generated",
    previewText: buildAcceptancePreview(loop, order, eq, telemetry),
    aiUsed: null,
  });
}

// ==================== LOTO 隔离点逐项确认（独立闸门，非环节推进） ====================

export async function confirmLotoPoint(params: {
  loopId: string;
  itemId: string;
  confirmed: boolean;
  user: any;
}): Promise<any> {
  const stage = await BusinessLoopRepository.getStage(params.loopId, 3);
  if (!stage) throw new BusinessLoopError(404, "闭环或环节记录不存在", "STAGE_NOT_FOUND");
  if (stage.status === "completed") {
    throw new BusinessLoopError(409, "LOTO 环节已确认完成，隔离点状态不可再修改", "STAGE_LOCKED");
  }
  const prefill = stage.aiPrefill || {};
  const items: any[] = Array.isArray(prefill.lotoItems) ? prefill.lotoItems : [];
  const idx = items.findIndex((i) => i.id === params.itemId);
  if (idx < 0) throw new BusinessLoopError(404, `隔离点 ${params.itemId} 不存在`, "LOTO_ITEM_NOT_FOUND");

  const now = new Date();
  const fmtTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  items[idx] = {
    ...items[idx],
    confirmed: params.confirmed,
    operator: params.confirmed ? `${params.user?.name || params.user?.username || "未知用户"} (${params.user?.roleTitle || params.user?.role || ""})`.replace(/ \(\)$/, "") : "待现场确认",
    confirmTime: params.confirmed ? fmtTime : undefined,
  };
  prefill.lotoItems = items;
  await BusinessLoopRepository.updateStagePrefill(params.loopId, 3, {
    aiPrefillJson: JSON.stringify(prefill),
    aiEngine: stage.aiEngine || "safety-interlock-rules",
    aiStatus: stage.aiStatus || "ok",
  });
  return buildLoopDetail(params.loopId);
}

// ==================== 归档闭环（质检报告 + 知识沉淀 + 全套产出物） ====================

export async function completeLoop(params: { loopId: string; user: any }): Promise<any> {
  const loop = await BusinessLoopRepository.getLoopById(params.loopId);
  if (!loop) throw new BusinessLoopError(404, "闭环不存在，请刷新列表", "LOOP_NOT_FOUND");
  if (loop.status === "archived") throw new BusinessLoopError(409, "闭环已归档，无需重复操作", "LOOP_ARCHIVED");

  const stages = await BusinessLoopRepository.listStages(params.loopId);
  const notCompleted = stages.filter((s) => s.status !== "completed");
  if (notCompleted.length) {
    throw new BusinessLoopError(
      400,
      `闭环归档被拒绝：尚有 ${notCompleted.length} 个环节未完成（环节 ${notCompleted.map((s) => s.stageNo).join(", ")}）`,
      "STAGES_INCOMPLETE"
    );
  }

  // ---- 质检报告（generate-report，DashScope 真实调用） ----
  const eq = loop.equipmentId ? await EquipmentRepository.getById(loop.equipmentId) : null;
  const woArtifact = await BusinessLoopRepository.getArtifactByType(params.loopId, "work_order");
  const order = woArtifact?.refId ? await WorkOrderRepository.getById(woArtifact.refId) : null;
  const report = await runGenerateReportCore(loop, eq, order);

  await BusinessLoopRepository.markArtifactGenerated(params.loopId, "quality_report", {
    refId: loop.loopNo,
    status: "generated",
    previewText: buildReportPreview(loop, report.body?.report || null),
    aiUsed: "generate-report",
  });

  // ---- 知识沉淀（suggest-contribution 同源判定 + 贡献表真实落库） ----
  const contribution = await runSuggestContributionCore(params.loopId, loop, eq, order, report.body?.report, params.user);
  const knowledgePrefill: any = { contribution };
  if (contribution.worthContributing && contribution.id) {
    await BusinessLoopRepository.markArtifactGenerated(params.loopId, "knowledge_entry", {
      refId: contribution.id,
      status: "generated",
      previewText: buildKnowledgePreview(contribution),
      aiUsed: "suggest-contribution",
    });
  } else {
    await BusinessLoopRepository.markArtifactGenerated(params.loopId, "knowledge_entry", {
      status: "pending",
      previewText: "AI 判定本次检修未达到「完整可复用案例」沉淀标准，如认为有沉淀价值请在知识库手动提交贡献。",
      aiUsed: "suggest-contribution",
    });
  }

  // ---- 环节 5/6 预填回写（供历史回看） ----
  await BusinessLoopRepository.updateStagePrefill(params.loopId, 5, {
    aiPrefillJson: JSON.stringify({ acceptanceSummary: order ? `关联工单 ${order.orderNo}（状态 ${order.status}）验收记录已生成` : "无关联工单，验收记录仅基于闭环数据" }),
    aiEngine: "business-loop-archive",
    aiStatus: "ok",
  });
  await BusinessLoopRepository.updateStagePrefill(params.loopId, 6, {
    aiPrefillJson: JSON.stringify(knowledgePrefill),
    aiEngine: "suggest-contribution",
    aiStatus: report.outcome === "success" || report.outcome === "cache" ? "ok" : "degraded",
  });

  // ---- 档案综合包 ----
  const counts = await BusinessLoopRepository.countArtifacts(params.loopId);
  await BusinessLoopRepository.markArtifactGenerated(params.loopId, "archive_pack", {
    refId: loop.loopNo,
    status: "generated",
    previewText: buildPackPreview(loop, counts),
    aiUsed: null,
  });

  await BusinessLoopRepository.completeLoop(params.loopId);

  addAuditLog(null, {
    actionType: "BUSINESS_LOOP_COMPLETED",
    module: "业务管家",
    detail: `闭环 ${loop.loopNo} 归档：质检报告 AI outcome=${report.outcome}，知识沉淀=${contribution.worthContributing ? "已入库" : "未达标"}`,
    status: "SUCCESS",
    metadata: { loopId: params.loopId, loopNo: loop.loopNo, reportOutcome: report.outcome, knowledgeWorth: !!contribution.worthContributing },
  });

  return buildLoopDetail(params.loopId);
}

export async function listLoops(filters?: { status?: string; limit?: number }) {
  const loops = await BusinessLoopRepository.listLoops(filters);
  const out: any[] = [];
  for (const loop of loops) {
    const eq = loop.equipmentId ? await EquipmentRepository.getById(loop.equipmentId) : null;
    const initiator = loop.initiatorId ? await UserRepository.getUserById(loop.initiatorId) : null;
    out.push({
      ...loop,
      equipmentName: eq ? `${eq.name}（${eq.code}）` : "",
      initiatorName: initiator?.name || "未知用户",
    });
  }
  return out;
}

// ==================== 质检报告核心（generate-report，DashScope 真实调用） ====================

/** 汇总真实闭环数据（目标/设备遥测/工单/JSA/LOTO/方案）后生成质检报告；失败如实 degraded，不伪造结论 */
async function runGenerateReportCore(
  loop: any,
  eq: any | null,
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

async function runSuggestContributionCore(
  loopId: string,
  loop: any,
  eq: any | null,
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

// ==================== 详情聚合（前端 BusinessClosedLoopData 唯一来源） ====================

export async function buildLoopDetail(loopId: string): Promise<any> {
  const loop = await BusinessLoopRepository.getLoopById(loopId);
  if (!loop) throw new BusinessLoopError(404, "闭环不存在", "LOOP_NOT_FOUND");
  const [stages, artifacts] = await Promise.all([
    BusinessLoopRepository.listStages(loopId),
    BusinessLoopRepository.listArtifacts(loopId),
  ]);

  const eq = loop.equipmentId ? await EquipmentRepository.getById(loop.equipmentId) : null;
  const initiator = loop.initiatorId ? await UserRepository.getUserById(loop.initiatorId) : null;

  const stagesView = stages.map((s) => {
    const def = stageDef(s.stageNo);
    return {
      id: def.stageId,
      order: s.stageNo,
      title: def.title,
      status: s.status,
      aiBadge: def.aiBadge + (s.aiStatus === "degraded" ? "（AI 降级）" : ""),
      outputSummary: def.outputSummary,
      targetPage: def.title,
      targetTabKey: def.pageRef,
      duration: def.durationText,
      completedTime: s.confirmAt ? fmtTimeOfDay(s.confirmAt) : undefined,
      aiPrefill: {
        engine: s.aiEngine || undefined,
        status: s.aiStatus || undefined,
        generatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined,
        content: stagePrefillContent(s),
        advice: stagePrefillAdvice(s),
        raw: s.aiPrefill || null,
      },
    };
  });

  const artifactsView = artifacts.map((a) => {
    const stageNo = ARTIFACT_DEFS.find((d) => d.type === a.artifactType)?.stageNo ?? 6;
    const def = ARTIFACT_DEFS.find((d) => d.type === a.artifactType)!;
    return {
      id: a.id,
      code: a.refId || artifactDisplayCode(loop.loopNo, a.artifactType),
      name: a.title || def.title,
      stageId: stageDef(stageNo).stageId,
      status: a.status === "generated" ? "ready" : "pending",
      category: categoryOf(a.artifactType),
      previewContent: a.previewText || "",
    };
  });

  const lotoStage = stages.find((s) => s.stageNo === 3);
  const lotoItems = (lotoStage?.aiPrefill?.lotoItems || []).map((i: any) => ({
    id: i.id,
    type: i.type,
    point: i.point,
    requirement: i.requirement,
    lockNumber: i.lockNumber,
    basis: i.basis || "JSA 评估输出",
    confirmed: !!i.confirmed,
    operator: i.operator || "待现场确认",
    confirmTime: i.confirmTime,
  }));

  const completedCount = stages.filter((s) => s.status === "completed").length;
  const startedAtMs = startTimeMs(loop);
  const elapsedHours = Math.max(0, (Date.now() - (startedAtMs ?? Date.now())) / 3_600_000);
  const equipmentView = mapEquipmentForFrontend(eq);

  const detail = {
    id: loop.id,
    loopCode: loop.loopNo || "",
    status: loop.status,
    businessGoal: loop.goal,
    equipment: equipmentView,
    initiator: {
      name: initiator?.name || "未知用户",
      role: initiator?.roleTitle || initiator?.role || "",
      time: loop.startedAt ? `${fmtDate(loop.startedAt)} ${fmtTimeOfDay(loop.startedAt)}` : fmtNow(),
    },
    progress: {
      currentStageOrder: loop.currentStage,
      totalStages: 6,
      percent: Math.round((completedCount / 6) * 100),
      estimatedTotalHours: round1((loop.expectedMinutes || STAGE_DEFS.reduce((a, s) => a + s.minutes, 0)) / 60),
      elapsedHours: round1(elapsedHours),
    },
    stages: stagesView,
    lotoItems,
    artifacts: artifactsView,
    suggestions: buildSuggestions(loop, stagesView, lotoItems, completedCount === 6),
  };
  return detail;
}

/** 历史（已归档）闭环 → HistoryLoopItem[] */
export async function buildHistoryItems(): Promise<any[]> {
  const loops = await BusinessLoopRepository.listLoops({ status: "archived", limit: 20 });
  const items: any[] = [];
  for (const loop of loops) {
    const counts = await BusinessLoopRepository.countArtifacts(loop.id);
    const eq = loop.equipmentId ? await EquipmentRepository.getById(loop.equipmentId) : null;
    const initiator = loop.initiatorId ? await UserRepository.getUserById(loop.initiatorId) : null;
    const startedMs = startTimeMs(loop);
    const endMs = completedTimeMs(loop);
    const durationHours = startedMs && endMs ? Math.max(0.1, (endMs - startedMs) / 3_600_000) : null;
    items.push({
      id: loop.id,
      loopCode: loop.loopNo || "",
      targetGoal: loop.goal,
      equipmentName: eq?.name || "未识别设备",
      status: "archived",
      duration: durationHours != null ? `${round1(durationHours)}h` : "—",
      artifactCount: counts.generated,
      knowledgeCount: counts.knowledgeCount,
      closedDate: loop.completedAt ? `${fmtDate(loop.completedAt)} ${fmtTimeOfDay(loop.completedAt)}` : fmtDate(loop.updatedAt || loop.startedAt), 
      leadUser: initiator?.name || "未知用户",
    });
  }
  return items;
}

// ==================== 内部组装工具 ====================

function mapEquipmentForFrontend(eq: any | null) {
  const te = eq?.telemetry || {};
  if (!eq) {
    return {
      id: "",
      code: "",
      name: "未识别设备",
      model: "",
      workshop: "",
      status: "normal" as const,
      temperature: 0,
      temperatureThreshold: TEMP_LIMIT,
      vibration: 0,
      loadRate: 0,
      healthScore: 0,
    };
  }
  const rawStatus = String(eq.status || "");
  const status: "warning" | "normal" | "danger" =
    ["fault", "critical"].includes(rawStatus) ? "danger" : rawStatus === "warning" ? "warning" : "normal";
  return {
    id: eq.id,
    code: eq.code,
    name: eq.name,
    model: eq.model || "",
    workshop: String(eq.workshop || ""),
    status,
    temperature: tele0(te.temperature),
    temperatureThreshold: TEMP_LIMIT,
    vibration: tele0(te.vibration),
    loadRate: tele0(te.loadRate),
    healthScore: Number.isFinite(Number(eq.healthScore)) ? Number(eq.healthScore) : 0,
  };
}

function stagePrefillContent(stage: any): string | null {
  const p = stage.aiPrefill;
  if (!p) return null;
  if (stage.stageNo === 1) {
    const d = p.workOrderDraft;
    if (!d?.title) return p.message || "工单草稿预填失败，请在确认前人工核对填写工单要素";
    return `${d.title}｜严重度优先级 ${d.priority || "—"}｜预计 ${d.estimatedHours ?? "—"} 小时`;
  }
  if (stage.stageNo === 2) {
    const a = p.assessment;
    if (!a?.riskLevel) return p.message || "JSA 预填失败，请人工开展作业安全分析";
    return `JSA 风险等级：${a.riskLevel}・${a.riskReason || "（未输出理由）"}`;
  }
  if (stage.stageNo === 3) {
    const items = p.lotoItems || [];
    const cnt = items.length;
    return cnt ? `AI 规则推演 ${cnt} 个隔离点；锁具要求 ${p.lockCount ?? cnt} 把` : p.note || null;
  }
  if (stage.stageNo === 4) {
    const plan = p.plan;
    if (!plan?.overview) return p.message || "检修方案预填失败，请人工编制方案";
    return plan.overview;
  }
  if (stage.stageNo === 5) return p.acceptanceSummary || null;
  if (stage.stageNo === 6) {
    const c = p.contribution;
    if (c?.worthContributing) return `知识沉淀建议：${c.title}`;
    return c?.message || "待归档或未达沉淀标准";
  }
  return null;
}

function stagePrefillAdvice(stage: any): string | null {
  const p = stage.aiPrefill;
  if (!p) return null;
  if (stage.stageNo === 1 && Array.isArray(p.workOrderDraft?.recommendedSteps)) {
    return p.workOrderDraft.recommendedSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n");
  }
  if (stage.stageNo === 2 && Array.isArray(p.assessment?.jsaMeasures)) {
    return p.assessment.jsaMeasures
      .slice(0, 6)
      .map((m: any) => `${m.hazard}：${m.control}`)
      .join("\n");
  }
  if (stage.stageNo === 3) {
    const items = p.lotoItems || [];
    return items.map((i: any) => `【${i.type}】${i.point}${i.lockNumber ? `（锁号 ${i.lockNumber}）` : "（锁具编号待现场登记）"}`).join("\n");
  }
  if (stage.stageNo === 4 && p.plan?.steps) {
    return p.plan.steps.map((s: any) => `${s.step}. ${s.operation}${s.qualityStandard ? `（验收：${s.qualityStandard}）` : ""}`).join("\n");
  }
  return null;
}

function buildSuggestions(loop: any, stagesView: any[], lotoItems: any[], allCompleted: boolean): any[] {
  const current = stagesView.find((s) => s.status === "in_progress") || stagesView[stagesView.length - 1];
  const currentNo = current?.order ?? loop.currentStage;
  const defs = STAGE_DEFS;

  const todoByStage: Record<number, { title: string; content: string; tag: string; actionText: string }> = {
    1: { title: `待办提醒：确认「${loop.loopNo}」工单草稿后推进`, content: "AI 已预填工单要素，请在检修工单页核对无误后确认下发报修", tag: "工单核对", actionText: "去确认" },
    2: { title: "待办提醒：核对 JSA 措施后办理作业票", content: "作业安全分析已在环节页预填，确认后系统落成真实作业票（待双人会签）", tag: "安全审批", actionText: "去核对 JSA" },
    3: {
      title: `待办提醒：LOTO 请完成 ${lotoItems.filter((i) => i.confirmed).length}/${lotoItems.length} 项确认`,
      content: lotoItems.filter((i) => !i.confirmed).length
        ? `未确认项：${lotoItems.filter((i) => !i.confirmed).map((i) => i.point).join("、")}`
        : "全部隔离点已确认完成",
      tag: "安全闸门",
      actionText: "去逐项确认",
    },
    4: { title: "待办提醒：确认检修方案后下发执行", content: "检修方案已由 AI 预填（步骤/备件/安全措施），确认后即可组织开工", tag: "方案确认", actionText: "去查看方案" },
    5: { title: "待办提醒：完工验收与质量复核", content: "维修完工后请完成现场验收记录与遥测复核", tag: "完工验收", actionText: "去验收" },
    6: { title: "待办提醒：质检归档与知识沉淀", content: "归档将生成质检报告并判断是否沉淀知识条目", tag: "归档收尾", actionText: "去归档" },
  };
  const sug1 = todoByStage[currentNo] || todoByStage[6];

  const degradedStage = stagesView.find((s) => s.aiPrefill?.status === "degraded");
  let sug2: { id: string; type: "risk"; title: string; content: string; tag: string; actionText: string };
  if (degradedStage) {
    sug2 = {
      id: "sug-2",
      type: "risk",
      title: `风险提示：环节 ${degradedStage.order}（${degradedStage.title}）AI 结果为降级规则结果`,
      content: `${degradedStage.aiPrefill?.engine || "该 AI 能力"}未输出可信结构化结果，请人工核校后再推进，避免以规则兜底内容直接替代工程判断`,
      tag: "AI 降级",
      actionText: "去人工核校",
    };
  } else {
    sug2 = {
      id: "sug-2",
      type: "risk",
      title: `风险提示：遥测对照经验限值（温度 < ${TEMP_LIMIT}°C / 振动 < ${VIB_LIMIT} mm/s）`,
      content: `限值来源为台账-趋势复用经验限值，非设备档案实测阈值；如需精确报警线请以设备台账与厂家手册为准`,
      tag: "遥测对照",
      actionText: "查看健康度",
    };
  }

  const sug3 = {
    id: "sug-3",
    type: "next" as const,
    title: allCompleted ? "下一步引导：执行归档生成质检报告" : `下一步引导：推进至「${defs[Math.min(currentNo, 5)].title}」`,
    content: allCompleted
      ? "六个环节已全部确认，归档将生成质检报告并判断知识沉淀价值"
      : `${current?.aiPrefill?.content || "AI 预填内容生成后即可在环节页核对确认"}`,
    tag: "自动编排",
    actionText: "查看当前环节",
  };

  return [
    { id: "sug-1", type: "todo" as const, ...sug1 },
    sug2,
    sug3,
  ];
}

// ---- 预览文本生成器（全部来自真实落库数据） ----

function buildWorkOrderPreview(order: any, loop: any): string {
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

function buildPermitPreview(permit: any): string {
  return [
    `【作业票号】${permit.permitNo}`,
    `【作业类型】${permit.permitType}｜风险等级：${permit.riskLevel}`,
    `【关联设备】${permit.equipmentName || "—"}｜车间：${permit.workshop || "—"}`,
    `【申请人】${permit.applicant}${permit.applicantDept ? `（${permit.applicantDept}）` : ""}`,
    `【有效期至】${permit.validUntil}`,
    `【安全措施】${(permit.precautions || []).slice(0, 5).join("；") || "—（JSA 未输出，请人工补充）"}`,
    `【会签状态】${permit.status}（需现场监护与主管双人会签后方可生效）`,
  ].join("\n");
}

function buildLotoPreview(loop: any, prefill: any): string {
  const items: any[] = prefill.lotoItems || [];
  const confirmed = items.filter((i) => i.confirmed).length;
  return [
    `【清单编号】${loop.loopNo}-LOTO`,
    `【隔离点位】${items.length} 处（${Array.from(new Set(items.map((i) => i.type))).join(" / ") || "无"})`,
    `【确认进度】${confirmed}/${items.length} 已由现场逐项确认`,
    ...items.map((i) => `- ${i.type}：${i.point}（锁号 ${i.lockNumber || "现场登记"}）${i.confirmed ? `✔ ${i.operator || ""} ${i.confirmTime || ""}` : " 待确认"}`),
    `【执行标准】${(prefill.standards || []).join("；")}`,
  ].join("\n");
}

function buildGuidePreview(loop: any, plan: any, degraded: boolean): string {
  if (!plan) return `【作业指引】${loop.loopNo}-SOP\n\n检修方案预填失败或为空，请以设备档案配套规程人工编制，勿以空指引替代工艺卡。`;
  return [
    `【作业指引】${loop.loopNo}-SOP${degraded ? "（AI 降级规则结果，需人工核校）" : ""}`,
    `【方案概述】${plan.overview || "—"}`,
    `【作业步骤】${(plan.steps || []).map((s: any) => `${s.step}. ${s.operation}${s.qualityStandard ? `（验收：${s.qualityStandard}）` : ""}`).join("\n") || "—"}`,
    `【LOTO 隔离点】${(plan.safetyMeasures?.lotoPoints || []).join("；") || "以环节 3 清单为准"}`,
    `【PPE】${(plan.safetyMeasures?.ppe || []).join("、") || "按现场标准"}`,
    `【备件/工具】${(plan.spareParts || []).map((p: any) => `${p.name}${p.spec ? `（${p.spec}）` : ""}×${p.qty ?? 1}`).join("；") || "以现场领料为准"}`,
    `【预估工时】${plan.estimatedHours ?? "—"} 小时（${plan.workers ?? "—"} 人）`,
  ].join("\n");
}

function buildAcceptancePreview(loop: any, order: any | null, eq: any | null, telemetry: any): string {
  return [
    `【验收记录】${loop.loopNo}-ACC`,
    `【关联工单】${order ? `${order.orderNo}（当前状态 ${order.status}）` : "未生成工单记录"}`,
    `【设备】${eq ? `${eq.name}（${eq.code}）` : "未识别设备"}｜健康分 ${eq?.healthScore ?? "—"}`,
    `【修前基线】温度 ${tele0(telemetry.temperature)}°C（限值 ${TEMP_LIMIT}）｜振动 ${tele0(telemetry.vibration)} mm/s（限值 ${VIB_LIMIT}）｜负载率 ${tele0(telemetry.loadRate)}%（限值 ${LOAD_LIMIT}）`,
    `【验收要求】修后实测回归经验限值以内；修前/修后对比与双签字请走「检修工单」页验收流程`,
    `【生成说明】本记录由业务闭环确认动作生成，数据源自真实台账遥测与工单状态`,
  ].join("\n");
}

function buildReportPreview(loop: any, report: any | null): string {
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

function buildKnowledgePreview(contribution: any): string {
  return [
    `【知识条目】${contribution.id || "（已提交待审核）"}`,
    `【标题】${contribution.title || "工业检修排查案例"}`,
    `【类型】${contribution.type || "故障案例"}｜设备：${contribution.equipment || "—"}`,
    `【摘要】${contribution.summary || "—"}`,
    `【解决方案要点】${contribution.solution || "—"}`,
    `【状态】已提交至 AI 知识贡献审核台（status=pending，人工审核通过后进入 RAG 知识库）`,
  ].join("\n");
}

function buildPackPreview(loop: any, counts: { total: number; generated: number; knowledgeCount: number }): string {
  return [
    `【档案综合包】${loop.loopNo}-PKG`,
    `【生成时间】${fmtNow()}`,
    `【内容】闭环 ${loop.loopNo} 全部 ${counts.total} 项标准资料，其中 ${counts.generated} 项为已生成状态（工单/作业票/LOTO 清单/作业指引/验收记录/质检报告/知识沉淀/档案包），知识沉淀 ${counts.knowledgeCount} 条`,
    `【数据纪律】所有单据均由本系统真实落库记录生成，未附带任何演示或占位数据`,
  ].join("\n");
}

function artifactDisplayCode(loopNo: string, type: string): string {
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

function categoryOf(type: string): string {
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

function fmtTimeOfDay(v: any): string {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDate(v: any): string {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtNow(): string {
  return `${fmtDate(Date.now())} ${fmtTimeOfDay(Date.now())}`;
}

function startTimeMs(loop: any): number | null {
  const t = new Date(loop.startedAt || loop.createdAt).getTime();
  return Number.isFinite(t) ? t : null;
}

function completedTimeMs(loop: any): number | null {
  const t = new Date(loop.completedAt || loop.updatedAt).getTime();
  return Number.isFinite(t) ? t : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
