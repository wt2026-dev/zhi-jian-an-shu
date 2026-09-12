// 重构说明：AI 协同任务编排服务（AI Task Pipeline）。
// 场景「AI 协同诊断」：故障诊断 → 检修方案生成 →（作业安全风险评估 ∥ 智能派单推荐）。
// 依赖关系：诊断 → 方案必须串行；风险审核与派单推荐依赖方案输出，二者并行（Promise.all）。
// 每个子任务复用 services/aiCapabilityService 中的核心能力（不复制控制器逻辑）；
// AI 失败沿用现有 degraded 标记与规则引擎降级（记入 result_json，不伪造结果）；
// 某步硬失败记录 error 并标记任务 failed，但不中断其余步骤的执行与已完成步骤的结果。

import { AiTaskRepository, AiTaskStepRepository, EquipmentRepository, TelemetryRepository } from "../../db/repositories/index.ts";
import {
  runFaultDiagnosisCore,
  runMaintenancePlanCore,
  runSafetyRiskAssessmentCore,
  runRecommendAssigneeCore,
  CapabilityResult,
} from "./aiCapabilityService.ts";

/** 场景「AI 协同诊断」的固定步骤依赖图（拓扑序 + 分组并行） */
export const PIPELINE_STEPS = [
  { name: "故障诊断", stepKey: "diagnosis" },
  { name: "检修方案生成", stepKey: "maintenance-plan" },
  { name: "风险审核", stepKey: "risk-assessment" },
  { name: "派单推荐", stepKey: "assignee-recommendation" },
] as const;

// 步骤执行器注册表：编排层通过 stepKey 查找，步骤间仅通过上一阶段结果对象传递
type StepRunner = (ctx: PipelineContext) => Promise<CapabilityResult>;
const STEP_RUNNERS: Record<string, StepRunner> = {
  diagnosis: runDiagnosisStep,
  "maintenance-plan": runPlanStep,
  "risk-assessment": runRiskStep,
  "assignee-recommendation": runAssigneeStep,
};

export interface PipelineContext {
  equipmentId: string;
  problemDescription: string;
  equipment: any;
  latestTelemetry: any | null;
  /** 各步骤产物，供后续步骤与最终报告引用 */
  diagnosis?: any;
  plan?: any;
  assessment?: any;
  recommendation?: any;
  /** 降级标记汇总（沿用现有 degraded 语义，不伪造结果） */
  degradedSteps: string[];
}

/** 步骤级联进度：任务总进度 = 已完成步骤数 / 总步骤数（当前运行步按比例折算） */
function computeTaskProgress(stepStatuses: { status: string; progress: number }[]): number {
  const total = stepStatuses.length || 1;
  const done = stepStatuses.reduce(
    (acc, s) => acc + (s.status === "completed" ? 100 : s.status === "failed" ? 100 : s.status === "running" ? Math.min(s.progress, 99) : 0),
    0
  );
  return Math.min(99, Math.round(done / total));
}

