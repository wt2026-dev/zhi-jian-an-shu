/**
 * 拆解作业终端（现场维修闭环）集成用例。
 *
 * 全部走真实种子数据与真实仓储写入，不打桩：
 *   · 会话设备 = eq-103（3# 轧机主传动行星减速箱，有真实拆解 BOM + 真实点检限值）；
 *   · 会话工单 = wo-20240902-001 / WO-20260902-101（种子内唯一"检修中"且有 5 条真实步骤原文）；
 *   · 现场记录一律落 work_orders.repair_log.fieldLog（与工单同表同寿）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let techToken: string;

/** 种子里的真实值（取自 seed-data/work-orders.json 与 inspections.json，不新造） */
const DEVICE_ID = "eq-103";
const ORDER_ID = "wo-20240902-001";
const STEP_COUNT = 5;
const POS_NO = "BOM-07"; // 高速输入端精密轴承座法兰端盖
const VIBRATION_POINT = "输入侧高速轴垂直向振动 (RMS)"; // 真实限值 0 ~ 4.5 mm/s

const LOTO_KEYS = [
  "loto_power_locked",
  "residual_energy_released",
  "hazardous_parts_isolated",
  "workzone_barricaded",
];

function lotoBody(keys: string[]) {
  return {
    items: keys.map((key) => ({ key, label: `客户端伪造标签-${key}`, confirmed: true })),
  };
}

async function getSession(token = techToken) {
  return request(app)
    .get(`/api/v1/equipments/${DEVICE_ID}/field-session`)
    .set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "tech1", password: "Tech1@2026#Work" });
  expect(login.status).toBe(200);
  techToken = login.body.token;
});

describe("现场作业会话（真实数据，不造假）", () => {
  it("有 BOM 目录的设备返回会话：5 条真实步骤 + 真实点检限值 + 未 LOTO 前不可记录", async () => {
    const res = await getSession();
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.order.id).toBe(ORDER_ID);
    expect(s.order.status).toBe("in_progress");
    expect(s.canOperate).toBe(true);
    expect(s.blockedReason).toBeNull();
    expect(s.loto).toBeNull();
    expect(s.steps).toHaveLength(STEP_COUNT);
    expect(s.steps.map((x: any) => x.text)).toEqual([
      "激光对中复核",
      "液压拆卸受损轴承",
      "轴颈微米级探伤并清洗轴承室",
      "采用感应加热器热装新SKF轴承",
      "加注极压润滑脂并试运转。",
    ]);
    expect(s.progress).toEqual({ total: 5, done: 0, skipped: 0, issue: 0, remaining: 5, current: 1 });
    // LOTO 未确认 → 每一步都不可记录（服务端口径，前端只是照此禁用按钮）
    for (const step of s.steps) expect(step.recordable).toBe(false);
    // 测量科目来自真实点检标准，不是前端造的允许区间
    const vib = s.measurementItems.find((m: any) => m.checkPoint === VIBRATION_POINT);
    expect(vib).toBeTruthy();
    expect(vib.unit).toBe("mm/s");
    expect(vib.maxLimit).toBe(4.5);
    expect(s.dataNote).toContain("repair_log.fieldLog");
  });

  it("没有拆解 BOM 目录的设备不开终端会话（404，不编造部件档案）", async () => {
    const res = await request(app)
      .get("/api/v1/equipments/eq-101/field-session")
      .set("Authorization", `Bearer ${techToken}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NO_EXPLODED_CATALOG");
  });

  it("有 BOM 但工单未开工（dispatched）→ 会话只读并给出真实原因，不产生任何记录入口", async () => {
    const res = await request(app)
      .get("/api/v1/equipments/eq-104/field-session")
      .set("Authorization", `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.order).toBeNull();
    expect(res.body.canOperate).toBe(false);
    expect(res.body.blockedReason).toContain("检修工单");
    expect(res.body.steps).toEqual([]);
  });

  it("写端点必须登录：无 Token 记录步骤 401", async () => {
    const res = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .send({ index: 1, action: "done" });
    expect(res.status).toBe(401);
  });
});

