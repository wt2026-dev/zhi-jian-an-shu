// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { handleGetCockpitMetrics } from "../controllers/dashboardController.ts";

export function registerDashboardRoutes(app: express.Express) {
  // 驾驶舱聚合指标 (支持小程序直接调用 /api/v1/cockpit/metrics，登录即可调用)
  app.get("/api/v1/cockpit/metrics", requireAuth, handleGetCockpitMetrics);
}
