/**
 * Hermes 业务闭环后端集成用例（node 环境：真实 Express + 真实 PGlite，无任何 Mock）
 *
 * 钉死的口径：
 * 1. 创建即落库——闭环 1 行 + 环节 6 行 + 产出物 8 行（全部 pending，禁止预造假单据）；
 * 2. 设备只认台账——示例目标文本必须命中 seed 里的 eq-102，禁止命中不存在的「3号空压机」；
 * 3. 人工闸门不可绕过——越序确认 409、LOTO 未满 100% 确认 400、环节未走完就归档 400；
 * 4. 环节确认落成真实业务记录——work_orders / safety_permits 真的多一行，产出物 code 就是那行的 id；
 * 5. AI 降级如实呈现——测试环境凭据被置空（vitest.config.ts env），环节 1/2/4 必为 degraded 且带真实原因，
 *    不允许出现假成功；环节 3 走规则，JSA 没输出隔离点时清单为空并如实拒绝确认。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import {
  BusinessLoopRepository,
  WorkOrderRepository,
  SafetyPermitRepository,
  AuditLogRepository,
} from "../src/db/repositories/index.ts";
import { getDb } from "../src/db/db.ts";
import { joinClauses } from "../src/server/services/businessLoopService.ts";

const GOAL = "2#无油螺杆空压机主机振动偏高，走检修流程";

let app: any;
let managerToken = "";
let inspectorToken = "";
const loop = { id: "", code: "", permitNo: "" };

async function login(username: string, password: string): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send({ username, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** 取详情（GET /:id 是前端唯一的预填回看通道） */
async function getDetail(loopId: string, token = managerToken) {
  return request(app).get(`/api/v1/business-loops/${loopId}`).set(bearer(token));
}

/** 环节 1-4 的 AI 预填是 fire-and-forget，轮询 GET 直到全部回写 outcome */
async function waitPrefill(loopId: string, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await getDetail(loopId);
    const prefillStages = res.body.stages.filter((s: any) => s.order <= 4);
    if (prefillStages.every((s: any) => s.aiPrefill?.status)) return res.body;
    if (Date.now() > deadline) throw new Error("环节 1-4 的 AI 预填超时未回写");
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function confirm(loopId: string, stageNo: number, token = managerToken) {
  return request(app)
    .post(`/api/v1/business-loops/${loopId}/stages/${stageNo}/confirm`)
    .set(bearer(token))
    .send({});
}

async function toggleLoto(loopId: string, itemId: string, confirmed: boolean, token = managerToken) {
  return request(app)
    .patch(`/api/v1/business-loops/${loopId}/loto-confirm`)
    .set(bearer(token))
    .send({ itemId, confirmed });
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  managerToken = await login("manager", "Manager@2026#Safe");
  inspectorToken = await login("inspector", "Inspect@2026#Check");
});

