// Hermes 业务闭环路由（智能业务管家）。
// 权限口径：写操作限 admin/manager/technician（requireRole，越权写审计日志）；
// 详情/列表查询仅要求登录（全局鉴权基线已兜底 /api/* 默认拒绝）。
// 注意注册顺序：/history 必须先于 /:id 注册，否则会被参数路由吞掉。
import express from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.ts";
import { createBusinessLoopSchema, listLoopsQuerySchema, loopIdParamSchema, stageNoParamSchema, lotoConfirmSchema } from "../schemas/businessLoop.ts";
import {
  handleCreateBusinessLoop,
  handleListBusinessLoops,
  handleGetBusinessLoop,
  handleGetBusinessLoopHistory,
  handleConfirmStage,
  handleConfirmLotoItem,
  handleCompleteBusinessLoop,
} from "../controllers/businessLoopController.ts";

const FIELD_ROLES = ["admin", "manager", "technician"];

const emptyBodySchema = z.looseObject({});

/** confirm/complete/归档 无需请求体内容：宽松空对象校验，客户端 POST 带 {} 即可通过 */
function emptyBody() {
  return emptyBodySchema;
}

export function registerBusinessLoopRoutes(app: express.Express) {
  // 列表 / 历史（登录即可见，前端按角色细粒度藏按钮）
  app.get("/api/v1/business-loops", requireAuth, validateQuery(listLoopsQuerySchema), handleListBusinessLoops);
  app.get("/api/v1/business-loops/history", requireAuth, handleGetBusinessLoopHistory);

  // 创建闭环（202：已受理，AI 预填在后台异步进行）
  app.post(
    "/api/v1/business-loops",
    requireRole(FIELD_ROLES, "创建业务闭环"),
    validateBody(createBusinessLoopSchema),
    handleCreateBusinessLoop
  );

  // 详情（六环节 + AI 预填 + 产出物）
  app.get("/api/v1/business-loops/:id", requireAuth, validateParams(loopIdParamSchema), handleGetBusinessLoop);

  // 环节确认闸门
  app.post(
    "/api/v1/business-loops/:id/stages/:stageNo/confirm",
    requireRole(FIELD_ROLES, "确认业务闭环环节"),
    validateParams(stageNoParamSchema),
    validateBody(emptyBody()),
    handleConfirmStage
  );

  // LOTO 隔离点逐项确认
  app.patch(
    "/api/v1/business-loops/:id/loto-confirm",
        requireRole(FIELD_ROLES, "确认 LOTO 隔离点"),
    validateParams(loopIdParamSchema),
    validateBody(lotoConfirmSchema),
    handleConfirmLotoItem
  );

  // 归档闭环（质检报告 + 知识沉淀 + 档案包）
  app.post(
    "/api/v1/business-loops/:id/complete",
    requireRole(FIELD_ROLES, "归档业务闭环"),
    validateParams(loopIdParamSchema),
    validateBody(emptyBody()),
    handleCompleteBusinessLoop
  );
}
