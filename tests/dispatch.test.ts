import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let adminToken: string;
let techToken: string;
let techUserId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const adminLogin = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "Admin@2026#Demo" });
  adminToken = adminLogin.body.token;

  // tech1 为种子技师（种子密码 Tech1@2026#Work）
  const techLogin = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "tech1", password: "Tech1@2026#Work" });
  techToken = techLogin.body.token;
  techUserId = techLogin.body.user?.id;
});

describe("11. 内部师傅距离调度测试 (Dispatch Suite)", () => {
  it("位置上报：技师可上报坐标并同步在岗状态，越界坐标返回 400", async () => {
    const ok = await request(app)
      .post("/api/v1/dispatch/location")
      .set("Authorization", `Bearer ${techToken}`)
      .send({ mapX: 150, mapY: 340, status: "online" });
    expect(ok.status).toBe(201);
    expect(ok.body.success).toBe(true);

    const bad = await request(app)
      .post("/api/v1/dispatch/location")
      .set("Authorization", `Bearer ${techToken}`)
      .send({ mapX: 1200, mapY: 340 });
    expect(bad.status).toBe(400);
  });

  it("在岗师傅列表：上报后的技师应出现在列表且带技能标签", async () => {
    const res = await request(app)
      .get("/api/v1/dispatch/technicians")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    const me = res.body.technicians.find((t: any) => t.id === techUserId);
    expect(me).toBeTruthy();
    expect(Array.isArray(me.skills)).toBe(true);
    expect(me.skills.length).toBeGreaterThan(0);
  });

  it("就近推荐：待派工单应返回按 score 降序的师傅列表（含距离/技能/理由）", async () => {
    // 造一台设备 + 一张待派工单
    const eqRes = await request(app)
      .post("/api/v1/equipments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: `EQ-DISPATCH-${Date.now()}`,
        name: "调度测试泵",
        category: "泵类设备",
        workshop: "动力一车间",
      });
    expect(eqRes.status).toBe(201);
    const equipmentId = eqRes.body.id;

    const woRes = await request(app)
      .post("/api/v1/work-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "调度模块测试工单",
        equipmentId,
        faultType: "轴承磨损",
        priority: "high",
        description: "轴承箱振动异常，疑似轴承磨损需要更换",
      });
    expect(woRes.status).toBe(201);
    const workOrderId = woRes.body.id;

    const rec = await request(app)
      .get(`/api/v1/dispatch/recommend?workOrderId=${workOrderId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(rec.status).toBe(200);
    expect(rec.body.equipment.id).toBe(equipmentId);
    expect(rec.body.equipment.mapX).not.toBeNull();
    expect(Array.isArray(rec.body.recommendations)).toBe(true);
    expect(rec.body.recommendations.length).toBeGreaterThanOrEqual(1);
    for (const r of rec.body.recommendations) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.distanceLabel).toContain("约");
      expect(r.reason.length).toBeGreaterThan(0);
    }
    // score 降序
    const scores = rec.body.recommendations.map((r: any) => r.score);
    expect([...scores].sort((a: number, b: number) => b - a)).toEqual(scores);
  });

  it("派单确认：admin 派单后工单状态应为 dispatched 且 assignee 正确；重复派单返回 409", async () => {
    const eqRes = await request(app)
      .post("/api/v1/equipments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: `EQ-DISPATCH-ASSIGN-${Date.now()}`,
        name: "派单测试风机",
        category: "风机设备",
        workshop: "烧结车间",
      });
    const woRes = await request(app)
      .post("/api/v1/work-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "派单确认测试工单",
        equipmentId: eqRes.body.id,
        faultType: "电气故障",
        priority: "urgent",
        description: "电机绕组温升异常",
      });
    const workOrderId = woRes.body.id;

    const assign = await request(app)
      .post("/api/v1/dispatch/assign")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ workOrderId, userId: techUserId });
    expect(assign.status).toBe(200);
    expect(assign.body.workOrder.status).toBe("dispatched");
    expect(assign.body.workOrder.assigneeId).toBe(techUserId);

    const again = await request(app)
      .post("/api/v1/dispatch/assign")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ workOrderId, userId: techUserId });
    expect(again.status).toBe(409);
  });

  it("角色校验：技师不可执行派单；演示模拟仅 admin/manager 可调用", async () => {
    const assign = await request(app)
      .post("/api/v1/dispatch/assign")
      .set("Authorization", `Bearer ${techToken}`)
      .send({ workOrderId: "wo-any", userId: "u-tech1" });
    expect(assign.status).toBe(403);

    const mock = await request(app)
      .post("/api/v1/dispatch/mock")
      .set("Authorization", `Bearer ${techToken}`)
      .send({});
    expect(mock.status).toBe(403);

    const mockAdmin = await request(app)
      .post("/api/v1/dispatch/mock")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(mockAdmin.status).toBe(200);
    expect(mockAdmin.body.demo).toBe(true);
  });

  it("演示模拟位置：重复调用不换位（种子取自师傅 ID，不随刷新抖动）", async () => {
    const first = await request(app)
      .post("/api/v1/dispatch/mock")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    const second = await request(app)
      .post("/api/v1/dispatch/mock")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(first.status).toBe(200);
    const posOf = (res: any) =>
      new Map<string, string>(res.body.positions.map((p: any) => [p.userId, `${p.lng},${p.lat},${p.mapX},${p.mapY}`]));
    const a = posOf(first);
    const b = posOf(second);
    expect(a.size).toBeGreaterThan(0);
    for (const [userId, pos] of a) expect(b.get(userId)).toBe(pos);
    // 同时要保证不是全员叠在一个点上，否则就近推荐失去距离差异
    expect(new Set(a.values()).size).toBeGreaterThanOrEqual(Math.ceil(a.size / 2));
  });

  it("环境隔离守卫：生产环境下若未开启 DEMO_MODE=true，mock 接口返回 403 阻断", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDemoMode = process.env.DEMO_MODE;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.DEMO_MODE;

      const res = await request(app)
        .post("/api/v1/dispatch/mock")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("MOCK_DISPATCH_FORBIDDEN");

      // 显式开启 DEMO_MODE=true 后允许调用
      process.env.DEMO_MODE = "true";
      const resWithDemo = await request(app)
        .post("/api/v1/dispatch/mock")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(resWithDemo.status).toBe(200);
      expect(resWithDemo.body.demo).toBe(true);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevDemoMode !== undefined) {
        process.env.DEMO_MODE = prevDemoMode;
      } else {
        delete process.env.DEMO_MODE;
      }
    }
  });
});
