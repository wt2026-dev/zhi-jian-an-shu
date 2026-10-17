import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { EquipmentRepository } from "../src/db/repositories/index.ts";

// 端到端安全联锁回归：工单开工/验收必须被「作业票双人会签 + LOTO 锁登记/释放 + 票据注销」硬性约束。
// 全程走真实 HTTP 接口与真实内存 PGlite（含种子），不 mock 仓库。
let app: any;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  for (const [key, username, password] of [
    ["admin", "admin", "Admin@2026#Demo"],
    ["manager", "manager", "Manager@2026#Safe"],
    ["tech", "tech1", "Tech1@2026#Work"],
    ["inspector", "inspector", "Inspect@2026#Check"],
  ] as const) {
    const res = await request(app).post("/api/v1/auth/login").send({ username, password });
    tokens[key] = res.body.token;
    expect(tokens[key], `登录 ${key} 失败`).toBeTruthy();
  }
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("工单安全联锁端到端 (Safety Interlock E2E)", () => {
  it("无票开工被拦 → 会签生效+锁登记后可开工 → 票未注销验收被拦 → 释放锁+注销票后归档，健康分不被改写", async () => {
    const eq = (
      await request(app).post("/api/v1/equipments").set(auth(tokens.admin)).send({
        code: `EQ-INTERLOCK-${Date.now()}`,
        name: "联锁测试设备",
        category: "泵类设备",
        workshop: "动力一车间",
      })
    ).body;

    const order = (
      await request(app).post("/api/v1/work-orders").set(auth(tokens.admin)).send({
        title: "联锁链路测试工单",
        equipmentId: eq.id,
        faultType: "机械振动",
        priority: "high",
        description: "验证安全联锁全链路",
      })
    ).body;

    await request(app).post(`/api/v1/work-orders/${order.id}/dispatch`).set(auth(tokens.admin)).send({ assigneeId: "u-tech", assigneeName: "张建国" });

    // 1) 无作业票 → 接单开工被联锁拦截
    const claimBlocked = await request(app).post(`/api/v1/work-orders/${order.id}/claim`).set(auth(tokens.tech)).send({});
    expect(claimBlocked.status).toBe(409);
    expect(claimBlocked.body.code).toBe("SAFETY_INTERLOCK_BLOCKED");

    // 2) 办票（声明 LOTO 锁号），监护 + 主管双人会签
    const permit = (
      await request(app).post("/api/v1/safety-permits").set(auth(tokens.inspector)).send({
        title: "联锁测试作业票",
        permitType: "LOTO停电挂牌作业票",
        equipmentId: eq.id,
        workshop: "动力一车间",
        validUntil: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
        lotoNumber: "LOTO-E2E-001",
      })
    ).body;
    expect(permit.status).toBe("pending_approval");

    const guardian = await request(app).post(`/api/v1/safety-permits/${permit.id}/approve`).set(auth(tokens.inspector)).send({ step: "guardian", pass: true });
    expect(guardian.status).toBe(200);
    const supervisor = await request(app).post(`/api/v1/safety-permits/${permit.id}/approve`).set(auth(tokens.manager)).send({ step: "supervisor", pass: true });
    expect(supervisor.status).toBe(200);
    expect(supervisor.body.status).toBe("approved");

    const sameSignerPermit = (await request(app).post("/api/v1/safety-permits").set(auth(tokens.admin)).send({ title: "同人会签拦截测试" })).body;
    await request(app).post(`/api/v1/safety-permits/${sameSignerPermit.id}/approve`).set(auth(tokens.admin)).send({ step: "guardian" });
    const sameSigner = await request(app).post(`/api/v1/safety-permits/${sameSignerPermit.id}/approve`).set(auth(tokens.admin)).send({ step: "supervisor" });
    expect(sameSigner.status).toBe(409);

    // 2.1) 票生效但锁未登记 → 仍禁止开工
    const claimNoLock = await request(app).post(`/api/v1/work-orders/${order.id}/claim`).set(auth(tokens.tech)).send({});
    expect(claimNoLock.status).toBe(409);
    expect(claimNoLock.body.code).toBe("SAFETY_INTERLOCK_BLOCKED");

    // 3) 登记隔离锁并关联作业票 → 开工放行
    const lock = (
      await request(app).post("/api/v1/loto-locks").set(auth(tokens.inspector)).send({
        lockNo: "LOTO-E2E-001",
        permitNo: permit.permitNo,
        pointName: "联锁测试隔离点",
        lockedBy: "李志强 (电气专工)",
      })
    ).body;
    expect(lock.status).toBe("locked");

    const claimOk = await request(app).post(`/api/v1/work-orders/${order.id}/claim`).set(auth(tokens.tech)).send({});
    expect(claimOk.status).toBe(200);
    expect(claimOk.body.status).toBe("in_progress");

    const earlyRelease = await request(app).post(`/api/v1/loto-locks/${lock.id}/release`).set(auth(tokens.inspector)).send({ unlockRemark: "提前释放" });
    expect(earlyRelease.status).toBe(409);
    const deleteActive = await request(app).delete(`/api/v1/safety-permits/${permit.id}`).set(auth(tokens.admin));
    expect(deleteActive.status).toBe(409);
    const duplicateLock = await request(app).post("/api/v1/loto-locks").set(auth(tokens.inspector)).send({ lockNo: lock.lockNo, permitNo: permit.permitNo, pointName: "重复点位" });
    expect(duplicateLock.status).toBe(409);
    const noEvidence = await request(app).post(`/api/v1/loto-locks/${lock.id}/release`).set(auth(tokens.inspector)).send({ unlockRemark: "  " });
    expect(noEvidence.status).toBe(400);

    // 通用状态接口不得绕过专用流程直达完工态
    const bypass = await request(app).patch(`/api/v1/work-orders/${order.id}/status`).set(auth(tokens.admin)).send({ targetStatus: "pending_acceptance" });
    expect(bypass.status).toBe(400);
    expect(bypass.body.code).toBe("DEDICATED_WORKFLOW_REQUIRED");

    const complete = await request(app).post(`/api/v1/work-orders/${order.id}/complete`).set(auth(tokens.tech)).send({
      causeAnalysis: "轴承磨损",
      resolutionSteps: "更换轴承并重新对中",
      workHours: 3,
    });
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
    expect(complete.body.status).toBe("pending_acceptance");

    // 4) 作业票未注销 → 验收归档被拦截
    const eqBefore = await EquipmentRepository.getById(eq.id);
    const acceptBlocked = await request(app).post(`/api/v1/work-orders/${order.id}/accept`).set(auth(tokens.admin)).send({ pass: true, score: 5 });
    expect(acceptBlocked.status).toBe(409);
    expect(acceptBlocked.body.code).toBe("SAFETY_INTERLOCK_BLOCKED");
    expect((await EquipmentRepository.getById(eq.id)).healthScore).toBe(eqBefore.healthScore);

    // 5) 锁未登记释放说明时禁止注销作业票
    const closeBlocked = await request(app).post(`/api/v1/safety-permits/${permit.id}/close`).set(auth(tokens.inspector)).send({});
    expect(closeBlocked.status).toBe(409);
    expect(closeBlocked.body.code).toBe("SAFETY_INTERLOCK_BLOCKED");

    // 6) 释放锁（带释放人与说明）→ 注销作业票 → 验收归档成功
    const release = await request(app).post(`/api/v1/loto-locks/${lock.id}/release`).set(auth(tokens.inspector)).send({
      releasedBy: "李志强 (电气专工)",
      unlockRemark: "检修完毕，双人验电后恢复送电",
    });
    expect(release.status).toBe(200);
    expect(release.body.status).toBe("unlocked");

    const closed = await request(app).post(`/api/v1/safety-permits/${permit.id}/close`).set(auth(tokens.inspector)).send({ closeRemark: "工完料净场地清" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");

    const accept = await request(app).post(`/api/v1/work-orders/${order.id}/accept`).set(auth(tokens.admin)).send({ pass: true, score: 5 });
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("completed");

    // 7) 归档不得自动改写健康分（旧实现强制抬到 ≥94）
    const eqAfter = await EquipmentRepository.getById(eq.id);
    expect(eqAfter.healthScore).toBe(eqBefore.healthScore);
    expect(eqAfter.status).toBe(eqBefore.status);
  });
});
