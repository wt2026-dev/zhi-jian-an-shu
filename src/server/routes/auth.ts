// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { authLimiter } from "../middleware/rateLimit.ts";
import { validateBody } from "../middleware/validate.ts";
import { loginSchema } from "../schemas/auth.ts";
import {
  handleLogin,
  handleLogout,
  handleRefresh,
  handleMe,
  handleGetAuthUsers,
  handleSwitchUser,
  handleWxLogin,
} from "../controllers/authController.ts";

export function registerAuthRoutes(app: express.Express) {
  app.post("/api/v1/auth/login", authLimiter, validateBody(loginSchema), handleLogin);

  // 用户登出 API (使当前 Token 失效)
  app.post("/api/v1/auth/logout", handleLogout);

  // Token 刷新 API
  app.post("/api/v1/auth/refresh", handleRefresh);

  app.get("/api/v1/auth/me", handleMe);

  app.get("/api/v1/auth/users", handleGetAuthUsers);

  // 快速身份切换 API (支持右上角角色无缝切换并签发对应用户 JWT)
  app.post("/api/v1/auth/switch-user", handleSwitchUser);

  // ==================== 15.5 微信小程序登录 (wx.login → code2session) ====================
  app.post("/api/v1/auth/wx-login", handleWxLogin);
}
