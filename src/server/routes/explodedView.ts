// 拆解视图 ↔ 检修业务联动接口（真实 DB 数据，无 mock）
import express from "express";
import { validateParams, idParamSchema } from "../middleware/validate.ts";
import {
  handleGetWorkOrderExplodedBrief,
  handleGetPartMaintenanceHistory,
  handleGetDeviceFaultDiagnostics,
  handleGetDevicePartLifeDiagnostics,
} from "../controllers/explodedViewController.ts";

export function registerExplodedViewRoutes(app: express.Express) {
  // 1. 工单 → 拆解视图跳转上下文（设备 + 真实 BOM 命中的目标位号）
  app.get("/api/v1/work-orders/:id/exploded-brief", validateParams(idParamSchema), handleGetWorkOrderExplodedBrief);
  app.get("/api/work-orders/:id/exploded-brief", validateParams(idParamSchema), handleGetWorkOrderExplodedBrief);

  // 2. 拆解位号 → 真实维修历史（工单 + 备件目录 + 出入库流水）
  //    注意 :partId 允许 `P-01`/`BOM-03` 这类含连字符的位号
  app.get("/api/v1/equipments/:deviceId/parts/:partId/maintenance-history", handleGetPartMaintenanceHistory);
  app.get("/api/equipments/:deviceId/parts/:partId/maintenance-history", handleGetPartMaintenanceHistory);

  // 3. 设备 → 真实遥测故障诊断（拆解页自动高亮「未处理故障」的红色脉冲高亮）
  app.get("/api/v1/equipments/:deviceId/fault-diagnostics", handleGetDeviceFaultDiagnostics);
  app.get("/api/equipments/:deviceId/fault-diagnostics", handleGetDeviceFaultDiagnostics);

  // 4. 设备 → 真实零件寿命预警（更换记录 × 运行时钟；拆解页黄/红寿命高亮 + 保养建议用）
  app.get("/api/v1/equipments/:deviceId/part-life-diagnostics", handleGetDevicePartLifeDiagnostics);
  app.get("/api/equipments/:deviceId/part-life-diagnostics", handleGetDevicePartLifeDiagnostics);
}
