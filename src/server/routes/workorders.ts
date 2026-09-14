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

  // 鉴权：工单写操作（创建/派发/接单/完工/验收/流转/删除）一律要求登录 JWT，
  // 防止匿名用户篡改工单状态；Web 端 request() 与小程序 request.js 均已携带 Bearer token。
  // 6. 创建工单
  app.post("/api/v1/work-orders", requireAuth, validateBody(createWorkOrderSchema), handleCreateWorkOrder);
  app.post("/api/work-orders", requireAuth, validateBody(createWorkOrderSchema), handleCreateWorkOrder);

  // 7. 主管派发工单
  app.post("/api/v1/work-orders/:id/dispatch", requireAuth, validateParams(idParamSchema), validateBody(dispatchWorkOrderSchema), handleDispatchWorkOrder);
  app.post("/api/work-orders/:id/dispatch", requireAuth, validateParams(idParamSchema), validateBody(dispatchWorkOrderSchema), handleDispatchWorkOrder);

  // 8. 技师接单
  app.post("/api/v1/work-orders/:id/claim", requireAuth, validateParams(idParamSchema), validateBody(claimWorkOrderSchema), handleClaimWorkOrder);
  app.post("/api/work-orders/:id/claim", requireAuth, validateParams(idParamSchema), validateBody(claimWorkOrderSchema), handleClaimWorkOrder);

  // 9. 技师完工上报
  app.post("/api/v1/work-orders/:id/complete", requireAuth, validateParams(idParamSchema), validateBody(completeWorkOrderSchema), handleCompleteWorkOrder);
  app.post("/api/work-orders/:id/complete", requireAuth, validateParams(idParamSchema), validateBody(completeWorkOrderSchema), handleCompleteWorkOrder);

  // 10. 质检验收归档
  app.post("/api/v1/work-orders/:id/accept", requireAuth, validateParams(idParamSchema), validateBody(acceptWorkOrderSchema), handleAcceptWorkOrder);
  app.post("/api/work-orders/:id/accept", requireAuth, validateParams(idParamSchema), validateBody(acceptWorkOrderSchema), handleAcceptWorkOrder);

  // 11. 通用状态流转接口
  app.patch("/api/v1/work-orders/:id/status", requireAuth, validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);
  app.put("/api/work-orders/:id/status", requireAuth, validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);
  // 状态转换 POST 别名（与 PATCH /status 等价：{ targetStatus, comment, operatorName }，含乐观锁与状态机校验）
  app.post("/api/v1/work-orders/:id/transition", requireAuth, validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);
  app.post("/api/work-orders/:id/transition", requireAuth, validateParams(idParamSchema), validateBody(transitionStatusSchema), handleTransitionStatus);

  // 工单流转时间线（完整操作日志，供详情页时间线渲染）
  app.get("/api/v1/work-orders/:id/logs", validateParams(idParamSchema), handleGetWorkOrderLogs);
  app.get("/api/work-orders/:id/logs", handleGetWorkOrderLogs);

  // 12. 删除/取消工单
  app.delete("/api/v1/work-orders/:id", requireAuth, validateParams(idParamSchema), handleDeleteWorkOrder);
  app.delete("/api/work-orders/:id", requireAuth, validateParams(idParamSchema), handleDeleteWorkOrder);

  // 工单合规审查记录查询
  app.get("/api/v1/work-orders/:id/compliance", requireAuth, handleGetWorkOrderCompliance);
}
