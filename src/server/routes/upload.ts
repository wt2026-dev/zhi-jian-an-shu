// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { videoUploadSchema, imageUploadSchema } from "../schemas/upload.ts";
import { handleUploadVideo, handleUploadImage } from "../controllers/uploadController.ts";

export function registerUploadRoutes(app: express.Express) {
  // 仅在上传业务专属端点挂载大容量 Body 解析器，避免全局放开带来的内存与拒绝服务风险
  const videoParser = express.json({ limit: "85mb" });
  const imageParser = express.json({ limit: "15mb" });

  // ==================== 视频文件上传接口 (POST /api/v1/upload/video) ====================
  app.post("/api/v1/upload/video", requireAuth, videoParser, validateBody(videoUploadSchema), handleUploadVideo);

  // [重构最小修复] 补挂 requireAuth 与专属图片 15MB 解析器
  app.post("/api/v1/upload/image", requireAuth, imageParser, validateBody(imageUploadSchema), handleUploadImage);
}
