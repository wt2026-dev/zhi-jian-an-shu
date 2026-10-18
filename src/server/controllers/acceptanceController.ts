/**
 * 修后验收与效果验证 HTTP 处理器。
 * 会话只读 GET + 两类写操作（逐项验收 / 双签字），业务校验全部由
 * acceptanceService 承担；签字人身份一律取服务端 req.currentUser，不信任 body。
 */
import type { Request, Response } from "express";
import {
  getAcceptanceSession,
  recordAcceptanceCheck,
  signAcceptance,
} from "../services/acceptanceService.ts";

interface AppError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

type AuthedRequest = Request & { currentUser?: unknown; user?: unknown };

function respondError(res: Response, err: unknown, fallbackTitle: string) {
  const e = err as AppError;
  if (e && e.code === "WORK_ORDER_NOT_FOUND") {
    return res.status(404).json({ error: e.message, code: "WORK_ORDER_NOT_FOUND" });
  }
  if (e && e.code === "STANDARD_NOT_FOUND") {
    return res.status(404).json({ error: e.message, code: "STANDARD_NOT_FOUND" });
  }
  if (e && (e.code === "STATE_MUTEX_ERROR" || e.code === "ACCEPTANCE_CLOSED" || e.code === "ALREADY_SIGNED")) {
    return res.status(409).json({ error: e.message, code: e.code });
  }
  if (e && (e.code === "ROLE_FORBIDDEN" || e.code === "NOT_REPAIRER")) {
    return res.status(403).json({ error: e.message, code: e.code, details: e.details ?? null });
  }
  if (e && e.name === "VersionConflictError") {
    return res.status(409).json({ error: e.message, code: "VERSION_CONFLICT" });
  }
  if (e && e.status === 422) {
    return res.status(422).json({ error: e.message, code: e.code ?? "INVALID_INPUT", details: e.details ?? null });
  }
  if (e && e.status === 400) {
    return res.status(400).json({ error: e.message, code: e.code ?? "INVALID_INPUT" });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ error: `${fallbackTitle}: ${msg}` });
}

/** GET /api/v1/work-orders/:orderId/acceptance —— 验收会话（清单 + 修前基线 + 已签字 + 总结） */
export async function handleGetAcceptance(req: Request, res: Response) {
  try {
    return res.json(await getAcceptanceSession(String(req.params.orderId ?? "")));
  } catch (err: unknown) {
    return respondError(res, err, "查询修后验收失败");
  }
}

/** POST /api/v1/work-orders/:orderId/acceptance/checks —— 记录一项验收结果（服务端复算判定） */
export async function handleAcceptanceCheck(req: Request, res: Response) {
  try {
    const authReq = req as AuthedRequest;
    const operator = authReq.currentUser ?? authReq.user ?? null;
    return res.json(await recordAcceptanceCheck(String(req.params.orderId ?? ""), operator, req.body));
  } catch (err: unknown) {
    return respondError(res, err, "录入验收结果失败");
  }
}

/** POST /api/v1/work-orders/:orderId/acceptance/sign —— 签字（维修人 → 班组长，须两人） */
export async function handleAcceptanceSign(req: Request, res: Response) {
  try {
    const authReq = req as AuthedRequest;
    const operator = authReq.currentUser ?? authReq.user ?? null;
    const result = await signAcceptance(String(req.params.orderId ?? ""), operator, req.body);
    // session.closed 与"本次调用是否关单"区分开，避免前端把历史上已关单误判为刚好关单
    return res.json({ ...result.session, justClosed: result.closed, summaryRef: result.summary });
  } catch (err: unknown) {
    return respondError(res, err, "验收签字失败");
  }
}
