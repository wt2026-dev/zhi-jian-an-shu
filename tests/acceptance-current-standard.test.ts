/**
 * 验收标准：额定电流必须保持 unconfigured（数据红线守卫）。
 *
 * 背景：台账 equipments 里**没有** ratedCurrent 字段。026 迁移与项目数据红线明确：
 *   - 额定电流无真实台账 ⇒ acceptance_standards 的 running_current 行 max/min 必须为 NULL，
 *     confidence='unconfigured'，判定恒为 'unconfigured'；
 *   - **禁止**按 I=P/(√3·U·cosφ) 用额定功率÷电压推算（电压与 cosφ 本身也非铭牌实测），
 *     也禁止把点检备注里的自由文本（如"额定电流 38A"）静默升格为量化验收线。
 *
 * 本文件守住这条红线：即便公式能算出一个"像真的"数（eq-112 → 170.9A），系统也不得采用。
 *
 * 沿革（2026-10-20）：本文件原为一份 WIP 规格，要求实现 derived_rating / inspection_standard
 * 的设备级额定电流标准；经取证确认该功能在代码中完全不存在，且与 026 迁移及数据红线冲突，
 * 维护决策为「保持红线、改写测试」——测试从"验证能判"改为"验证绝不编造"。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { AcceptanceStandardRepository } from "../src/db/repositories/acceptanceStandardRepository.ts";

let app: any;
let techToken: string;

const STANDARD_KEYS = ["no_load_temp", "vibration", "running_current", "no_leak_noise", "safety_guard"];

/** 仅用于证明"公式确实能算出一个像真的数"，断言系统不得采用该值 */
function derivedAmps(kw: number, volts: number, cosPhi = 0.8): number {
  return Math.round(((kw * 1000) / (Math.sqrt(3) * volts * cosPhi)) * 10) / 10;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "tech1", password: "Tech1@2026#Work" });
  expect(login.status).toBe(200);
  techToken = login.body.token;
  expect(techToken).toBeTruthy();
});

async function getAcceptance(equipmentId: string, orderId: string) {
  const res = await request(app)
    .get(`/api/v1/work-orders/${orderId}/acceptance`)
    .set("Authorization", `Bearer ${techToken}`);
  expect(res.status).toBe(200);
  expect(res.body.order.equipmentId).toBe(equipmentId);
  return res;
}

describe("额定电流：无台账即 unconfigured，禁止推算（数据红线）", () => {
  it("有铭牌功率的设备也不得用 I=P/(√3·U·cosφ) 推算（公式值 170.9A 不得入库）", async () => {
    const list = await AcceptanceStandardRepository.getEffective("eq-112");
    const cur = list.find((s) => s.itemKey === "running_current")!;
    expect(cur).toBeTruthy();

    // 公式确实能算出一个"像真的"数——正因如此才必须显式禁止
    expect(derivedAmps(90, 380)).toBe(170.9);

    expect(cur.maxLimit).toBeNull();
    expect(cur.minLimit).toBeNull();
    expect(cur.confidence).toBe("unconfigured");
    expect(cur.scope).toBe("default");
    // 来源必须如实说明"无台账、不推算"，不得包装成设备手册/验收规程
    expect(cur.source).toContain("unconfigured");
    expect(cur.source).not.toContain("设备手册");
    expect(cur.note ?? "").toContain("禁止");
  });

  it("点检备注里的自由文本（额定电流 38A / ≤52.0 A）不得静默升格为量化标准", async () => {
    // eq-104 的点检备注提到"额定电流 38A"、eq-105 提到"电流 ≤52.0 A"——
    // 这些是自由文本，不是结构化台账，系统不得据此凭空造出 maxLimit。
    for (const id of ["eq-104", "eq-105"]) {
      const cur = (await AcceptanceStandardRepository.getEffective(id)).find(
        (s) => s.itemKey === "running_current"
      )!;
      expect(cur.maxLimit, `${id} 不得把备注文本变成量化上限`).toBeNull();
      expect(cur.minLimit, `${id} 不得凭空给下限`).toBeNull();
      expect(cur.confidence, `${id} 必须标 unconfigured`).toBe("unconfigured");
      expect(cur.scope, `${id} 应回落到 default 兜底行`).toBe("default");
    }
  });

  it("没有任何依据的设备同样是 unconfigured：不回落到同型号、不拿整定值冒充", async () => {
    for (const id of ["eq-103", "eq-106", "eq-107", "eq-116"]) {
      const cur = (await AcceptanceStandardRepository.getEffective(id)).find(
        (s) => s.itemKey === "running_current"
      )!;
      expect(cur.maxLimit, `${id} 不该有电流上限`).toBeNull();
      expect(cur.minLimit, `${id} 不该有电流下限`).toBeNull();
      expect(cur.confidence, `${id} 必须标 unconfigured`).toBe("unconfigured");
      expect(cur.scope, `${id} 应回落到 default 兜底行`).toBe("default");
    }
  });

  it("每台设备仍是完整 5 项（额定电流为空不影响其它项）", async () => {
    for (const id of ["eq-101", "eq-104", "eq-112", "eq-114", "eq-103"]) {
      const keys = (await AcceptanceStandardRepository.getEffective(id)).map((s) => s.itemKey).sort();
      expect(keys, `${id} 验收项缺失`).toEqual([...STANDARD_KEYS].sort());
    }
  });
});

describe("额定电流判定链路：无标准 ⇒ 判 unconfigured，绝不判合格", () => {
  const EQ = "eq-112";
  const ORDER = "wo-20240902-005"; // 12# 结晶器冷却循环泵电机三相电流不平衡（种子工单，dispatched）

  it("接口按设备返回空上限 + unconfigured，且不伪造依据字段", async () => {
    const res = await getAcceptance(EQ, ORDER);
    const cur = (res.body.items as any[]).find((i) => i.itemKey === "running_current")!;
    expect(cur.maxLimit).toBeNull();
    expect(cur.minLimit).toBeNull();
    expect(cur.confidence).toBe("unconfigured");
    // 无标准 ⇒ 只能判 unconfigured，绝不判 pending/pass
    expect(cur.verdict).toBe("unconfigured");
    // 没有依据就不许给"依据"字段塞编造内容
    expect(cur.standardBasis ?? null).toBeNull();
  });
});
