import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
}, 30000);

describe("1. 认证与登录功能测试 (Auth Suite)", () => {
  it("登录成功：提供正确的用户名和密码应返回 200 与 JWT Token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "Admin@2026#Demo" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user).toHaveProperty("username", "admin");
  });

  it("登录失败：错误的密码应返回 401 错误", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "wrongpassword_123" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("登录失败：不存在的用户应返回 401 错误", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "non_existent_user_999", password: "Admin@2026#Demo" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("未登录保护拦截：未携带 Token 请求上传接口应返回 401", async () => {
    const res = await request(app)
      .post("/api/v1/upload/image")
      .send({ imageBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("登出与 Token 废弃测试：登出后使用旧 Token 再次访问应返回 401", async () => {
    // 1. 登录获取 Token
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "Admin@2026#Demo" });
    const token = loginRes.body.token;

    // 2. 调用登出接口
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);

    // 3. 使用废弃 Token 访问受到保护的接口
    const accessRes = await request(app)
      .post("/api/v1/upload/image")
      .set("Authorization", `Bearer ${token}`)
      .send({ imageBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" });

    expect(accessRes.status).toBe(401);
  });

  it("Cookie 认证闭环：登录响应 Set-Cookie (HttpOnly, SameSite=Lax, Max-Age=28800)，且通过 Cookie 可免 Bearer 鉴权", async () => {
    // 1. 登录响应包含 Set-Cookie 头
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "Admin@2026#Demo" });

    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers["set-cookie"] || [];
    const tokenCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c: string) => c.startsWith("token="));
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie).toContain("HttpOnly");
    expect(tokenCookie?.toLowerCase()).toContain("samesite=lax");
    expect(tokenCookie).toContain("Max-Age=28800");

    // 提取 raw cookie
    const rawCookie = tokenCookie?.split(";")[0] || "";

    // 2. 仅携带 Cookie（不带 Authorization: Bearer 头）访问受保护的 getCurrentUser (/api/v1/auth/me)
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", rawCookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body).toHaveProperty("username", "admin");

    // 3. 登出响应清除 Cookie (Max-Age=0 或 Expired)
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", rawCookie);

    expect(logoutRes.status).toBe(200);
    const logoutCookies = logoutRes.headers["set-cookie"] || [];
    const clearedCookie = (Array.isArray(logoutCookies) ? logoutCookies : [logoutCookies]).find((c: string) => c.startsWith("token="));
    expect(clearedCookie).toBeDefined();

    // 4. 登出后使用旧 Cookie 再次访问被 401 拦截
    const postLogoutRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", rawCookie);
    expect(postLogoutRes.status).toBe(401);
  });

  it("CSRF 兜底防御：来自非白名单 Origin 的写操作请求被 403 拦截", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "http://malicious-attacker.com")
      .send({ username: "admin", password: "Admin@2026#Demo" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_FORBIDDEN");
  });
});
