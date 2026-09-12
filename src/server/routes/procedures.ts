// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import { validateBody, validateQuery } from "../middleware/validate.ts";
import { procedureQuerySchema, createProcedureSchema } from "../schemas/procedure.ts";
import { videoAnalyzeSchema } from "../schemas/ai.ts";
import {
  handleListProcedures,
  handleProcedureVideoStatus,
  handleDeleteProcedureVideo,
  handleGetProcedure,
  handleCreateProcedure,
  handleGenerateVideoScript,
  handleGenerateVideo,
  handleGenerateVideoFull,
  handleGetProcedureVideos,
} from "../controllers/procedureController.ts";
import { handleVideoAnalyze } from "../controllers/uploadController.ts";
import { handleGetComplianceStats } from "../controllers/complianceController.ts";

export function registerProcedureRoutes(app: express.Express) {
  app.get("/api/v1/procedures", requireAuth, validateQuery(procedureQuerySchema), handleListProcedures);

  // 轮询视频状态 (GET /api/v1/procedures/video-status?taskId=xxx)
  // 必须位于 /api/v1/procedures/:id 之前注册，防止 video-status 被当作 :id 匹配
  app.get("/api/v1/procedures/video-status", requireAuth, handleProcedureVideoStatus);

  // 删除视频记录 (DELETE /api/v1/procedures/videos/:id)
  app.delete(
    "/api/v1/procedures/videos/:id",
    requireAuth,
    requireRole(["admin", "manager"], "删除作业指引视频记录"),
    handleDeleteProcedureVideo
  );

  app.get("/api/v1/procedures/:id", requireAuth, handleGetProcedure);

  app.post("/api/v1/procedures", requireAuth, requireRole(["admin", "manager"], "创建维护作业指引"), validateBody(createProcedureSchema), handleCreateProcedure);

  app.post("/api/v1/procedures/:id/generate-video-script", requireAuth, handleGenerateVideoScript);

  // ==================== Agnes AI 真实工业实操视频生成接口 ====================
  // 1. 发起视频生成 (POST /api/v1/procedures/:id/generate-video)
  app.post("/api/v1/procedures/:id/generate-video", requireAuth, handleGenerateVideo);

  // ==================== 完整讲解视频：多段按步骤生成 + FFmpeg 拼接（带声音） ====================
  // POST /api/v1/procedures/:id/generate-video-full
  app.post("/api/v1/procedures/:id/generate-video-full", requireAuth, handleGenerateVideoFull);

  // 3. 获取指定规程的历史视频记录列表 (GET /api/v1/procedures/:id/videos)
  app.get("/api/v1/procedures/:id/videos", requireAuth, handleGetProcedureVideos);

  // ==================== 视频多模态智能故障分析 (POST /api/v1/ai/video-analyze) ====================
  app.post("/api/v1/ai/video-analyze", requireAuth, validateBody(videoAnalyzeSchema), handleVideoAnalyze);

  // ==================== 操作失误率与合规统计接口 ====================
  app.get("/api/v1/admin/compliance-stats", requireAuth, handleGetComplianceStats);
  app.get("/api/v1/compliance-stats", requireAuth, handleGetComplianceStats);
  app.get("/api/v1/compliance/stats", requireAuth, handleGetComplianceStats);
}
