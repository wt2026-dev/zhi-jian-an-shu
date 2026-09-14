// 重构说明：内部师傅距离调度路由（位置上报 / 在岗列表 / 就近推荐 / 派单确认 / 演示模拟）。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { z } from "zod";
import {
  handleReportLocation,
  handleListDutyTechnicians,
  handleRecommendDispatch,
  handleAssignDispatch,
  handleMockLocations,
  handleListEquipmentPoints,
} from "../controllers/dispatchController.ts";

const locationReportSchema = z.object({
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  mapX: z.number().min(0).max(1000).optional(),
  mapY: z.number().min(0).max(1000).optional(),
  status: z.enum(["online", "idle", "offline"]).optional(),
});

const assignSchema = z.object({
  workOrderId: z.string().min(1, { message: "workOrderId 必填" }),
  userId: z.string().min(1, { message: "userId 必填" }),
});

export function registerDispatchRoutes(app: express.Express) {
  // 师傅位置上报（后端校验仅 technician/inspector 可上报）
  app.post("/api/v1/dispatch/location", requireAuth, validateBody(locationReportSchema), handleReportLocation);

  // 在岗师傅列表
  app.get("/api/v1/dispatch/technicians", requireAuth, handleListDutyTechnicians);

  // 调度大屏聚合数据（设备点位 + 待派工单下拉）
  app.get("/api/v1/dispatch/board", requireAuth, handleListEquipmentPoints);

  // 就近派单推荐（核心：距离 40% + 空闲 30% + 技能 30%）
  app.get("/api/v1/dispatch/recommend", requireAuth, handleRecommendDispatch);

  // 派单确认
  app.post("/api/v1/dispatch/assign", requireAuth, validateBody(assignSchema), handleAssignDispatch);

  // 演示接口：模拟在岗师傅位置（仅显式调用生效，标注 demo）
  app.post("/api/v1/dispatch/mock", requireAuth, handleMockLocations);
}
