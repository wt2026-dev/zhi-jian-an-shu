// 拆解视图 ↔ 检修业务联动接口（真实 DB 数据，无 mock）
import express from "express";
import { deviceIdParamSchema, idParamSchema, validateParams } from "../middleware/validate.ts";
import {
  handleGetWorkOrderExplodedBrief,
  handleGetPartMaintenanceHistory,
  handleGetDeviceFaultDiagnostics,
  handleGetDevicePartLifeDiagnostics,
  handleGetDevicePartInventory,
  handleGetMaintenanceReport,
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

  // 5. 设备 → 真实备件库存联动（spare_parts 台账；拆解页库存四要素 + 采购申请用）
  app.get("/api/v1/equipments/:deviceId/part-inventory", handleGetDevicePartInventory);
  app.get("/api/equipments/:deviceId/part-inventory", handleGetDevicePartInventory);

  // 6. 设备 → 检修报告聚合数据（设备台账 + 拆解页 BOM + 故障/寿命/库存标注 + 完工单历史，PDF 导出用）
  app.get("/api/v1/equipments/:deviceId/maintenance-report", validateParams(deviceIdParamSchema), handleGetMaintenanceReport);
  app.get("/api/equipments/:deviceId/maintenance-report", validateParams(deviceIdParamSchema), handleGetMaintenanceReport);
}
