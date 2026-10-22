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
function sameEditValue(a: any, b: any): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
  }
  return String(a ?? "").trim() === String(b ?? "").trim();
}

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

// ==================== LOTO 隔离点逐项确认（独立闸门，非环节推进） ====================

export async function confirmLotoPoint(params: {
  loopId: string;
  itemId: string;
  confirmed: boolean;
  user: any;
  fields?: any;
}): Promise<any> {
  const stage = await BusinessLoopRepository.getStage(params.loopId, 3);
  if (!stage) throw new BusinessLoopError(404, "闭环或环节记录不存在", "STAGE_NOT_FOUND");
  if (stage.status === "completed") {
    throw new BusinessLoopError(409, "LOTO 环节已确认完成，隔离点状态不可再修改", "STAGE_LOCKED");
  }
  const prefill = { ...(stage.aiPrefill || {}) };
  const items: any[] = Array.isArray(prefill.lotoItems) ? prefill.lotoItems : [];
  const idx = items.findIndex((i) => i.id === params.itemId);
  if (idx < 0) throw new BusinessLoopError(404, `隔离点 ${params.itemId} 不存在`, "LOTO_ITEM_NOT_FOUND");

  const now = new Date();
  const fmtTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const actor = params.user?.name || params.user?.username || "未知用户";

  // 现场登记字段：AI 推演的点位/要求/锁号只是草稿，标错必须能改，改前先留 AI 原值
  const editedFields = lotoEditableFields(params.fields);
  const next: any = { ...items[idx] };
  const itemOriginal: any = { ...(next.aiOriginal || {}) };
  const changedLabels: string[] = [];
  for (const [key, label] of editedFields) {
    const incoming = String(params.fields[key]).trim();
    if (!incoming || sameEditValue(next[key], incoming)) continue;
    if (!(key in itemOriginal)) itemOriginal[key] = next[key] ?? "";
    next[key] = incoming;
    changedLabels.push(label);
  }
  if (changedLabels.length) {
    next.aiOriginal = itemOriginal;
    next.editedBy = actor;
    next.editedAt = fmtNow();
  }

  next.confirmed = params.confirmed;
  // 确认人只认真实登录身份（可核签），现场操作人允许由人改填实际挂牌的那位；
  // 规则清单里的「待现场确认」是占位符，不算人工填过的值，勾选确认时要换成记账人。
  next.confirmedBy = params.confirmed ? actor : next.confirmedBy;
  const operatorDraft = String(next.operator || "").trim();
  const isPlaceholder = operatorDraft === "" || operatorDraft === "待现场确认";
  next.operator = params.confirmed
    ? isPlaceholder
      ? `${actor} (${params.user?.roleTitle || params.user?.role || ""})`.replace(/ \(\)$/, "")
      : operatorDraft
    : isPlaceholder
      ? "待现场确认"
      : operatorDraft;
  next.confirmTime = params.confirmed ? fmtTime : undefined;

  items[idx] = next;
  prefill.lotoItems = items;
  if (Array.isArray(prefill.isolationPoints)) {
    prefill.isolationPoints = items.map((i: any) => i.point);
  }
  prefill.humanRevised = changedLabels.length
    ? mergeHumanRevised(prefill.humanRevised, changedLabels, params.user, "LOTO 隔离点登记")
    : prefill.humanRevised;
  await writeLotoPrefill(params.loopId, stage, prefill);
  return buildLoopDetail(params.loopId);
}

