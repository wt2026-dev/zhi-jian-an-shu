import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import {
  WorkOrderRepository,
  SafetyPermitRepository,
  WorkOrderLogRepository,
  AuditLogRepository,
} from "../src/db/repositories/index.ts";

let app: any;
let adminToken: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "password123" });
  adminToken = loginRes.body.token;
  expect(adminToken).toBeTruthy();
});

describe("并发控制与时间戳口径加固测试 (Concurrency & Timestamp Suite)", () => {
  async function createTestEquipment(tag: string) {
    const res = await request(app)
      .post("/api/v1/equipments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: `EQ-CONCUR-${tag}-${Date.now()}`,
        name: `并发测试设备-${tag}`,
        category: "泵类设备",
        workshop: "动力一车间",
      });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  // -------------------------------------------------------------
  // 任务 1：乐观锁并发控制测试
  // -------------------------------------------------------------
  it("工单派发并发冲突：同一 version 的并发派单一个成功(200)一个冲突(409 VERSION_CONFLICT)", async () => {
    const eqId = await createTestEquipment("DISPATCH-CONCUR");
    const createRes = await request(app)
      .post("/api/v1/work-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "并发派发测试工单",
        equipmentId: eqId,
        faultType: "电气故障",
        priority: "high",
        description: "并发派发测试",
      });
    expect(createRes.status).toBe(201);
    const order = createRes.body;
    expect(order.version).toBe(1);

    // 两个请求同时拿同一 version: 1 尝试派发
    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/v1/work-orders/${order.id}/dispatch`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ assigneeId: "u-tech1", assigneeName: "技师A", version: 1 }),
      request(app)
        .post(`/api/v1/work-orders/${order.id}/dispatch`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ assigneeId: "u-tech2", assigneeName: "技师B", version: 1 }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = resA.status === 409 ? resA : resB;
    expect(conflictRes.body.code).toBe("VERSION_CONFLICT");

    // 验证数据库最终版本自增为 2
    const fresh = await WorkOrderRepository.getById(order.id);
    expect(fresh?.version).toBe(2);
    expect(fresh?.status).toBe("dispatched");
  });

  it("工单接单与状态流转并发保护：旧版本无法覆盖最新状态", async () => {
    const eqId = await createTestEquipment("STALE-VER");
    const order = (
      await request(app)
        .post("/api/v1/work-orders")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "旧版本保护工单",
          equipmentId: eqId,
          faultType: "管路泄漏",
          priority: "medium",
          description: "测试旧版本无法修改状态",
        })
    ).body;

    // 正常派单 version: 1 -> 2
    const dispatchRes = await request(app)
      .post(`/api/v1/work-orders/${order.id}/dispatch`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assigneeId: "u-tech1", version: 1 });
    console.log("TEST2 DISPATCH RES:", dispatchRes.status, dispatchRes.body);
    expect(dispatchRes.status).toBe(200);

    // 用已过期的 version: 1 尝试接单 -> 409
    const staleClaim = await request(app)
      .post(`/api/v1/work-orders/${order.id}/claim`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ operatorName: "李技师", version: 1 });
    expect(staleClaim.status).toBe(409);
    expect(staleClaim.body.code).toBe("VERSION_CONFLICT");
  });

  it("普通非状态修改支持向后兼容（未传 version 时正常更新）", async () => {
    const eqId = await createTestEquipment("COMPAT");
    const order = (
      await request(app)
        .post("/api/v1/work-orders")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "向后兼容工单",
          equipmentId: eqId,
          faultType: "机械振动",
          priority: "medium",
          description: "未传 version 测试",
        })
    ).body;

    const initialVersion = order.version;
    const updated = await WorkOrderRepository.update(order.id, {
      description: "向后兼容无条件修改描述",
    });
    expect(updated).not.toBeNull();
    expect(updated?.description).toBe("向后兼容无条件修改描述");
    expect(updated?.version).toBe(initialVersion + 1);
  });

  it("安全作业票审批并发保护：同一 version 并发审批一个成功一个 409", async () => {
    const eqId = await createTestEquipment("PERMIT-LOCK");
    const permitRes = await request(app)
      .post("/api/v1/safety-permits")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "并发审批高危作业票",
        permitType: "动火作业票",
        riskLevel: "较大风险 (Level 2)",
        equipmentId: eqId,
        workshop: "动力一车间",
        location: "1号锅炉区",
      });
    expect(permitRes.status).toBe(201);
    const permit = permitRes.body;

    // 两个请求同时使用 version: 1 进行监护人审批
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/safety-permits/${permit.id}/approve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ step: "guardian", pass: true, comment: "会签通过1", version: 1 }),
      request(app)
        .post(`/api/v1/safety-permits/${permit.id}/approve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ step: "guardian", pass: true, comment: "会签通过2", version: 1 }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflictRes = res1.status === 409 ? res1 : res2;
    expect(conflictRes.body.code).toBe("VERSION_CONFLICT");
  });

  // -------------------------------------------------------------
  // 任务 2：时间戳 ISO-8601 标准化
  // -------------------------------------------------------------
  it("时间戳标准化：新建工单、日志与审计记录的持久化时间严格遵循 ISO-8601 规范", async () => {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    const eqId = await createTestEquipment("TIMESTAMP-ISO");
    const woRes = await request(app)
      .post("/api/v1/work-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "ISO时间戳验证工单",
        equipmentId: eqId,
        faultType: "电气故障",
        priority: "medium",
        description: "时间戳必须为 ISO-8601",
      });
    expect(woRes.status).toBe(201);
    expect(woRes.body.createdAt).toMatch(isoRegex);

    // 验证工单日志的时间戳格式
    const logsRes = await request(app)
      .get(`/api/v1/work-orders/${woRes.body.id}/logs`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(logsRes.status).toBe(200);
    expect(logsRes.body.length).toBeGreaterThan(0);
    expect(logsRes.body[0].createdAt).toMatch(isoRegex);

    // 验证审计日志时间戳
    const auditRes = await request(app)
      .get("/api/v1/audit-logs?limit=5")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(auditRes.status).toBe(200);
    const recentAudit = auditRes.body.items || auditRes.body;
    expect(Array.isArray(recentAudit)).toBe(true);
    expect(recentAudit[0].timestamp).toMatch(isoRegex);
  });

  // -------------------------------------------------------------
  // 任务 3：AI 预测 6 维遥测口径对齐
  // -------------------------------------------------------------
  it("AI 健康趋势预测返回统计信息补齐全部 6 维遥测指标", async () => {
    const eqList = await request(app)
      .get("/api/v1/equipments")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(eqList.status).toBe(200);
    const targetEq = eqList.body.find((e: any) => e.telemetry || e.id) || eqList.body[0];
    expect(targetEq).toBeTruthy();

    const forecastRes = await request(app)
      .post("/api/v1/ai/health-forecast")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ equipmentId: targetEq.id, hours: 48 });

    expect(forecastRes.status).toBe(200);
    expect(forecastRes.body.statistics).toBeDefined();

    const stats = forecastRes.body.statistics;
    const requiredMetrics = ["temperature", "vibration", "current", "pressure", "loadRate", "rpm"];

    for (const metric of requiredMetrics) {
      expect(stats[metric]).toBeDefined();
      expect(typeof stats[metric].mean).toBe("number");
      expect(typeof stats[metric].max).toBe("number");
      expect(typeof stats[metric].min).toBe("number");
      expect(typeof stats[metric].slopePerHour).toBe("number");
      expect(typeof stats[metric].exceedCount).toBe("number");
    }
  });

  // -------------------------------------------------------------
  // 任务 4：ID 生成高并发碰撞安全
  // -------------------------------------------------------------
  it("ID 并发碰撞防护：在同一毫秒内并发生成 50 条日志与审计 ID，0 重复 0 碰撞且长度 <= 64", async () => {
    const COUNT = 50;

    // 1) 工单日志 ID 并发安全性
    const woLogPromises = Array.from({ length: COUNT }, (_, i) =>
      WorkOrderLogRepository.add({
        workOrderId: "wo-concur-test",
        action: "TEST_CONCUR",
        comment: `并发写入 ${i}`,
      })
    );
    const woLogs = await Promise.all(woLogPromises);
    const woLogIds = woLogs.map((l) => l.id);
    const uniqueWoLogIds = new Set(woLogIds);
    expect(uniqueWoLogIds.size).toBe(COUNT);
    for (const id of woLogIds) {
      expect(id.length).toBeLessThanOrEqual(64);
      expect(id).toMatch(/^log-\d+-[a-z0-9]+$/);
    }

    // 2) 审计日志 ID 并发安全性
    const auditPromises = Array.from({ length: COUNT }, (_, i) =>
      AuditLogRepository.add({
        userId: "u-admin",
        userName: "管理员",
        userRole: "admin",
        ip: "127.0.0.1",
        actionType: "CONCUR_TEST",
        module: "测试模块",
        detail: `并发审计日志测试 ${i}`,
        status: "SUCCESS",
      })
    );
    const audits = await Promise.all(auditPromises);
    const auditIds = audits.map((a) => a.id);
    const uniqueAuditIds = new Set(auditIds);
    expect(uniqueAuditIds.size).toBe(COUNT);
    for (const id of auditIds) {
      expect(id.length).toBeLessThanOrEqual(64);
      expect(id).toMatch(/^audit-\d+-[a-z0-9]+$/);
    }
  });
});
