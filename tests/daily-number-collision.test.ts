/**
 * 当日业务编号分配 —— 撞号防护回归。
 *
 * 病根（2026-10-18 复核）：`inspections.task_no`、`safety_permits.permit_no`、
 * `work_orders.order_no` 都是 `VARCHAR(64) UNIQUE NOT NULL`，而旧实现用 `Math.random()`
 * 在固定位数里摇号：
 *   · 巡检：`INSP-YYYYMMDD-` + 3 位 ⇒ 每天只有 900 个号位；
 *   · 作业票：`SP-YYYYMMDD-` + 4 位 ⇒ 每天 9000 个号位；
 *   · 工单：`WO-YYYYMMDD-` + (Date.now 尾 4 位 + 随机 4 位) —— 尾 4 位每 100 秒轮回一次。
 * 摇重了不是覆盖而是 INSERT 违反 UNIQUE ⇒ 整条请求 500。`business_loops.loop_no` 的
 * `COUNT(*) + 1` 更直接：中间删掉一行，下一个号就撞上仍在的号。
 *
 * 现口径：向数据库要「当天最大数字后缀 +1」，并把「取号 → 落库」放进同一把进程内锁
 * （见 `src/db/dailyNo.ts`）。这里用并发请求正面钉住：全部 201、编号互不相同。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { getDb } from "../src/db/db.ts";
import { generateLoopNo } from "../src/db/repositories/businessLoopRepository.ts";

let app: any;
let adminToken: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DASHSCOPE_API_KEY = "";
  app = await createApp();
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "Admin@2026#Demo" });
  adminToken = login.body.token;
  expect(adminToken, "admin 登录必须成功，否则本文件全部断言失去意义").toBeTruthy();
});

const bearer = () => ({ Authorization: `Bearer ${adminToken}` });

describe("UNIQUE 编号列的并发分配", () => {
  it("20 个并发创建巡检任务：全部 201 且 task_no 互不相同", async () => {
    const tag = "并发撞号回归巡检";
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post("/api/v1/inspections")
          .set(bearer())
          .send({ title: `${tag} #${i}`, workshop: "动力一车间" })
      )
    );
    // 撞号的表象就是 500 —— 先钉状态码，再钉编号集合大小
    const failed = results.filter((r) => r.status !== 201);
    expect(
      failed.map((r) => `${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`),
      "并发创建必须全部成功（任一 500 即为编号撞车）"
    ).toEqual([]);

    const db = await getDb();
    const { rows } = await db.query(
      "SELECT task_no FROM inspections WHERE title LIKE $1 ORDER BY task_no",
      [`${tag} #%`]
    );
    expect(rows.length).toBe(20);
    expect(new Set(rows.map((r: any) => r.task_no)).size, "task_no 出现重复分配").toBe(20);
    // 形状仍是对外承诺的 INSP-YYYYMMDD-NNN；只断言"互不相同"抓不到旧的 3 位随机摇号
    // （20 次撞进 900 个号位的概率只有约 20%），所以要钉"连号"。
    const seqs = rows.map((r: any) => {
      const m = /^INSP-\d{8}-(\d{3,})$/.exec(r.task_no);
      expect(m, `巡检号必须是 INSP-YYYYMMDD-NNN，实际 ${r.task_no}`).not.toBeNull();
      return Number(m![1]);
    });
    const sorted = seqs.sort((a, b) => a - b);
    expect(sorted[sorted.length - 1] - sorted[0], "20 个并发号必须连号").toBe(19);
  });

  it("12 个并发创建作业票：全部 201 且 permit_no 互不相同", async () => {
    const tag = "并发撞号回归作业票";
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request(app)
          .post("/api/v1/safety-permits")
          .set(bearer())
          .send({ title: `${tag} #${i}`, permitType: "动火作业票", workshop: "动力一车间" })
      )
    );
    const failed = results.filter((r) => r.status !== 201);
    expect(
      failed.map((r) => `${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`),
      "并发创建必须全部成功（任一 500 即为编号撞车）"
    ).toEqual([]);

    const nos = results.map((r) => r.body.permitNo);
    expect(new Set(nos).size, `permit_no 出现重复分配: ${nos.join(", ")}`).toBe(12);
    // 同上：12 次撞进 9000 个随机号位只有约 0.7% 概率撞车，必须钉连号才抓得住旧实现
    const seqs = nos.map((no: string) => {
      const m = /^SP-\d{8}-(\d{4,})$/.exec(no);
      expect(m, `作业票号必须是 SP-YYYYMMDD-NNNN，实际 ${no}`).not.toBeNull();
      return Number(m![1]);
    });
    const sorted = seqs.sort((a, b) => a - b);
    expect(sorted[sorted.length - 1] - sorted[0], "12 个并发号必须连号").toBe(11);
  });

  it("10 个并发创建工单：全部 201 且 order_no 互不相同（旧口径靠 Date.now 尾 4 位 + 随机 4 位）", async () => {
    const db = await getDb();
    const { rows: eqRows } = await db.query("SELECT id FROM equipments ORDER BY id LIMIT 1");
    expect(eqRows.length, "种子库里必须有设备，否则这条回归只是空跑").toBe(1);
    const equipmentId = eqRows[0].id;

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post("/api/v1/work-orders")
          .set(bearer())
          .send({
            title: `并发撞号回归工单 #${i}`,
            equipmentId,
            description: `并发创建第 ${i} 单`,
            // 15 分钟同类报单拦截会按设备去重，本用例考的是编号不是去重
            forceSubmit: true,
          })
      )
    );
    const failed = results.filter((r) => r.status !== 201);
    expect(
      failed.map((r) => `${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`),
      "并发创建必须全部成功（任一 500 即为编号撞车）"
    ).toEqual([]);

    const nos = results.map((r) => r.body.orderNo);
    expect(new Set(nos).size, `order_no 出现重复分配: ${nos.join(", ")}`).toBe(10);
    // 只断言"互不相同"抓不到旧实现：尾号是 Date.now() 后 4 位 + 随机 4 位，10 并发撞车概率
    // 只有约 0.5%。所以钉"确定性序号"：4 位补零、且 10 个连号 —— 随机摇号永远给不出连号。
    const seqs = nos.map((no: string) => {
      const m = /^WO-\d{8}-(\d{4})$/.exec(no);
      expect(m, `工单号必须回到 WO-YYYYMMDD-NNNN 口径，实际 ${no}`).not.toBeNull();
      return Number(m![1]);
    });
    const sorted = [...seqs].sort((a, b) => a - b);
    expect(sorted[sorted.length - 1] - sorted[0], "10 个并发号必须连号").toBe(9);

    const { rows } = await db.query("SELECT order_no FROM work_orders WHERE title LIKE $1", [
      "并发撞号回归工单 #%",
    ]);
    expect(rows.length, "回读行数应与并发成功数一致").toBe(10);
    expect(new Set(rows.map((r: any) => r.order_no)).size).toBe(10);
  });

  it("删行留出空洞后 generateLoopNo 不复用仍存在的号（COUNT+1 会撞 UNIQUE）", async () => {
    const db = await getDb();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `PL-${today}-`;
    await db.query("DELETE FROM business_loops WHERE loop_no LIKE $1 || '%'", [prefix]);

    // 001 / 003 / 004（002 已被删除 = 中间空洞）：COUNT+1 = 4 → 撞上现存的 004
    for (const no of ["001", "003", "004"]) {
      await db.query("INSERT INTO business_loops (id, loop_no, goal) VALUES ($1, $2, $3)", [
        `bl-guard-${no}`,
        `${prefix}${no}`,
        `编号守卫占位 ${no}`,
      ]);
    }
    const next = await generateLoopNo();
    expect(next, "新号必须落在最大号之后，而不是行数之后").toBe(`${prefix}005`);
    // 反证旧实现：generateLoopNo 只做计算不落库，所以现存 3 行；
    // COUNT+1 = 004 正好撞上仍存在的 004（新实现取 MAX+1 = 005 才安全）。
    const { rows } = await db.query("SELECT loop_no FROM business_loops WHERE loop_no LIKE $1 || '%'", [prefix]);
    expect(rows.length).toBe(3);
    expect(rows.map((r: any) => r.loop_no)).toContain(`${prefix}004`);
    const countBased = `${prefix}004`;
    expect(rows.map((r: any) => r.loop_no), "旧 COUNT+1 口径必须正撞在现存号上").toContain(countBased);
    expect(next).not.toBe(countBased);
    await db.query("DELETE FROM business_loops WHERE id LIKE 'bl-guard-%'", []);
  });
});
