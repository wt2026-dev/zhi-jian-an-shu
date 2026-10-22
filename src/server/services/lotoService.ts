/**
 * LOTO 流程域（自 businessLoopService.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：环节 3 的 LOTO 硬闸门（assertLotoAllConfirmed：100% 人工逐项确认，
 * 与前端闸门同源）、LOTO 清单落档（settleLotoChecklist）、隔离点逐项确认与补登
 * （confirmLotoPoint / addLotoItem：字段白名单 + 审计留痕 + 预填回写）、
 * sameEditValue 编辑比对工具。闸门口径：上锁挂牌必须 100% 确认，一分不放。
 */
import { BusinessLoopRepository } from "../../db/repositories/index.ts";
import { addAuditLog } from "./auditService.ts";
import { BusinessLoopError } from "./businessLoopService.ts";
import { buildLotoPreview } from "./businessLoopPreviews.ts";
import { lotoRequirement } from "./lotoAdvisory.ts";
import { buildLoopDetail, fmtNow } from "./businessLoopService.ts";

/** 环节3 确认闸门：LOTO 必须全部人工逐项确认（与前端闸门同源的服务端硬校验） */
export async function assertLotoAllConfirmed(stage: any) {
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
export async function settleLotoChecklist(loop: any, stage: any) {
  await BusinessLoopRepository.markArtifactGenerated(loop.id, "loto_checklist", {
    refId: `${loop.loopNo}-LOTO`,
    status: "generated",
    previewText: buildLotoPreview(loop, stage.aiPrefill || {}),
    aiUsed: stage.aiEngine || "safety-interlock-rules",
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
export function lotoEditableFields(fields: any): Array<[string, string]> {
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

export async function writeLotoPrefill(loopId: string, stage: any, prefill: any): Promise<void> {
  await BusinessLoopRepository.updateStagePrefill(loopId, 3, {
    aiPrefillJson: JSON.stringify(prefill),
    aiEngine: stage.aiEngine || "safety-interlock-rules",
    aiStatus: stage.aiStatus || "ok",
  });
}

export function sameEditValue(a: any, b: any): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
  }
  return String(a ?? "").trim() === String(b ?? "").trim();
}
