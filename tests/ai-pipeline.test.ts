import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let token: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "Admin@2026#Demo" });
  token = loginRes.body.token;
});

describe("7. AI 协同任务链路测试 (AI Pipeline Suite)", () => {
  it("创建接口输入校验：缺少 problemDescription 应返回 400", async () => {
    const res = await request(app)
      .post("/api/v1/ai/pipeline")
      .set("Authorization", `Bearer ${token}`)
      .send({ equipmentId: "eq-101" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("创建协同任务：合法请求应返回 202 与任务 ID，并包含 4 个编排步骤", async () => {
    const res = await request(app)
      .post("/api/v1/ai/pipeline")
      .set("Authorization", `Bearer ${token}`)
      .send({ equipmentId: "eq-101", problemDescription: "轴承箱温度持续升高并伴有金属摩擦异响" });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.taskId).toBe("string");
    expect(res.body.steps).toEqual(["故障诊断", "检修方案生成", "风险审核", "派单推荐"]);
  });

  it("查询任务：返回任务状态与 4 个步骤结构（含 status/progress/result 字段）", async () => {
    const createRes = await request(app)
      .post("/api/v1/ai/pipeline")
      .set("Authorization", `Bearer ${token}`)
      .send({ equipmentId: "eq-102", problemDescription: "振动值接近报警上限，疑似不对中" });
    const taskId = createRes.body.taskId;

    const res = await request(app)
      .get(`/api/v1/ai/pipeline/${taskId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.task.id).toBe(taskId);
    expect(["pending", "running", "completed", "failed"]).toContain(res.body.task.status);
    expect(Array.isArray(res.body.task.steps)).toBe(true);
    expect(res.body.task.steps.length).toBe(4);
    for (const step of res.body.task.steps) {
      expect(["pending", "running", "completed", "failed"]).toContain(step.status);
      expect(typeof step.progress).toBe("number");
    }
  });

  it("查询不存在的任务应返回 404", async () => {
    const res = await request(app)
      .get("/api/v1/ai/pipeline/aipt-not-exist-999")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("编排执行推进：启动后短时间内任务应进入 running 且步骤数不变（不阻塞请求）", async () => {
    const createRes = await request(app)
      .post("/api/v1/ai/pipeline")
      .set("Authorization", `Bearer ${token}`)
      .send({ equipmentId: "eq-103", problemDescription: "电机绕组温升异常，电流波动明显" });
    const taskId = createRes.body.taskId;

    // 等待编排异步推进（AI 调用耗时不确定，仅验证结构稳定与状态机合法）
    await new Promise((r) => setTimeout(r, 2500));

    const res = await request(app)
      .get(`/api/v1/ai/pipeline/${taskId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(["running", "completed", "failed"]).toContain(res.body.task.status);
    expect(res.body.task.progress).toBeGreaterThanOrEqual(0);
    expect(res.body.task.steps.length).toBe(4);
  });

  it("查询协同任务列表：返回 tasks 数组且包含必要字段及 limit 限制", async () => {
    const listRes = await request(app)
      .get("/api/v1/ai/pipeline?limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(Array.isArray(listRes.body.tasks)).toBe(true);
    expect(listRes.body.tasks.length).toBeLessThanOrEqual(2);

    if (listRes.body.tasks.length > 0) {
      const item = listRes.body.tasks[0];
      expect(typeof item.id).toBe("string");
      expect(typeof item.scene).toBe("string");
      expect(typeof item.status).toBe("string");
      expect(typeof item.progress).toBe("number");
      expect(typeof item.equipmentName).toBe("string");
      expect(typeof item.problemDescription).toBe("string");
      expect(item.createdAt).toBeDefined();
    }
  });
});
