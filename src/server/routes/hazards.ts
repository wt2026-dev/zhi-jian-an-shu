// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { createHazardSchema, updateHazardSchema, assignHazardSchema, verifyHazardSchema } from "../schemas/hazard.ts";
import {
  handleGetHazards,
  handleGetHazardMetrics,
  handleGetHazardById,
  handleCreateHazard,
  handleUpdateHazard,
  handleAssignHazard,
  handleVerifyHazard,
} from "../controllers/hazardsController.ts";

export function registerHazardRoutes(app: express.Express) {
  // ==================== 安全隐患闭环管理 API ====================
  // 1. 获取隐患列表 (重大隐患置顶)
  app.get("/api/v1/hazards", requireAuth, handleGetHazards);

  // 2. 隐患统计指标 (待整改、重大隐患数量等)
  app.get("/api/v1/hazards/metrics", requireAuth, handleGetHazardMetrics);

  // 3. 获取单项隐患详情
  app.get("/api/v1/hazards/:id", requireAuth, handleGetHazardById);

  // 4. 现场上报或排查登记新隐患
  app.post("/api/v1/hazards", requireAuth, validateBody(createHazardSchema), handleCreateHazard);

  // 5. 更新隐患信息
  app.put("/api/v1/hazards/:id", requireAuth, validateBody(updateHazardSchema), handleUpdateHazard);

  // 6. 隐患一键下发整改工单 (生成抢修/整改工单并关联)
  app.post("/api/v1/hazards/:id/assign", requireAuth, validateBody(assignHazardSchema), handleAssignHazard);

  // 7. 隐患现场复核验收与闭环归档
  app.post("/api/v1/hazards/:id/verify", requireAuth, validateBody(verifyHazardSchema), handleVerifyHazard);
}
