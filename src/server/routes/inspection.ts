// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireRole } from "../middleware/auth.ts";
import { validateBody, validateParams, validateQuery, idParamSchema } from "../middleware/validate.ts";
import { inspectionsQuerySchema, inspectionCreateSchema, inspectionUpdateSchema } from "../schemas/inspection.ts";
import {
  handleGetInspections,
  handleGetInspectionById,
  handleCreateInspection,
  handleUpdateInspection,
} from "../controllers/inspectionController.ts";

// ==================== 16.5 巡检任务真实落库 (Inspections CRUD) ====================
export function registerInspectionRoutes(app: express.Express) {
  app.get("/api/v1/inspections", validateQuery(inspectionsQuerySchema), handleGetInspections);

  app.get("/api/v1/inspections/:id", validateParams(idParamSchema), handleGetInspectionById);

  // 创建巡检任务 (巡检主管 / 安全监护 / 管理员 / 技师可发起)
  app.post(
    "/api/v1/inspections",
    requireRole(["inspector", "admin", "manager", "technician"], "创建巡检任务"),
    validateBody(inspectionCreateSchema),
    handleCreateInspection
  );

  // 更新巡检任务（测点打卡 / 状态流转 / 汇总）
  app.patch(
    "/api/v1/inspections/:id",
    requireRole(["inspector", "admin", "manager", "technician"], "更新巡检任务"),
    validateParams(idParamSchema),
    validateBody(inspectionUpdateSchema),
    handleUpdateInspection
  );
}
