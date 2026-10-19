// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import { validateBody, validateParams, validateQuery, idParamSchema } from "../middleware/validate.ts";
import {
  workOrdersQuerySchema,
  createWorkOrderSchema,
  dispatchWorkOrderSchema,
  claimWorkOrderSchema,
  completeWorkOrderSchema,
  acceptWorkOrderSchema,
  transitionStatusSchema,
} from "../schemas/workorder.ts";
import {
  handleGetWorkOrderStats,
  handleGetWorkOrders,
  handleExportWorkOrders,
  handleGetWorkOrderById,
  handleGetWorkOrderLogs,
  handleDeleteWorkOrder,
  handleGetWorkOrderCompliance,
} from "../controllers/workOrderController.ts";
import {
  handleCreateWorkOrder,
  handleDispatchWorkOrder,
  handleClaimWorkOrder,
  handleCompleteWorkOrder,
  handleAcceptWorkOrder,
  handleTransitionStatus,
} from "../controllers/workOrderWorkflowController.ts";

export function registerWorkOrderRoutes(app: express.Express) {
  // 3. 工单统计接口
  app.get("/api/v1/work-orders/stats", handleGetWorkOrderStats);
  app.get("/api/work-orders/stats", handleGetWorkOrderStats);

  // 4. 获取工单列表
  app.get("/api/v1/work-orders", validateQuery(workOrdersQuerySchema), handleGetWorkOrders);
  app.get("/api/work-orders", validateQuery(workOrdersQuerySchema), handleGetWorkOrders);

  // 工单台账导出 Excel/CSV (必须在 /:id 路由之前注册，避免 Express 把 "export" 当作 :id 匹配)
  app.get("/api/v1/work-orders/export", validateQuery(workOrdersQuerySchema), handleExportWorkOrders);
  app.get("/api/work-orders/export", validateQuery(workOrdersQuerySchema), handleExportWorkOrders);

  // 5. 获取工单详情
  app.get("/api/v1/work-orders/:id", validateParams(idParamSchema), handleGetWorkOrderById);
  app.get("/api/work-orders/:id", validateParams(idParamSchema), handleGetWorkOrderById);

  // 鉴权与 RBAC（2026-10-19 试点加固，角色口径经确认）：
  // - 报修创建：全员可报修（operator 的报修通道，业务闭环起点），仅需登录；
  // - 派单/验收/归档/状态流转/删除：manager、admin；
  // - 接单开工/完工上报：technician、inspector；
  // - 越权访问由 requireRole 写入审计日志（RBAC_ACCESS_DENIED），拒绝响应 403。
  // 6. 创建工单（报修）
  app.post("/api/v1/work-orders", requireAuth, validateBody(createWorkOrderSchema), handleCreateWorkOrder);
  app.post("/api/work-orders", requireAuth, validateBody(createWorkOrderSchema), handleCreateWorkOrder);

  // 7. 主管派发工单
  app.post("/api/v1/work-orders/:id/dispatch", requireRole(["manager", "admin"], "派发工单"), validateParams(idParamSchema), validateBody(dispatchWorkOrderSchema), handleDispatchWorkOrder);
  app.post("/api/work-orders/:id/dispatch", requireRole(["manager", "admin"], "派发工单"), validateParams(idParamSchema), validateBody(dispatchWorkOrderSchema), handleDispatchWorkOrder);

  // 8. 技师接单
  app.post("/api/v1/work-orders/:id/claim", requireRole(["technician", "inspector"], "接单开工"), validateParams(idParamSchema), validateBody(claimWorkOrderSchema), handleClaimWorkOrder);
  app.post("/api/work-orders/:id/claim", requireRole(["technician", "inspector"], "接单开工"), validateParams(idParamSchema), validateBody(claimWorkOrderSchema), handleClaimWorkOrder);

  // 9. 技师完工上报
  app.post("/api/v1/work-orders/:id/complete", requireRole(["technician", "inspector"], "完工上报"), validateParams(idParamSchema), validateBody(completeWorkOrderSchema), handleCompleteWorkOrder);
  app.post("/api/work-orders/:id/complete", requireRole(["technician", "inspector"], "完工上报"), validateParams(idParamSchema), validateBody(completeWorkOrderSchema), handleCompleteWorkOrder);

  // 10. 质检验收归档
  app.post("/api/v1/work-orders/:id/accept", requireRole(["manager", "admin"], "质检验收归档"), validateParams(idParamSchema), validateBody(acceptWorkOrderSchema), handleAcceptWorkOrder);
  app.post("/api/work-orders/:id/accept", requireRole(["manager", "admin"], "质检验收归档"), validateParams(idParamSchema), validateBody(acceptWorkOrderSchema), handleAcceptWorkOrder);

  // 11. 通用状态流转接口（开工/完工/验收已被专用接口拦截，此处仅主管口径的派单/退回/取消）
  app.patch("/api/v1/work-orders/:id/status", requireRole(["manager", "admin"], "工单状态流转"), validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);
  app.put("/api/work-orders/:id/status", requireRole(["manager", "admin"], "工单状态流转"), validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);
  // 状态转换 POST 别名（与 PATCH /status 等价：{ targetStatus, comment, operatorName }，含乐观锁与状态机校验）
  app.post("/api/v1/work-orders/:id/transition", requireRole(["manager", "admin"], "工单状态流转"), validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);
  app.post("/api/work-orders/:id/transition", requireRole(["manager", "admin"], "工单状态流转"), validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);

  // 工单流转时间线（完整操作日志，供详情页时间线渲染）
  app.get("/api/v1/work-orders/:id/logs", validateParams(idParamSchema), handleGetWorkOrderLogs);
  app.get("/api/work-orders/:id/logs", handleGetWorkOrderLogs);

  // 12. 删除/取消工单
  app.delete("/api/v1/work-orders/:id", requireRole(["manager", "admin"], "删除工单"), validateParams(idParamSchema), handleDeleteWorkOrder);
  app.delete("/api/work-orders/:id", requireRole(["manager", "admin"], "删除工单"), validateParams(idParamSchema), handleDeleteWorkOrder);

  // 工单合规审查记录查询
  app.get("/api/v1/work-orders/:id/compliance", requireAuth, handleGetWorkOrderCompliance);
}
