// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
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
} from "../controllers/workOrderWorkflowController.ts";
import {
  handleCompleteWorkOrder,
  handleAcceptWorkOrder,
  handleTransitionStatus,
} from "../controllers/workOrderCompletionController.ts";

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

  // 6. 创建工单
  app.post("/api/v1/work-orders", validateBody(createWorkOrderSchema), handleCreateWorkOrder);
  app.post("/api/work-orders", validateBody(createWorkOrderSchema), handleCreateWorkOrder);

  // 7. 主管派发工单
  app.post("/api/v1/work-orders/:id/dispatch", validateParams(idParamSchema), validateBody(dispatchWorkOrderSchema), handleDispatchWorkOrder);
  app.post("/api/work-orders/:id/dispatch", validateParams(idParamSchema), validateBody(dispatchWorkOrderSchema), handleDispatchWorkOrder);

  // 8. 技师接单
  app.post("/api/v1/work-orders/:id/claim", validateParams(idParamSchema), validateBody(claimWorkOrderSchema), handleClaimWorkOrder);
  app.post("/api/work-orders/:id/claim", validateParams(idParamSchema), validateBody(claimWorkOrderSchema), handleClaimWorkOrder);

  // 9. 技师完工上报
  app.post("/api/v1/work-orders/:id/complete", validateParams(idParamSchema), validateBody(completeWorkOrderSchema), handleCompleteWorkOrder);
  app.post("/api/work-orders/:id/complete", validateParams(idParamSchema), validateBody(completeWorkOrderSchema), handleCompleteWorkOrder);

  // 10. 质检验收归档
  app.post("/api/v1/work-orders/:id/accept", validateParams(idParamSchema), validateBody(acceptWorkOrderSchema), handleAcceptWorkOrder);
  app.post("/api/work-orders/:id/accept", validateParams(idParamSchema), validateBody(acceptWorkOrderSchema), handleAcceptWorkOrder);

  // 11. 通用状态流转接口
  app.patch("/api/v1/work-orders/:id/status", validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);
  app.put("/api/work-orders/:id/status", validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);
  // 状态转换 POST 别名（与 PATCH /status 等价：{ targetStatus, comment, operatorName }，含乐观锁与状态机校验）
  app.post("/api/v1/work-orders/:id/transition", validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);
  app.post("/api/work-orders/:id/transition", validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);

  // 工单流转时间线（完整操作日志，供详情页时间线渲染）
  app.get("/api/v1/work-orders/:id/logs", validateParams(idParamSchema), handleGetWorkOrderLogs);
  app.get("/api/work-orders/:id/logs", handleGetWorkOrderLogs);

  // 12. 删除/取消工单
  app.delete("/api/v1/work-orders/:id", validateParams(idParamSchema), handleDeleteWorkOrder);
  app.delete("/api/work-orders/:id", validateParams(idParamSchema), handleDeleteWorkOrder);

  // 工单合规审查记录查询
  app.get("/api/v1/work-orders/:id/compliance", requireAuth, handleGetWorkOrderCompliance);
}
