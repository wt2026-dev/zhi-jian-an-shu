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
import { buildLotoAdvisory, classifyLotoType, compact, energySourceItemsFor, lotoRequirement } from "./lotoAdvisory.ts";
import { buildSuggestions, mapEquipmentForFrontend, stagePrefillAdvice, stagePrefillContent } from "./businessLoopDetail.ts";
import {
  addLotoItem,
  assertLotoAllConfirmed,
  confirmLotoPoint,
  sameEditValue,
  settleLotoChecklist,
} from "./lotoService.ts";
import { runGenerateReportCore, runSuggestContributionCore } from "./businessLoopReport.ts";
import {
  buildAcceptancePreview,
  buildGuidePreview,
  buildKnowledgePreview,
  buildLotoPreview,
  buildPackPreview,
  buildPermitPreview,
  buildReportPreview,
  buildWorkOrderPreview,
  artifactDisplayCode,
  categoryOf,
  fmtTimeOfDay,
  joinClauses,
} from "./businessLoopPreviews.ts";
import {
  ARTIFACT_DEFS,
  JSA_RISK_TO_LEVEL,
  LOAD_LIMIT,
  STAGE_DEFS,
  TEMP_LIMIT,
  VIB_LIMIT,
  stageDef,
  telemetryValueOrNull,
  type StageDef,
} from "./businessLoopConstants.ts";
import { logger } from "../../utils/logger.ts";
import type { Equipment } from "../../types/index.ts";

// ==================== 闭环常量定义 ====================


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
  let best: { eq: Equipment; score: number } | null = null;
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

