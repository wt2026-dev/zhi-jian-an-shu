import jwt from "jsonwebtoken";
import { logger } from "../../utils/logger.ts";

// ==================== 全局异常处理中间件（原 createApp 尾部错误处理） ====================
// 所有未捕获的 async/sync 路由异常统一捕获返回 500 JSON，不崩溃进程，并记录结构化日志
export function globalErrorHandler(err: any, req: any, res: any, next: any) {
  const durationMs = req._startTime ? Date.now() - req._startTime : 0;
  let userId: string | null = null;
  const authHeader = req.headers?.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    try {
      const decoded = jwt.decode(authHeader.substring(7)) as any;
      if (decoded && (decoded.sub || decoded.id)) userId = decoded.sub || decoded.id;
    } catch {}
  }

  logger.error(
    {
      err: {
        message: err.message,
        name: err.name,
        stack: err.stack,
      },
      method: req.method,
      path: req.originalUrl || req.url,
      status: 500,
      durationMs,
      userId,
    },
    `Uncaught Exception in ${req.method} ${req.originalUrl || req.url}: ${err.message}`
  );

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "服务器内部故障，已统一拦截处理",
    code: "INTERNAL_SERVER_ERROR",
    message: err.message || "Internal Server Error",
  });
}