describe("Hermes 业务闭环 - 鉴权与入参", () => {
  it("未登录创建 / 查询均 401（全局鉴权基线兜底）", async () => {
    const create = await request(app).post("/api/v1/business-loops").send({ goal: GOAL });
    expect(create.status).toBe(401);
    expect(create.body.code).toBe("UNAUTHORIZED");

    const list = await request(app).get("/api/v1/business-loops");
    expect(list.status).toBe(401);
  });

  it("点检工程师（inspector）创建闭环 403：写操作限 admin/manager/technician", async () => {
    const res = await request(app)
      .post("/api/v1/business-loops")
      .set(bearer(inspectorToken))
      .send({ goal: GOAL });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RBAC_PERMISSION_DENIED");
    expect(res.body.requiredRoles).toEqual(["admin", "manager", "technician"]);
  });

  it("goal 少于 4 字 → 400 INVALID_INPUT，不建任何闭环", async () => {
    const before = await request(app).get("/api/v1/business-loops?status=running").set(bearer(managerToken));
    const res = await request(app).post("/api/v1/business-loops").set(bearer(managerToken)).send({ goal: "修泵" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
    const after = await request(app).get("/api/v1/business-loops?status=running").set(bearer(managerToken));
    expect(after.body.length).toBe(before.body.length);
  });

  it("环节编号越界（stageNo=7）在参数校验层就被 400 拒绝", async () => {
    const res = await confirm("bl-whatever", 7);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("查询不存在的闭环 → 404 LOOP_NOT_FOUND", async () => {
    const res = await getDetail("bl-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("LOOP_NOT_FOUND");
  });
});

describe("Hermes 业务闭环 - 创建与落库结构", () => {
  it("POST 202：1 条闭环 + 6 环节 + 8 项 pending 产出物真实落库", async () => {
    const res = await request(app).post("/api/v1/business-loops").set(bearer(managerToken)).send({ goal: GOAL });
    expect(res.status).toBe(202);
    loop.id = res.body.id;
    loop.code = res.body.loopCode;

    expect(loop.code).toMatch(/^PL-\d{8}-\d{3}$/);
    expect(res.body.status).toBe("running");
    expect(res.body.businessGoal).toBe(GOAL);
    expect(res.body.initiator.name).toBe("陈主管");
    expect(res.body.progress).toMatchObject({ currentStageOrder: 1, totalStages: 6 });

    expect(res.body.stages.map((s: any) => s.id)).toEqual([
      "stage_report",
      "stage_permit",
      "stage_loto",
      "stage_execution",
      "stage_completion",
      "stage_archive",
    ]);
    expect(res.body.stages[0].status).toBe("in_progress");
    expect(res.body.stages.slice(1).every((s: any) => s.status === "pending")).toBe(true);

    // 八项产出物建闭环时只登记空档，单据必须在对应环节人工确认后才生成
    expect(res.body.artifacts).toHaveLength(8);
    expect(res.body.artifacts.every((a: any) => a.status === "pending")).toBe(true);

    const row = await BusinessLoopRepository.getLoopById(loop.id);
    expect(row).toBeTruthy();
    expect(row.equipmentId).toBe("eq-102");
    expect(row.currentStage).toBe(1);
    expect(row.expectedMinutes).toBe(210);
    expect(await BusinessLoopRepository.listStages(loop.id)).toHaveLength(6);
    const arts = await BusinessLoopRepository.listArtifacts(loop.id);
    expect(arts).toHaveLength(8);
    expect(arts.every((a: any) => a.status === "pending" && !a.refId)).toBe(true);
  });

  it("目标文本命中 seed 真实设备台账（eq-102 2# 无油螺杆空压机主机）", async () => {
    const res = await getDetail(loop.id);
    expect(res.status).toBe(200);
    expect(res.body.equipment.id).toBe("eq-102");
    expect(res.body.equipment.name).toContain("无油螺杆空压机主机");
    expect(res.body.equipment.code).toBe("EQ-2024-COMP-02");
    // 遥测取自台账，不做修饰
    expect(res.body.equipment.vibration).toBeCloseTo(1.8, 1);
  });

  it("running 列表可见该闭环，并带出台账设备名与发起人", async () => {
    const res = await request(app).get("/api/v1/business-loops?status=running").set(bearer(managerToken));
    expect(res.status).toBe(200);
    const mine = res.body.find((l: any) => l.id === loop.id);
    expect(mine).toBeTruthy();
    expect(mine.loopNo).toBe(loop.code);
    expect(mine.equipmentName).toBe("2# 无油螺杆空压机主机（EQ-2024-COMP-02）");
    expect(mine.initiatorName).toBe("陈主管");
  });

  it("AI 降级如实回写：环节 1/2/4 = degraded 且带真实原因，环节徽章可辨", async () => {
    const detail = await waitPrefill(loop.id);
    const byNo = (no: number) => detail.stages.find((s: any) => s.order === no);

    for (const no of [1, 2, 4]) {
      const s = byNo(no);
      expect(s.aiPrefill.status).toBe("degraded");
      expect(s.aiBadge).toContain("（AI 降级）");
      // 降级必须给出可核的失败原因，不能是空壳成功
      expect(s.aiPrefill.raw?.message).toBeTruthy();
    }
    expect(byNo(1).aiPrefill.engine).toBe("generate-work-order");
    expect(byNo(2).aiPrefill.engine).toBe("safety-risk-assessment");
    expect(byNo(4).aiPrefill.engine).toBe("generate-maintenance-plan");
    // 无 Key 时 JSA 无 assessment 输出 → 环节 1 也没有可信工单草稿
    expect(byNo(1).aiPrefill.raw?.workOrderDraft).toBeNull();
    expect(byNo(2).aiPrefill.raw?.assessment).toBeNull();
    // 环节 3 是规则推演（非 AI），JSA 无输出时按设备类别兜底，状态恒为 ok
    expect(byNo(3).aiPrefill.status).toBe("ok");
    expect(detail.lotoItems.length).toBeGreaterThan(0);
    expect(detail.lotoItems.every((i: any) => i.basis === "类别规则兜底" && i.confirmed === false)).toBe(true);
    expect(detail.lotoItems.some((i: any) => i.type === "电气隔离")).toBe(true);
    // 不编造锁号：eq-102 在锁具台账里没有匹配记录，只能留空由现场登记
    expect(detail.lotoItems.every((i: any) => i.lockNumber === "")).toBe(true);
  });
});

describe("Hermes 业务闭环 - 人工闸门与全链路推进", () => {
  it("越序确认第 3 环节被拒：409 STAGE_SEQUENCE_MISMATCH", async () => {
    const res = await confirm(loop.id, 3);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STAGE_SEQUENCE_MISMATCH");
    expect(res.body.error).toContain("当前进行中环节为第 1 环节");
  });

  it("环节 1 确认 → work_orders 真的多一行，产出物 code 即该行 id", async () => {
    const res = await confirm(loop.id, 1);
    expect(res.status).toBe(200);
    expect(res.body.progress.currentStageOrder).toBe(2);
    expect(res.body.stages.find((s: any) => s.order === 1).status).toBe("completed");

    const woArt = res.body.artifacts.find((a: any) => a.category === "检修工单");
    expect(woArt.status).toBe("ready");
    const order = await WorkOrderRepository.getById(woArt.code);
    expect(order).toBeTruthy();
    expect(order.source).toBe("business_loop");
    expect(order.equipmentId).toBe("eq-102");
    expect(order.creator).toBe("陈主管");
    expect(order.description).toContain(GOAL);
    // AI 降级时标题走台账真实设备名兜底，不编造故障描述
    expect(order.title).toContain("无油螺杆空压机主机");
  });

  it("环节 2 确认 → safety_permits 落成待会签作业票（不是已批准假章）", async () => {
    const res = await confirm(loop.id, 2);
    expect(res.status).toBe(200);
    expect(res.body.progress.currentStageOrder).toBe(3);

    const permitArt = res.body.artifacts.find((a: any) => a.category === "安全许可");
    expect(permitArt.status).toBe("ready");
    const permit = await SafetyPermitRepository.getById(permitArt.code);
    expect(permit).toBeTruthy();
    expect(permit.permitNo).toMatch(/^SP-\d{8}-L\d{3}$/);
    expect(permit.status).toBe("pending_approval");
    expect(permit.equipmentId).toBe("eq-102");
    expect(permit.title).toContain(loop.code);
    // JSA 降级时不编造风险档，如实标注未评级
    expect(permit.riskLevel).toBe("待人工 JSA 评定（未评级）");
    loop.permitNo = permit.permitNo;
  });

  it("目标未命中台账设备 → 如实标注未识别，LOTO 无点可推：确认环节 3 得 400 LOTO_EMPTY", async () => {
    const created = await request(app)
      .post("/api/v1/business-loops")
      .set(bearer(managerToken))
      .send({ goal: "厂区南门路灯线路老化跳闸，走检修流程" });
    expect(created.status).toBe(202);
    const ghostId = created.body.id;
    // 禁止编造设备：目标文本没命中台账时设备为空，前端显示「未识别设备」
    expect(created.body.equipment.id).toBe("");
    await waitPrefill(ghostId);
    const detail = await getDetail(ghostId);
    expect(detail.body.lotoItems).toEqual([]);

    expect((await confirm(ghostId, 1)).status).toBe(200);
    expect((await confirm(ghostId, 2)).status).toBe(200);
    // 同一秒内确认两条闭环的作业票也不能撞号（permit_no UNIQUE 会直接把确认打成 500）
    const ghostPermitArt = (await getDetail(ghostId)).body.artifacts.find((a: any) => a.category === "安全许可");
    const ghostPermit = await SafetyPermitRepository.getById(ghostPermitArt.code);
    expect(ghostPermit.permitNo).not.toBe(loop.permitNo);
    expect(ghostPermit.equipmentId).toBeNull();
    const res = await confirm(ghostId, 3);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOTO_EMPTY");

    // 该闭环停在环节 3，不允许归档
    const archive = await request(app).post(`/api/v1/business-loops/${ghostId}/complete`).set(bearer(managerToken)).send({});
    expect(archive.status).toBe(400);
    expect(archive.body.code).toBe("STAGES_INCOMPLETE");
  });

  it("确认不存在的隔离点 → 404 LOTO_ITEM_NOT_FOUND", async () => {
    const res = await toggleLoto(loop.id, "loto-not-exist", true);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("LOTO_ITEM_NOT_FOUND");
  });

  it("LOTO 闸门：未满 100% 拒绝推进，逐项确认后放行并生成隔离清单档案", async () => {
    const before = await getDetail(loop.id);
    const items: any[] = before.body.lotoItems;
    expect(items.length).toBeGreaterThan(1);

    const partial = await toggleLoto(loop.id, items[0].id, true);
    expect(partial.status).toBe(200);
    const first = partial.body.lotoItems.find((i: any) => i.id === items[0].id);
    expect(first.confirmed).toBe(true);
    expect(first.operator).toContain("陈主管");

    const blocked = await confirm(loop.id, 3);
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe("LOTO_NOT_FULLY_CONFIRMED");
    expect(blocked.body.error).toContain(`当前 1/${items.length} 项`);

    for (const item of items.slice(1)) {
      expect((await toggleLoto(loop.id, item.id, true)).status).toBe(200);
    }
    const advanced = await confirm(loop.id, 3);
    expect(advanced.status).toBe(200);
    expect(advanced.body.progress.currentStageOrder).toBe(4);
    const lotoArt = advanced.body.artifacts.find((a: any) => a.category === "能量隔离");
    expect(lotoArt.status).toBe("ready");
    expect(lotoArt.code).toBe(`${loop.code}-LOTO`);
  });

  it("环节 3 已完成后隔离点锁定：再改 → 409 STAGE_LOCKED", async () => {
    const before = await getDetail(loop.id);
    const res = await toggleLoto(loop.id, before.body.lotoItems[0].id, false);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STAGE_LOCKED");
  });

  it("环节 4 / 5 确认后作业指引与验收记录入库", async () => {
    const s4 = await confirm(loop.id, 4);
    expect(s4.status).toBe(200);
    const guide = s4.body.artifacts.find((a: any) => a.category === "作业标准");
    expect(guide.status).toBe("ready");
    expect(guide.code).toBe(`${loop.code}-SOP`);

    const s5 = await confirm(loop.id, 5);
    expect(s5.status).toBe(200);
    const acceptance = s5.body.artifacts.find((a: any) => a.category === "现场验收");
    expect(acceptance.status).toBe("ready");
    // 验收记录引用环节 1 落成的真实工单
    const woArt = s5.body.artifacts.find((a: any) => a.category === "检修工单");
    expect(acceptance.code).toBe(woArt.code);
  });

  it("环节未走完就归档 → 400 STAGES_INCOMPLETE", async () => {
    const res = await request(app).post(`/api/v1/business-loops/${loop.id}/complete`).set(bearer(managerToken)).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("STAGES_INCOMPLETE");
    expect(res.body.error).toContain("环节 6");
  });

  it("环节 6 确认 + 归档：状态 archived、质检报告与档案包入库、历史可见", async () => {
    const s6 = await confirm(loop.id, 6);
    expect(s6.status).toBe(200);
    expect(s6.body.stages.every((st: any) => st.status === "completed")).toBe(true);
    expect(s6.body.progress.percent).toBe(100);

    const res = await request(app).post(`/api/v1/business-loops/${loop.id}/complete`).set(bearer(managerToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
    expect(res.body.artifacts.find((a: any) => a.category === "质量评估").status).toBe("ready");
    expect(res.body.artifacts.find((a: any) => a.category === "全量档案").status).toBe("ready");
    // 无 AI Key 时质检报告如实标 degraded，知识沉淀未达标则保持 pending（不造假条目）
    const knowledge = res.body.artifacts.find((a: any) => a.category === "知识沉淀");
    expect(["ready", "pending"]).toContain(knowledge.status);
    const row = await BusinessLoopRepository.getLoopById(loop.id);
    expect(row.status).toBe("archived");

    const history = await request(app).get("/api/v1/business-loops/history").set(bearer(managerToken));
    expect(history.status).toBe(200);
    const mine = history.body.find((h: any) => h.loopCode === loop.code);
    expect(mine).toBeTruthy();
    expect(mine.status).toBe("archived");
    expect(mine.artifactCount).toBeGreaterThan(0);
    expect(mine.leadUser).toBe("陈主管");
  });

  it("归档后只读：重复归档 409 LOOP_ARCHIVED，重复确认 409 LOOP_NOT_RUNNING", async () => {
    const again = await request(app).post(`/api/v1/business-loops/${loop.id}/complete`).set(bearer(managerToken)).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("LOOP_ARCHIVED");

    const confirmAfterArchive = await confirm(loop.id, 6);
    expect(confirmAfterArchive.status).toBe(409);
    expect(confirmAfterArchive.body.code).toBe("LOOP_NOT_RUNNING");
  });

  it("越权确认：inspector 点确认环节 → 403，环节状态未被改动", async () => {
    const res = await request(app)
      .post(`/api/v1/business-loops/${loop.id}/stages/6/confirm`)
      .set(bearer(inspectorToken))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RBAC_PERMISSION_DENIED");
  });
});

describe("Hermes 业务闭环 - 预填闸门", () => {
  it("AI 预填尚未回写就确认 → 409 PREFILL_PENDING，预填落库后人工仍可确认", async () => {
    const created = await request(app).post("/api/v1/business-loops").set(bearer(managerToken)).send({ goal: GOAL });
    expect(created.status).toBe(202);
    const id = created.body.id;
    await waitPrefill(id);

    // 模拟「真实 AI 调用还在路上」：把环节 1 的 outcome 抹回 NULL
    const db = await getDb();
    await db.query(`UPDATE business_loop_stages SET ai_status = NULL, ai_engine = NULL WHERE loop_id = $1 AND stage_no = 1;`, [id]);

    const blocked = await confirm(id, 1);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("PREFILL_PENDING");

    // 兜底回写（degraded）后不得永久卡住人工确认
    await BusinessLoopRepository.updateStagePrefill(id, 1, {
      aiPrefillJson: JSON.stringify({ workOrderDraft: null, message: "预填未回写，人工补录工单要素" }),
      aiEngine: "generate-work-order",
      aiStatus: "degraded",
    });
    const ok = await confirm(id, 1);
    expect(ok.status).toBe(200);
    expect(ok.body.progress.currentStageOrder).toBe(2);
  });
});

/**
 * 人工闸门要真的能改：确认前提交的 edits 才是落库值，AI 原值只作留底。
 * 测试环境无 AI Key（环节 1/2/4 恒 degraded），正好验证「AI 没给 ≠ 人不能改」。
 */
describe("Hermes 业务闭环 - 确认前人工修订", () => {
  const rev = { id: "" };

  function confirmWithEdits(loopId: string, stageNo: number, edits: any, token = managerToken) {
    return request(app)
      .post(`/api/v1/business-loops/${loopId}/stages/${stageNo}/confirm`)
      .set(bearer(token))
      .send({ edits });
  }

  function patchLoto(loopId: string, payload: any, token = managerToken) {
    return request(app).patch(`/api/v1/business-loops/${loopId}/loto-confirm`).set(bearer(token)).send(payload);
  }

  function postLotoItem(loopId: string, fields: any, token = managerToken) {
    return request(app).post(`/api/v1/business-loops/${loopId}/loto-items`).set(bearer(token)).send(fields);
  }

  /** 审计是异步落库，轮询取本闭环本环节那条 */
  async function findConfirmAudit(loopId: string, stageNo: number) {
    const deadline = Date.now() + 8000;
    for (;;) {
      const logs = await AuditLogRepository.getAll({ actionType: "BUSINESS_LOOP_STAGE_CONFIRM", limit: 500 });
      const hit = logs.find((l: any) => l.metadata?.loopId === loopId && Number(l.metadata?.stageNo) === stageNo);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`环节 ${stageNo} 的确认审计未落库`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it("专用闭环建立并等预填回写（供后续修订用例串行推进）", async () => {
    const created = await request(app).post("/api/v1/business-loops").set(bearer(managerToken)).send({ goal: GOAL });
    expect(created.status).toBe(202);
    rev.id = created.body.id;
    await waitPrefill(rev.id);
    // AI 降级时工单草稿为空壳，正是人工补录的入口
    const s1 = (await getDetail(rev.id)).body.stages.find((s: any) => s.order === 1);
    expect(s1.aiPrefill.raw.workOrderDraft).toBeNull();
  });

  it("环节 1 带 edits 确认：落库工单取人工值，AI 原值留底，审计记处数", async () => {
    const res = await confirmWithEdits(rev.id, 1, {
      workOrderDraft: {
        title: "2# 无油螺杆空压机主机振动复测与联轴器弹性块更换",
        faultType: "机械故障",
        priority: "urgent",
        estimatedHours: 2.5,
        description: "现场复测振动 2.3 mm/s，仅需更换联轴器弹性块，不必解体主机。",
      },
    });
    expect(res.status).toBe(200);

    const s1 = res.body.stages.find((s: any) => s.order === 1);
    expect(s1.aiPrefill.raw.workOrderDraft).toMatchObject({
      title: "2# 无油螺杆空压机主机振动复测与联轴器弹性块更换",
      priority: "urgent",
      estimatedHours: 2.5,
    });
    expect(s1.aiPrefill.revised).toMatchObject({ by: "陈主管" });
    expect(s1.aiPrefill.revised.fields).toEqual(
      expect.arrayContaining(["工单标题", "故障类型", "优先级", "预计工时", "现场情况描述"])
    );
    // 降级时 AI 本就没给值，留底如实为 null，不假装模型输出过
    expect(s1.aiPrefill.raw.aiOriginal.workOrderDraft.priority).toBeNull();

    const woArt = res.body.artifacts.find((a: any) => a.category === "检修工单");
    const order = await WorkOrderRepository.getById(woArt.code);
    expect(order.title).toBe("2# 无油螺杆空压机主机振动复测与联轴器弹性块更换");
    expect(order.priority).toBe("urgent");
    expect(order.faultType).toBe("机械故障");
    // 正文以确认人核对后的描述为准，业务目标不再顶替
    expect(order.description).toContain("现场复测振动 2.3 mm/s");
    expect(order.description).not.toContain(GOAL);
    // work_orders 无工时列：预计工时如实写进描述并标来源
    expect(order.description).toContain("预计工时：2.5 小时（来源：人工修订）");

    const audit = await findConfirmAudit(rev.id, 1);
    expect(audit.detail).toContain("人工修订 5 处");
    expect((audit.metadata as any).humanRevisedFields).toHaveLength(5);
  });

  it("环节 2 带 edits 确认：作业票按人工风险档落库，票面措施如实留修订痕", async () => {
    const res = await confirmWithEdits(rev.id, 2, {
      assessment: { riskLevel: "高", riskReason: "残余气压未泄净，需双人挂锁作业" },
    });
    expect(res.status).toBe(200);

    const permitArt = res.body.artifacts.find((a: any) => a.category === "安全许可");
    const permit = await SafetyPermitRepository.getById(permitArt.code);
    expect(permit.status).toBe("pending_approval");
    // 「高」映射到站内作业票口径 Level 2，而不是留在未评级
    expect(permit.riskLevel).toBe("较大风险 (Level 2)");
    const revisionLine = (permit.precautions || []).find((p: string) => p.includes("【人工修订留痕】"));
    expect(revisionLine).toBeTruthy();
    expect(revisionLine).toContain("（AI 未给出） → 高");
    expect(revisionLine).toContain("陈主管");
    // 票面预览会截断措施清单（只展示前 5 条），修订留痕必须单列一行不被截掉
    expect(permitArt.previewContent).toContain("【人工修订留痕】JSA 风险等级");

    const s2 = res.body.stages.find((s: any) => s.order === 2);
    expect(s2.aiPrefill.raw.assessment.riskLevel).toBe("高");
    expect(s2.aiPrefill.raw.aiOriginal.assessment.riskLevel).toBeNull();

    const audit2 = await findConfirmAudit(rev.id, 2);
    expect(audit2.detail).toContain("人工修订 2 处");
    expect((audit2.metadata as any).humanRevisedFields.join("；")).toContain("JSA 风险等级");
  });

  it("环节 3 不收通用 edits：隔离点必须逐行走登记接口", async () => {
    const res = await confirmWithEdits(rev.id, 3, { plan: { overview: "不该塞进环节 3 的修订" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("STAGE_EDITS_NOT_SUPPORTED");
    expect(res.body.error).toContain("LOTO");
    // 被拒之后环节没有偷偷推进
    expect((await getDetail(rev.id)).body.progress.currentStageOrder).toBe(3);
  });

  it("隔离点可现场改登：AI 原值留底、改动人入库，确认人只认登录身份", async () => {
    const items: any[] = (await getDetail(rev.id)).body.lotoItems;
    const target = items[0];
    expect(target.lockNumber).toBe("");

    const res = await patchLoto(rev.id, {
      itemId: target.id,
      confirmed: false,
      fields: { point: `${target.point}（现场核实为 QF-05）`, lockNumber: "LK-EL-408", operator: "李工" },
    });
    expect(res.status).toBe(200);
    const row = res.body.lotoItems.find((i: any) => i.id === target.id);
    expect(row.point).toContain("QF-05");
    expect(row.lockNumber).toBe("LK-EL-408");
    expect(row.operator).toBe("李工");
    expect(row.editedBy).toBe("陈主管");
    expect(row.editedAt).toBeTruthy();
    expect(row.aiOriginal).toMatchObject({ point: target.point, lockNumber: "" });
    // 未勾选确认就没有确认人，operator 不等于记账人
    expect(row.confirmed).toBe(false);
    expect(row.confirmedBy).toBeNull();
  });

  it("清单漏项可补登：来源如实标人工登记，操作要求留空按 GB/T 33579 规则生成", async () => {
    const before: any[] = (await getDetail(rev.id)).body.lotoItems;
    const res = await postLotoItem(rev.id, {
      type: "机械能",
      point: "主机联轴器护罩紧固螺栓",
      requirement: "停机挂警示牌后方可拆护罩",
      lockNumber: "LK-ME-033",
    });
    expect(res.status).toBe(201);
    const added = res.body.lotoItems[res.body.lotoItems.length - 1];
    expect(res.body.lotoItems).toHaveLength(before.length + 1);
    expect(added.basis).toBe("人工登记（AI/JSA 清单外补充）");
    expect(added.requirement).toBe("停机挂警示牌后方可拆护罩");
    expect(added.lockNumber).toBe("LK-ME-033");
    expect(added.confirmed).toBe(false);

    const fallback = await postLotoItem(rev.id, { type: "机械能", point: "进气过滤器壳体快开卡箍" });
    expect(fallback.status).toBe(201);
    const second = fallback.body.lotoItems[fallback.body.lotoItems.length - 1];
    expect(second.requirement).toBeTruthy();
    expect(second.requirement).not.toBe("");

    const dup = await postLotoItem(rev.id, { type: "机械能", point: "主机联轴器护罩紧固螺栓" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("LOTO_POINT_DUPLICATE");

    const incomplete = await postLotoItem(rev.id, { type: "机械能", point: "  " });
    expect(incomplete.status).toBe(400);
    // 空白点位在入参校验层就被拦（zod trim+min(1)），不会落一条没有点位的隔离行
    expect(incomplete.body.code).toBe("INVALID_INPUT");
    expect((await getDetail(rev.id)).body.lotoItems).toHaveLength(fallback.body.lotoItems.length);
  });

  it("补登的行同样卡 100% 闸门：全项确认后才放行，人工点位进入隔离清单档案", async () => {
    const items: any[] = (await getDetail(rev.id)).body.lotoItems;
    const blocked = await confirm(rev.id, 3);
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe("LOTO_NOT_FULLY_CONFIRMED");
    expect(blocked.body.error).toContain("联轴器护罩紧固螺栓");

    for (const item of items) {
      expect((await patchLoto(rev.id, { itemId: item.id, confirmed: true })).status).toBe(200);
    }
    const advanced = await confirm(rev.id, 3);
    expect(advanced.status).toBe(200);
    expect(advanced.body.progress.currentStageOrder).toBe(4);
    expect(advanced.body.lotoItems.every((i: any) => i.confirmed && i.confirmedBy === "陈主管")).toBe(true);

    const lotoArt = advanced.body.artifacts.find((a: any) => a.category === "能量隔离");
    expect(lotoArt.status).toBe("ready");
    // 人工补登的点位进入了归档清单，不是只活在页面上
    expect(lotoArt.previewContent).toContain("主机联轴器护罩紧固螺栓");
    expect(lotoArt.previewContent).toContain(`${items.length}/${items.length} 已由现场逐项确认`);

    const lockedPatch = await patchLoto(rev.id, { itemId: items[0].id, confirmed: false });
    expect(lockedPatch.status).toBe(409);
    expect(lockedPatch.body.code).toBe("STAGE_LOCKED");
    const lockedAdd = await postLotoItem(rev.id, { type: "机械能", point: "环节完成后不能再补的点" });
    expect(lockedAdd.status).toBe(409);
    expect(lockedAdd.body.code).toBe("STAGE_LOCKED");
  });

  it("环节 4 带 edits 确认：作业指引按人工工时与人数成档", async () => {
    const res = await confirmWithEdits(rev.id, 4, {
      plan: { overview: "更换联轴器弹性块并复测振动，全程不带压作业", estimatedHours: 3, workers: 2 },
    });
    expect(res.status).toBe(200);
    const guide = res.body.artifacts.find((a: any) => a.category === "作业标准");
    expect(guide.status).toBe("ready");
    expect(guide.previewContent).toContain("【方案概述】更换联轴器弹性块并复测振动");
    expect(guide.previewContent).toContain("【预估工时】3 小时（2 人）");

    const audit = await findConfirmAudit(rev.id, 4);
    expect(audit.detail).toContain("人工修订 3 处");
    expect(audit.detail).toContain("预估工时");
  });

  it("环节 5 不带 edits 确认：审计如实记「按 AI 预填原值确认」", async () => {
    const s5 = await confirm(rev.id, 5);
    expect(s5.status).toBe(200);
    const audit = await findConfirmAudit(rev.id, 5);
    expect(audit.detail).toContain("无修订，按 AI 预填原值确认");
    expect((audit.metadata as any).humanRevisedFields).toEqual([]);
  });

  it("越权修订：inspector 带 edits 确认 → 403，人工值没有落库", async () => {
    const res = await confirmWithEdits(rev.id, 6, { workOrderDraft: { title: "点检工程师想改的标题" } }, inspectorToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RBAC_PERMISSION_DENIED");
    const s6 = (await getDetail(rev.id)).body.stages.find((s: any) => s.order === 6);
    expect(s6.status).toBe("in_progress");
    expect(s6.aiPrefill.raw?.workOrderDraft?.title).toBeUndefined();
  });
});

/**
 * 单据正文里的重复标点（真机截图暴露：「…断电。；…泄压。；」）源于 AI/JSA 输出的
 * 每条措施自带句末标点，再用「；」join 就叠出来了。这里双向钉住：
 * 带标点必须收口，不带标点的条目不得被改动一个字。
 */
describe("preview 文本标点收口", () => {
  it("条目自带句末标点：剥掉后再 join，不出现「。；」与行尾悬空分隔符", () => {
    const out = joinClauses(["作业前必须断电挂牌。", "残余气压泄压至零；", "  ", "监护人全程在场"]);
    expect(out).toBe("作业前必须断电挂牌；残余气压泄压至零；监护人全程在场");
    expect(out).not.toMatch(/[。；;]\s*[；;]/);
    expect(out).not.toMatch(/[；;]$/);
  });

  it("条目本就没有标点：原样拼接、不吞字，空清单返回空串", () => {
    expect(joinClauses(["GB/T 33579-2017 锁定/挂牌", "GB 30871 特殊作业安全规范"])).toBe(
      "GB/T 33579-2017 锁定/挂牌；GB 30871 特殊作业安全规范"
    );
    expect(joinClauses([])).toBe("");
  });
});

/**
 * 遥测缺测不得被填成 0（数据红线）。
 *
 * 旧实现 `tele0()` 把任何非法值转成 0，于是缺测设备在闭环详情里显示成
 * 「温度 0°C（经验限值 80°C）」，在 AI 上下文栏里显示成一台正常设备；
 * 更糟的是这句 `.teleCtx` 会进 AI 提示词，模型照着 0 写诊断结论。
 *
 * 这组用例真改库（把该设备 telemetry 置空）再读接口，证明返回的是 null 不是 0。
 * ⚠️ 反向断言「不是 0」必须配正向断言「有遥测时确实是那个数」，否则
 * 把字段整个删掉也能让"不是 0"通过 —— 那是零信息断言。
 */
describe("遥测缺测 → null（不得填 0）", () => {
  it("设备 telemetry 置空后：闭环详情回 null，有读数时回真实数值", async () => {
    const db = await getDb();
    const eqId = "eq-102";
    const before = await db.query(`SELECT telemetry FROM equipments WHERE id = $1;`, [eqId]);
    const originalTelemetry = before.rows[0]?.telemetry ?? null;

    try {
      // ---- 正向对照：先把一份确定的读数写进去，读出来必须是这些数 ----
      await db.query(
        `UPDATE equipments SET telemetry = $1::jsonb WHERE id = $2;`,
        [JSON.stringify({ temperature: 63.5, vibration: 3.25, loadRate: 71 }), eqId]
      );
      const withTele = await request(app)
        .post("/api/v1/business-loops")
        .set(bearer(managerToken))
        .send({ goal: "2#无油螺杆空压机主机温度异常，走检修流程" });
      expect(withTele.status).toBe(202);
      const d1 = (await getDetail(withTele.body.id)).body;
      expect(d1.equipment.temperature).toBe(63.5);
      expect(d1.equipment.vibration).toBe(3.25);
      expect(d1.equipment.loadRate).toBe(71);

      // ---- 缺测：把 telemetry 置空，读出来必须是 null ----
      await db.query(`UPDATE equipments SET telemetry = NULL WHERE id = $1;`, [eqId]);
      const noTele = await request(app)
        .post("/api/v1/business-loops")
        .set(bearer(managerToken))
        .send({ goal: "2#无油螺杆空压机主机振动偏高，走检修流程" });
      expect(noTele.status).toBe(202);
      const d2 = (await getDetail(noTele.body.id)).body;
      expect(d2.equipment.id).toBe(eqId);
      // 三处都不能是 0 —— 0°C / 0mm/s / 0% 都会被读成"设备完好"
      expect(d2.equipment.temperature).toBeNull();
      expect(d2.equipment.vibration).toBeNull();
      expect(d2.equipment.loadRate).toBeNull();
    } finally {
      await db.query(`UPDATE equipments SET telemetry = $1::jsonb WHERE id = $2;`, [
        JSON.stringify(originalTelemetry ?? {}),
        eqId,
      ]);
    }
  });
});
