// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { handleGetCockpitMetrics, handleGetAbnormalEquipments } from "../controllers/dashboardController.ts";
import { cockpitAbnormalQuerySchema } from "../schemas/dashboard.ts";
import { validateQuery } from "../middleware/validate.ts";

export function registerDashboardRoutes(app: express.Express) {
  // 驾驶舱聚合指标 (支持小程序直接调用 /api/v1/cockpit/metrics，登录即可调用)
  app.get("/api/v1/cockpit/metrics", requireAuth, handleGetCockpitMetrics);

  // 驾驶舱异常下钻：受影响设备/事件明细（监测 → 定位 → 干预 闭环数据源）
  app.get(
    "/api/v1/cockpit/abnormal-equipments",
    requireAuth,
    validateQuery(cockpitAbnormalQuerySchema),
    handleGetAbnormalEquipments
  );
}