/** 现场补登隔离点（AI/JSA 推演漏项时由人加，来源如实标「人工登记」，不冒充模型结论） */
export async function addLotoItem(params: {
  loopId: string;
  fields: { type: string; point: string; requirement?: string; lockNumber?: string };
  user: any;
}): Promise<any> {
  const stage = await BusinessLoopRepository.getStage(params.loopId, 3);
  if (!stage) throw new BusinessLoopError(404, "闭环或环节记录不存在", "STAGE_NOT_FOUND");
  if (stage.status === "completed") {
    throw new BusinessLoopError(409, "LOTO 环节已确认完成，不能再补登隔离点", "STAGE_LOCKED");
  }
  const prefill = { ...(stage.aiPrefill || {}) };
  const items: any[] = Array.isArray(prefill.lotoItems) ? prefill.lotoItems : [];
  const type = String(params.fields.type || "").trim();
  const point = String(params.fields.point || "").trim();
  if (!type || !point) throw new BusinessLoopError(400, "补登隔离点必须填写能量类型与点位", "LOTO_ITEM_INCOMPLETE");
  if (items.some((i) => String(i.point || "").trim() === point)) {
    throw new BusinessLoopError(409, `点位「${point}」已在清单中，请直接修改该行而不是重复补登`, "LOTO_POINT_DUPLICATE");
  }

  const item = {
    // 人工补登用 h+时间戳后缀，避免与规则推演的 loto-<loopId>-<序号> 撞 id
    id: `loto-${params.loopId}-h${Date.now().toString(36)}`,
    type,
    point,
    requirement: String(params.fields.requirement || "").trim() || lotoRequirement(type, point),
    lockNumber: String(params.fields.lockNumber || "").trim(),
    basis: "人工登记（AI/JSA 清单外补充）",
    confirmed: false, // 新补的点同样要过 100% 人工确认闸门
    operator: "待现场确认",
  };
  items.push(item);
  prefill.lotoItems = items;
  if (Array.isArray(prefill.isolationPoints)) prefill.isolationPoints = items.map((i: any) => i.point);
  prefill.lockCount = items.length;
  prefill.humanRevised = mergeHumanRevised(prefill.humanRevised, ["补登隔离点"], params.user, "LOTO 隔离点登记");
  await writeLotoPrefill(params.loopId, stage, prefill);
  return buildLoopDetail(params.loopId);
}

/** LOTO 行内允许人工改的字段（顺序即审计里的展示顺序） */
function lotoEditableFields(fields: any): Array<[string, string]> {
  if (!fields || typeof fields !== "object") return [];
  const allowed: Array<[string, string]> = [
    ["type", "能量类型"],
    ["point", "隔离点位"],
    ["requirement", "隔离要求"],
    ["lockNumber", "锁具编号"],
    ["operator", "现场操作人"],
  ];
  return allowed.filter(([key]) => typeof fields[key] === "string");
}

function mergeHumanRevised(prev: any, labels: string[], user: any, actorNote: string): any {
  const existingFields: string[] = Array.isArray(prev?.fields) ? prev.fields : [];
  return {
    by: user?.name || user?.username || "未知用户",
    at: fmtNow(),
    fields: Array.from(new Set([...existingFields, ...labels.map((l) => `${actorNote}：${l}`)])),
  };
}

