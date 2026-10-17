/**
 * 拆解作业终端（现场维修闭环）HTTP 处理器。
 * 会话只读 GET + 四类写操作（LOTO / 步骤 / 测量 / 照片），同一套真实业务校验
 * 由 fieldOperationService 承担；操作人一律取服务端 req.currentUser。
 */
import type { Request, Response } from "express";
import {
  getWorkSession,
  confirmLoto,
  recordFieldStep,
  addFieldMeasurement,
  addFieldPartPhoto,
} from "../services/fieldOperationService.ts";

interface AppError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

/** 带 requireAuth 注入用户身份的请求（respond 端不信任 body 里的身份） */
type AuthedRequest = Request & { currentUser?: unknown; user?: unknown };

function respondError(res: Response, err: unknown, fallbackTitle: string) {
  const e = err as AppError;
  if (e && e.code === "EQUIPMENT_NOT_FOUND") {
    return res.status(404).json({ error: "设备未找到", code: "EQUIPMENT_NOT_FOUND" });
  }
  if (e && e.code === "NO_EXPLODED_CATALOG") {
    return res.status(404).json({ error: e.message, code: "NO_EXPLODED_CATALOG" });
  }
  if (e && e.code === "WORK_ORDER_NOT_FOUND") {
    return res.status(404).json({ error: e.message, code: "WORK_ORDER_NOT_FOUND" });
  }
  if (e && e.code === "PART_NOT_IN_CATALOG") {
    return res.status(404).json({ error: e.message, code: "PART_NOT_IN_CATALOG" });
  }
  if (e && e.code === "FIELD_LOTO_REQUIRED") {
    return res.status(403).json({ error: e.message, code: e.code });
  }
  if (e && e.code === "STATE_MUTEX_ERROR") {
    return res.status(409).json({ error: e.message, code: e.code });
  }
  if (e && e.name === "VersionConflictError") {
    return res.status(409).json({ error: e.message, code: "VERSION_CONFLICT" });
  }
  if (e && e.status === 422) {
    return res.status(422).json({ error: e.message, code: e.code ?? "INVALID_INPUT", details: e.details ?? null });
  }
  if (e && e.code === "MEASURE_STANDARD_NOT_FOUND") {
    return res.status(422).json({ error: e.message, code: e.code });
  }
  if (e && e.status === 400) {
    return res.status(400).json({ error: e.message, code: e.code ?? "INVALID_INPUT" });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ error: `${fallbackTitle}: ${msg}` });
}

/** GET /api/v1/equipments/:deviceId/field-session —— 现场作业会话（工单 + LOTO + 步骤留痕 + 进度） */
export async function handleGetFieldSession(req: Request, res: Response) {
  try {
    return res.json(await getWorkSession(String(req.params.deviceId ?? "")));
  } catch (err: unknown) {
    return respondError(res, err, "查询现场作业会话失败");
  }
}

/** POST /api/v1/work-orders/:orderId/field-actions/loto —— LOTO 强制安全确认留档 */
export async function handleFieldLoto(req: Request, res: Response) {
  try {
    const authReq = req as AuthedRequest;
    const operator = authReq.currentUser ?? authReq.user ?? null;
    const items = Array.isArray((req.body ?? {}).items) ? (req.body as { items: unknown[] }).items : [];
    // 四项是否齐全由服务层按权威清单复验（这里不重复判定，避免两处口径漂移）
    const session = await confirmLoto(String(req.params.orderId ?? ""), operator, items);
    return res.json(session);
  } catch (err: unknown) {
    return respondError(res, err, "LOTO 安全确认失败");
  }
}

/** POST /api/v1/work-orders/:orderId/field-actions/step —— 记录单步（完成/跳过/问题），全部完成自动完工 */
export async function handleFieldStep(req: Request, res: Response) {
  try {
    const authReq = req as AuthedRequest;
    const operator = authReq.currentUser ?? authReq.user ?? null;
    const result = await recordFieldStep(String(req.params.orderId ?? ""), operator, req.body);
    // 会话里的 autoCompleted 是**完工留痕对象**（完工时间/维修人/工时/步骤数），
    // "本次调用是否触发了完工"另用 justCompleted 表达，避免一个键两种类型。
    return res.json({ ...result.session, justCompleted: result.autoCompleted });
  } catch (err: unknown) {
    return respondError(res, err, "记录维修步骤失败");
  }
}

/** POST /api/v1/work-orders/:orderId/field-actions/measure —— 录入测量数据（真实点检标准比对） */
export async function handleFieldMeasure(req: Request, res: Response) {
  try {
    const authReq = req as AuthedRequest;
    const operator = authReq.currentUser ?? authReq.user ?? null;
    return res.json(await addFieldMeasurement(String(req.params.orderId ?? ""), operator, req.body));
  } catch (err: unknown) {
    return respondError(res, err, "录入测量数据失败");
  }
}

/** POST /api/v1/work-orders/:orderId/field-actions/photo —— 关联现场照片（须先真实上传） */
export async function handleFieldPhoto(req: Request, res: Response) {
  try {
    const authReq = req as AuthedRequest;
    const operator = authReq.currentUser ?? authReq.user ?? null;
    return res.json(await addFieldPartPhoto(String(req.params.orderId ?? ""), operator, req.body));
  } catch (err: unknown) {
    return respondError(res, err, "关联现场照片失败");
  }
}
