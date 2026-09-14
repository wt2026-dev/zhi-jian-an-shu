/**
 * 视频上传文件头魔数校验回归测试。
 * 修复前：视频上传仅校验 MIME 声明与扩展名，伪造内容可落盘；现要求 mp4/mov/webm/avi
 * 具备真实文件头签名，校验失败返回 400 INVALID_FILE_SIGNATURE。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let adminToken = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  adminToken = (await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "password123" })).body.token;
  expect(adminToken).toBeTruthy();
});

// 构造带真实 ftyp box 的最小 mp4 头（size=0x18, 'ftyp', 'isom' brand, minor, 两个兼容品牌）
const mp4Magic = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "binary"),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from("isomiso2", "binary"),
]).toString("base64");

// 构造 webm EBML 头 (1A 45 DF A3 ...)
const webmMagic = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]).toString("base64");

// 明显不是视频的内容（文本）
const fakeContent = Buffer.from("this is definitely not a video file").toString("base64");

describe("视频上传魔数校验", () => {
  it("伪造扩展名/MIME 的非视频内容应返回 400 INVALID_FILE_SIGNATURE", async () => {
    const res = await request(app)
      .post("/api/v1/upload/video")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ videoBase64: `data:video/mp4;base64,${fakeContent}`, filename: "fake.mp4" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FILE_SIGNATURE");
  });

  it("携带真实 ftyp 头的 mp4 内容应正常上传（成功路径不变）", async () => {
    const res = await request(app)
      .post("/api/v1/upload/video")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ videoBase64: `data:video/mp4;base64,${mp4Magic}`, filename: "real.mp4" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.videoId).toContain(".mp4");
  });

  it("携带 EBML 头的 webm 内容应正常上传", async () => {
    const res = await request(app)
      .post("/api/v1/upload/video")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ videoBase64: `data:video/webm;base64,${webmMagic}`, filename: "real.webm" });
    expect(res.status).toBe(201);
    expect(res.body.videoId).toContain(".webm");
  });
});
