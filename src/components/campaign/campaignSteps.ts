/**
 * 第 5 幕「现场检修」的四步操作构造 —— **纯逻辑，无 DOM**。
 *
 * 四步固定为：① 断电挂牌（LOTO） ② 拆解 ③ 更换备件 ④ 复装回位。
 * 每步的动作清单、工具、安全要点、验收标准全部取自两处真实来源：
 *   - `maintenance_procedures` 的规程步骤（`name/content/tools/safety/acceptance`）
 *   - `/api/v1/ai/generate-maintenance-plan` 返回的 AI 方案（隔离点、备件清单）
 * 两者都取不到时返回空数组，由 UI 如实禁用这一幕 —— 没有规程就不演"按规程检修"。
 *
 * 唯一的例外是 LOTO 的标准四步：它来自 GB 30871 能量隔离通用作业要求（与
 * `game/gameData.ts` 的通用安全句库同一性质），不是设备台账数据，且 `source` 字段会
 * 明确标成 `loto-standard`，界面必须把这层来源显示出来。
 */
import type { MaintenanceProcedure, ProcedureStep } from "../../types";
import type { AiMaintenancePlan } from "../../api";
import { parseTools, splitContentActions } from "../game/gameData";

export type RepairStepKind = "loto" | "disassemble" | "replace" | "reassemble";
export type RepairStepSource = "procedure" | "ai-plan" | "loto-standard";

export interface RepairStep {
  kind: RepairStepKind;
  title: string;
  prompt: string;
  /** 需要按正确顺序点选的真实动作 */
  actions: string[];
  /** 该步所需工具（规程 tools 字段） */
  tools: string[];
  /** 安全要点（规程 safety 字段或 LOTO 要求） */
  safety: string;
  /** 验收标准（规程 acceptance 字段） */
  acceptance: string;
  /** 本步登记消耗的备件；无来源时为空数组，UI 显示"本步无备件消耗" */
  parts: { name: string; qty: number }[];
  source: RepairStepSource;
}

/** 确定性打乱：同一 stepKey 永远得到同一顺序，便于复现与单测（不用 Math.random） */
export function shuffledDeterministic<T>(items: readonly T[], stepKey: string): T[] {
  const out = items.slice();
  let h = 2166136261;
  for (let i = 0; i < stepKey.length; i++) {
    h ^= stepKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const j = ((h >>> 0) % (i + 1) + (i + 1)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const LOTO_STANDARD_ACTIONS = ["确认设备停机并通知岗位操作工", "断开动力电源并挂牌上锁", "验电确认零能量", "释放残余压力与储能"];

/** 从规程 safety 文本里抓真实存在的能量隔离动作；抓不到就退回标准四步 */
function lotoActions(procedure: MaintenanceProcedure | null, plan: AiMaintenancePlan | null | undefined): { actions: string[]; source: RepairStepSource } {
  const fromPlan = (plan?.safetyMeasures?.lotoPoints ?? []).map((s) => String(s).trim()).filter((s) => s.length >= 4);
  if (fromPlan.length >= 3) return { actions: fromPlan.slice(0, 4), source: "ai-plan" };
  const fromProc = (procedure?.steps ?? [])
    .flatMap((s) => String(s.safety ?? "").split(/[；;。\n]+/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && /断电|停电|挂牌|上锁|验电|零能量|隔离/.test(s));
  const merged = Array.from(new Set([...fromProc, ...fromPlan]));
  if (merged.length >= 3) return { actions: merged.slice(0, 4), source: "procedure" };
  return { actions: LOTO_STANDARD_ACTIONS, source: "loto-standard" };
}

/** 规程步骤 → 一个操作步；动作拆不出 3 段时退回步骤名序列，保证"顺序题"始终可玩 */
function stepFromProcedure(
  kind: RepairStepKind,
  title: string,
  src: ProcedureStep | undefined,
  fallbackActions: string[],
  parts: { name: string; qty: number }[]
): RepairStep | null {
  if (!src) return null;
  const actions = splitContentActions(src.content ?? "").length >= 3 ? splitContentActions(src.content ?? "") : fallbackActions;
  if (actions.length < 3) return null;
  return {
    kind,
    title,
    prompt: `按正确顺序执行：${src.name}`,
    actions,
    tools: parseTools(src.tools),
    safety: (src.safety ?? "").trim() || "规程本步未登记安全要点，按车间通用防护要求执行",
    acceptance: (src.acceptance ?? "").trim() || "规程本步未登记验收标准",
    parts,
    source: "procedure",
  };
}

/**
 * 构造四步现场操作。
 *
 * @param procedure 该设备命中的真实规程（null = 无规程，返回 []，UI 须禁用这一幕）
 * @param plan      AI 生成的检修方案（可为空：只用规程）
 */
export function buildRepairSteps(input: {
  procedure: MaintenanceProcedure | null;
  plan?: AiMaintenancePlan | null;
}): RepairStep[] {
  const { procedure, plan } = input;
  if (!procedure || !Array.isArray(procedure.steps) || procedure.steps.length === 0) return [];

  const spareParts = (plan?.spareParts ?? []).map((p) => ({ name: String(p.name ?? "").trim(), qty: Number(p.qty) || 1 })).filter((p) => p.name.length > 0);
  const stepNames = procedure.steps.map((s) => s.name).filter(Boolean);
  const loto = lotoActions(procedure, plan);

  const steps: (RepairStep | null)[] = [
    {
      kind: "loto",
      title: "第一步 · 断电挂牌（LOTO）",
      prompt: "按正确顺序完成能量隔离",
      actions: loto.actions,
      tools: [],
      safety: "未验证零能量前，不得接触任何转动或带电部件",
      acceptance: "锁具登记在册、验电记录为零能量",
      parts: [],
      source: loto.source,
    },
    // 规程按 4 步编排：拆解取第 1 步、更换取第 2 步、复装取第 3 步（不足时循环回退）
    stepFromProcedure("disassemble", "第二步 · 拆解到位", procedure.steps[0], stepNames, []),
    stepFromProcedure(
      "replace",
      "第三步 · 更换备件",
      procedure.steps[1] ?? procedure.steps[0],
      stepNames,
      // 备件清单只在第三步出现；AI 没给方案时如实为空，由界面提示"本步无登记备件消耗"
      spareParts
    ),
    stepFromProcedure("reassemble", "第四步 · 复装回位", procedure.steps[2] ?? procedure.steps[procedure.steps.length - 1], stepNames, []),
  ];

  return steps.filter((s): s is RepairStep => s !== null && s.actions.length >= 3);
}

/** 顺序判定：逐个比对，顺序完全正确才算一次通过 */
export function judgeOrder(step: RepairStep, picked: readonly string[]): boolean {
  if (picked.length !== step.actions.length) return false;
  return picked.every((id, i) => id === step.actions[i]);
}

/** 判定 LOTO 登记是否满足本步要求：真实接口返回的锁具编号即可 */
export function lotoRequirementOf(step: RepairStep | undefined): string[] {
  return step ? step.actions : [];
}
