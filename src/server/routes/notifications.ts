// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { validateParams, validateQuery, idParamSchema } from "../middleware/validate.ts";
import { notificationsQuerySchema } from "../schemas/notification.ts";
import {
  handleGetNotifications,
  handleMarkNotificationRead,
  handleMarkAllNotificationsRead,
} from "../controllers/notificationController.ts";

export function registerNotificationRoutes(app: express.Express) {
  // 通知列表 (登录即可查看，按用户真实隔离落库)
  app.get("/api/v1/notifications", requireAuth, validateQuery(notificationsQuerySchema), handleGetNotifications);

  // 标记单条通知已读
  app.patch("/api/v1/notifications/:id/read", requireAuth, validateParams(idParamSchema), handleMarkNotificationRead);

  // 标记全部通知已读 (支持按当前用户隔离)
  app.post("/api/v1/notifications/read-all", requireAuth, handleMarkAllNotificationsRead);
}
