import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/repositories/index.ts", () => ({
  EquipmentRepository: { getById: vi.fn(), updateStatus: vi.fn() },
  WorkOrderRepository: { getById: vi.fn(), update: vi.fn(), hasOtherActiveOrders: vi.fn() },
  WorkOrderLogRepository: { getByWorkOrderId: vi.fn() },
  SafetyPermitRepository: { getAll: vi.fn() },
  LotoLockRepository: { getAll: vi.fn() },
  ComplianceCheckRepository: { create: vi.fn() },
  VersionConflictError: class VersionConflictError extends Error {},
}));
vi.mock("../src/server/services/auditService.ts", () => ({ pushNotification: vi.fn() }));
vi.mock("../src/server/services/aiClient.ts", () => ({ callDashScopeJson: vi.fn() }));
vi.mock("../src/utils/aiCache.ts", () => ({ aiCacheInvalidateEquipment: vi.fn() }));
vi.mock("../src/server/controllers/workOrderController.ts", () => ({
  STATUS_LABELS: {}, pushWorkOrderLog: vi.fn(), DUPLICATE_WINDOW_MS: 900000,
  ALLOWED_TRANSITIONS: { dispatched: ["in_progress"], pending_acceptance: ["completed", "in_progress"] },
}));

import { EquipmentRepository, WorkOrderRepository, SafetyPermitRepository, LotoLockRepository } from "../src/db/repositories/index.ts";
import { handleAcceptWorkOrder, handleClaimWorkOrder, handleTransitionStatus } from "../src/server/controllers/workOrderWorkflowController.ts";

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(WorkOrderRepository.getById).mockResolvedValue({ id: "wo-test", equipmentId: "eq-test", status: "pending_acceptance", version: 1 } as any);
  vi.mocked(WorkOrderRepository.update).mockResolvedValue({ id: "wo-test", status: "completed" } as any);
  vi.mocked(WorkOrderRepository.hasOtherActiveOrders).mockResolvedValue(false);
  vi.mocked(EquipmentRepository.getById).mockResolvedValue({ id: "eq-test", healthScore: 43 } as any);
  vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([]);
  vi.mocked(LotoLockRepository.getAll).mockResolvedValue([]);
});

describe("工单安全联锁", () => {
  it("缺少作业票时禁止接单开工且不写入状态", async () => {
    vi.mocked(WorkOrderRepository.getById).mockResolvedValue({ id: "wo-test", equipmentId: "eq-test", status: "dispatched", version: 1 } as any);
    const res = response();
    await handleClaimWorkOrder({ params: { id: "wo-test" }, body: { version: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "SAFETY_INTERLOCK_BLOCKED" }));
    expect(WorkOrderRepository.update).not.toHaveBeenCalled();
  });
  it("验收通过不会写入未经测量的健康分", async () => {
    const res = response();
    await handleAcceptWorkOrder({ params: { id: "wo-test" }, body: { pass: true, version: 1 } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(WorkOrderRepository.update).toHaveBeenCalled();
    for (const call of vi.mocked(EquipmentRepository.updateStatus).mock.calls) {
      expect(call[2]).toBeUndefined();
    }
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });
});
