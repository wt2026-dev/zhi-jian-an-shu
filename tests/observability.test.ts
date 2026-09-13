import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
});

describe("5. 生产可观测性与健康检查测试 (Observability Suite)", () => {
  it("GET /health 存活探针：应返回 200 及 ok 状态 JSON", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body).toHaveProperty("service", "industrial-ops-backend");
    expect(res.body).toHaveProperty("uptimeSeconds");
  });

  it("GET /ready 就绪探针：应正常检查数据库连通性并返回 200 ready 状态", async () => {
    const res = await request(app).get("/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.database).toBe("connected");
  });

  it("全局 500 异常拦截：未捕获的异步路由异常应被统一拦截并返回 500 JSON，进程不崩溃", async () => {
    // 全局鉴权基线生效后 /api/v1/* 需要登录，先取 token 再触发异常端点
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "password123" });
    const res = await request(app)
      .get("/api/v1/test/error")
      .set("Authorization", `Bearer ${loginRes.body.token}`);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_SERVER_ERROR");
    expect(res.body.error).toContain("服务器内部故障");
  });
});
