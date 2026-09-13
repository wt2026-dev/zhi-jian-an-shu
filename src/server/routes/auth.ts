// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { authLimiter } from "../middleware/rateLimit.ts";
import { requireAuth, requireRole } from "../middleware/auth.ts";
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

  // 用户列表含全员手机号/邮箱等敏感字段：必须登录后才能读取
  app.get("/api/v1/auth/users", requireAuth, handleGetAuthUsers);

  // 快速身份切换 API（高危：可无密码签发任意用户 JWT）。
  // 双重收紧：生产环境直接 404 下线；非生产环境仅 admin 可用（防止普通账号横向提权）。
  app.post(
    "/api/v1/auth/switch-user",
    (req: any, res: any, next: any) => {
      if (process.env.NODE_ENV === "production") {
        return res.status(404).json({ error: "Not Found" });
      }
      next();
    },
    requireRole(["admin"], "切换用户身份"),
    handleSwitchUser
  );

  // ==================== 15.5 微信小程序登录 (wx.login → code2session) ====================
  app.post("/api/v1/auth/wx-login", handleWxLogin);
}
