/**
 * 新建设备台账时不得自带"健康的身体"（数据红线）。
 *
 * 曾经 `handleCreateEquipment` 传给仓储的入参是：
 *     healthScore: 100,
 *     telemetry: { temperature: 0, vibration: 0, voltage: 0, current: 0, loadRate: 0,
 *                  lastUpdated: "待首次遥测上报" }
 *
 * 于是任何新建设备一落库就带着"温度 0°C / 振动 0 / 健康 100 分"的读数：
 * - 0°C / 0mm/s 是可判定的真实读数语义，界面会显示成一台冷态正常运转的设备；
 * - `lastUpdated: "待首次遥测上报"` 还会被下游当成"已经有过上报"；
 * - 100 分等于"新建即满分健康"，而健康分本是评估结果，不可能在录入时得知。
 *
 * 这里直接拦在控制器 → 仓储的边界上，断言这两个字段是 null。
 * ⚠️ 同时做正向对照：其它字段必须照常透传，否则"全是 null"也能让"是 null"通过。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  create: vi.fn(),
  addAuditLog: vi.fn(),
}));

vi.mock("../src/db/repositories/index.ts", () => ({
  EquipmentRepository: { getAll: mocks.getAll, create: mocks.create },
}));
vi.mock("../src/server/services/auditService.ts", () => ({
  addAuditLog: mocks.addAuditLog,
  pushNotification: vi.fn(),
}));
vi.mock("../src/server/services/dispatchService.ts", () => ({
  computeEquipmentCoords: vi.fn(() => ({ x: 0, y: 0 })),
}));

import { handleCreateEquipment } from "../src/server/controllers/equipmentController.ts";

async function createWith(body: Record<string, unknown>) {
  const req = { body, user: { id: "u-1", name: "管理员", role: "admin" } };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  await handleCreateEquipment(req as never, res as never);
  return { res, payload: mocks.create.mock.calls[0]?.[0] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAll.mockResolvedValue([]);
  mocks.create.mockImplementation(async (input: unknown) => ({ ...(input as object), id: "eq-new" }));
});

describe("新建设备不得自带遥测与健康分", () => {
  it("healthScore 必须为 null（未评估），不是 100", async () => {
    const { payload } = await createWith({
      code: "EQ-T-001",
      name: "测试泵",
      category: "泵类设备",
      workshop: "一车间",
    });
    expect(payload).toBeDefined();
    expect(payload.healthScore).toBeNull();
    // 反向：不能是 100，也不能是 0（0 分同样是"已评估且极差"的结论）
    expect(payload.healthScore).not.toBe(100);
    expect(payload.healthScore).not.toBe(0);
  });

  it("telemetry 必须为 null（未接入），不得写一套 0 值快照", async () => {
    const { payload } = await createWith({
      code: "EQ-T-002",
      name: "测试空压机",
      category: "压缩机",
    });
    expect(payload.telemetry).toBeNull();
  });

  it("正向对照：其余字段照常透传（证明上面两条不是「整个对象为空」造成的）", async () => {
    const { payload } = await createWith({
      code: "EQ-T-003",
      name: "测试减速机",
      category: "传动减速机",
      workshop: "二车间",
      location: "2F-B12",
      manufacturer: "某厂",
      criticality: "关键核心",
    });
    expect(payload.code).toBe("EQ-T-003");
    expect(payload.name).toBe("测试减速机");
    expect(payload.category).toBe("传动减速机");
    expect(payload.workshop).toBe("二车间");
    expect(payload.location).toBe("2F-B12");
    expect(payload.manufacturer).toBe("某厂");
    expect(payload.criticality).toBe("关键核心");
    // specs 有默认值（安装工段），说明对象是"正常构造"而非空壳
    expect(payload.specs).toEqual({ 安装工段: "二车间" });
  });
});