describe("LOTO 强制安全确认闸门", () => {
  it("未确认 LOTO：步骤 / 测量 / 照片三类记录全部 403 FIELD_LOTO_REQUIRED", async () => {
    const step = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ index: 1, action: "done" });
    expect(step.status).toBe(403);
    expect(step.body.code).toBe("FIELD_LOTO_REQUIRED");

    const measure = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/measure`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ posNo: POS_NO, checkPoint: VIBRATION_POINT, value: 3.1 });
    expect(measure.status).toBe(403);
    expect(measure.body.code).toBe("FIELD_LOTO_REQUIRED");

    const photo = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/photo`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ posNo: POS_NO, url: "/uploads/fake.jpg" });
    expect(photo.status).toBe(403);
    expect(photo.body.code).toBe("FIELD_LOTO_REQUIRED");

    // 闸门没被绕过：工单里不该有任何现场留痕
    const s = await getSession();
    expect(s.body.loto).toBeNull();
    expect(s.body.events).toEqual([]);
    expect(s.body.progress.done).toBe(0);
  });

  it("只勾部分项 → 422 并点名缺项，档案不落“已确认”", async () => {
    const res = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/loto`)
      .set("Authorization", `Bearer ${techToken}`)
      .send(lotoBody(LOTO_KEYS.slice(0, 3)));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_INPUT");
    expect(res.body.details.missing).toHaveLength(1);
    expect(res.body.details.missing[0]).toContain("警示围栏");

    const s = await getSession();
    expect(s.body.loto).toBeNull();
  });

  it("四项全部勾选 → 200 留档，标签以服务端权威清单重写、操作人取服务端会话而非请求体", async () => {
    const res = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/loto`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({
        items: [
          // 客户端把标签文本改成任意内容，服务端必须覆盖成权威文本（防伪造档案）
          ...lotoBody(LOTO_KEYS).items.map((i) => ({ ...i, label: "随便写的标签" })),
        ],
        // 身份字段由客户端伪造，服务端应忽略
        operator: { name: "冒名顶替者", role: "admin" },
      });
    expect(res.status).toBe(200);
    const loto = res.body.loto;
    expect(loto.items).toHaveLength(4);
    expect(loto.items.map((i: any) => i.key)).toEqual(LOTO_KEYS);
    expect(loto.items.map((i: any) => i.label)).toEqual([
      "设备已断电、上锁挂牌（LOTO）",
      "残余压力/能量已释放",
      "高温/高压/转动部件已隔离",
      "作业区域已设置警示围栏",
    ]);
    expect(loto.by.name).toBe("张建国");
    expect(loto.by.name).not.toBe("冒名顶替者");
    expect(Date.parse(loto.confirmedAt)).toBeGreaterThan(0);

    const s = await getSession();
    expect(s.body.loto).toBeTruthy();
    for (const step of s.body.steps) expect(step.recordable).toBe(true);
    expect(s.body.events.some((e: any) => e.kind === "loto")).toBe(true);
  });
});

