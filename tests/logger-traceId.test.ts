import assert from "node:assert/strict";
import { describe, it, beforeAll } from "vitest";
import { getTraceId, runWithTraceId } from "../src/utils/logger.ts";
import { traceIdMiddleware } from "../src/server/middleware/traceId.ts";

describe("traceId / 结构化日志可观测性基线", () => {
  // 确保 Node 端 AsyncLocalStorage 模块在断言前就绪（非强制：未就绪时降级路径同样正确）。
  beforeAll(async () => {
    const { ensureServerModules } = await import("../src/utils/logger.ts");
    await ensureServerModules();
  });

  it("getTraceId 在上下文外为 undefined", () => {
    assert.equal(getTraceId(), undefined);
  });

  it("runWithTraceId 内可读到 traceId，离开后恢复", () => {
    assert.equal(getTraceId(), undefined);
    runWithTraceId("trace-abc", () => {
      assert.equal(getTraceId(), "trace-abc");
    });
    assert.equal(getTraceId(), undefined);
  });

  it("traceId 中间件：自动生成并回写 X-Trace-Id，且 next 内可读取", () => {
    const headers: Record<string, string> = {};
    let inside: string | undefined;
    const req: any = { headers: {} };
    const res: any = { setHeader: (k: string, v: string) => (headers[k] = v), locals: {} };
    const next = () => {
      inside = getTraceId();
    };

    traceIdMiddleware(req, res, next);

    assert.ok(typeof headers["X-Trace-Id"] === "string");
    assert.equal(headers["X-Trace-Id"].length, 36); // UUID v4 长度
    assert.equal(inside, headers["X-Trace-Id"]);
    assert.equal(res.locals.traceId, headers["X-Trace-Id"]);
    assert.equal(getTraceId(), undefined); // 中间件同步体内 set，离开即恢复
  });

  it("traceId 中间件：沿用上游传入的 X-Trace-Id", () => {
    const headers: Record<string, string> = {};
    const req: any = { headers: { "x-trace-id": "upstream-123" } };
    const res: any = { setHeader: (k: string, v: string) => (headers[k] = v), locals: {} };
    traceIdMiddleware(req, res, () => {});
    assert.equal(headers["X-Trace-Id"], "upstream-123");
    assert.equal(res.locals.traceId, "upstream-123");
  });
});
