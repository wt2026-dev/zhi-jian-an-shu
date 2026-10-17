// 拆解视图 ↔ 检修业务联动接口（真实 DB 数据，无 mock）
import express from "express";
import { validateParams, idParamSchema } from "../middleware/validate.ts";
import {
  handleGetWorkOrderExplodedBrief,
  handleGetPartMaintenanceHistory,
} from "../controllers/explodedViewController.ts";

export function registerExplodedViewRoutes(app: express.Express) {
  // 1. 工单 → 拆解视图跳转上下文（设备 + 真实 BOM 命中的目标位号）
  app.get("/api/v1/work-orders/:id/exploded-brief", validateParams(idParamSchema), handleGetWorkOrderExplodedBrief);
  app.get("/api/work-orders/:id/exploded-brief", validateParams(idParamSchema), handleGetWorkOrderExplodedBrief);

  // 2. 拆解位号 → 真实维修历史（工单 + 备件目录 + 出入库流水）
  //    注意 :partId 允许 `P-01`/`BOM-03` 这类含连字符的位号
  app.get("/api/v1/equipments/:deviceId/parts/:partId/maintenance-history", handleGetPartMaintenanceHistory);
  app.get("/api/equipments/:deviceId/parts/:partId/maintenance-history", handleGetPartMaintenanceHistory);
}
