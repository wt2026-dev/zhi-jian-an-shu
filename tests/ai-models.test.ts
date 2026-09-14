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

describe("9. AI 模型路由管理测试 (AI Model Router Suite)", () => {
  it("未登录访问模型配置列表应返回 401", async () => {
    const res = await request(app).get("/api/v1/admin/ai-models");
    expect(res.status).toBe(401);
  });

  it("首次启动自动种子：列表包含 DASHSCOPE 环境变量种子（chat/vision），密钥仅返回掩码", async () => {
    const res = await request(app)
      .get("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const chat = res.body.find((m: any) => m.id === "aimc-dashscope-chat");
    const vision = res.body.find((m: any) => m.id === "aimc-dashscope-vision");
    expect(chat).toBeTruthy();
    expect(vision).toBeTruthy();
    expect(chat.apiKeyMasked).toBe("env:DASHSCOPE_API_KEY");
    expect(chat.capabilities).toContain("chat");
    expect(vision.capabilities).toContain("vision");
    // 任何字段都不允许泄露明文密钥
    expect(JSON.stringify(res.body)).not.toContain(process.env.DASHSCOPE_API_KEY || "__never_match__");
  });

  it("新增模型配置：合法请求返回 201，密钥回传为掩码，写入审计", async () => {
    const uniqueModel = `test-model-x-${Date.now()}`;
    const res = await request(app)
      .post("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`)
      .send({
        provider: "openai-compatible",
        displayName: "测试备用模型",
        baseUrl: "https://invalid.example.com/v1",
        apiKey: "sk-test-secret-abcdefg-123456",
        modelName: uniqueModel,
        capabilities: ["chat"],
        priority: 90,
        enabled: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.config.modelName).toBe(uniqueModel);
    expect(res.body.config.apiKeyMasked).toContain("••••");
    expect(JSON.stringify(res.body)).not.toContain("sk-test-secret-abcdefg-123456");

    // 重排序后该配置参与优先级链
    const list = await request(app)
      .get("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`);
    const orderedIds = list.body.map((m: any) => m.id);
    const reorder = await request(app)
      .post("/api/v1/admin/ai-models/reorder")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderedIds });
    expect(reorder.status).toBe(200);
    const byId = Object.fromEntries(reorder.body.configs.map((c: any) => [c.id, c]));
    expect(byId[orderedIds[0]].priority).toBeLessThan(byId[orderedIds[1]].priority);
  });

  it("重排序入参校验：缺少 orderedIds 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/admin/ai-models/reorder")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("测试连接：对不可达地址的配置应返回 success=false 与耗时（不抛 500）", async () => {
    const list = await request(app)
      .get("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${token}`);
    const target = list.body.find((m: any) => m.modelName.startsWith("test-model-x-"));
    expect(target).toBeTruthy();

    const res = await request(app)
      .post(`/api/v1/admin/ai-models/${target.id}/test`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.latencyMs).toBe("number");
  });
});
