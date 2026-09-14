import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let operatorToken: string;
let adminToken: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  // 获取普通操作员 Token (u-operator / operator)
  const opRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "operator", password: "password123" });
  operatorToken = opRes.body.token;

  // 获取管理员 Token (u-admin / admin)
  const adminRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "password123" });
  adminToken = adminRes.body.token;
});

describe("2. 基于角色的访问控制 (RBAC) 权限测试", () => {
  it("越权拦截：普通操作员 (operator) 删除高危作业票应被拒绝返回 403", async () => {
    // 1. 获取现有作业票（全局鉴权基线：读操作也需登录）
    const permitsRes = await request(app).get("/api/v1/safety-permits").set("Authorization", `Bearer ${operatorToken}`);
    expect(permitsRes.status).toBe(200);
    expect(permitsRes.body.length).toBeGreaterThan(0);
    const permitId = permitsRes.body[0].id;

    // 2. 普通操作员尝试删除作业票 -> 返回 403
    const delRes = await request(app)
      .delete(`/api/v1/safety-permits/${permitId}`)
      .set("Authorization", `Bearer ${operatorToken}`);

    expect(delRes.status).toBe(403);
    expect(delRes.body.code).toBe("RBAC_DELETE_FORBIDDEN");

    // 3. 校验审计日志是否成功写入越权拦截 (BLOCKED) 记录
    const auditRes = await request(app)
      .get("/api/v1/audit-logs?actionType=PERMIT_DELETE")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(auditRes.status).toBe(200);
    const logs = auditRes.body;
    const blockedLog = logs.find((l: any) => l.status === "BLOCKED" && l.actionType === "PERMIT_DELETE");
    expect(blockedLog).toBeTruthy();
  });

  it("合规授权：系统管理员 (admin) 允许成功删除高危作业票", async () => {
    // 1. 先创建一个测试用的作业票
    const createRes = await request(app)
      .post("/api/v1/safety-permits")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        permitType: "hot_work",
        title: "RBAC 测试用高空动火作业票",
        equipmentId: "eq-101",
        equipmentName: "1# 离心给水泵",
        workshop: "一号水泵房",
        applicant: "李巡检",
        riskLevel: "一级高危",
        precautions: ["佩戴安全带", "灭火器就位"],
      });

    expect(createRes.status).toBe(201);
    const newPermitId = createRes.body.id;

    // 2. 使用 admin 角色执行删除
    const delRes = await request(app)
      .delete(`/api/v1/safety-permits/${newPermitId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // 3. 验证审计日志中包含 SUCCESS 状态记录
    const auditRes = await request(app)
      .get("/api/v1/audit-logs?actionType=PERMIT_DELETE")
      .set("Authorization", `Bearer ${adminToken}`);

    const logs = auditRes.body;
    const successLog = logs.find((l: any) => l.status === "SUCCESS" && l.actionType === "PERMIT_DELETE");
    expect(successLog).toBeTruthy();
  });
});