describe("边拆边记：步骤留痕 + 跳过/问题 + 测量比对 + 现场照片", () => {
  it("跳过与标记问题必须带原因（422），空白备注不收", async () => {
    const skip = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ index: 2, action: "skip" });
    expect([400, 422]).toContain(skip.status);
    expect(skip.body.code).toBe("INVALID_INPUT");

    const issue = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ index: 2, action: "issue", note: "   " });
    expect([400, 422]).toContain(issue.status);
  });

  it("步骤序号超出真实步骤数 → 400，不写入幽灵步骤", async () => {
    const res = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ index: STEP_COUNT + 4, action: "done" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("完成第 1 步：自动记下操作人 / 时间 / 距上一记录的用时，工单仍在检修中", async () => {
    const res = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ index: 1, action: "done" });
    expect(res.status).toBe(200);
    expect(res.body.justCompleted).toBe(false);
    expect(res.body.autoCompleted).toBeNull();
    expect(res.body.order.status).toBe("in_progress");

    const step1 = res.body.steps.find((x: any) => x.index === 1);
    expect(step1.state.status).toBe("done");
    expect(step1.state.by.name).toBe("张建国");
    expect(Date.parse(step1.state.at)).toBeGreaterThan(0);
    // 上一步事件是 LOTO 确认 → 用时是真实算出来的分钟数
    expect(typeof step1.state.elapsedMin).toBe("number");
    expect(step1.state.elapsedMin).toBeGreaterThanOrEqual(0);

    expect(res.body.progress.done).toBe(1);
    expect(res.body.progress.current).toBe(2);
    expect(res.body.progress.remaining).toBe(4);
  });

  it("第 2 步跳过并留原因、第 3/4 步完成：进度按真实记录汇总", async () => {
    const skip = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ index: 2, action: "skip", note: "旧轴承组已随上月抢修更换，本次复核无损伤" });
    expect(skip.status).toBe(200);
    const skipState = skip.body.steps.find((x: any) => x.index === 2).state;
    expect(skipState.status).toBe("skip");
    expect(skipState.note).toContain("上月抢修");

    for (const index of [3, 4]) {
      const done = await request(app)
        .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
        .set("Authorization", `Bearer ${techToken}`)
        .send({ index, action: "done" });
      expect(done.status).toBe(200);
    }
    const s = await getSession();
    expect(s.body.progress).toEqual({ total: 5, done: 3, skipped: 1, issue: 0, remaining: 1, current: 5 });
    // 现场时间线：LOTO + 4 条步骤 = 5 条，顺序即真实发生顺序
    expect(s.body.events).toHaveLength(5);
    expect(s.body.events.map((e: any) => e.kind)).toEqual(["loto", "step", "step", "step", "step"]);
  });

  it("第 5 步标记「有问题」→ 不触发自动完工，问题必须可见", async () => {
    const res = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ index: 5, action: "issue", note: "试运转仍见 5.1mm/s，需追加换齿计划" });
    expect(res.status).toBe(200);
    expect(res.body.justCompleted).toBe(false);
    expect(res.body.progress.issue).toBe(1);
    expect(res.body.order.status).toBe("in_progress");
  });

  it("测量数据：与真实点检限值比对，超标记 ok=false；无标准科目拒录", async () => {
    const over = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/measure`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ posNo: POS_NO, checkPoint: VIBRATION_POINT, value: 7.4 });
    expect(over.status).toBe(200);
    const overRec = over.body.measurements.find((m: any) => m.value === 7.4);
    expect(overRec.ok).toBe(false);
    expect(overRec.maxLimit).toBe(4.5);
    expect(overRec.standard).toContain("4.5");
    expect(overRec.by.name).toBe("张建国");

    const pass = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/measure`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ posNo: POS_NO, checkPoint: VIBRATION_POINT, value: 3.2 });
    expect(pass.status).toBe(200);
    expect(pass.body.measurements.find((m: any) => m.value === 3.2).ok).toBe(true);

    const noStd = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/measure`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ posNo: POS_NO, checkPoint: "凭空发明的测点", value: 1 });
    expect(noStd.status).toBe(422);
    expect(noStd.body.code).toBe("MEASURE_STANDARD_NOT_FOUND");

    const badPos = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/measure`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ posNo: "BOM-99", checkPoint: VIBRATION_POINT, value: 3 });
    expect(badPos.status).toBe(404);
    expect(badPos.body.code).toBe("PART_NOT_IN_CATALOG");
  });

  it("现场照片：非 /uploads/ 地址在入参校验层就被拒；真实上传后才关联到该零件位号", async () => {
    const forged = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/photo`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ posNo: POS_NO, url: "https://evil.example.com/x.jpg" });
    expect([400, 422]).toContain(forged.status);
    expect(forged.body.code).toBe("INVALID_INPUT");

    const upload = await request(app)
      .post("/api/v1/upload/image")
      .set("Authorization", `Bearer ${techToken}`)
      .send({
        imageBase64:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        filename: "field-bom07.png",
      });
    expect(upload.status).toBe(200);
    expect(upload.body.url).toMatch(/^\/uploads\//);

    const attach = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/photo`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ posNo: POS_NO, url: upload.body.url, filename: "field-bom07.png" });
    expect(attach.status).toBe(200);
    const photo = attach.body.partPhotos[0];
    expect(photo.posNo).toBe(POS_NO);
    expect(photo.url).toBe(upload.body.url);
    expect(photo.by.name).toBe("张建国");

    const s = await getSession();
    expect(s.body.events.some((e: any) => e.kind === "photo")).toBe(true);
    expect(s.body.events.some((e: any) => e.kind === "measure")).toBe(true);
  });
});

