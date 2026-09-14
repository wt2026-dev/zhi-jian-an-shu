import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let token: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "password123" });
  token = loginRes.body.token;
});

describe("畸形 JSON 请求体错误处理", () => {
  it("未转义控制字符 -> 400 INVALID_JSON", async () => {
    const malformedBody = '{"provider":"dashscope","displayName":"故障\n\t注入模型","modelName":"m1"}';
    const res = await request(app)
      .post("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send(malformedBody);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_JSON");
    expect(res.body.error).toBe("请求体 JSON 格式错误");
  });

  it("合法 JSON 字段校验失败 -> 400 INVALID_INPUT", async () => {
    const res = await request(app)
      .post("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "dashscope" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("空请求体 -> 400", async () => {
    const res = await request(app)
      .post("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send("");
    expect(res.status).toBe(400);
  });

  it("非 JSON Content-Type 发送 JSON -> 不崩溃", async () => {
    const res = await request(app)
      .post("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "text/plain")
      .send('{"provider":"dashscope"}');
    // Should not return 500
    expect(res.status).not.toBe(500);
  });

  it("JSON 数组而非对象 -> 400", async () => {
    const res = await request(app)
      .post("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send('[{"provider":"dashscope"}]');
    expect(res.status).toBe(400);
  });

  it("截断的 JSON -> 400", async () => {
    const res = await request(app)
      .post("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send('{"provider":"dashscope","display');
    expect(res.status).toBe(400);
  });

  it("超大payload -> 不崩溃 (应返回 413 或 400)", async () => {
    const bigBody = '{"data":"' + "x".repeat(10 * 1024 * 1024) + '"}';
    const res = await request(app)
      .post("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send(bigBody);
    // Should not return 500
    expect(res.status).not.toBe(500);
  });
});
