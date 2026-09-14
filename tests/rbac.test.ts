import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let operatorToken: string;
let adminToken: string;
let managerToken: string;
let technicianToken: string;
let inspectorToken: string;
let archivistToken: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const login = async (username: string, password: string) => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username, password });
    return res.body.token;
  };

  operatorToken = await login("operator", "password123");
  adminToken = await login("admin", "password123");
  managerToken = await login("manager", "password123");
  technicianToken = await login("tech1", "password123");
  inspectorToken = await login("inspector", "password123");
  archivistToken = await login("archivist", "password123");
});

describe("RBAC 权限控制全面测试", () => {
  // ==================== 1. 认证基线 ====================
  describe("认证基线", () => {
    it("未登录访问受保护接口返回 401", async () => {
      const res = await request(app).get("/api/v1/work-orders");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHORIZED");
    });

    it("伪造 Token 访问受保护接口返回 401", async () => {
      const res = await request(app)
        .get("/api/v1/work-orders")
        .set("Authorization", "Bearer invalid.token.here");
      expect(res.status).toBe(401);
    });
  });

  // ==================== 2. 角色越权拦截 ====================
  describe("角色越权拦截", () => {
    it("operator 删除作业票 -> 403", async () => {
      const permitsRes = await request(app)
        .get("/api/v1/safety-permits")
        .set("Authorization", `Bearer ${operatorToken}`);
      expect(permitsRes.status).toBe(200);
      const permitId = permitsRes.body[0]?.id;
      if (!permitId) return;

      const delRes = await request(app)
        .delete(`/api/v1/safety-permits/${permitId}`)
        .set("Authorization", `Bearer ${operatorToken}`);
      expect(delRes.status).toBe(403);
      expect(delRes.body.code).toBe("RBAC_DELETE_FORBIDDEN");
    });

    it("technician 删除作业票 -> 403", async () => {
      const permitsRes = await request(app)
        .get("/api/v1/safety-permits")
        .set("Authorization", `Bearer ${technicianToken}`);
      const permitId = permitsRes.body[0]?.id;
      if (!permitId) return;

      const delRes = await request(app)
        .delete(`/api/v1/safety-permits/${permitId}`)
        .set("Authorization", `Bearer ${technicianToken}`);
      expect(delRes.status).toBe(403);
    });

    it("inspector 删除作业票 -> 403", async () => {
      const permitsRes = await request(app)
        .get("/api/v1/safety-permits")
        .set("Authorization", `Bearer ${inspectorToken}`);
      const permitId = permitsRes.body[0]?.id;
      if (!permitId) return;

      const delRes = await request(app)
        .delete(`/api/v1/safety-permits/${permitId}`)
        .set("Authorization", `Bearer ${inspectorToken}`);
      expect(delRes.status).toBe(403);
    });

    it("archivist 删除作业票 -> 403", async () => {
      const permitsRes = await request(app)
        .get("/api/v1/safety-permits")
        .set("Authorization", `Bearer ${archivistToken}`);
      const permitId = permitsRes.body[0]?.id;
      if (!permitId) return;

      const delRes = await request(app)
        .delete(`/api/v1/safety-permits/${permitId}`)
        .set("Authorization", `Bearer ${archivistToken}`);
      expect(delRes.status).toBe(403);
    });
  });

  // ==================== 3. 合规授权 ====================
  describe("合规授权", () => {
    it("admin 删除作业票 -> 200", async () => {
      const createRes = await request(app)
        .post("/api/v1/safety-permits")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          permitType: "hot_work",
          title: "RBAC 合规测试动火票",
          equipmentId: "eq-101",
          equipmentName: "测试设备",
          workshop: "测试车间",
          applicant: "测试员",
          riskLevel: "一级高危",
          precautions: ["佩戴安全带"],
        });
      expect(createRes.status).toBe(201);

      const delRes = await request(app)
        .delete(`/api/v1/safety-permits/${createRes.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
    });

    it("manager 删除作业票 -> 200 (manager 有删除权限)", async () => {
      const createRes = await request(app)
        .post("/api/v1/safety-permits")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          permitType: "confined_space",
          title: "RBAC manager 测试有限空间票",
          equipmentId: "eq-102",
          equipmentName: "测试罐体",
          workshop: "化工车间",
          applicant: "测试员",
          riskLevel: "二级高危",
          precautions: ["气体检测"],
        });
      expect(createRes.status).toBe(201);

      const delRes = await request(app)
        .delete(`/api/v1/safety-permits/${createRes.body.id}`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(delRes.status).toBe(200);
    });
  });

  // ==================== 4. 审计日志验证 ====================
  describe("审计日志", () => {
    it("越权操作写入 BLOCKED 审计日志", async () => {
      // 触发一次越权
      const permitsRes = await request(app)
        .get("/api/v1/safety-permits")
        .set("Authorization", `Bearer ${operatorToken}`);
      const permitId = permitsRes.body[0]?.id;
      if (!permitId) return;

      await request(app)
        .delete(`/api/v1/safety-permits/${permitId}`)
        .set("Authorization", `Bearer ${operatorToken}`);

      // 验证审计日志
      const auditRes = await request(app)
        .get("/api/v1/audit-logs?actionType=PERMIT_DELETE")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(auditRes.status).toBe(200);
      const blockedLog = auditRes.body.find(
        (l: any) => l.status === "BLOCKED" && l.actionType === "PERMIT_DELETE"
      );
      expect(blockedLog).toBeTruthy();
    });
  });

  // ==================== 5. 读操作各角色均可访问 ====================
  describe("读操作基线", () => {
    it("所有角色均可读取工单列表", async () => {
      const tokens = [operatorToken, technicianToken, inspectorToken, archivistToken, managerToken];
      for (const token of tokens) {
        const res = await request(app)
          .get("/api/v1/work-orders")
          .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      }
    });

    it("所有角色均可读取设备列表", async () => {
      const tokens = [operatorToken, technicianToken, inspectorToken, archivistToken, managerToken];
      for (const token of tokens) {
        const res = await request(app)
          .get("/api/v1/equipments")
          .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
      }
    });
  });
});
