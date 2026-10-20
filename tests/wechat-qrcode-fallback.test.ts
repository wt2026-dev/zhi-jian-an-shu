/**
 * 设备二维码降级契约 —— QrScannerModal 依赖的那条路径。
 *
 * 前端逻辑（2026-10-20 提交 f9162f2）：
 *   优先请求 /api/v1/wechat/repair-qrcode（小程序太阳码）；
 *   img onError → 切 /api/v1/wechat/h5-qrcode（H5 普通二维码 PNG）。
 *
 * 因此服务端必须保证两件事，否则前端会降级到一张裂图：
 *   1) 未配置 AppID/Secret 时，repair-qrcode 返回**可被 onError 捕获的失败**
 *      （404 + configured:false），而不是 200 的 JSON 错误体；
 *   2) h5-qrcode 在任何情况下都能出图，且深链参数正确。
 *
 * 本文件在 import server 之前把凭据置空：config.ts 在模块加载期 dotenv.config()，
 * 而 dotenv 不覆盖已存在的变量，故置空即可锁定「未配置」分支，且不会访问微信接口。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

let app: any;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.WECHAT_APP_ID = "";
  process.env.WECHAT_APP_SECRET = "";
  const { createApp } = await import("../server.ts");
  app = await createApp();
});

describe("设备二维码：小程序码不可用时降级 H5", () => {
  it("未配置小程序凭据 → repair-qrcode 返回 404 + configured:false（前端据此切 H5）", async () => {
    const res = await request(app).get("/api/v1/wechat/repair-qrcode?deviceId=eq-101");
    expect(res.status).toBe(404);
    expect(res.body.configured).toBe(false);
    // 提示语要指明可用 H5 过渡码，否则运维看到 404 只会以为是接口坏了
    expect(String(res.body.msg)).toContain("H5");
  });

  it("h5-qrcode 始终出图（PNG），深链带 quick_repair + 设备号", async () => {
    const res = await request(app).get("/api/v1/wechat/h5-qrcode?deviceId=eq-101");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("image/png");
    const target = String(res.headers["x-target-url"] ?? "");
    expect(target).toContain("view=quick_repair");
    expect(target).toContain("equipmentId=eq-101");
  });

  it("缺 deviceId 时 repair-qrcode 仍是 400（降级逻辑不得把参数校验吞掉）", async () => {
    const res = await request(app).get("/api/v1/wechat/repair-qrcode");
    expect(res.status).toBe(400);
  });
});
