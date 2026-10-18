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
} from "../src/db/repositories/index.ts";
import { getDb } from "../src/db/db.ts";

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
