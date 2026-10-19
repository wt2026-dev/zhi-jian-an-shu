import jwt from "jsonwebtoken";
import { logger } from "../../utils/logger.ts";
import { recordPerf } from "../utils/perf.ts";

// 重构说明：本模块自 server.ts 拆出（原 createApp 内的结构化 HTTP 请求日志中间件），逻辑保持原样。

// 结构化 HTTP 请求日志中间件 (方法、路径、状态码、耗时、用户ID)
export function requestLogger(req: any, res: any, next: any) {
  const start = Date.now();
  req._startTime = start;

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    let userId: string | null = null;
    const authHeader = req.headers?.authorization;
    if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      try {
        const decoded = jwt.decode(authHeader.substring(7)) as any;
        if (decoded && (decoded.sub || decoded.id)) userId = decoded.sub || decoded.id;
      } catch {}
    }

    recordPerf(req.originalUrl || req.url, req.method, res.statusCode, durationMs);
    logger.info(
      {
        type: "HTTP_REQUEST",
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs,
        userId,
        traceId: res.locals?.traceId,
      },
      `${req.method} ${req.originalUrl || req.url} ${res.statusCode} - ${durationMs}ms`
    );
  });

  next();
}
