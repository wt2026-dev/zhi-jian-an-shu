// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { validateBody, validateParams, validateQuery, idParamSchema } from "../middleware/validate.ts";
import { requireAuth, requireRole } from "../middleware/auth.ts";
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

  // 高危作业票：读操作登录即可；写操作（创建/审批/关闭）限 admin/manager/inspector
  app.get("/api/v1/safety-permits", requireAuth, validateQuery(safetyPermitsQuerySchema), handleGetSafetyPermits);

  app.get("/api/v1/safety-permits/:id", requireAuth, validateParams(idParamSchema), handleGetSafetyPermitById);

  app.post("/api/v1/safety-permits", requireRole(["admin", "manager", "inspector"], "创建高危作业票"), validateBody(createSafetyPermitSchema), handleCreateSafetyPermit);

  // 双人审批业务流转
  app.post("/api/v1/safety-permits/:id/approve", requireRole(["admin", "manager", "inspector"], "审批高危作业票"), validateParams(idParamSchema), validateBody(approveSafetyPermitSchema), handleApproveSafetyPermit);

  app.post("/api/v1/safety-permits/:id/close", requireRole(["admin", "manager", "inspector"], "关闭高危作业票"), validateParams(idParamSchema), validateBody(closeSafetyPermitSchema), handleCloseSafetyPermit);

  // 删除作业票：路由层仅要求登录（全局基线挡匿名）；admin/manager 的角色校验与
  // PERMIT_DELETE/BLOCKED 审计留痕由 handleDeleteSafetyPermit 内部完成，路由层重复拦截会丢失该语义
  app.delete("/api/v1/safety-permits/:id", requireAuth, validateParams(idParamSchema), handleDeleteSafetyPermit);

  // ==================== 16.4 通知中心 / LOTO 锁具 / 账号与设备创建 ====================

  // LOTO 能量隔离锁具看板 (工作台 LOTO 面板与安全看板真实数据源)：登录可读
  app.get("/api/v1/loto-locks", requireAuth, handleGetLotoLocks);
  app.get("/api/loto-locks", requireAuth, handleGetLotoLocks);
  app.get("/api/v1/loto-locks/:id", requireAuth, validateParams(idParamSchema), handleGetLotoLockById);
}
