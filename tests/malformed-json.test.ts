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

describe("10. 畸形 JSON 请求体错误处理测试 (Malformed JSON Suite)", () => {
  it("POST /api/v1/admin/ai-models 畸形 JSON（未转义控制字符）应返回 400 且 code=INVALID_JSON，而非 500", async () => {
    // 构造包含未转义控制字符（原始换行/制表符）的 JSON 请求体，body-parser 解析必然失败
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

  it("合法 JSON 请求体不受影响：字段校验仍走原有 400 INVALID_INPUT 通道", async () => {
    const res = await request(app)
      .post("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "dashscope" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });
});
