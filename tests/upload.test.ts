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

describe("3. 图片上传安全控制测试 (Upload Security Suite)", () => {
  it("鉴权拦截：未提供 Token 上传图片应返回 401", async () => {
    const res = await request(app)
      .post("/api/v1/upload/image")
      .send({
        imageBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      });

    expect(res.status).toBe(401);
  });

  it("类型白名单校验：非法文件格式 (非 jpg/png/webp，如 .pdf / .exe) 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/upload/image")
      .set("Authorization", `Bearer ${token}`)
      .send({
        imageBase64: "data:application/pdf;base64,JVBERi0xLjQK%",
        filename: "malicious_payload.exe",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("仅支持");
  });

  it("单文件超限拦截：大于 10MB 的图片文件上传应拦截并返回 413 Payload Too Large", async () => {
    // 构造约 14MB Base64 字符串
    const oversizedBase64 = "data:image/png;base64," + "A".repeat(14 * 1024 * 1024);

    const res = await request(app)
      .post("/api/v1/upload/image")
      .set("Authorization", `Bearer ${token}`)
      .send({
        imageBase64: oversizedBase64,
        filename: "huge_image.png",
      });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("正常上传：在规格与白名单内的图片应返回 200 及包含随机文件名防路径穿越的 URL", async () => {
    const validBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const res = await request(app)
      .post("/api/v1/upload/image")
      .set("Authorization", `Bearer ${token}`)
      .send({
        imageBase64: validBase64,
        filename: "test_equipment.png",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("url");
    expect(res.body.url).toMatch(/\/uploads\/img_.*\.(png|jpg|webp)/);
  });
});
