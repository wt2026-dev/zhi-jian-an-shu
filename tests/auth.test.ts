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
      .send({ username: "admin", password: "password123" });

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
      .send({ username: "non_existent_user_999", password: "password123" });

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
      .send({ username: "admin", password: "password123" });
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
});
