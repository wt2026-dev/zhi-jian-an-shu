/**
 * 视频上传文件头魔数校验回归测试。
 * 修复前：视频上传仅校验 MIME 声明与扩展名，伪造内容可落盘；现要求 mp4/mov/webm/avi
 * 具备真实文件头签名，校验失败返回 400 INVALID_FILE_SIGNATURE。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createApp } from "../server.ts";

let app: any;
let adminToken = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  adminToken = (await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "Admin@2026#Demo" })).body.token;
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

/**
 * 落盘位置与静态托管位置必须一致。
 *
 * 回归背景：`uploadController.handleUploadVideo` 曾写死
 * `path.join(process.cwd(), "public", "uploads", "videos", videoId)`，
 * 而 `/uploads` 是由 `express.static(UPLOADS_DIR)` 托管的，`UPLOADS_DIR` 又支持用环境变量
 * 覆盖为工作区之外的绝对路径（逃出工作区大文件清理的唯一手段）。
 * 两者一旦分叉：文件写到 A 处、却从 B 处提供服务 → 上传返回 201，但紧接着取回就是 404。
 * 现改为统一走 config 导出的 `VIDEOS_DIR`。
 *
 * 注：vitest.config.ts 的 `env.UPLOADS_DIR` 把它指向系统临时目录，因此本用例是在
 * **非默认值**下运行的 —— 这恰好是能暴露上述原始 bug 的条件：老代码写死
 * `process.cwd()/public/uploads/videos`，而 /uploads 从 tmp 托管，两者分叉后
 * 「落在 VIDEOS_DIR 下」与「url 可取回」两条断言都会失败。
 */
describe("视频上传落盘位置与 /uploads 静态托管一致", () => {
  it("上传后返回的 url 必须能立即取回（写盘路径 == 托管路径）", async () => {
    const res = await request(app)
      .post("/api/v1/upload/video")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ videoBase64: `data:video/mp4;base64,${mp4Magic}`, filename: "roundtrip.mp4" });
    expect(res.status).toBe(201);
    expect(res.body.url).toBeTruthy();

    // 文件必须落在 config 导出的 VIDEOS_DIR 下，而不是任何写死的路径
    const { VIDEOS_DIR, UPLOADS_DIR } = await import("../src/server/utils/config.ts");
    expect(fs.existsSync(path.join(VIDEOS_DIR, res.body.videoId))).toBe(true);

    // 隔离护栏：产物目录必须在 os.tmpdir() 之下。若有人删掉 vitest.config.ts 里的
    // UPLOADS_DIR，本用例会退化成"在默认值下自证"，同时重新开始往仓库灌垃圾 —— 这里挡住它。
    expect(UPLOADS_DIR.startsWith(os.tmpdir())).toBe(true);

    // 反向断言：绝不能落进仓库里被 express.static 托管的真实目录
    expect(fs.existsSync(path.join(process.cwd(), "public", "uploads", "videos", res.body.videoId))).toBe(false);

    // 并且必须能通过返回的 url 取回（写盘路径与托管路径确实是同一个）
    const got = await request(app).get(res.body.url);
    expect(got.status).toBe(200);
  });
});