/** 创建协同任务并异步启动编排（fire-and-forget，接口立即返回任务 ID） */
export async function createAndRunPipeline(params: {
  scene: string;
  equipmentId: string;
  problemDescription: string;
  createdBy?: string;
}): Promise<{ id: string }> {
  const taskId = `aipt-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  await AiTaskRepository.create({
    id: taskId,
    scene: params.scene,
    createdBy: params.createdBy,
    steps: PIPELINE_STEPS.map((s) => ({ id: `${taskId}-step-${s.stepKey}`, stepName: s.name })),
  });
  // 异步执行编排，不阻塞创建请求；执行器内部自行落库与容错
  void executePipeline(taskId, params.equipmentId, params.problemDescription).catch((err) => {
    console.error(`[AI Pipeline ${taskId}] 编排执行异常:`, err?.message || err);
  });
  return { id: taskId };
}

/** 编排执行器：诊断 → 方案 串行，风险审核 ∥ 派单推荐 并行 */
export async function executePipeline(taskId: string, equipmentId: string, problemDescription: string): Promise<void> {
  const equipment = await EquipmentRepository.getById(equipmentId);
  if (!equipment) {
    // 设备不存在：直接把任务置为 failed（尚未开始任何步骤）
    await AiTaskRepository.markFailed(taskId, { error: "设备不存在，请核对 equipmentId" });
    return;
  }
  const telemetryHistory = await TelemetryRepository.getHistory(equipmentId, 24);
  const ctx: PipelineContext = {
    equipmentId,
    problemDescription,
    equipment,
    latestTelemetry: telemetryHistory?.[telemetryHistory.length - 1] || null,
    degradedSteps: [],
  };

  await AiTaskRepository.markRunning(taskId, PIPELINE_STEPS[0].name);

  const stepIds: Record<string, string> = {};
  for (const s of PIPELINE_STEPS) stepIds[s.stepKey] = `${taskId}-step-${s.stepKey}`;

  // ---- 阶段 1：故障诊断（串行） ----
  const failedSteps: string[] = [];
  const runStep = async (stepKey: string) => {
    const stepId = stepIds[stepKey];
    const stepName = PIPELINE_STEPS.find((s) => s.stepKey === stepKey)!.name;
    await AiTaskStepRepository.markRunning(stepId);
    await AiTaskRepository.updateProgress(taskId, computeTaskProgress(await currentStepStatuses(taskId)), stepName);
    try {
      const result = await STEP_RUNNERS[stepKey](ctx);
      if (result.outcome === "failed") {
        await AiTaskStepRepository.markFailed(stepId, result.body?.error || result.errorMessage || "步骤执行失败");
        failedSteps.push(stepName);
        return;
      }
      await AiTaskStepRepository.markCompleted(stepId, {
        outcome: result.outcome,
        degraded: result.outcome === "degraded" || result.outcome === "unavailable",
        message: result.body?.message,
        data: result.body,
      });
      if (result.outcome === "degraded" || result.outcome === "unavailable") {
        ctx.degradedSteps.push(stepName);
      }
    } catch (err: any) {
      await AiTaskStepRepository.markFailed(stepId, err?.message || String(err));
      failedSteps.push(stepName);
    }
  };

  await runStep("diagnosis");
  // ---- 阶段 2：检修方案生成（串行，依赖诊断结论） ----
  await runStep("maintenance-plan");
  // ---- 阶段 3：风险审核 ∥ 派单推荐（并行，均依赖方案输出） ----
  await Promise.all([runStep("risk-assessment"), runStep("assignee-recommendation")]);

  // ---- 汇总任务终态：有硬失败步骤 → failed；否则 completed（degraded 步骤如实标记） ----
  const finalTask = await AiTaskRepository.getById(taskId);
  const report = buildCollaborativeReport(ctx, finalTask?.steps || []);
  if (failedSteps.length > 0) {
    await AiTaskRepository.markFailed(taskId, {
      failedSteps,
      degradedSteps: ctx.degradedSteps,
      report,
    });
  } else {
    await AiTaskRepository.markCompleted(taskId, {
      degradedSteps: ctx.degradedSteps,
      report,
    });
  }
}

/** 读取当前各步骤状态用于计算任务进度 */
async function currentStepStatuses(taskId: string): Promise<{ status: string; progress: number }[]> {
  const task = await AiTaskRepository.getById(taskId);
  return (task?.steps || []).map((s: any) => ({ status: s.status, progress: s.progress }));
}

// ==================== 步骤执行器（复用 aiCapabilityService 核心） ====================

async function runDiagnosisStep(ctx: PipelineContext): Promise<CapabilityResult> {
  const result = await runFaultDiagnosisCore({
    equipmentName: ctx.equipment.name,
    equipmentCode: ctx.equipment.code,
    category: ctx.equipment.category,
    symptoms: ctx.problemDescription,
    telemetry: ctx.latestTelemetry
      ? {
          temperature: ctx.latestTelemetry.temperature,
          vibration: ctx.latestTelemetry.vibration,
          voltage: ctx.latestTelemetry.voltage,
          current: ctx.latestTelemetry.current,
          loadRate: ctx.latestTelemetry.loadRate,
        }
      : undefined,
    errorCodes: "",
  });
  ctx.diagnosis = result.body?.diagnosis || null;
  return result;
}

async function runPlanStep(ctx: PipelineContext): Promise<CapabilityResult> {
  const diagnosisSummary = ctx.diagnosis?.summary || ctx.problemDescription;
  const causes = (ctx.diagnosis?.probableCauses || [])
    .slice(0, 3)
    .map((c: any) => `${c.cause}(${c.probability ?? "?"}%)`)
    .join("、");
  const result = await runMaintenancePlanCore({
    equipmentId: ctx.equipmentId,
    faultDescription: `【协同诊断结论】${diagnosisSummary}${causes ? `。主要可能原因：${causes}。` : ""}【原始问题描述】${ctx.problemDescription}`,
  });
  ctx.plan = result.body?.plan || null;
  return result;
}

async function runRiskStep(ctx: PipelineContext): Promise<CapabilityResult> {
  const planOverview = ctx.plan?.overview || "";
  const lotoPoints = ctx.plan?.safetyMeasures?.lotoPoints || [];
  const result = await runSafetyRiskAssessmentCore({
    permitType: "设备检修作业票",
    equipmentId: ctx.equipmentId,
    workDescription: `${ctx.problemDescription}${planOverview ? `。检修方案概述：${planOverview}` : ""}`,
    location: ctx.equipment.location || ctx.equipment.workshop,
    hazards: [
      ...(lotoPoints.length ? [`能量隔离：${lotoPoints.join("、")}`] : []),
      ...(ctx.diagnosis?.safetyPrecautions || []).slice(0, 3),
    ],
  });
  ctx.assessment = result.body?.assessment || null;
  return result;
}

async function runAssigneeStep(ctx: PipelineContext): Promise<CapabilityResult> {
  const riskLevel = ctx.assessment?.riskLevel || "";
  const priorityByRisk: Record<string, string> = { "极高": "urgent", "高": "urgent", "中": "high", "低": "medium" };
  const result = await runRecommendAssigneeCore({
    equipmentId: ctx.equipmentId,
    faultDescription: `${ctx.problemDescription}${ctx.diagnosis?.summary ? `。诊断结论：${ctx.diagnosis.summary}` : ""}`,
    priority: priorityByRisk[riskLevel] || "high",
  });
  ctx.recommendation = result.body?.recommendation || null;
  return result;
}

// ==================== 协同检修报告（任务完成后汇总各步结果） ====================

function buildCollaborativeReport(ctx: PipelineContext, steps: any[]) {
  const stepByName = Object.fromEntries(steps.map((s: any) => [s.stepName, s]));
  const diagnosisStep = stepByName["故障诊断"];
  const planStep = stepByName["检修方案生成"];
  const riskStep = stepByName["风险审核"];
  const assigneeStep = stepByName["派单推荐"];

  return {
    equipment: {
      id: ctx.equipment.id,
      name: ctx.equipment.name,
      code: ctx.equipment.code,
      workshop: ctx.equipment.workshop,
      healthScore: ctx.equipment.healthScore,
    },
    problemDescription: ctx.problemDescription,
    diagnosis: diagnosisStep
      ? {
          status: diagnosisStep.status,
          degraded: !!diagnosisStep.result?.degraded,
          severity: ctx.diagnosis?.severity,
          urgencyScore: ctx.diagnosis?.urgencyScore,
          summary: ctx.diagnosis?.summary,
          probableCauses: (ctx.diagnosis?.probableCauses || []).slice(0, 3),
          safetyPrecautions: (ctx.diagnosis?.safetyPrecautions || []).slice(0, 3),
        }
      : null,
    plan: planStep
      ? {
          status: planStep.status,
          degraded: !!planStep.result?.degraded,
          overview: ctx.plan?.overview,
          steps: (ctx.plan?.steps || []).slice(0, 6),
          estimatedHours: ctx.plan?.estimatedHours,
        }
      : null,
    risk: riskStep
      ? {
          status: riskStep.status,
          degraded: !!riskStep.result?.degraded,
          riskLevel: ctx.assessment?.riskLevel,
          riskReason: ctx.assessment?.riskReason,
          jsaMeasures: (ctx.assessment?.jsaMeasures || []).slice(0, 4),
          lotoAdvice: ctx.assessment?.lotoAdvice,
        }
      : null,
    assignee: assigneeStep
      ? {
          status: assigneeStep.status,
          degraded: !!assigneeStep.result?.degraded,
          recommended: ctx.recommendation?.recommended,
          alternatives: (ctx.recommendation?.alternatives || []).slice(0, 2),
          estimatedHours: ctx.recommendation?.estimatedHours,
        }
      : null,
    degradedSteps: ctx.degradedSteps,
    generatedAt: new Date().toISOString(),
  };
}