describe("全部步骤记录完成 → 工单自动完工闭环", () => {
  it("第 5 步改记完成后自动完工：状态/完工时间/实际维修人/工时全部自动写回工单", async () => {
    const res = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ index: 5, action: "done" });
    expect(res.status).toBe(200);
    expect(res.body.justCompleted).toBe(true);
    // 完工后会话仍钉在本单（只读留档），不跳到该设备的下一张单
    expect(res.body.order.id).toBe(ORDER_ID);
    expect(res.body.order.status).toBe("completed");
    expect(Date.parse(res.body.order.completedAt)).toBeGreaterThan(0);
    expect(res.body.blockedReason).toContain("只读留档");
    expect(res.body.autoCompleted).toMatchObject({ total: 5, done: 4, skipped: 1 });
    expect(res.body.autoCompleted.workHours).toBeGreaterThanOrEqual(0.1);
    expect(res.body.autoCompleted.by).toBe("张建国");

    // 直接读工单：现场留痕确实写在 work_orders.repair_log.fieldLog
    const order = await request(app)
      .get(`/api/v1/work-orders/${ORDER_ID}`)
      .set("Authorization", `Bearer ${techToken}`);
    expect(order.status).toBe(200);
    expect(order.body.status).toBe("completed");
    expect(order.body.assignee).toBe("张建国");
    expect(order.body.repairLog.workHours).toBeGreaterThanOrEqual(0.1);
    // 工单原有真实根因分析不被自动完工覆盖
    expect(order.body.repairLog.causeAnalysis).toContain("轴承");

    const fieldLog = order.body.repairLog.fieldLog;
    expect(Object.keys(fieldLog.steps)).toHaveLength(STEP_COUNT);
    expect(fieldLog.steps["2"].status).toBe("skip");
    expect(fieldLog.loto.items).toHaveLength(4);
    expect(fieldLog.measurements.length).toBeGreaterThanOrEqual(2);
    expect(fieldLog.partPhotos).toHaveLength(1);
    expect(fieldLog.completed.done).toBe(4);
    // 完工照片取真实现场上传，供验收页复用
    expect(order.body.repairLog.completionPhotos).toEqual(fieldLog.partPhotos.map((p: any) => p.url));
    // 时间线完整可回放：LOTO + 6 次步骤写（含问题改完成）+ 2 测量 + 1 照片 + 完工
    expect(fieldLog.events.length).toBeGreaterThanOrEqual(10);
    expect(fieldLog.events[fieldLog.events.length - 1].kind).toBe("complete");
  });

  it("闭环后终端转只读留档：再写任何现场记录一律 409 状态互斥", async () => {
    const step = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/step`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ index: 1, action: "done" });
    expect(step.status).toBe(409);
    expect(step.body.code).toBe("STATE_MUTEX_ERROR");

    const loto = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/loto`)
      .set("Authorization", `Bearer ${techToken}`)
      .send(lotoBody(LOTO_KEYS));
    expect(loto.status).toBe(409);

    const measure = await request(app)
      .post(`/api/v1/work-orders/${ORDER_ID}/field-actions/measure`)
      .set("Authorization", `Bearer ${techToken}`)
      .send({ posNo: POS_NO, checkPoint: VIBRATION_POINT, value: 2 });
    expect(measure.status).toBe(409);
  });

  it("闭环留痕进入工单流转日志与设备会话（后续可查完整维修记录）", async () => {
    const logs = await request(app)
      .get(`/api/v1/work-orders/${ORDER_ID}/logs`)
      .set("Authorization", `Bearer ${techToken}`);
    expect(logs.status).toBe(200);
    const actions = (logs.body ?? []).map((l: any) => l.action);
    expect(actions).toContain("SAFETY_CONFIRM");
    expect(actions).toContain("COMPLETE");

    // 会话自动切到该设备下一张可操作工单；已闭环单的留痕不会污染新单
    const s = await getSession();
    expect(s.body.order.id).toBe("wo-20240902-013");
    expect(s.body.canOperate).toBe(false);
    expect(s.body.blockedReason).toContain("验收");
    expect(s.body.steps.every((x: any) => x.recordable === false)).toBe(true);
  });
});
