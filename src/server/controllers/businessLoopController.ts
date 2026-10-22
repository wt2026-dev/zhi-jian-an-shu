import type { Request, Response } from "express";
import { createLoop, confirmStage, completeLoop, listLoops, buildLoopDetail, buildHistoryItems, BusinessLoopError } from "../services/businessLoopService.ts";
import { confirmLotoPoint, addLotoItem } from "../services/lotoService.ts";
import { logger } from "../../utils/logger.ts";

// 统一错误出口：BusinessLoopError → 状态码 + 业务码；其余按 500 记日志
function loopErrorResponse(res: Response, err: any, fallbackMsg: string) {
  if (err instanceof BusinessLoopError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  logger.error(err, "业务闭环接口异常");
  return res.status(500).json({ error: `${fallbackMsg}（${err?.message || "未知错误"}）` });
}

type AuthedRequest = Request & { currentUser?: any; user?: any };

// POST /api/v1/business-loops（创建闭环，202 表示已受理且 AI 预填在后台进行）
export async function handleCreateBusinessLoop(req: any, res: Response) {
  try {
    const detail = await createLoop({
      goal: req.body.goal,
      equipmentId: req.body.equipmentId,
      user: (req as AuthedRequest).currentUser,
    });
    return res.status(202).json(detail);
  } catch (err: any) {
    return loopErrorResponse(res, err, "创建业务闭环失败");
  }
}

// GET /api/v1/business-loops?status=running|paused|archived&limit=n
export async function handleListBusinessLoops(req: any, res: Response) {
  try {
    const loops = await listLoops(req.query as any);
    return res.json(loops);
  } catch (err: any) {
    return loopErrorResponse(res, err, "查询业务闭环列表失败");
  }
}

// GET /api/v1/business-loops/:id（详情：六环节 + AI 预填 + 产出物）
export async function handleGetBusinessLoop(req: any, res: Response) {
  try {
    const detail = await buildLoopDetail(req.params.id);
    return res.json(detail);
  } catch (err: any) {
    return loopErrorResponse(res, err, "查询业务闭环详情失败");
  }
}

// GET /api/v1/business-loops/history（历史闭环，仅已归档）
export async function handleGetBusinessLoopHistory(_req: any, res: Response) {
  try {
    const history = await buildHistoryItems();
    return res.json(history);
  } catch (err: any) {
    return loopErrorResponse(res, err, "查询历史闭环失败");
  }
}

// POST /api/v1/business-loops/:id/stages/:stageNo/confirm（人工确认闸门，可带人工修订 edits）
export async function handleConfirmStage(req: any, res: Response) {
  try {
    const detail = await confirmStage({
      loopId: req.params.id,
      stageNo: Number(req.params.stageNo),
      user: (req as AuthedRequest).currentUser,
      edits: req.body?.edits,
    });
    return res.json(detail);
  } catch (err: any) {
    return loopErrorResponse(res, err, "确认环节失败");
  }
}

// PATCH /api/v1/business-loops/:id/loto-confirm（LOTO 隔离点逐项确认 + 现场登记字段修订）
export async function handleConfirmLotoItem(req: any, res: Response) {
  try {
    const detail = await confirmLotoPoint({
      loopId: req.params.id,
      itemId: req.body.itemId,
      confirmed: req.body.confirmed,
      user: (req as AuthedRequest).currentUser,
      fields: req.body?.fields,
    });
    return res.json(detail);
  } catch (err: any) {
    return loopErrorResponse(res, err, "LOTO 隔离点确认失败");
  }
}

// POST /api/v1/business-loops/:id/loto-items（现场补登 AI 清单外的隔离点）
export async function handleAddLotoItem(req: any, res: Response) {
  try {
    const detail = await addLotoItem({
      loopId: req.params.id,
      fields: req.body,
      user: (req as AuthedRequest).currentUser,
    });
    return res.status(201).json(detail);
  } catch (err: any) {
    return loopErrorResponse(res, err, "LOTO 隔离点补登失败");
  }
}

// POST /api/v1/business-loops/:id/complete（归档：质检报告 + 知识沉淀 + 档案包）
export async function handleCompleteBusinessLoop(req: any, res: Response) {
  try {
    const detail = await completeLoop({ loopId: req.params.id, user: (req as AuthedRequest).currentUser });
    return res.json(detail);
  } catch (err: any) {
    return loopErrorResponse(res, err, "归档闭环失败");
  }
}
