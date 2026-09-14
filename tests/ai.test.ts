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
    .send({ username: "admin", password: "Admin@2026#Demo" });
  token = loginRes.body.token;
});

describe("4. 语音/视觉 AI 接口输入校验与链路测试 (AI Speech/Vision Suite)", () => {
  it("语音接口输入校验：非法的 durationSeconds 类型 (非 number) 应拦截返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/speech-to-text")
      .set("Authorization", `Bearer ${token}`)
      .send({
        audioBase64: "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQAC...",
        durationSeconds: "NOT_A_NUMBER_VALUE",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("语音接口合法请求：DashScope 兼容模式暂不支持语音转写，应返回 200 与明确的暂不支持提示", async () => {
    const res = await request(app)
      .post("/api/v1/ai/speech-to-text")
      .set("Authorization", `Bearer ${token}`)
      .send({
        audioBase64: "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQAC...",
        durationSeconds: 3.5,
        mimeType: "audio/webm",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("暂不支持");
  });

  it("视觉质检接口输入校验：非法的 imageBase64 类型 (非 string) 应拦截返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/vision-defect-detect")
      .set("Authorization", `Bearer ${token}`)
      .send({
        imageBase64: 999999, // 非法类型
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("视觉质检接口合法请求：正常参数调用应返回 200 并包含质检诊断结果", async () => {
    const res = await request(app)
      .post("/api/v1/ai/vision-defect-detect")
      .set("Authorization", `Bearer ${token}`)
      .send({
        imageBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        equipmentType: "离心泵",
        promptText: "请检测联轴器偏磨",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("defectResult");
  });
});
