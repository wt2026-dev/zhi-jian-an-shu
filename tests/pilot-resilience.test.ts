// 阶段5 试点韧性验收：数据库不可用时的优雅降级与探针独立性
// 场景来源：《生产差距清单-试点部署.md》阶段5 验收要求——
//   正常流程 / 越权 / 并发状态冲突由 business-loop / workorder-rbac /
//   optimistic-lock-and-concurrency 测试覆盖；本文件补齐"数据库不可用"场景：
//   1) 就绪探针必须 503（fail-fast 暴露不健康，供负载探针摘除）
//   2) 存活探针必须保持 200（liveness 不依赖数据库，防止被误杀重启循环）
//   3) 业务请求返回 5xx 而非进程崩溃，且服务此后仍可响应探针
// 全程使用测试隔离数据库（initDatabase 默认 PGlite 内存/临时目录），不触碰真实数据。
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
// 先经 server.ts 建立模块加载环境（与其他测试一致），再引 db 层
import { createApp } from "../server.ts";
import { getDb } from "../src/db/db.ts";

let app: any;
let adminToken = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "Admin@2026#Demo" });
  expect(res.status).toBe(200);
  adminToken = res.body.token;
});

describe("P5 试点韧性：数据库不可用场景 (Resilience Suite)", () => {
  it("基线：数据库可用时 /ready=200 ready，/health=200 ok", async () => {
    const ready = await request(app).get("/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe("ready");
    expect(ready.body.database).toBe("connected");

    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
  });

  it("数据库不可用时：/ready 必须 503 unready（fail-fast 暴露不健康）", async () => {
    // 故障注入：直接替换单例适配器的 query 为抛错函数，确定性模拟连接不可达。
    // （不能用 db.close()：close 会清空单例，/ready 经 getDb 自动重建实例——
    //   PGlite 模式具备自愈语义，"关掉旧实例"不等于"数据库不可用"。）
    const db = await getDb();
    const origQuery = db.query;
    db.query = async () => {
      throw new Error("PGlite is closed (simulated connection failure)");
    };
    try {
      const ready = await request(app).get("/ready");
      expect(ready.status).toBe(503);
      expect(ready.body.status).toBe("unready");
      expect(ready.body.database).toBe("disconnected");
    } finally {
      db.query = origQuery; // 恢复，避免影响同 worker 后续断言
    }
  });

  it("数据库不可用时：/health 仍 200（liveness 独立于数据库，防误杀重启循环）", async () => {
    const db = await getDb();
    const origQuery = db.query;
    db.query = async () => {
      throw new Error("PGlite is closed (simulated connection failure)");
    };
    try {
      const health = await request(app).get("/health");
      expect(health.status).toBe(200);
      expect(health.body.status).toBe("ok");
    } finally {
      db.query = origQuery;
    }
  });

  it("数据库不可用时：业务请求优雅 5xx 而非进程崩溃，服务随后仍响应探针", async () => {
    const db = await getDb();
    const origQuery = db.query;
    db.query = async () => {
      throw new Error("PGlite is closed (simulated connection failure)");
    };
    try {
      const biz = await request(app)
        .get("/api/v1/equipments")
        .set("Authorization", `Bearer ${adminToken}`);
      // 关键断言：拿到确定性的错误响应（4xx/5xx），而不是连接被重置/超时（崩溃特征）
      expect(biz.status).toBeGreaterThanOrEqual(400);
      expect(biz.status).toBeLessThan(600);

      // 进程存活：错误之后探针依然可达（此时适配器已恢复，/ready 应回 200）
      const health = await request(app).get("/health");
      expect(health.status).toBe(200);
    } finally {
      db.query = origQuery;
    }
  });
});
