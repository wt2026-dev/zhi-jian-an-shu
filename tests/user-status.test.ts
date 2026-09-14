/**
 * 用户状态字段与停用能力回归测试 (User Status & Disablement Capability)
 * 覆盖场景：
 * ① 禁用用户后，其已签发 Token 访问受保护业务接口返回 401
 * ② 被禁用用户通过账密登录返回 403 + USER_DISABLED
 * ③ 非 admin 调用状态变更接口返回 403 (RBAC 拦截)
 * ④ admin 可禁用/启用他人，但操作自身账号被安全策略拒绝 (400)
 * ⑤ 恢复启用后，用户重新登录并正常访问受保护接口
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let adminToken = "";
let tech1Token = "";
let tech2Token = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  // 获取测试 Token
  const adminLogin = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "password123" });
  adminToken = adminLogin.body.token;

  const tech1Login = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "tech1", password: "password123" });
  tech1Token = tech1Login.body.token;

  const tech2Login = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "tech2", password: "password123" });
  tech2Token = tech2Login.body.token;

  expect(adminToken).toBeTruthy();
  expect(tech1Token).toBeTruthy();
  expect(tech2Token).toBeTruthy();
});

describe("用户状态字段与停用能力 (User Status & Disablement)", () => {
  it("前置核验：启用状态下持有 Token 可正常访问受保护接口", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tech1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("tech1");
  });

  it("③ 非 admin 调用状态变更接口必须返回 403 (RBAC 拒绝)", async () => {
    const res = await request(app)
      .patch("/api/v1/auth/users/u-tech1/status")
      .set("Authorization", `Bearer ${tech2Token}`)
      .send({ status: "disabled" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RBAC_PERMISSION_DENIED");
  });

  it("④ admin 操作自身账号被拒绝 (400 防御自锁)", async () => {
    // 依 id 测试
    const resById = await request(app)
      .patch("/api/v1/auth/users/u-admin/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });

    expect(resById.status).toBe(400);
    expect(resById.body.code).toBe("SELF_STATUS_CHANGE_FORBIDDEN");

    // 依 username 测试
    const resByUsername = await request(app)
      .patch("/api/v1/auth/users/admin/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });

    expect(resByUsername.status).toBe(400);
    expect(resByUsername.body.code).toBe("SELF_STATUS_CHANGE_FORBIDDEN");
  });

  it("④-2 admin 可成功停用他人账号 (tech1)", async () => {
    const res = await request(app)
      .patch("/api/v1/auth/users/u-tech1/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.status).toBe("disabled");
  });

  it("① 禁用用户后，其已签发的 Token 访问受保护接口必须立即返回 401", async () => {
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tech1Token}`);
    expect(meRes.status).toBe(401);
    expect(meRes.body.code).toBe("UNAUTHORIZED");

    const equipRes = await request(app)
      .get("/api/v1/equipments")
      .set("Authorization", `Bearer ${tech1Token}`);
    expect(equipRes.status).toBe(401);
    expect(equipRes.body.code).toBe("UNAUTHORIZED");
  });

  it("② 被禁用用户尝试登录必须被拒绝 (403 + USER_DISABLED)", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "tech1", password: "password123" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("USER_DISABLED");
    expect(res.body.token).toBeUndefined();
  });

  it("⑤ admin 重新启用用户账号，用户可正常重新登录并恢复权限", async () => {
    const enableRes = await request(app)
      .patch("/api/v1/auth/users/u-tech1/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    expect(enableRes.status).toBe(200);
    expect(enableRes.body.user.status).toBe("active");

    // 重新登录获取新 Token
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "tech1", password: "password123" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();

    // 新 Token 访问受保护接口正常
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.username).toBe("tech1");
  });
});
