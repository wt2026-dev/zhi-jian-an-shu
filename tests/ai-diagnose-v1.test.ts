import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

describe("AI v1 路由与 Legacy 下线验证", () => {
  let app: any;
  let adminToken: string;

  beforeAll(async () => {
    app = await createApp();
    const loginRes = await request(app).post("/api/v1/auth/login").send({
      username: "admin",
      password: "password123",
    });
    adminToken = loginRes.body.token;
    expect(adminToken).toBeTruthy();
  });

  it("POST /api/v1/ai/diagnose 正确响应诊断结果与降级策略", async () => {
    const res = await request(app)
      .post("/api/v1/ai/diagnose")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        equipmentName: "主冷却循环泵",
        category: "泵类",
        symptoms: "轴承异常高温伴振动超标",
        telemetry: { temperature: 85, vibration: 6.2 },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.diagnosis).toBeDefined();
    expect(res.body.diagnosis.summary).toBeTruthy();
    expect(Array.isArray(res.body.diagnosis.probableCauses)).toBe(true);
    expect(Array.isArray(res.body.diagnosis.recommendedActions)).toBe(true);
  });

  it("POST /api/v1/ai/suggest-contribution 正确响应知识贡献判定", async () => {
    const res = await request(app)
      .post("/api/v1/ai/suggest-contribution")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        lastUserMessage: "给水泵机械密封泄漏怎么处理？",
        lastAiReply: "更换副密封圈并调整弹簧压缩量至规定间隙。",
        equipment: "1#给水泵",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.suggestion).toBeDefined();
  });

  it("下线确认：旧 legacy /api/ai/diagnose 接口不再可达 (404)", async () => {
    const res = await request(app)
      .post("/api/ai/diagnose")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        equipmentName: "主冷却循环泵",
      });

    expect(res.status).toBe(404);
  });

  it("下线确认：旧 legacy /api/ai/chat 接口不再可达 (404)", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        message: "hello",
      });

    expect(res.status).toBe(404);
  });

  it("下线确认：旧 legacy /api/ai/contributions 接口不再可达 (404)", async () => {
    const res = await request(app)
      .get("/api/ai/contributions")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});