async function writeLotoPrefill(loopId: string, stage: any, prefill: any): Promise<void> {
  await BusinessLoopRepository.updateStagePrefill(loopId, 3, {
    aiPrefillJson: JSON.stringify(prefill),
    aiEngine: stage.aiEngine || "safety-interlock-rules",
    aiStatus: stage.aiStatus || "ok",
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

// ==================== 质检报告核心（generate-report，DashScope 真实调用） ====================

/** 汇总真实闭环数据（目标/设备遥测/工单/JSA/LOTO/方案）后生成质检报告；失败如实 degraded，不伪造结论 */
async function runGenerateReportCore(
  loop: any,
  eq: Equipment | null,
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
  eq: Equipment | null,
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


// ---- 预览文本生成器（全部来自真实落库数据） ----

/** 条目级列表拼成一行：先剥掉条目自带的句末标点，避免出现「。；」这类重复标点 */
export function joinClauses(items: unknown[], sep = "；"): string {
  return items
    .map((item) => String(item).trim().replace(/[。；;]+$/, ""))
    .filter(Boolean)
    .join(sep);
}

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
  // 措施清单可能超过 5 条，人工修订留痕不能被 slice 掉——它会替票面说话，所以单列一行。
  const all = (permit.precautions || []).map((p: any) => String(p));
  const revisionLines = all.filter((p) => p.startsWith("【人工修订留痕】"));
  const measures = all.filter((p) => !p.startsWith("【人工修订留痕】"));
  return [
    `【作业票号】${permit.permitNo}`,
    `【作业类型】${permit.permitType}｜风险等级：${permit.riskLevel}`,
    `【关联设备】${permit.equipmentName || "—"}｜车间：${permit.workshop || "—"}`,
    `【申请人】${permit.applicant}${permit.applicantDept ? `（${permit.applicantDept}）` : ""}`,
    `【有效期至】${permit.validUntil}`,
    `【安全措施】${joinClauses(measures.slice(0, 5)) || "—（JSA 未输出，请人工补充）"}`,
    ...revisionLines,
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
    `【执行标准】${joinClauses(prefill.standards || [])}`,
  ].join("\n");
}

function buildGuidePreview(loop: any, plan: any, degraded: boolean): string {
  if (!plan) return `【作业指引】${loop.loopNo}-SOP\n\n检修方案预填失败或为空，请以设备档案配套规程人工编制，勿以空指引替代工艺卡。`;
  return [
    `【作业指引】${loop.loopNo}-SOP${degraded ? "（AI 降级规则结果，需人工核校）" : ""}`,
    `【方案概述】${plan.overview || "—"}`,
    `【作业步骤】${(plan.steps || []).map((s: any) => `${s.step}. ${s.operation}${s.qualityStandard ? `（验收：${s.qualityStandard}）` : ""}`).join("\n") || "—"}`,
    `【LOTO 隔离点】${joinClauses(plan.safetyMeasures?.lotoPoints || []) || "以环节 3 清单为准"}`,
    `【PPE】${(plan.safetyMeasures?.ppe || []).join("、") || "按现场标准"}`,
    `【备件/工具】${(plan.spareParts || []).map((p: any) => `${p.name}${p.spec ? `（${p.spec}）` : ""}×${p.qty ?? 1}`).join("；") || "以现场领料为准"}`,
    `【预估工时】${plan.estimatedHours ?? "—"} 小时（${plan.workers ?? "—"} 人）`,
  ].join("\n");
}

function buildAcceptancePreview(loop: any, order: any | null, eq: Equipment | null, telemetry: any): string {
  const fmtBase = (v: unknown, unit: string, limit: number) => {
    const n = telemetryValueOrNull(v);
    return n == null ? `未接入（限值 ${limit}${unit}）` : `${n}${unit}（限值 ${limit}${unit}）`;
  };
  const hasBase = [telemetry?.temperature, telemetry?.vibration, telemetry?.loadRate]
    .some((v) => telemetryValueOrNull(v) != null);
  return [
    `【验收记录】${loop.loopNo}-ACC`,
    `【关联工单】${order ? `${order.orderNo}（当前状态 ${order.status}）` : "未生成工单记录"}`,
    `【设备】${eq ? `${eq.name}（${eq.code}）` : "未识别设备"}｜健康分 ${eq?.healthScore ?? "—"}`,
    hasBase
      ? `【修前基线】温度 ${fmtBase(telemetry.temperature, "°C", TEMP_LIMIT)}｜振动 ${fmtBase(telemetry.vibration, " mm/s", VIB_LIMIT)}｜负载率 ${fmtBase(telemetry.loadRate, "%", LOAD_LIMIT)}`
      : "【修前基线】遥测未接入，修前基线为空（不得据零值判定修后改善与否）",
    `【验收要求】修后实测回归经验限值以内；修前/修后对比与双签字请走「检修工单」页验收流程`,
    `【生成说明】本记录由业务闭环确认动作生成，数据源自设备台账遥测与工单状态`,
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
