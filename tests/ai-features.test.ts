import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { aiChatSchema } from "../src/server/schemas/ai.ts";

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

describe("7. AI 扩展功能接口测试 (AI Features Suite: 6 大工业场景)", () => {
  it("智能工单生成：未登录应返回 401", async () => {
    const res = await request(app)
      .post("/api/v1/ai/generate-work-order")
      .send({ equipmentId: "eq-101", abnormalDescription: "轴承温度超标" });
    expect(res.status).toBe(401);
  });

  it("智能工单生成：缺少 abnormalDescription 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/generate-work-order")
      .set("Authorization", `Bearer ${token}`)
      .send({ equipmentId: "eq-101" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("智能工单生成：设备不存在应返回 404", async () => {
    const res = await request(app)
      .post("/api/v1/ai/generate-work-order")
      .set("Authorization", `Bearer ${token}`)
      .send({ equipmentId: "eq-not-exist-999", abnormalDescription: "轴承温度超标" });
    expect(res.status).toBe(404);
  });

  it("根因分析：既无 workOrderId 也无 equipmentId+faultDescription 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/root-cause-analysis")
      .set("Authorization", `Bearer ${token}`)
      .send({ faultDescription: "泵体振动" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("根因分析：workOrderId 不存在应返回 404", async () => {
    const res = await request(app)
      .post("/api/v1/ai/root-cause-analysis")
      .set("Authorization", `Bearer ${token}`)
      .send({ workOrderId: "wo-not-exist-999" });
    expect(res.status).toBe(404);
  });

  it("检修方案生成：缺少 faultDescription 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/generate-maintenance-plan")
      .set("Authorization", `Bearer ${token}`)
      .send({ equipmentId: "eq-101" });
    expect(res.status).toBe(400);
  });

  it("健康趋势预测：equipmentId 非法类型应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/health-forecast")
      .set("Authorization", `Bearer ${token}`)
      .send({ equipmentId: 12345 });
    expect(res.status).toBe(400);
  });

  it("智能报告生成：reportType 非法枚举应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/generate-report")
      .set("Authorization", `Bearer ${token}`)
      .send({ reportType: "annual", startDate: "2026-09-01", endDate: "2026-09-05" });
    expect(res.status).toBe(400);
  });

  it("作业票风险评估：缺少 workDescription 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/safety-risk-assessment")
      .set("Authorization", `Bearer ${token}`)
      .send({ permitType: "动火作业票" });
    expect(res.status).toBe(400);
  });
});

describe("8. AI 助手升级接口测试 (SSE 流式 + 功能 7-10)", () => {
  it("流式对话：未登录应返回 401", async () => {
    const res = await request(app)
      .post("/api/v1/ai/chat/stream")
      .send({ message: "泵振动超标怎么办" });
    expect(res.status).toBe(401);
  });

  it("流式对话：缺少 message 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/chat/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("流式对话：history 超过 12 条应返回 400 与明确提示", async () => {
    const res = await request(app)
      .post("/api/v1/ai/chat/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({
        message: "泵振动超标怎么办",
        history: Array.from({ length: 13 }, () => ({ role: "user", content: "历史问题" })),
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
    expect(res.body.details[0].message).toBe("对话历史过长，请刷新后重试");
  });

  it("流式对话：12 条 history 可通过 schema 校验", () => {
    const result = aiChatSchema.safeParse({
      message: "泵振动超标怎么办",
      history: Array.from({ length: 12 }, () => ({ role: "assistant", content: "历史回复" })),
    });
    expect(result.success).toBe(true);
  });

  it("流式对话：单条 history content 超长应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/chat/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({
        message: "泵振动超标怎么办",
        history: [{ role: "user", content: "x".repeat(2001) }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("追问建议：缺少 lastAiReply 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/suggest-followups")
      .set("Authorization", `Bearer ${token}`)
      .send({ lastUserMessage: "泵振动超标" });
    expect(res.status).toBe(400);
  });

  it("健康画像：缺少 equipmentId 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/equipment-summary")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("推荐派单：缺少 faultDescription 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/recommend-assignee")
      .set("Authorization", `Bearer ${token}`)
      .send({ equipmentId: "eq-101" });
    expect(res.status).toBe(400);
  });

  it("报警关联分析：少于 2 条报警应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/alarm-correlation")
      .set("Authorization", `Bearer ${token}`)
      .send({ alarms: [{ equipmentId: "eq-101", alarmType: "高温报警" }] });
    expect(res.status).toBe(400);
  });
});
