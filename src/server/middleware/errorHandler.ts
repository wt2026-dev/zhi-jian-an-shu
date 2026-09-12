import jwt from "jsonwebtoken";
import { logger } from "../../utils/logger.ts";

// ==================== 全局异常处理中间件（原 createApp 尾部错误处理） ====================
// 所有未捕获的 async/sync 路由异常统一捕获返回 500 JSON，不崩溃进程，并记录结构化日志
export function globalErrorHandler(err: any, req: any, res: any, next: any) {
  // 前置分支：Express body-parser 的 JSON 解析失败（畸形 JSON / 未转义控制字符）属于客户端错误，
  // 返回 400 而非 500，便于前端给出可理解的提示
  if (err?.type === "entity.parse.failed" || (err?.status === 400 && /json/i.test(err?.type || err?.message || ""))) {
    logger.warn(
      {
        type: "JSON_PARSE_FAILED",
        method: req.method,
        path: req.originalUrl || req.url,
        message: err.message,
      },
      `Malformed JSON body in ${req.method} ${req.originalUrl || req.url}: ${err.message}`
    );
    if (res.headersSent) return next(err);
    return res.status(400).json({
      error: "请求体 JSON 格式错误",
      code: "INVALID_JSON",
      message: "请求体不是合法 JSON，请检查是否包含未转义的特殊字符",
    });
  }

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