async function prefillStages(loopId: string, goal: string, eq: Equipment | null): Promise<void> {
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

async function runPrefillSequence(loopId: string, goal: string, eq: Equipment | null): Promise<void> {
  const telemetry = eq?.telemetry ?? null;
  const eqCtx = eq
    ? `${eq.name} (${eq.code}) | 类别: ${eq.category || "未知"} | 型号: ${eq.model || "未知"} | 车间: ${eq.workshop || "未知"} | 位置: ${eq.location || "未知"}`
    : "未识别到具体设备（目标文本未命中设备台账）";
  // 提示词里的遥测必须逐项判断缺测：写成"温度 0°C"会让模型照着 0 写诊断结论。
  const fmtTele = (v: unknown, unit: string, limit: number) => {
    const n = telemetryValueOrNull(v);
    return n == null ? "未接入" : `${n}${unit} (限值 < ${limit}${unit.replace(/^ /, "")})`;
  };
  const hasAnyTele = telemetry
    ? [telemetry.temperature, telemetry.vibration, telemetry.loadRate].some((v) => telemetryValueOrNull(v) != null)
    : false;
  const teleCtx = eq
    ? (hasAnyTele && telemetry
      ? `温度 ${fmtTele(telemetry.temperature, "°C", TEMP_LIMIT)} | 振动 ${fmtTele(telemetry.vibration, " mm/s", VIB_LIMIT)} | 负载率 ${fmtTele(telemetry.loadRate, "%", LOAD_LIMIT)} | 健康分 ${eq.healthScore ?? "未知"}`
      : `遥测未接入（该设备无有效读数，不得据此推断运行状态）| 健康分 ${eq.healthScore ?? "未知"}`)
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

/**
 * 遥测取值：缺测返回 null，**绝不补 0**。
 *
 * 旧实现叫 `tele0(v)`，把非法值一律转成 0，注释写的是"不经手任何编造值"——
 * 但那恰恰是编造：0°C / 0mm/s / 0% 都是可判定的读数，喂给 AI 提示词和前端
 * 后会显示成"温度 0°C（限值 80°C）"，读起来就是一台正常运转的设备。
 * 缺测的正确表达是 null，由调用方显示「未接入」。
 */

/** 环节 1 核心：工单草稿生成（与 /api/v1/ai/generate-work-order 同源 DashScope 通道 + aiCache） */
async function runWorkOrderDraftCore(input: {
  goal: string;
  eq: Equipment | null;
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
  "description": "现场情况描述（80字内，引用设备遥测数值）",
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


// ==================== 人工确认闸门 ====================

/**
 * 各环节允许人工改写 AI 预填的字段白名单（服务端逐字段取，未列出的键一律忽略）。
 * 人工闸门必须真的能改：AI 给的预计工时/优先级/风险档只是预填，确认人签字的才是落库值。
 */
const HUMAN_EDITABLE_FIELDS: Record<number, Array<{ group: "workOrderDraft" | "assessment" | "plan"; key: string; label: string }>> = {
  1: [
    { group: "workOrderDraft", key: "title", label: "工单标题" },
    { group: "workOrderDraft", key: "faultType", label: "故障类型" },
    { group: "workOrderDraft", key: "priority", label: "优先级" },
    { group: "workOrderDraft", key: "estimatedHours", label: "预计工时" },
    { group: "workOrderDraft", key: "description", label: "现场情况描述" },
  ],
  2: [
    { group: "assessment", key: "riskLevel", label: "JSA 风险等级" },
    { group: "assessment", key: "riskReason", label: "风险定级理由" },
  ],
  4: [
    { group: "plan", key: "overview", label: "方案概述" },
    { group: "plan", key: "estimatedHours", label: "预估工时" },
    { group: "plan", key: "workers", label: "作业人数" },
  ],
};

function isBlank(v: any): boolean {
  return v === undefined || v === null || (typeof v === "string" && !v.trim());
}

/** 比较用归一：数字按数值比，字符串按去空白比（避免「4」与 4 被判成两处修订） */

/**
 * 把确认闸门上的人工修订写进环节预填：AI 原值留底在 prefill.aiOriginal，
 * 修订人/时间/字段清单落在 prefill.humanRevised。
 * 必须在各 settle 之前调用并同步 stage.aiPrefill，落库的才是确认人签字的值而不是 AI 默认值。
 */
async function applyHumanEdits(params: {
  loopId: string;
  stageNo: number;
  stage: any;
  edits: any;
  user: any;
}): Promise<string[]> {
  const allowed = HUMAN_EDITABLE_FIELDS[params.stageNo];
  const edits = params.edits && typeof params.edits === "object" ? params.edits : null;

  if (!allowed) {
    // 环节 3 的隔离点走 LOTO 专用接口逐行改；环节 5/6 无 AI 预填要素可改
    if (edits && Object.values(edits).some((g: any) => g && typeof g === "object" && Object.values(g).some((v) => !isBlank(v)))) {
      throw new BusinessLoopError(
        400,
        `环节 ${params.stageNo} 不支持提交人工修订字段（环节 3 请逐条使用 LOTO 隔离点登记）`,
        "STAGE_EDITS_NOT_SUPPORTED"
      );
    }
    return [];
  }

  const prefill: any = { ...(params.stage.aiPrefill || {}) };
  const aiOriginal: any = { ...(prefill.aiOriginal || {}) };
  const diffs: string[] = [];
  const labels: string[] = [];

  for (const field of allowed) {
    const incoming = edits?.[field.group]?.[field.key];
    if (isBlank(incoming)) continue;
    if (!prefill[field.group] || typeof prefill[field.group] !== "object") prefill[field.group] = {};
    const current = prefill[field.group][field.key];
    const value = typeof incoming === "string" ? incoming.trim() : incoming;
    if (sameEditValue(current, value)) continue;
    if (!aiOriginal[field.group]) aiOriginal[field.group] = {};
    // 只在首次修订时留底，后续再改也不覆盖 AI 原值（归档要能追溯是谁改的、原本是什么）
    if (!(field.key in aiOriginal[field.group])) aiOriginal[field.group][field.key] = isBlank(current) ? null : current;
    prefill[field.group][field.key] = value;
    diffs.push(`${field.label}「${isBlank(current) ? "（AI 未给出）" : String(current)}」→「${String(value)}」`);
    labels.push(field.label);
  }

  if (!diffs.length) return [];

  prefill.aiOriginal = aiOriginal;
  const prevFields: string[] = Array.isArray(prefill.humanRevised?.fields) ? prefill.humanRevised.fields : [];
  prefill.humanRevised = {
    by: params.user?.name || params.user?.username || "未知用户",
    at: fmtNow(),
    fields: Array.from(new Set([...prevFields, ...labels])),
  };
  await BusinessLoopRepository.updateStagePrefill(params.loopId, params.stageNo, {
    aiPrefillJson: JSON.stringify(prefill),
    aiEngine: params.stage.aiEngine || PREFILL_ENGINES[params.stageNo] || "human-revision",
    aiStatus: params.stage.aiStatus || "degraded",
  });
  params.stage.aiPrefill = prefill;
  return diffs;
}

export async function confirmStage(params: {
  loopId: string;
  stageNo: number;
  user: any;
  edits?: any;
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

  // 人工修订先落环节预填，再进各 settle —— 顺序错了就会把 AI 默认值落成"人工确认值"
  const revisionDiffs = await applyHumanEdits({
    loopId: params.loopId,
    stageNo: params.stageNo,
    stage,
    edits: params.edits,
    user: params.user,
  });

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
    detail: `${confirmBy} 确认闭环 ${loop.loopNo} 环节${params.stageNo}（${stageDef(params.stageNo).title}）${
      revisionDiffs.length ? `；人工修订 ${revisionDiffs.length} 处：${revisionDiffs.join("；")}` : "；无修订，按 AI 预填原值确认"
    }`,
    status: "SUCCESS",
    metadata: {
      loopId: params.loopId,
      stageNo: params.stageNo,
      confirmBy,
      humanRevisedFields: revisionDiffs,
    },
  });

  const detail = await buildLoopDetail(params.loopId);
  return detail;
}

/** 环节1 确认：工单草稿落成真实工单（work_orders） */
async function settleWorkOrder(loop: any, stage: any, eq: Equipment | null, user: any) {
  if (stage.producedArtifactRef) return; // 幂等
  const draft = stage.aiPrefill?.workOrderDraft || {};
  const creator = user?.name || user?.username || "业务管家";
  // 描述以确认页上看到的内容为准（人工改过就是人工的），缺省才回落业务目标
  const descBody = String(draft.description || "").trim() || loop.goal;
  const stepsNote =
    Array.isArray(draft.recommendedSteps) && draft.recommendedSteps.length
      ? `\nAI 建议步骤：${draft.recommendedSteps.join("；")}`
      : "";
  // work_orders 没有工时列，预计工时如实写进描述并标来源，绝不静默丢掉确认人改过的数
  const hoursNote =
    draft.estimatedHours != null
      ? `\n预计工时：${draft.estimatedHours} 小时（来源：${stage.aiPrefill?.humanRevised ? "人工修订" : "AI 预填"}）`
      : "";
  const prefillNote = stage.aiPrefill?.message ? `\n（AI 预填状态：${stage.aiPrefill.message}）` : "";
  const order = await WorkOrderRepository.create({
    title: draft.title || `${eq ? eq.name : "设备"}故障检修`,
    equipmentId: eq?.id || undefined,
    equipmentName: eq?.name || "未识别设备",
    equipmentCode: eq?.code || "",
    workshop: eq?.workshop || "",
    faultType: draft.faultType || "其他",
    priority: draft.priority || "medium",
    description: `${descBody}${stepsNote}${hoursNote}${prefillNote}`,
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
async function settleSafetyPermit(loop: any, stage: any, eq: Equipment | null, user: any) {
  if (stage.producedArtifactRef) return; // 幂等
  const prefill = stage.aiPrefill || {};
  const assessment = prefill.assessment || {};
  // JSA 输出 4 档结论，作业票按站内 Level 1-4 口径登记（getRiskBadge 只认 Level 字样，
  // 传裸「高/中/低」会被兜底渲染成「低风险」）；未评定时如实标注，绝不落到最低档。
  const riskLevel = JSA_RISK_TO_LEVEL[String(assessment.riskLevel || "").trim()] || "待人工 JSA 评定（未评级）";
  // 会签人要能在票面上看到"这一档是 AI 给的还是人改的"，所以把修订差值如实追加进措施清单
  const aiRisk = prefill.aiOriginal?.assessment?.riskLevel;
  const revisionNote =
    aiRisk !== undefined && String(aiRisk ?? "") !== String(assessment.riskLevel ?? "")
      ? `【人工修订留痕】JSA 风险等级 ${aiRisk || "（AI 未给出）"} → ${assessment.riskLevel || "—"}（${prefill.humanRevised?.by || "确认人"} ${prefill.humanRevised?.at || ""}，本行是修订留痕，不是现场安全措施）`
      : null;
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`;
  // permit_no 列 UNIQUE：号序直接取本闭环的当日序号（PL-YYYYMMDD-NNN → SP-YYYYMMDD-LNNN），
  // 同一天两条闭环并发确认也不会撞号；用 HHMM/HHMMSS 计时会在同一秒内撞。
  const loopSeq = String(loop.loopNo || "").split("-").pop();
  const permitNo = `SP-${dateStr}-L${/^\d{3}$/.test(loopSeq || "") ? loopSeq : `${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`}`;
  const precautions = [
    ...(Array.isArray(assessment.jsaMeasures) ? assessment.jsaMeasures.map((m: any) => `${m.hazard}: ${m.control}`) : []),
    ...(revisionNote ? [revisionNote] : []),
  ];
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
    precautions,
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
async function settleAcceptance(loop: any, eq: Equipment | null) {
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
        // 已持久化的人工修订（谁/几点/改了哪些字段），前端徽章与只读态直接用它
        revised: s.aiPrefill?.humanRevised || null,
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
    // 人工登记留痕：确认人（登录身份）+ 改动人/时间 + AI 原值（供前端「恢复」与 tooltip 用）
    confirmedBy: i.confirmedBy || null,
    editedBy: i.editedBy || null,
    editedAt: i.editedAt || null,
    aiOriginal: i.aiOriginal || null,
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



function fmtDate(v: any): string {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fmtNow(): string {
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
