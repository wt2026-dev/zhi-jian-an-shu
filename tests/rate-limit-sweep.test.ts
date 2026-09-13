/**
 * 限流/登录失败 Map 内存泄漏修复回归测试。
 * 修复前：rateLimitStore / loginFailureStore 的 key 只增不减（仅清数组不清 key），
 * 长跑服务内存无限增长；修复后写入时超过阈值即清扫窗口外/已过期的 key，行为不变。
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  createRateLimiter,
  aiLimiter,
  recordLoginFailure,
  checkLoginBruteForce,
  __rateLimitStore,
  __loginFailureStore,
  __RATE_LIMIT_STORE_MAX,
} from "../src/server/middleware/rateLimit.ts";

function mockReq(ip: string) {
  return { headers: {}, socket: { remoteAddress: ip } };
}
function mockRes() {
  const headers: Record<string, any> = {};
  return {
    setHeader: (k: string, v: any) => { headers[k] = v; },
    status: () => ({ json: () => {} }),
    headers,
  };
}

describe("限流 Store 超阈值过期清扫", () => {
  beforeEach(() => {
    __rateLimitStore.clear();
    __loginFailureStore.clear();
  });

  it("插入超过阈值的 key 且全部在窗口内时，不清扫（行为不变，计数有效）", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 240, name: "test-all-fresh" });
    for (let i = 0; i < __RATE_LIMIT_STORE_MAX + 200; i++) {
      limiter(mockReq(`10.1.0.${i % 256}.${Math.floor(i / 256) % 256}`) as any, mockRes() as any, () => {});
    }
    // 全部 key 的请求都在窗口内，清扫不应删除有效计数
    expect(__rateLimitStore.size).toBeGreaterThan(__RATE_LIMIT_STORE_MAX);
  });

  it("超过阈值后新写入触发清扫：窗口外过期 key 被删除，活跃 key 保留", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 240, name: "test-sweep" });
    for (let i = 0; i < __RATE_LIMIT_STORE_MAX + 200; i++) {
      limiter(mockReq(`10.2.0.${i % 256}.${Math.floor(i / 256) % 256}`) as any, mockRes() as any, () => {});
    }
    // 将全部既有记录的时间戳改为窗口外（模拟时间流逝）
    const expiredTs = Date.now() - 120_000;
    for (const rec of __rateLimitStore.values()) rec.timestamps = [expiredTs];

    // 新 key 写入触发清扫
    limiter(mockReq("10.2.99.99") as any, mockRes() as any, () => {});
    expect(__rateLimitStore.size).toBeLessThanOrEqual(__RATE_LIMIT_STORE_MAX);
    // 新 key 的计数仍在（未被误删）
    expect(__rateLimitStore.has("test-sweep:10.2.99.99")).toBe(true);
  });
});

describe("v1 AI 接口专属限流", () => {
  beforeEach(() => {
    __rateLimitStore.clear();
  });

  it("POST /api/v1/ai/chat 第 61 次请求返回 429", async () => {
    const app = express();
    app.use("/api/v1/ai/", aiLimiter);
    app.post("/api/v1/ai/chat", (_req, res) => res.json({ success: true }));

    for (let i = 0; i < 60; i++) {
      const res = await request(app).post("/api/v1/ai/chat");
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post("/api/v1/ai/chat");
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});

describe("登录失败 Store 超阈值过期清扫", () => {
  beforeEach(() => {
    __loginFailureStore.clear();
  });

  it("大量未锁定且超期无失败的记录在新写入时被清扫，锁定中的记录保留", () => {
    // 制造 5200 个陈旧记录（无锁定、15 分钟无失败）
    for (let i = 0; i < 5200; i++) {
      recordLoginFailure(`10.3.${Math.floor(i / 256)}.${i % 256}`);
    }
    // 伪造为陈旧：lastFailureAt 30 分钟前
    const stale = Date.now() - 30 * 60 * 1000;
    for (const rec of __loginFailureStore.values()) {
      rec.lockedUntil = 0;
      (rec as any).lastFailureAt = stale;
    }
    // 3 个处于锁定态的记录（应保留）：连续 5 次失败触发锁定
    for (let i = 0; i < 5; i++) recordLoginFailure("10.3.200.1");
    // 首次写入已触发清扫（5200 个陈旧记录被删除），锁定记录保留
    expect(__loginFailureStore.size).toBeLessThan(5200);

    // 新失败写入再次触发清扫
    recordLoginFailure("10.3.201.1");
    expect(__loginFailureStore.size).toBeLessThan(5200);
    // 锁定中的记录未被误删，且防爆破锁定语义保持
    expect(__loginFailureStore.has("10.3.200.1")).toBe(true);
    const res2 = mockRes();
    expect(checkLoginBruteForce(mockReq("10.3.200.1") as any, res2 as any)).toBe(false);
  });

  it("清扫后防爆破语义不变：连续失败仍触发锁定", () => {
    const res = mockRes();
    let blocked = false;
    for (let i = 0; i < 5; i++) recordLoginFailure("10.4.0.1");
    blocked = !checkLoginBruteForce(mockReq("10.4.0.1") as any, res as any);
    expect(blocked).toBe(true);
  });
});
