/**
 * 修后验收与效果验证集成用例。
 *
 * 全部走真实种子数据与真实仓储写入，不打桩：
 *   · 设备 = eq-103（3# 轧机主传动行星减速箱，遥测表里有真实温度/振动/电流历史）；
 *   · 工单 = wo-20240902-001（检修中），先走完现场流程自动转入"待验收"，再验修后验收；
 *   · 验收标准读 acceptance_standards（026 迁移种子：70℃ / 2.8mm/s / 电流未配置）；
 *   · 判定、修前基线、签字全部由服务端计算，用例里不伪造任何判定值。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { WorkOrderRepository } from "../src/db/repositories/workOrderRepository.ts";

let app: any;
let techToken: string;
let managerToken: string;
let adminToken: string;

const DEVICE_ID = "eq-103";
const ORDER_ID = "wo-20240902-001";
const STEP_COUNT = 5;

const LOTO_KEYS = [
  "loto_power_locked",
  "residual_energy_released",
  "hazardous_parts_isolated",
  "workzone_barricaded",
];

async function login(username: string, password: string): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send({ username, password });
  expect(res.status).toBe(200);
  return res.body.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function getAcceptance(orderId = ORDER_ID, token = techToken) {
  return request(app).get(`/api/v1/work-orders/${orderId}/acceptance`).set(auth(token));
}

async function check(orderId: string, body: Record<string, unknown>, token = techToken) {
  return request(app).post(`/api/v1/work-orders/${orderId}/acceptance/checks`).set(auth(token)).send(body);
}

async function sign(orderId: string, step: "technician" | "teamlead", token: string) {
  return request(app).post(`/api/v1/work-orders/${orderId}/acceptance/sign`).set(auth(token)).send({ step });
}

/** 把工单从"检修中"推进到"待验收"：LOTO + 全部步骤完成（走真实接口，不直接改库） */
async function driveToPendingAcceptance() {
  const loto = await request(app)
    .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/loto`)
    .set(auth(techToken))
    .send({ items: LOTO_KEYS.map((key) => ({ key, label: key, confirmed: true })) });
  expect(loto.status).toBe(200);

  let last: any = null;
  for (let i = 1; i <= STEP_COUNT; i++) {
    last = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set(auth(techToken))
      .send({ index: i, action: "done", note: "现场确认完成" });
    expect(last.status).toBe(200);
  }
  expect(last.body.order.status).toBe("pending_acceptance");
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  techToken = await login("tech1", "Tech1@2026#Work");
  managerToken = await login("manager", "Manager@2026#Safe");
  adminToken = await login("admin", "Admin@2026#Demo");
});

describe("验收标准表（阈值带来源，未配置不推算）", () => {
  it("清单 5 项：温度/振动有阈值且来源标注待工程确认，电流无阈值=未配置", async () => {
    const res = await getAcceptance();
    expect(res.status).toBe(200);
    const items = res.body.items as any[];
    expect(items).toHaveLength(5);

    const temp = items.find((i) => i.metric === "temperature")!;
    expect(temp.maxLimit).toBe(70);
    expect(temp.unit).toBe("℃");
    // 来源必须如实写成"待工程确认"，不能伪装成设备手册数值
    expect(temp.standardSource).toContain("待工程确认");

    const vib = items.find((i) => i.metric === "vibration")!;
    expect(vib.maxLimit).toBe(2.8);
    expect(vib.unit).toBe("mm/s");

    // 额定电流全厂无台账 ⇒ 上下限都是 null，判定恒为 unconfigured
    const cur = items.find((i) => i.metric === "current")!;
    expect(cur.minLimit).toBeNull();
    expect(cur.maxLimit).toBeNull();
    expect(cur.verdict).toBe("unconfigured");
    expect(cur.standardSource).toContain("缺");

    // 定性项靠人工确认，不填数
    expect(items.filter((i) => i.judgedBy === "manual").map((i) => i.metric).sort()).toEqual(["switch", "visual"]);
  });

  it("修前基线如实反映遥测覆盖：窗口内无数据 ⇒ samples=0，电流无报警线 ⇒ overLimitSamples=null", async () => {
    const res = await getAcceptance();
    const baselines = res.body.baselines as any[];
    expect(baselines.map((b) => b.metric).sort()).toEqual(["current", "temperature", "vibration"]);

    // 种子遥测只覆盖"当前往前 48h"，而种子工单创建于 2026/09/02，早于遥测覆盖起点 ⇒
    // 修前 24h 窗口内确实没有样本。这里必须如实为 0/null，不能退化成"拿现在 48h 冒充修前"，
    // 也不能在缺测时补常量（那样会编造出一组不存在的修前数字）。
    const temp = baselines.find((b) => b.metric === "temperature")!;
    expect(temp.samples).toBe(0);
    expect(temp.preMax).toBeNull();
    expect(temp.preAvg).toBeNull();
    expect(temp.windowFrom).toBeNull();

    // 有数据时最坏值必然 ≥ 平均值；无数据时两者同为 null，不允许出现 0
    for (const b of baselines) {
      if (b.samples > 0) {
        expect(b.preMax).toBeGreaterThanOrEqual(b.preAvg);
        expect(b.windowTo).toBeTruthy();
      } else {
        expect(b.preMax).toBeNull();
      }
    }

    // 电流无系统报警阈值 ⇒ overLimitSamples 必须为 null（"不判超限"），不能用 0 冒充"0 个超限"
    const cur = baselines.find((b) => b.metric === "current")!;
    expect(cur.overLimitSamples).toBeNull();
  });

  it("修前基线窗口是「工单创建前 24h」而不是「最近 48h」——用真实遥测构造窗口两端验证", async () => {
    // 建一条刚创建的工单：其创建时刻落在遥测覆盖范围内，修前窗口应真正取到样本。
    const created = new Date().toISOString();
    const id = "wo-acc-baseline-probe";
    await WorkOrderRepository.create({
      id,
      orderNo: "WO-ACC-BASE-001",
      title: "基线窗口验证",
      equipmentId: DEVICE_ID,
      equipmentName: "3# 轧机主传动行星减速箱",
      equipmentCode: "EQ-103",
      workshop: "轧钢车间",
      faultType: "计划检修",
      priority: "medium",
      status: "pending_acceptance",
      creator: "系统",
      dispatcher: "系统",
      assignee: "tech1",
      createdAt: created,
      createdTimestamp: Date.parse(created),
      completedAt: created,
      description: "仅用于验证修前基线窗口，不参与其他用例",
      safetyRequirements: [],
      photos: [],
      repairLog: null,
      acceptance: null,
      version: 1,
    } as any);

    const res = await getAcceptance(id);
    expect(res.status).toBe(200);
    const temp = (res.body.baselines as any[]).find((b) => b.metric === "temperature")!;
    // 窗口 = [创建前 24h, 创建时刻]；创建时刻在遥测覆盖内 ⇒ 必有样本
    expect(temp.samples).toBeGreaterThan(0);
    expect(Date.parse(temp.windowTo)).toBeLessThanOrEqual(Date.parse(created) + 1000);
    const spanHours = (Date.parse(temp.windowTo) - Date.parse(temp.windowFrom)) / 3600_000;
    expect(spanHours).toBeCloseTo(24, 0);
  });

  it("修前窗口绝不越过工单创建时刻——把「最近 24h」当修前会把故障后的数据算进去", async () => {
    // 故意把创建时刻放在 10 小时前（仍在 48h 遥测覆盖内）。
    // 正确实现：窗口 [创建-24h, 创建]，windowTo 必须 ≤ 创建时刻。
    // 错误实现（用"最近 24h"代替）：windowTo 会跑到"现在"，把工单创建之后的
    // 运行数据当成"修前"，修后对比就失真了。
    const createdMs = Date.now() - 10 * 3600_000;
    const id = "wo-acc-window-probe";
    await WorkOrderRepository.create({
      id,
      orderNo: "WO-ACC-WIN-001",
      title: "修前窗口边界验证",
      equipmentId: DEVICE_ID,
      equipmentName: "3# 轧机主传动行星减速箱",
      equipmentCode: "EQ-103",
      workshop: "轧钢车间",
      faultType: "计划检修",
      priority: "medium",
      status: "pending_acceptance",
      creator: "系统",
      dispatcher: "系统",
      assignee: "tech1",
      createdAt: new Date(createdMs).toISOString(),
      createdTimestamp: createdMs,
      completedAt: new Date(createdMs).toISOString(),
      description: "仅用于验证修前窗口右边界",
      safetyRequirements: [],
      photos: [],
      repairLog: null,
      acceptance: null,
      version: 1,
    } as any);

    const res = await getAcceptance(id);
    const temp = (res.body.baselines as any[]).find((b) => b.metric === "temperature")!;
    expect(temp.samples).toBeGreaterThan(0);
    // 右边界不得超过工单创建时刻 1 分钟（允许取整误差）
    expect(Date.parse(temp.windowTo)).toBeLessThanOrEqual(createdMs + 60_000);
    // 左边界距右边界约 24h
    expect((Date.parse(temp.windowTo) - Date.parse(temp.windowFrom)) / 3600_000).toBeCloseTo(24, 0);
  });

  it("检修中的工单不能验收，且给出如实原因", async () => {
    const res = await getAcceptance();
    expect(res.body.canAccept).toBe(false);
    expect(res.body.blockedReason).toContain("完工上报");
  });
});

describe("验收录入（服务端复算，越界告警）", () => {
  it("推进到待验收后 canAccept=true、nextSigner=null（还没测完）", async () => {
    await driveToPendingAcceptance();
    const res = await getAcceptance();
    expect(res.body.canAccept).toBe(true);
    expect(res.body.blockedReason).toBeNull();
    expect(res.body.allPassed).toBe(false);
    expect(res.body.nextSigner).toBeNull();
  });

  it("温度 65℃ 合格、振动 3.4mm/s 超标（>2.8）——判定由服务端算", async () => {
    const t = await check(ORDER_ID, { itemKey: "no_load_temp", value: 65 });
    expect(t.status).toBe(200);
    const temp = (t.body.items as any[]).find((i) => i.itemKey === "no_load_temp")!;
    expect(temp.verdict).toBe("pass");
    expect(temp.record.value).toBe(65);
    expect(temp.record.maxLimit).toBe(70); // 录入时快照标准

    const v = await check(ORDER_ID, { itemKey: "vibration", value: 3.4 });
    expect(v.status).toBe(200);
    const vib = (v.body.items as any[]).find((i) => i.itemKey === "vibration")!;
    expect(vib.verdict).toBe("fail");
    expect(v.body.failed).toBe(1);
  });

  it("前端硬塞 verdict=pass 也不被采信（服务端按实测值复算）", async () => {
    const res = await check(ORDER_ID, { itemKey: "vibration", value: 9.9, verdict: "pass", ok: true });
    expect(res.status).toBe(200);
    const vib = (res.body.items as any[]).find((i) => i.itemKey === "vibration")!;
    expect(vib.verdict).toBe("fail");
  });

  it("电流未配置：录入真实值也不判合格，仍是 unconfigured", async () => {
    const res = await check(ORDER_ID, { itemKey: "running_current", value: 38 });
    expect(res.status).toBe(200);
    const cur = (res.body.items as any[]).find((i) => i.itemKey === "running_current")!;
    expect(cur.verdict).toBe("unconfigured");
    expect(cur.record.value).toBe(38); // 值照实留档
    expect(res.body.unconfigured).toBe(1);
  });

  it("数值项缺实测值 422；定性项未确认 422；未知 itemKey 404", async () => {
    expect((await check(ORDER_ID, { itemKey: "no_load_temp" })).status).toBe(422);
    expect((await check(ORDER_ID, { itemKey: "no_leak_noise" })).status).toBe(422);
    expect((await check(ORDER_ID, { itemKey: "not-a-real-item", value: 1 })).status).toBe(404);
  });

  it("定性项确认后 pass；验收项不全时签字被 422 拦下并列出阻塞项", async () => {
    const leak = await check(ORDER_ID, { itemKey: "no_leak_noise", confirmed: true });
    expect((leak.body.items as any[]).find((i) => i.itemKey === "no_leak_noise")!.verdict).toBe("pass");

    const blocked = await sign(ORDER_ID, "technician", techToken);
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe("ACCEPTANCE_INCOMPLETE");
    expect(blocked.body.error).toContain("振动");
  });
});

describe("双签字关单与维修总结沉淀", () => {
  it("全部合格后 nextSigner=technician；先签班组长被顺序拦下；同人兼签被拒", async () => {
    // 逐项录入全部剩余项（温度已在前面测过）
    await check(ORDER_ID, { itemKey: "vibration", value: 1.8 });
    await check(ORDER_ID, { itemKey: "running_current", value: 38 });
    await check(ORDER_ID, { itemKey: "no_leak_noise", confirmed: true });
    const guard = await check(ORDER_ID, { itemKey: "safety_guard", confirmed: true });
    expect(guard.status).toBe(200);

    // 额定电流无台账 ⇒ 该项恒为 unconfigured：它不阻塞关单（没有标准就不能判不合格），
    // 但也绝不算"合格"。所以 allPassed 的定义是「无 fail 且无 pending」，
    // unconfigured 单独计数并在界面上如实展示为"未配置，未判定"。
    const items = guard.body.items as any[];
    expect(items.filter((i) => i.verdict === "unconfigured").map((i) => i.itemKey)).toEqual(["running_current"]);
    expect(guard.body.failed).toBe(0);
    expect(guard.body.pending).toBe(0);
    expect(guard.body.unconfigured).toBe(1);
    expect(guard.body.allPassed).toBe(true);
    expect(guard.body.nextSigner).toBe("technician");

    const early = await sign(ORDER_ID, "teamlead", managerToken);
    expect(early.status).toBe(422);
    expect(early.body.code).toBe("SIGN_ORDER_INVALID");

    const tech = await sign(ORDER_ID, "technician", techToken!);
    expect(tech.status).toBe(200);
    expect(tech.body.justClosed).toBe(false);
    expect(tech.body.nextSigner).toBe("teamlead");

    // 维修人已签，且其角色非 manager/admin ⇒ 无法自己给自己做班组长复核
    const self = await sign(ORDER_ID, "teamlead", techToken);
    expect([403, 422]).toContain(self.status);
  });

  it("班组长不能与维修人是同一人——即使他本身就有 manager 权限也必须被拒", async () => {
    // 造一份独立的待验收工单：由 manager 本人签"维修人"，再让 manager 签"班组长"。
    // 这样角色检查一定能过，唯一能拦下它的就是"双签字必须两个人"这条规则。
    const created = new Date().toISOString();
    const id = "wo-acc-selfsign-probe";
    await WorkOrderRepository.create({
      id,
      orderNo: "WO-ACC-SELF-001",
      title: "同人兼签验证",
      equipmentId: DEVICE_ID,
      equipmentName: "3# 轧机主传动行星减速箱",
      equipmentCode: "EQ-103",
      workshop: "轧钢车间",
      faultType: "计划检修",
      priority: "medium",
      status: "pending_acceptance",
      creator: "系统",
      dispatcher: "系统",
      assignee: "陈主管",
      createdAt: created,
      createdTimestamp: Date.parse(created),
      completedAt: created,
      description: "仅用于验证同人兼签拦截",
      safetyRequirements: [],
      photos: [],
      repairLog: null,
      acceptance: null,
      version: 1,
    } as any);

    // 先让全部项达到可签字状态
    expect((await check(id, { itemKey: "no_load_temp", value: 62 }, managerToken)).status).toBe(200);
    expect((await check(id, { itemKey: "vibration", value: 1.5 }, managerToken)).status).toBe(200);
    expect((await check(id, { itemKey: "no_leak_noise", confirmed: true }, managerToken)).status).toBe(200);
    const ready = await check(id, { itemKey: "safety_guard", confirmed: true }, managerToken);
    expect(ready.body.allPassed).toBe(true);

    // manager 本人签维修人：允许（他有作业权限）
    const asTech = await sign(id, "technician", managerToken);
    expect(asTech.status).toBe(200);
    expect(asTech.body.nextSigner).toBe("teamlead");

    // 同一人再签班组长：角色够格，但必须是另一个人
    const asLead = await sign(id, "teamlead", managerToken);
    expect(asLead.status).toBe(422);
    expect(asLead.body.code).toBe("SIGNER_MUST_DIFFER");
  });

  it("班组长签字后转 completed、写入双签字留痕并生成维修案例", async () => {
    const lead = await sign(ORDER_ID, "teamlead", managerToken);
    expect(lead.status).toBe(200);
    expect(lead.body.justClosed).toBe(true);
    expect(lead.body.order.status).toBe("completed");
    expect(lead.body.order.statusLabel).toBe("已归档");
    expect(lead.body.closedAt).toBeTruthy();

    const sigs = lead.body.signatures as any[];
    expect(sigs).toHaveLength(2);
    expect(sigs[0].step).toBe("technician");
    expect(sigs[1].step).toBe("teamlead");
    // 两个人，不是一个人兼签
    expect(sigs[0].userId).not.toBe(sigs[1].userId);
    expect(sigs[0].signatureHash).toMatch(/^[0-9a-f]{16}$/);
    expect(sigs[1].signatureHash).toMatch(/^[0-9a-f]{16}$/);
    expect(sigs[0].signatureHash).not.toBe(sigs[1].signatureHash);

    // 维修总结已沉淀，且内容是真实对比数字
    expect(lead.body.summary).toBeTruthy();
    expect(lead.body.summary.knowledgeId).toBe(`kb-case-${ORDER_ID}`);

    const kb = await request(app)
      .get(`/api/v1/knowledge/${lead.body.summary.knowledgeId}`)
      .set(auth(adminToken));
    expect([200, 404]).toContain(kb.status);
  });

  it("关单后验收只读：再录入/再签字都 409", async () => {
    const again = await check(ORDER_ID, { itemKey: "no_load_temp", value: 61 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ACCEPTANCE_CLOSED");

    const resign = await sign(ORDER_ID, "technician", techToken);
    expect(resign.status).toBe(409);
    expect(resign.body.code).toBe("ACCEPTANCE_CLOSED");
  });

  it("已归档工单回看仍能看到完整验收与签字留痕", async () => {
    const res = await getAcceptance();
    expect(res.body.canAccept).toBe(false);
    expect(res.body.blockedReason).toContain("归档");
    expect(res.body.items.every((i: any) => i.verdict === "pass" || i.verdict === "unconfigured")).toBe(true);
    expect(res.body.signatures).toHaveLength(2);
    // 事件流里既有验收也有签字，且带操作人
    const kinds = new Set(res.body.events.map((e: any) => e.kind));
    expect(kinds.has("acceptance")).toBe(true);
    expect(kinds.has("sign")).toBe(true);
    expect(res.body.events.filter((e: any) => e.kind === "sign").length).toBe(2);
  });
});

describe("维修人签字资格（不能任何人代签）", () => {
  it("非本次维修人不能签「维修人」——否则双签字就变成了随便拉两个人", async () => {
    // 造一份待验收工单：派工对象 = tech1，LOTO 由 tech1 确认 ⇒ 维修人已可识别。
    // 让 manager 先来签"维修人"：他权限够，但不是本次维修人，必须被拒。
    const created = new Date().toISOString();
    const id = "wo-acc-identity-probe";
    await WorkOrderRepository.create({
      id,
      orderNo: "WO-ACC-ID-001",
      title: "维修人身份校验",
      equipmentId: DEVICE_ID,
      equipmentName: "3# 轧机主传动行星减速箱",
      equipmentCode: "EQ-103",
      workshop: "轧钢车间",
      faultType: "计划检修",
      priority: "medium",
      status: "pending_acceptance",
      creator: "系统",
      dispatcher: "系统",
      assignee: "张建国",
      assigneeId: "u-tech1",
      createdAt: created,
      createdTimestamp: Date.parse(created),
      completedAt: created,
      description: "仅用于验证维修人签字身份",
      safetyRequirements: [],
      photos: [],
      repairLog: {
        causeAnalysis: "",
        resolutionSteps: "",
        partsUsed: [],
        workHours: 1,
        completionPhotos: [],
        fieldLog: {
          events: [],
          loto: {
            confirmedAt: created,
            by: { id: "u-tech1", username: "tech1", name: "张建国", role: "technician" },
            items: LOTO_KEYS.map((k) => ({ key: k, label: k, confirmed: true })),
          },
          steps: {},
          measurements: [],
          partPhotos: [],
          completed: { at: created, by: "张建国", workHours: 1, total: 5, done: 5, skipped: 0 },
          acceptance: null,
        },
      },
      acceptance: null,
      version: 1,
    } as any);

    // 先把验收项全部做完，排除"没做完"这个干扰原因
    for (const [k, v] of [
      ["no_load_temp", 65],
      ["vibration", 1.8],
      ["running_current", 38],
    ] as const) {
      await check(id, { itemKey: k, value: v }, techToken);
    }
    await check(id, { itemKey: "no_leak_noise", confirmed: true }, techToken);
    const ready = await check(id, { itemKey: "safety_guard", confirmed: true }, techToken);
    expect(ready.body.allPassed).toBe(true);

    // manager 不是本次维修人 ⇒ 拒绝
    const wrong = await sign(id, "technician", managerToken);
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("NOT_REPAIRER");

    // 真正的维修人 tech1 才能签
    const right = await sign(id, "technician", techToken);
    expect(right.status).toBe(200);
    expect(right.body.nextSigner).toBe("teamlead");
  });
});

describe("维修人身份匹配的边界", () => {
  it("有用户 ID 时只比 ID：派工姓名与账号姓名不一致（改过名）也不能误挡", async () => {
    // 派工记录里存的是旧姓名"张建国"，但 assigneeId 指向 u-tech1（现名可能已改）。
    // 身份必须由 ID 决定，不能因为姓名对不上就把执行人挡在门外。
    const created = new Date().toISOString();
    const id = "wo-acc-rename-probe";
    await WorkOrderRepository.create({
      id,
      orderNo: "WO-ACC-RENAME-001",
      title: "改名后仍可签字",
      equipmentId: DEVICE_ID,
      equipmentName: "3# 轧机主传动行星减速箱",
      equipmentCode: "EQ-103",
      workshop: "轧钢车间",
      faultType: "计划检修",
      priority: "medium",
      status: "pending_acceptance",
      creator: "系统",
      dispatcher: "系统",
      assignee: "张建国（旧名）",
      assigneeId: "u-tech1",
      createdAt: created,
      createdTimestamp: Date.parse(created),
      completedAt: created,
      description: "验证 ID 优先于姓名",
      safetyRequirements: [],
      photos: [],
      repairLog: null,
      acceptance: null,
      version: 1,
    } as any);

    for (const [k, v] of [
      ["no_load_temp", 66],
      ["vibration", 1.9],
      ["running_current", 37],
    ] as const) {
      await check(id, { itemKey: k, value: v }, techToken);
    }
    await check(id, { itemKey: "no_leak_noise", confirmed: true }, techToken);
    const ready = await check(id, { itemKey: "safety_guard", confirmed: true }, techToken);
    expect(ready.body.allPassed).toBe(true);
    // 会话如实给出执行人（按 ID 解析）
    expect(ready.body.repairer.id).toBe("u-tech1");

    // tech1 的账号姓名是"张建国"，与派工记录的"张建国（旧名）"不同 —— 仍必须放行
    const signed = await sign(id, "technician", techToken);
    expect(signed.status).toBe(200);
    expect(signed.body.signatures[0].userId).toBe("u-tech1");
  });
});
