// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { validateBody, validateParams, validateQuery, idParamSchema } from "../middleware/validate.ts";
import { safetyPermitsQuerySchema, createSafetyPermitSchema, approveSafetyPermitSchema, closeSafetyPermitSchema } from "../schemas/safety.ts";
import {
  handleGetSafetyPermits,
  handleGetSafetyPermitById,
  handleCreateSafetyPermit,
  handleApproveSafetyPermit,
  handleCloseSafetyPermit,
  handleDeleteSafetyPermit,
  handleGetLotoLocks,
  handleGetLotoLockById,
  loadSafetyPermitsIntoMemory,
} from "../controllers/safetyController.ts";

export function registerSafetyRoutes(app: express.Express) {
  // 对应 server.ts:3676 的启动加载逻辑：列表以数据库真实落库为准
  void loadSafetyPermitsIntoMemory();

  app.get("/api/v1/safety-permits", validateQuery(safetyPermitsQuerySchema), handleGetSafetyPermits);

  app.get("/api/v1/safety-permits/:id", validateParams(idParamSchema), handleGetSafetyPermitById);

  app.post("/api/v1/safety-permits", validateBody(createSafetyPermitSchema), handleCreateSafetyPermit);

  // 双人审批业务流转
  app.post("/api/v1/safety-permits/:id/approve", validateParams(idParamSchema), validateBody(approveSafetyPermitSchema), handleApproveSafetyPermit);

  app.post("/api/v1/safety-permits/:id/close", validateParams(idParamSchema), validateBody(closeSafetyPermitSchema), handleCloseSafetyPermit);

  // 删除作业票 (仅限 admin 和 manager)
  app.delete("/api/v1/safety-permits/:id", validateParams(idParamSchema), handleDeleteSafetyPermit);

  // ==================== 16.4 通知中心 / LOTO 锁具 / 账号与设备创建 ====================

  // LOTO 能量隔离锁具看板 (工作台 LOTO 面板与安全看板真实数据源)
  app.get("/api/v1/loto-locks", handleGetLotoLocks);
  app.get("/api/loto-locks", handleGetLotoLocks);
  app.get("/api/v1/loto-locks/:id", validateParams(idParamSchema), handleGetLotoLockById);
}
