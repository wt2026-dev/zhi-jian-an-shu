// 修后验收与效果验证路由：会话 + 逐项验收 + 双签字。
// 写操作 requireAuth —— 签字人取服务端会话用户，不信任请求体身份。
import express from "express";
import { orderIdParamSchema, validateParams, validateBody } from "../middleware/validate.ts";
import { requireAuth } from "../middleware/auth.ts";
import { z } from "zod";
import {
  handleGetAcceptance,
  handleAcceptanceCheck,
  handleAcceptanceSign,
} from "../controllers/acceptanceController.ts";

// 逐项验收：itemKey 必须在验收标准表内（服务层再查一次，防越权枚举）；
// value 允许为空（定性项），verdict 由服务端复算，不收前端判定。
const checkSchema = z.object({
  itemKey: z.string().min(1),
  value: z.union([z.number().finite(), z.string().max(32)]).nullable().optional(),
  confirmed: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

// 签字：只认步骤，不认姓名/角色（角色从会话取，防冒充班组长）
const signSchema = z.object({
  step: z.enum(["technician", "teamlead"]),
  comment: z.string().max(300).optional(),
});

export function registerAcceptanceRoutes(app: express.Express) {
  app.get("/api/v1/work-orders/:orderId/acceptance", validateParams(orderIdParamSchema), handleGetAcceptance);
  app.get("/api/work-orders/:orderId/acceptance", validateParams(orderIdParamSchema), handleGetAcceptance);

  app.post(
    "/api/v1/work-orders/:orderId/acceptance/checks",
    requireAuth,
    validateParams(orderIdParamSchema),
    validateBody(checkSchema),
    handleAcceptanceCheck
  );
  app.post(
    "/api/work-orders/:orderId/acceptance/checks",
    requireAuth,
    validateParams(orderIdParamSchema),
    validateBody(checkSchema),
    handleAcceptanceCheck
  );

  app.post(
    "/api/v1/work-orders/:orderId/acceptance/sign",
    requireAuth,
    validateParams(orderIdParamSchema),
    validateBody(signSchema),
    handleAcceptanceSign
  );
  app.post(
    "/api/work-orders/:orderId/acceptance/sign",
    requireAuth,
    validateParams(orderIdParamSchema),
    validateBody(signSchema),
    handleAcceptanceSign
  );
}
