import { randomUUID } from "node:crypto";
import { runWithTraceId } from "../../utils/logger.ts";

/**
 * 请求级 traceId 中间件（工业级链路追踪基线）。
 *
 * - 每请求生成（或沿用上游传入的 X-Trace-Id）一个 UUID 作为 traceId；
 * - 通过 AsyncLocalStorage 绑定到当前请求上下文，使该请求内所有日志共享同一 traceId；
 * - 在响应头回写 X-Trace-Id，便于前端 / 调用方串联链路；
 * - 同时写入 res.locals.traceId，供 requestLogger 在 finish 阶段稳定取用（不依赖 ALS 时序）。
 *
 * 注意：必须注册在 requestLogger 之前，否则 HTTP 访问日志会丢失 traceId。
 */
export function traceIdMiddleware(req: any, res: any, next: any) {
  const incoming = req.headers?.["x-trace-id"];
  const traceId =
    typeof incoming === "string" && incoming.length > 0
      ? incoming
      : randomUUID();

  res.setHeader("X-Trace-Id", traceId);
  if (res.locals) res.locals.traceId = traceId;

  runWithTraceId(traceId, () => next());
}
