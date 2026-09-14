// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { createUserSchema } from "../schemas/auth.ts";
import { handleUploadAvatar, handleCreateUser } from "../controllers/userController.ts";

export function registerUserRoutes(app: express.Express) {
  // ==================== 15.6 用户头像上传与持久化 (小程序 /api/v1/user/avatar) ====================
  app.post("/api/v1/user/avatar", requireAuth, handleUploadAvatar);

  // 管理员创建用户账号
  app.post("/api/v1/auth/users", requireRole(["admin"], "创建用户账号"), validateBody(createUserSchema), handleCreateUser);
}
