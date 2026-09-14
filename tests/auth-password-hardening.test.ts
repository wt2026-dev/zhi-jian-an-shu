/**
 * 明文密码兼容平滑升级与安全加固回归测试 (Password Hardening & Upgrade)
 * 覆盖场景：
 * ① 生产环境 (NODE_ENV=production) 遇到数据库中存为明文的密码直接拒绝登录 (403 + INSECURE_PASSWORD_DETECTED)
 * ② 开发/测试环境下，明文密码长度 < 8 或不含字母/数字时拒绝自动升级并报错 (400 + PASSWORD_TOO_WEAK)
 * ③ 开发/测试环境下，满足安全强度下限（长度 >= 8 且含字母与数字）的明文密码允许平滑升级为 Bcrypt 哈希并成功登录
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { getDb } from "../src/db/db.ts";

let app: any;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const db = await getDb();
  // 插入测试用的明文密码账号
  await db.query(`
    INSERT INTO users (id, username, password, name, role, role_title, department, status)
    VALUES
      ('u-test-weak', 'test_weak_pwd', 'weak1', '弱明文用户', 'technician', '测试技师', '测试部', 'active'),
      ('u-test-no-num', 'test_no_num_pwd', 'abcdefgh', '无数字明文用户', 'technician', '测试技师', '测试部', 'active'),
      ('u-test-strong', 'test_strong_pwd', 'ValidPass2026', '强明文用户', 'technician', '测试技师', '测试部', 'active'),
      ('u-test-prod', 'test_prod_pwd', 'ValidPass2026', '生产明文用户', 'technician', '测试技师', '测试部', 'active')
    ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password, status = 'active';
  `);
});

afterEach(() => {
  process.env.NODE_ENV = "test";
});

describe("明文密码兼容与安全升级加固 (Password Hardening)", () => {
  it("① 生产环境 (NODE_ENV=production) 检测到数据库明文密码直接拦截 (403 + INSECURE_PASSWORD_DETECTED)", async () => {
    process.env.NODE_ENV = "production";

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "test_prod_pwd", password: "ValidPass2026" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INSECURE_PASSWORD_DETECTED");
    expect(res.body.token).toBeUndefined();
  });

  it("② 非生产环境遇到弱明文密码 (长度 < 8) 拒绝平滑升级 (400 + PASSWORD_TOO_WEAK)", async () => {
    process.env.NODE_ENV = "test";

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "test_weak_pwd", password: "weak1" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_WEAK");
    expect(res.body.token).toBeUndefined();
  });

  it("②-2 非生产环境遇到无数字明文密码 (纯字母) 拒绝平滑升级 (400 + PASSWORD_TOO_WEAK)", async () => {
    process.env.NODE_ENV = "test";

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "test_no_num_pwd", password: "abcdefgh" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_WEAK");
    expect(res.body.token).toBeUndefined();
  });

  it("③ 非生产环境强明文密码 (长度 >= 8 且含字母与数字) 自动升级为 Bcrypt 哈希并成功登录", async () => {
    process.env.NODE_ENV = "test";

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "test_strong_pwd", password: "ValidPass2026" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe("test_strong_pwd");

    // 校验数据库中已被升级为 Bcrypt 哈希字符串
    const db = await getDb();
    const { rows } = await db.query("SELECT password FROM users WHERE username = 'test_strong_pwd';");
    expect(rows[0]?.password).toMatch(/^\$2[aby]\$/);

    // 再次登录验证走 Bcrypt 分支正常通过
    const resAgain = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "test_strong_pwd", password: "ValidPass2026" });
    expect(resAgain.status).toBe(200);
    expect(resAgain.body.token).toBeTruthy();
  });

  it("④ 各角色账号均能通过其独立强密码登录成功 (Admin@2026#Demo / Manager@2026#Safe / Tech1@2026#Work 等)", async () => {
    const roles = [
      { username: "admin", password: "Admin@2026#Demo", role: "admin" },
      { username: "manager", password: "Manager@2026#Safe", role: "manager" },
      { username: "tech1", password: "Tech1@2026#Work", role: "technician" },
      { username: "inspector", password: "Inspect@2026#Check", role: "inspector" },
      { username: "operator", password: "Operator@2026#Line", role: "operator" },
      { username: "tech2", password: "Tech2@2026#Elec", role: "technician" },
      { username: "inspector2", password: "Inspect2@2026#Site", role: "inspector" },
      { username: "operator2", password: "Operator2@2026#Lift", role: "user" },
      { username: "archivist", password: "Archive@2026#Doc", role: "archivist" },
    ];

    for (const r of roles) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ username: r.username, password: r.password });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.role).toBe(r.role);
    }
  });

  it("⑤ DEMO_FORCE_PASSWORD_CHANGE=true 时，登录响应返回 forcePasswordChange: true 标记", async () => {
    process.env.DEMO_FORCE_PASSWORD_CHANGE = "true";
    try {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ username: "admin", password: "Admin@2026#Demo" });
      expect(res.status).toBe(200);
      expect(res.body.forcePasswordChange).toBe(true);
    } finally {
      delete process.env.DEMO_FORCE_PASSWORD_CHANGE;
    }
  });

  it("⑥ 默认环境未启用改密开关时，登录响应不含 forcePasswordChange 标记", async () => {
    delete process.env.DEMO_FORCE_PASSWORD_CHANGE;
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "Admin@2026#Demo" });
    expect(res.status).toBe(200);
    expect(res.body.forcePasswordChange).toBeUndefined();
  });
});
