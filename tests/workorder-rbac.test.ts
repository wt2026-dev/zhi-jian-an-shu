// 工单高危端点 RBAC 越权测试（2026-10-19 试点加固，阶段2/G1）
// 角色口径（经确认的业务惯例矩阵）：
//   报修创建：全员（operator 报修通道）；派单/验收/归档/状态流转/删除：manager、admin；
//   接单开工/完工上报：technician、inspector。
// 佐证：越权一律 403 + code=RBAC_PERMISSION_DENIED，且 requireRole 写入 RBAC_ACCESS_DENIED 审计。
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let adminToken: string;
let managerToken: string;
let techToken: string;
let operatorToken: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const login = async (username: string, password: string) => {
    const res = await request(app).post("/api/v1/auth/login").send({ username, password });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };

  adminToken = await login("admin", "Admin@2026#Demo");
  managerToken = await login("manager", "Manager@2026#Safe");
  techToken = await login("tech1", "Tech1@2026#Work");
  operatorToken = await login("operator", "Operator@2026#Line");
});

describe("工单高危端点 RBAC（越权拒绝矩阵）", () => {
  async function createEquipment(tag: string) {
    const res = await request(app)
      .post("/api/v1/equipments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: `EQ-RBAC-${tag}-${Date.now()}`,
        name: `RBAC测试设备-${tag}`,
        category: "泵类设备",
        workshop: "动力一车间",
      });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createOrderAsOperator(equipmentId: string, tag: string) {
    // operator 报修创建（业务闭环起点，全员可用）
    const res = await request(app)
      .post("/api/v1/work-orders")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({
        title: `RBAC报修工单-${tag}`,
        equipmentId,
        faultType: "机械振动",
        priority: "high",
        description: "operator 报修通道验证",
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  it("未认证调用派单端点 → 401", async () => {
    const res = await request(app).post("/api/v1/work-orders/some-id/dispatch").send({});
    expect(res.status).toBe(401);
  });

  it("operator 报修创建工单 → 201（报修通道保留）", async () => {
    const eqId = await createEquipment("CREATE-OK");
    const order = await createOrderAsOperator(eqId, "CREATE-OK");
    expect(order.status).toBe("created");
    expect(order.id).toBeTruthy();
  });

  it.each([
    ["dispatch", "post", "/dispatch", {}],
    ["claim", "post", "/claim", {}],
    ["complete", "post", "/complete", { causeAnalysis: "x", resolutionSteps: "y" }],
    ["accept", "post", "/accept", { pass: true, score: 5 }],
    ["transition(PATCH status)", "patch", "/status", { targetStatus: "cancelled" }],
    ["delete", "delete", "", {}],
  ])("operator 调用高危端点 %s → 403 RBAC_PERMISSION_DENIED", async (_label, method, suffix, body) => {
    const eqId = await createEquipment("OP-DENY");
    const order = await createOrderAsOperator(eqId, "OP-DENY");
    const url = `/api/v1/work-orders/${order.id}${suffix}`;
    // 计算属性访问必须与 receivers 同行：换行写会被 no-unexpected-multiline 判 error（CI 第七步 lint 因此整条红，
    // 后面 npm test / metrics:check / build 三步全被 skip）。语义完全一致。
    const res = await (request(app) as any)[method](url)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RBAC_PERMISSION_DENIED");
    expect(res.body.userRole).toBe("operator");
  });

  it.each([
    ["dispatch", "/dispatch", {}],
    ["accept", "/accept", { pass: true, score: 5 }],
  ])("technician 调用主管口径端点 %s → 403", async (_label, suffix, body) => {
    const eqId = await createEquipment("TECH-DENY");
    const order = await createOrderAsOperator(eqId, "TECH-DENY");
    const res = await request(app)
      .post(`/api/v1/work-orders/${order.id}${suffix}`)
      .set("Authorization", `Bearer ${techToken}`)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RBAC_PERMISSION_DENIED");
  });

  it("manager 派单 → 200（正常路径不破坏）", async () => {
    const eqId = await createEquipment("MGR-OK");
    const order = await createOrderAsOperator(eqId, "MGR-OK");
    const res = await request(app)
      .post(`/api/v1/work-orders/${order.id}/dispatch`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ assigneeId: "u-tech1", assigneeName: "张建国 (高级技师)", estimatedHours: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("dispatched");
  });

  it("操作日志含认证身份标注（防 body.operatorName 伪造）", async () => {
    const eqId = await createEquipment("LOG-ACTOR");
    const order = await createOrderAsOperator(eqId, "LOG-ACTOR");
    const logs = await request(app)
      .get(`/api/v1/work-orders/${order.id}/logs`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(logs.status).toBe(200);
    const createLog = logs.body.find((l: any) => l.action === "CREATE");
    expect(createLog).toBeTruthy();
    // body 未传 creator 时也必须可溯源到登录账号 operator
    expect(createLog.comment).toContain("操作账号: operator/");
  });

  it("伪造 dispatcher 展示名仍记录真实认证账号", async () => {
    const eqId = await createEquipment("LOG-SPOOF");
    const order = await createOrderAsOperator(eqId, "LOG-SPOOF");
    const dispatch = await request(app)
      .post(`/api/v1/work-orders/${order.id}/dispatch`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ assigneeId: "u-tech1", assigneeName: "张建国", dispatcher: "伪造的总裁" });
    expect(dispatch.status).toBe(200);

    const logs = await request(app)
      .get(`/api/v1/work-orders/${order.id}/logs`)
      .set("Authorization", `Bearer ${adminToken}`);
    const dispatchLog = logs.body.find((l: any) => l.action === "DISPATCH");
    expect(dispatchLog).toBeTruthy();
    // 展示名保留 body 值，但 comment 必须携带真实登录身份
    expect(dispatchLog.comment).toContain("操作账号: manager/");
  });
});
