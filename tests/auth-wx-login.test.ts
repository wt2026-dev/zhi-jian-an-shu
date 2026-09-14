/**
 * 微信小程序登录 (wx-login) 安全加固回归测试
 * 针对漏洞：此前 handleWxLogin 读取 WX_APPID 导致降级分支永远生效，
 * 且降级分支默认将任意 code 绑定到 admin 并签发管理员 JWT。
 * 加固要求：
 * 1. 统一键名 WECHAT_APP_ID / WECHAT_APP_SECRET
 * 2. 生产环境禁止降级（未配置返回 503）
 * 3. 开发态降级严禁绑定 admin/manager，且需显式配置 WX_DEFAULT_USERNAME
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  delete process.env.WECHAT_APP_ID;
  delete process.env.WECHAT_APP_SECRET;
  delete process.env.WX_DEFAULT_USERNAME;
  app = await createApp();
});

afterEach(() => {
  process.env.NODE_ENV = "test";
  delete process.env.WECHAT_APP_ID;
  delete process.env.WECHAT_APP_SECRET;
  delete process.env.WX_DEFAULT_USERNAME;
});

describe("微信小程序登录认证安全加固 (wx-login hardening)", () => {
  it("① 匿名 POST /api/v1/auth/wx-login 传任意 code，未配置默认账号时返回 401 且不得签发 Token", async () => {
    delete process.env.WX_DEFAULT_USERNAME;
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;

    const res = await request(app)
      .post("/api/v1/auth/wx-login")
      .send({ code: "malicious_random_code_123" });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(res.body.code).toBe("WX_DEV_LOGIN_UNCONFIGURED");
  });

  it("② 生产模式 (NODE_ENV=production) 下未配置微信凭据必须返回 503 而非降级签发", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    process.env.WX_DEFAULT_USERNAME = "tech1";

    const res = await request(app)
      .post("/api/v1/auth/wx-login")
      .send({ code: "any_attacker_code" });

    expect(res.status).toBe(503);
    expect(res.body.token).toBeUndefined();
    expect(res.body.code).toBe("WECHAT_SERVICE_UNCONFIGURED");
  });

  it("③ 开发态降级配置 WX_DEFAULT_USERNAME 指向 admin 时必须被安全策略拒绝 (401)", async () => {
    process.env.NODE_ENV = "test";
    process.env.WX_DEFAULT_USERNAME = "admin";
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;

    const res = await request(app)
      .post("/api/v1/auth/wx-login")
      .send({ code: "dev_probe_code_admin" });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(res.body.code).toBe("WX_DEV_FORBIDDEN_ROLE");
  });

  it("③-2 开发态降级配置 WX_DEFAULT_USERNAME 指向 manager 时必须被安全策略拒绝 (401)", async () => {
    process.env.NODE_ENV = "test";
    process.env.WX_DEFAULT_USERNAME = "manager";
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;

    const res = await request(app)
      .post("/api/v1/auth/wx-login")
      .send({ code: "dev_probe_code_manager" });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(res.body.code).toBe("WX_DEV_FORBIDDEN_ROLE");
  });

  it("④ 开发态降级配置 WX_DEFAULT_USERNAME 指向普通技师 (tech1) 允许本地安全联调", async () => {
    process.env.NODE_ENV = "test";
    process.env.WX_DEFAULT_USERNAME = "tech1";
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;

    const res = await request(app)
      .post("/api/v1/auth/wx-login")
      .send({ code: "valid_dev_test_code_99" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.devMode).toBe(true);
    expect(res.body.openid).toMatch(/^dev_/);
    expect(res.body.user).toHaveProperty("username", "tech1");
    expect(res.body.user.role).toBe("technician");
  });
});
