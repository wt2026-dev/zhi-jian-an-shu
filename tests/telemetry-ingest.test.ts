/**
 * 遥测数据摄入接口（POST /api/v1/telemetry/ingest）集成用例。
 *
 * 全部走真实种子数据与真实仓储写入，不打桩：
 *   · 设备 = eq-101 / eq-102（种子设备，equipment_telemetry 已有 48h 仿真历史）；
 *   · 摄入读数走真实接口落库，随后经 telemetry-history 读回验证；
 *   · 鉴权矩阵：未登录 401 / operator 越权 403 / manager、tech 可写；
 *   · 校验矩阵：空 points 400、超范围读数 400、未知设备 404、批量多设备成功。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let managerToken: string;
let techToken: string;
let operatorToken: string;

async function login(username: string, password: string): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send({ username, password });
  expect(res.status).toBe(200);
  return res.body.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function validPoint(equipmentId = "eq-101", overrides: Record<string, unknown> = {}) {
  return {
    equipmentId,
    recordedAtDt: new Date().toISOString(),
    temperature: 61.5,
    vibration: 2.1,
    current: 52.3,
    voltage: 380.1,
    pressure: 0.86,
    loadRate: 72.5,
    rpm: 1498,
    ...overrides,
  };
}

beforeAll(async () => {
  app = await createApp();
  managerToken = await login("manager", "Manager@2026#Safe");
  techToken = await login("tech1", "Tech1@2026#Work");
  operatorToken = await login("operator", "Operator@2026#Line");
});

describe("遥测摄入 · 鉴权矩阵", () => {
  it("未登录：401", async () => {
    const res = await request(app)
      .post("/api/v1/telemetry/ingest")
      .send({ points: [validPoint()] });
    expect(res.status).toBe(401);
  });

  it("operator 越权：403（摄入为写操作，按 RBAC 收口）", async () => {
    const res = await request(app)
      .post("/api/v1/telemetry/ingest")
      .set(auth(operatorToken))
      .send({ points: [validPoint()] });
    expect(res.status).toBe(403);
  });

  it("manager / tech 可写", async () => {
    for (const token of [managerToken, techToken]) {
      const res = await request(app)
        .post("/api/v1/telemetry/ingest")
        .set(auth(token))
        .send({ source: "manual-test", points: [validPoint()] });
      expect(res.status).toBe(200);
      expect(res.body.ingested).toBe(1);
    }
  });
});

describe("遥测摄入 · 校验矩阵", () => {
  it("空 points：400", async () => {
    const res = await request(app)
      .post("/api/v1/telemetry/ingest")
      .set(auth(managerToken))
      .send({ points: [] });
    expect(res.status).toBe(400);
  });

  it("超范围读数（1e99）：400", async () => {
    const res = await request(app)
      .post("/api/v1/telemetry/ingest")
      .set(auth(managerToken))
      .send({ points: [validPoint("eq-101", { temperature: 1e99 })] });
    expect(res.status).toBe(400);
  });

  it("未知设备：404，且整体拒绝", async () => {
    const res = await request(app)
      .post("/api/v1/telemetry/ingest")
      .set(auth(managerToken))
      .send({
        points: [
          validPoint("eq-101"),
          validPoint("eq-NOT-EXIST"),
        ],
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("EQUIPMENT_NOT_FOUND");
    expect(res.body.missingEquipmentIds).toContain("eq-NOT-EXIST");
  });

  it("超过 500 点：400", async () => {
    const points = Array.from({ length: 501 }, () => validPoint("eq-101"));
    const res = await request(app)
      .post("/api/v1/telemetry/ingest")
      .set(auth(managerToken))
      .send({ points });
    expect(res.status).toBe(400);
  });
});

describe("遥测摄入 · 落库与读回", () => {
  it("批量多设备摄入成功，且 telemetry-history 可读回最新读数", async () => {
    const marker = 77.7;
    const res = await request(app)
      .post("/api/v1/telemetry/ingest")
      .set(auth(managerToken))
      .send({
        source: "ingest-integration-test",
        points: [
          validPoint("eq-101", { temperature: marker, rpm: 1234 }),
          validPoint("eq-102", { temperature: marker + 1, rpm: 1235 }),
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.ingested).toBe(2);
    expect(res.body.equipmentIds.sort()).toEqual(["eq-101", "eq-102"]);

    // 读回：history 按时间升序，最新一条应带摄入标记值
    const history = await request(app)
      .get("/api/v1/equipments/eq-101/telemetry-history?hours=24")
      .set(auth(managerToken));
    expect(history.status).toBe(200);
    const points = history.body.points as any[];
    const last = points[points.length - 1];
    expect(Number(last.temperature)).toBe(marker);
    expect(Number(last.rpm)).toBe(1234);
  });
});
