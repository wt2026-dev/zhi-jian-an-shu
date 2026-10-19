// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireRole } from "../middleware/auth.ts";
import { validateBody, validateParams, validateQuery, idParamSchema } from "../middleware/validate.ts";
import { equipmentsQuerySchema, createEquipmentSchema } from "../schemas/equipment.ts";
import {
  handleGetEquipments,
  handleGetEquipmentById,
  handleGetEquipmentQrcode,
  handleGetEquipmentTelemetryHistory,
  handleCreateEquipment,
} from "../controllers/equipmentController.ts";

export function registerEquipmentRoutes(app: express.Express) {
  // 1. 获取设备台账列表
  app.get("/api/v1/equipments", validateQuery(equipmentsQuerySchema), handleGetEquipments);

  // 2. 获取单个设备详情
  app.get("/api/v1/equipments/:id", validateParams(idParamSchema), handleGetEquipmentById);

  // 14. 设备专属二维码与历史时序监控接口
  app.get("/api/v1/equipments/:id/qrcode", validateParams(idParamSchema), handleGetEquipmentQrcode);

  app.get("/api/v1/equipments/:id/telemetry-history", validateParams(idParamSchema), handleGetEquipmentTelemetryHistory);

  // 新增设备档案 (仅限管理员 / 主管，真实落库 equipments 表)
  app.post("/api/v1/equipments", requireRole(["admin", "manager"], "新增设备档案"), validateBody(createEquipmentSchema), handleCreateEquipment);
}
