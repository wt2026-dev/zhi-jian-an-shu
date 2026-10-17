import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { SafetyPermitRepository } from "../src/db/repositories/index.ts";

// 种子数据必须能直接走通联锁链路：演示设备上未结案的种子作业票
// 不得因为「有效期已过 / 会签身份不可区分 / 锁未登记」让开工一律被拦。
let app: any;
let adminToken: string;
let techToken: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  adminToken = (await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "Admin@2026#Demo" })).body.token;
  techToken = (await request(app).post("/api/v1/auth/login").send({ username: "tech1", password: "Tech1@2026#Work" })).body.token;
  expect(adminToken).toBeTruthy();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("种子作业票联锁可用性 (Seed Permits Under Interlock)", () => {
  it("种子 approved/active 作业票的有效期被滚动刷新，全部满足双人会签与有效期要求", async () => {
    const permits = await SafetyPermitRepository.getAll();
    const live = permits.filter((p: any) => ["approved", "active"].includes(p.status));
    expect(live.length, "种子库应存在未结案作业票").toBeGreaterThan(0);

    const now = Date.now();
    for (const p of live) {
      const expiry = Date.parse(String(p.validUntil).replace(/\//g, "-"));
      expect(Number.isFinite(expiry), `作业票 ${p.permitNo} 有效期必须可解析: ${p.validUntil}`).toBe(true);
      expect(expiry, `作业票 ${p.permitNo} 已过期: ${p.validUntil}`).toBeGreaterThan(now);
      const g = p.guardianApproval || {};
      const s = p.supervisorApproval || {};
      expect(g.signed && s.signed, `作业票 ${p.permitNo} 必须双人会签`).toBe(true);
      if (g.userId && s.userId) {
        expect(g.userId, `作业票 ${p.permitNo} 会签不得同人`).not.toBe(s.userId);
      } else {
        expect(g.name && s.name && g.name !== s.name, `作业票 ${p.permitNo} 历史会签身份必须可区分`).toBe(true);
      }
    }
  });

  it("带生效种子作业票且无 LOTO 声明的设备，派单后可直接开工（eq-116 → SP-20260904-03）", async () => {
    const order = (
      await request(app).post("/api/v1/work-orders").set(auth(adminToken)).send({
        title: "种子联锁可用性工单",
        equipmentId: "eq-116",
        faultType: "机械振动",
        priority: "medium",
        description: "验证种子作业票满足联锁前置条件",
      })
    ).body;
    expect(order.id).toBeTruthy();

    const dispatch = await request(app).post(`/api/v1/work-orders/${order.id}/dispatch`).set(auth(adminToken)).send({ assigneeId: "u-tech1", assigneeName: "张建国" });
    expect(dispatch.status).toBe(200);

    const claim = await request(app).post(`/api/v1/work-orders/${order.id}/claim`).set(auth(techToken)).send({});
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
    expect(claim.body.status).toBe("in_progress");
  });
});
