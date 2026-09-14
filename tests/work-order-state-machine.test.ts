import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let adminToken: string;
let techToken: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const adminLogin = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "Admin@2026#Demo" });
  adminToken = adminLogin.body.token;

  const techLogin = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "tech1", password: "Tech1@2026#Work" });
  techToken = techLogin.body.token;
});

describe("工单状态机与互斥校验 (Work Order State Machine Suite)", () => {
  async function createEquipment(tag: string) {
    const res = await request(app)
      .post("/api/v1/equipments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: `EQ-SM-${tag}-${Date.now()}`,
        name: `状态机测试设备-${tag}`,
        category: "泵类设备",
        workshop: "动力一车间",
      });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createOrder(equipmentId: string, tag: string) {
    const res = await request(app)
      .post("/api/v1/work-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: `状态机测试工单-${tag}`,
        equipmentId,
        faultType: "机械振动",
        priority: "high",
        description: "状态机测试用工单",
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  it("完整生命周期：created → dispatched → in_progress → pending_acceptance → completed，时间线日志 ≥5 条", async () => {
    const eqId = await createEquipment("FULL");
    const order = await createOrder(eqId, "FULL");
    expect(order.status).toBe("created");

    // 派单
    const dispatch = await request(app)
      .post(`/api/v1/work-orders/${order.id}/dispatch`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assigneeId: "u-tech1", assigneeName: "张建国 (高级技师)", estimatedHours: 2 });
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.status).toBe("dispatched");

    // 接单
    const claim = await request(app)
      .post(`/api/v1/work-orders/${order.id}/claim`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ operatorName: "张建国" });
    expect(claim.status).toBe(200);
    expect(claim.body.status).toBe("in_progress");

    // 完工上报
    const complete = await request(app)
      .post(`/api/v1/work-orders/${order.id}/complete`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ causeAnalysis: "轴承磨损", resolutionSteps: "更换轴承并重新对中", workHours: 3 });
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("pending_acceptance");

    // 质检验收归档
    const accept = await request(app)
      .post(`/api/v1/work-orders/${order.id}/accept`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ pass: true, score: 5, comment: "验收合格" });
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("completed");

    // 完整流转时间线（CREATE + DISPATCH + CLAIM + COMPLETE + ACCEPT）
    const logs = await request(app)
      .get(`/api/v1/work-orders/${order.id}/logs`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(logs.status).toBe(200);
    expect(logs.body.length).toBeGreaterThanOrEqual(5);
  });

  it("非法流转拦截：created 直接跳转 in_progress 返回 INVALID_STATE_TRANSITION，并列出允许状态", async () => {
    const eqId = await createEquipment("ILLEGAL");
    const order = await createOrder(eqId, "ILLEGAL");

    const res = await request(app)
      .patch(`/api/v1/work-orders/${order.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ targetStatus: "in_progress", operatorName: "测试操作员" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_STATE_TRANSITION");
    expect(res.body.currentStatus).toBe("created");
    expect(res.body.targetStatus).toBe("in_progress");
    expect(res.body.allowedStatuses).toEqual(["dispatched", "cancelled"]);
  });

  it("终态锁定：completed 后任何流转均被拒绝（允许状态为空）", async () => {
    const eqId = await createEquipment("TERMINAL");
    const order = await createOrder(eqId, "TERMINAL");
    await request(app)
      .post(`/api/v1/work-orders/${order.id}/dispatch`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assigneeId: "u-tech1" });
    await request(app)
      .post(`/api/v1/work-orders/${order.id}/claim`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({});
    await request(app)
      .post(`/api/v1/work-orders/${order.id}/complete`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ causeAnalysis: "x", resolutionSteps: "y", workHours: 1 });
    const accept = await request(app)
      .post(`/api/v1/work-orders/${order.id}/accept`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ pass: true, score: 5, comment: "ok" });
    expect(accept.body.status).toBe("completed");

    const res = await request(app)
      .patch(`/api/v1/work-orders/${order.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ targetStatus: "in_progress" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_STATE_TRANSITION");
    expect(res.body.allowedStatuses).toEqual([]);
  });

  it("乐观锁冲突：携带过期 version 的合法流转返回 409 VERSION_CONFLICT", async () => {
    const eqId = await createEquipment("VERSION");
    const order = await createOrder(eqId, "VERSION");
    expect(order.version).toBe(1);

    // 1) 合法派单（version 1 → 2）
    const dispatch = await request(app)
      .post(`/api/v1/work-orders/${order.id}/dispatch`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assigneeId: "u-tech1", version: order.version });
    expect(dispatch.status).toBe(200);

    // 2) 合法退回 created（dispatched → created 允许，version 2 → 3）
    const rollback = await request(app)
      .patch(`/api/v1/work-orders/${order.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ targetStatus: "created", version: 2 });
    expect(rollback.status).toBe(200);
    expect(rollback.body.status).toBe("created");

    // 3) 用过期 version=2 再次派单 → 状态合法但版本冲突 → 409
    const stale = await request(app)
      .post(`/api/v1/work-orders/${order.id}/dispatch`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assigneeId: "u-tech1", version: 2 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("VERSION_CONFLICT");
  });

  it("防重复报单：同一设备 15 分钟内重复创建返回 409 DUPLICATE_WORK_ORDER", async () => {
    const eqId = await createEquipment("DUP");
    await createOrder(eqId, "DUP-1");

    const dup = await request(app)
      .post("/api/v1/work-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "状态机测试工单-DUP-2",
        equipmentId: eqId,
        faultType: "机械振动",
        priority: "high",
        description: "重复报单应被拦截",
      });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("DUPLICATE_WORK_ORDER");
    expect(dup.body.existingOrder).toBeTruthy();
    expect(dup.body.existingOrder.id).toBeTruthy();
  });

  it("专用接口互斥：created 状态直接 claim 返回 STATE_MUTEX_ERROR", async () => {
    const eqId = await createEquipment("MUTEX");
    const order = await createOrder(eqId, "MUTEX");

    const claim = await request(app)
      .post(`/api/v1/work-orders/${order.id}/claim`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({});
    expect(claim.status).toBe(400);
    expect(claim.body.code).toBe("STATE_MUTEX_ERROR");
    expect(claim.body.currentStatus).toBe("created");
  });
});
