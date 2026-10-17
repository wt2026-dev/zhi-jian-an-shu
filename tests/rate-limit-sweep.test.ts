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
  globalLimiter,
  authLimiter,
  aiLimiter,
  recordLoginFailure,
  checkLoginBruteForce,
  __rateLimitStore,
  __loginFailureStore,
  __RATE_LIMIT_STORE_MAX,
} from "../src/server/middleware/rateLimit.ts";

function mockReq(ip: string, originalUrl = "/api/v1/equipments") {
  return { headers: {}, socket: { remoteAddress: ip }, originalUrl, url: originalUrl };
}
function mockRes() {
  const headers: Record<string, any> = {};
  return {
    setHeader: (k: string, v: any) => { headers[k] = v; },
    status: () => ({ json: () => {} }),
    headers,
  };
}
/** 记录响应状态码与响应体的 mock res，用于断言 429 分支 */
function recordingRes() {
  const headers: Record<string, any> = {};
  const out: { statusCode: number; body: any } = { statusCode: 200, body: null };
  return {
    headers,
    result: out,
    setHeader: (k: string, v: any) => { headers[k] = v; },
    status(code: number) {
      out.statusCode = code;
      return { json: (body: any) => { out.body = body; } };
    },
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

// ==================== 全局限流误伤修复回归（P0） ====================
// 背景：/api/v1/* 共用一个「每 IP 每分钟」计数器。一次页面加载会打出十余个接口，
// 演示时快速切页/连续刷新可在 60 秒内逼近旧阈值 240，触发 429；一旦命中 /auth/me
// （会话恢复探针），前端会误判未登录而弹回登录页——现象与崩溃无法区分，且 60 秒后自动恢复。
describe("全局限流阈值与 /auth/me 豁免", () => {
  beforeEach(() => {
    __rateLimitStore.clear();
  });

  it("globalLimiter 上限为 600：第 601 次请求才返回 429", () => {
    const ip = "10.5.0.1";
    // 前 600 次必须全部放行
    for (let i = 0; i < 600; i++) {
      let passed = false;
      const res = recordingRes();
      globalLimiter(mockReq(ip) as any, res as any, () => { passed = true; });
      expect(passed).toBe(true);
      expect(res.result.statusCode).toBe(200);
    }
    // 第 601 次被拦截
    const blocked = recordingRes();
    let passed = false;
    globalLimiter(mockReq(ip) as any, blocked as any, () => { passed = true; });
    expect(passed).toBe(false);
    expect(blocked.result.statusCode).toBe(429);
    expect(blocked.result.body.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("阈值确为 600 而非旧的 240：第 241 次请求不应被拦截（防回归）", () => {
    const ip = "10.5.0.2";
    for (let i = 0; i < 241; i++) {
      const res = recordingRes();
      globalLimiter(mockReq(ip) as any, res as any, () => {});
      expect(res.result.statusCode).toBe(200);
    }
  });

  it("/auth/me 豁免全局限流：远超阈值的请求全部放行且不计数", () => {
    const ip = "10.5.0.3";
    for (let i = 0; i < 900; i++) {
      let passed = false;
      const res = recordingRes();
      globalLimiter(mockReq(ip, "/api/v1/auth/me") as any, res as any, () => { passed = true; });
      expect(passed).toBe(true);
      expect(res.result.statusCode).toBe(200);
    }
    // 豁免请求完全未落入计数器
    expect(__rateLimitStore.has(`global:${ip}`)).toBe(false);
  });

  it("/auth/me 的豁免基于 originalUrl，能穿透挂载路径剥离（真实 Express 挂载）", async () => {
    // 关键陷阱：限流器挂载在 "/api/v1/" 上，进入中间件时 req.url 已被剥离为 "/auth/me"。
    // 若用 req.url 比对 "/api/v1/auth/me" 永不成立，豁免会静默失效——此用例专门守住这一点。
    const app = express();
    app.use("/api/v1/", globalLimiter);
    app.get("/api/v1/auth/me", (_req, res) => res.json({ success: true }));
    app.get("/api/v1/equipments", (_req, res) => res.json({ success: true }));

    // 先把该 IP 的非豁免额度打满，确认限流器本身是生效的
    for (let i = 0; i < 600; i++) {
      await request(app).get("/api/v1/equipments");
    }
    const blocked = await request(app).get("/api/v1/equipments");
    expect(blocked.status).toBe(429);

    // 同一 IP 下 /auth/me 仍应畅通（豁免不受同一计数器影响）
    for (let i = 0; i < 5; i++) {
      const me = await request(app).get("/api/v1/auth/me");
      expect(me.status).toBe(200);
    }
  });

  it("authLimiter 保持 20/min：登录防爆破不被削弱", () => {
    const ip = "10.5.0.4";
    for (let i = 0; i < 20; i++) {
      const res = recordingRes();
      authLimiter(mockReq(ip, "/api/v1/auth/login") as any, res as any, () => {});
      expect(res.result.statusCode).toBe(200);
    }
    const blocked = recordingRes();
    authLimiter(mockReq(ip, "/api/v1/auth/login") as any, blocked as any, () => {});
    expect(blocked.result.statusCode).toBe(429);
  });

  it("aiLimiter 保持 60/min：AI 计费保护不被削弱", () => {
    const ip = "10.5.0.5";
    for (let i = 0; i < 60; i++) {
      const res = recordingRes();
      aiLimiter(mockReq(ip, "/api/v1/ai/diagnose") as any, res as any, () => {});
      expect(res.result.statusCode).toBe(200);
    }
    const blocked = recordingRes();
    aiLimiter(mockReq(ip, "/api/v1/ai/diagnose") as any, blocked as any, () => {});
    expect(blocked.result.statusCode).toBe(429);
  });

  it("豁免匹配为「精确路径或子路径」：形近兄弟路径不被误放行", () => {
    const ip = "10.5.0.6";
    // "/api/v1/auth/members" 与白名单 "/api/v1/auth/me" 形近但不是其子路径，
    // 不应被豁免（否则将来新增的兄弟路由会被静默摘出限流）。
    for (let i = 0; i < 600; i++) {
      const res = recordingRes();
      globalLimiter(mockReq(ip, "/api/v1/auth/members") as any, res as any, () => {});
    }
    const blocked = recordingRes();
    globalLimiter(mockReq(ip, "/api/v1/auth/members") as any, blocked as any, () => {});
    expect(blocked.result.statusCode).toBe(429);
  });

  it("子路径与带查询串的 /auth/me 请求同样豁免", () => {
    const ip = "10.5.0.7";
    const urls = ["/api/v1/auth/me", "/api/v1/auth/me/avatar", "/api/v1/auth/me?ts=1"];
    for (let i = 0; i < 300; i++) {
      const res = recordingRes();
      globalLimiter(mockReq(ip, urls[i % urls.length]) as any, res as any, () => {});
      expect(res.result.statusCode).toBe(200);
    }
    expect(__rateLimitStore.has(`global:${ip}`)).toBe(false);
  });
});
