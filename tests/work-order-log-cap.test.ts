/**
 * 工单日志内存上限回归测试。
 * pushWorkOrderLog 此前向 dbWorkOrderLogs 无限 unshift，长期运行内存持续增长；
 * 修复后内存数组封顶 1000 条（头部最新、截断尾部最旧），时间线接口以 work_order_logs 表为准。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { pushWorkOrderLog, dbWorkOrderLogs } from "../src/server/controllers/workOrderController.ts";

let app: any;
let adminToken = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  adminToken = (await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "Admin@2026#Demo" })).body.token;
  expect(adminToken).toBeTruthy();
});

describe("工单日志内存上限 (Work Order Log Memory Cap)", () => {
  it("连续写入 1500 条日志后，内存数组长度不超过 1000，且保持头部最新语义", async () => {
    const before = dbWorkOrderLogs.length;
    for (let i = 1; i <= 1500; i++) {
      pushWorkOrderLog({
        workOrderId: `wo-cap-${i}`,
        action: "created",
        previousStatus: null,
        newStatus: "created",
        operatorName: "压测脚本",
        createdAt: new Date().toISOString(),
      });
    }
    expect(dbWorkOrderLogs.length).toBe(before + 1000);
    // 头部是最新一条，尾部是第 501 条（最旧的 500 条被截断）
    expect(dbWorkOrderLogs[0].workOrderId).toBe("wo-cap-1500");
    expect(dbWorkOrderLogs[dbWorkOrderLogs.length - 1].workOrderId).toBe("wo-cap-501");
  });

  it("时间线接口以数据库为准：截断后 GET /work-orders/:id/logs 仍返回完整记录", async () => {
    // 创建测试设备（创建工单校验设备必须存在）
    const eqRes = await request(app)
      .post("/api/v1/equipments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: `EQ-CAP-${Date.now()}`,
        name: "日志上限测试设备",
        category: "泵类设备",
        workshop: "动力一车间",
      });
    expect(eqRes.status).toBe(201);

    // 通过真实 HTTP 链路创建工单（产生 created 日志并落库）
    const createRes = await request(app)
      .post("/api/v1/work-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "日志上限验证工单",
        description: "验证内存截断后数据库时间线完整",
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

  it("工单详情接口仍返回内存缓存日志（过滤出该单的记录）", async () => {
    const listRes = await request(app).get("/api/v1/work-orders").set("Authorization", `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    const target = listRes.body.find?.((w: any) => w.id) || listRes.body.workOrders?.[0];
    expect(target).toBeTruthy();

    const detailRes = await request(app)
      .get(`/api/v1/work-orders/${target.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detailRes.status).toBe(200);
    expect(Array.isArray(detailRes.body.logs)).toBe(true);
  });
});
