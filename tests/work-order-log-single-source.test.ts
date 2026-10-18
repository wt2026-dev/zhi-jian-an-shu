/**
 * 工单日志单一数据源回归测试。
 * 修复前：详情接口读内存数组、时间线接口读 work_order_logs 表，两套口径可能分歧。
 * 修复后：唯一真源是 work_order_logs 表，详情与时间线均从同一张表读取，不再维护内存镜像。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let adminToken = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  adminToken = (await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "Admin@2026#Demo" })).body.token;
  expect(adminToken).toBeTruthy();
});

describe("工单日志单一数据源 (Work Order Log Single Source of Truth)", () => {
  it("通过真实链路创建工单后，时间线接口以数据库为准返回完整记录", async () => {
    const eqRes = await request(app)
      .post("/api/v1/equipments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: `EQ-SRC-${Date.now()}`,
        name: "单源验证设备",
        category: "泵类设备",
        workshop: "动力一车间",
      });
    expect(eqRes.status).toBe(201);

    const createRes = await request(app)
      .post("/api/v1/work-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "单源验证工单",
        description: "验证日志以数据库为唯一真源",
        equipmentId: eqRes.body.id,
        faultType: "机械故障",
        priority: "high",
        workshop: "总装车间",
      });
    expect(createRes.status).toBe(201);
    const woId = createRes.body.id;
    expect(woId).toBeTruthy();

    const logsRes = await request(app)
      .get(`/api/v1/work-orders/${woId}/logs`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(logsRes.status).toBe(200);
    expect(Array.isArray(logsRes.body)).toBe(true);
    expect(logsRes.body.length).toBeGreaterThanOrEqual(1);
    expect(logsRes.body.every((l: any) => l.workOrderId === woId)).toBe(true);
  });

  it("详情接口与时间线接口读同一张表：返回的日志集合一致", async () => {
    const listRes = await request(app).get("/api/v1/work-orders").set("Authorization", `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    const target = listRes.body.find?.((w: any) => w.id) || listRes.body.workOrders?.[0];
    expect(target).toBeTruthy();

    const detailRes = await request(app)
      .get(`/api/v1/work-orders/${target.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detailRes.status).toBe(200);
    expect(Array.isArray(detailRes.body.logs)).toBe(true);

    const logsRes = await request(app)
      .get(`/api/v1/work-orders/${target.id}/logs`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(logsRes.status).toBe(200);

    // 同一工单的详情日志与时间线日志，来源必须是同一张表（不再有内存 / DB 双源）
    const detailIds = detailRes.body.logs.map((l: any) => l.id).sort();
    const timelineIds = logsRes.body.map((l: any) => l.id).sort();
    expect(detailIds).toEqual(timelineIds);
  });
});
