// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { videoUploadSchema, imageUploadSchema } from "../schemas/upload.ts";
import { handleUploadVideo, handleUploadImage } from "../controllers/uploadController.ts";

export function registerUploadRoutes(app: express.Express) {
  // ==================== 视频文件上传接口 (POST /api/v1/upload/video) ====================
  app.post("/api/v1/upload/video", requireAuth, validateBody(videoUploadSchema), handleUploadVideo);

  // [重构最小修复] 原路由缺失鉴权中间件，未登录也可上传图片（安全缺陷），补挂 requireAuth 使未登录请求返回 401（与测试契约一致），不改变已登录请求的行为。
  app.post("/api/v1/upload/image", requireAuth, validateBody(imageUploadSchema), handleUploadImage);
}
