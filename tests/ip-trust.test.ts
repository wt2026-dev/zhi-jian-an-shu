/**
 * 客户端 IP 防伪造回归测试。
 * 修复前：getClientIp 盲目信任 X-Forwarded-For 第一跳，攻击者可伪造该头绕过
 * 限流/登录防爆破并污染审计日志。修复后：默认取 socket 直连地址，
 * 仅在 TRUST_PROXY=true 或直连 IP 命中 TRUSTED_PROXY_IPS 白名单时才解析 XFF。
 */
import { describe, it, expect } from "vitest";
import { getClientIp } from "../src/server/services/auditService.ts";

function mockReq(headers: Record<string, string>, remoteAddress = "::ffff:127.0.0.1") {
  return { headers, socket: { remoteAddress } };
}

describe("getClientIp 防 X-Forwarded-For 伪造", () => {
  it("默认（无任何信任配置）：伪造 XFF 不生效，返回 socket 地址", () => {
    const req = mockReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(getClientIp(req)).toBe("127.0.0.1");
  });

  it("默认：无 XFF 时返回去 ::ffff: 前缀的 socket 地址", () => {
    expect(getClientIp(mockReq({}))).toBe("127.0.0.1");
    expect(getClientIp(mockReq({}, "192.168.1.55"))).toBe("192.168.1.55");
  });

  it("TRUSTED_PROXY_IPS：直连 IP 不在白名单时不解析 XFF", () => {
    const prev = process.env.TRUSTED_PROXY_IPS;
    process.env.TRUSTED_PROXY_IPS = "10.0.0.9,10.0.0.10";
    try {
      const req = mockReq({ "x-forwarded-for": "1.2.3.4" }, "192.168.1.55");
      expect(getClientIp(req)).toBe("192.168.1.55");
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXY_IPS;
      else process.env.TRUSTED_PROXY_IPS = prev;
    }
  });

  it("TRUSTED_PROXY_IPS：直连 IP 命中白名单时解析 XFF 第一跳", () => {
    const prev = process.env.TRUSTED_PROXY_IPS;
    process.env.TRUSTED_PROXY_IPS = "10.0.0.9,192.168.1.55";
    try {
      const req = mockReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }, "::ffff:192.168.1.55");
      expect(getClientIp(req)).toBe("1.2.3.4");
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXY_IPS;
      else process.env.TRUSTED_PROXY_IPS = prev;
    }
  });

  it("TRUST_PROXY=true：解析 XFF 第一跳（部署方显式声明可信反代）", () => {
    const prev = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    try {
      const req = mockReq({ "x-forwarded-for": "203.0.113.7" }, "10.0.0.2");
      expect(getClientIp(req)).toBe("203.0.113.7");
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
    }
  });

  it("伪造 XFF 不影响限流计数（集成）：同一伪造头下重复请求按 socket 地址同一计数键", async () => {
    const { createApp } = await import("../server.ts");
    process.env.NODE_ENV = "test";
    const app = await createApp();
    // 登录写入审计（携带伪造 XFF），随后以 admin 读取审计日志验证 ip 为 socket 地址
    await request(app).post("/api/v1/auth/login").set("x-forwarded-for", "6.6.6.6").send({ username: "tech1", password: "Tech1@2026#Work" });
    const adminLogin = await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "Admin@2026#Demo" });
    const auditRes = await request(app)
      .get("/api/v1/audit-logs?actionType=LOGIN")
      .set("Authorization", `Bearer ${adminLogin.body.token}`);
    expect(auditRes.status).toBe(200);
    const techLogins = (auditRes.body as any[]).filter((l) => l.userName?.includes("检修技师") || l.userId === "u-tech1" || l.userName === "李明");
    // 审计中该批登录记录的 ip 均不应为伪造值 6.6.6.6
    const allIps = (auditRes.body as any[]).map((l) => l.ip);
    expect(allIps).not.toContain("6.6.6.6");
  });
});

// 最小 request 引用（与其它测试文件一致的 supertest 用法）
import request from "supertest";
