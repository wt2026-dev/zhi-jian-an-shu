import { beforeEach, describe, expect, it, vi } from "vitest";

// 安全联锁规则单元测试：只测 src/server/services/safetyInterlock.ts 的纯规则逻辑。
// 与 work-order-safety-guards.test.ts（走 controller）不同，这里直接 mock 两个仓库，
// 不触 PGlite / HTTP，逐条覆盖拦截分支与放行分支。
vi.mock("../src/db/repositories/index.ts", () => ({
  SafetyPermitRepository: { getAll: vi.fn() },
  LotoLockRepository: { getAll: vi.fn() },
}));

import {
  assertCanArchiveWork,
  assertCanStartWork,
  assertPermitLocksReleased,
  relatedLocks,
  requireDistinctApprovals,
  requireValidPermit,
  respondSafetyInterlock,
  SafetyInterlockError,
} from "../src/server/services/safetyInterlock.ts";
import { LotoLockRepository, SafetyPermitRepository } from "../src/db/repositories/index.ts";

const EQ = "eq-interlock-1";

/** 合法生效的作业票基线：approved（双人会签生效态）、有效期未来 8 小时、无 LOTO 声明 */
function permit(overrides: Record<string, any> = {}) {
  return {
    permitNo: "SP-2026-001",
    equipmentId: EQ,
    status: "approved",
    validUntil: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    guardianApproval: { signed: true, userId: "u-guardian", name: "监护员甲" },
    supervisorApproval: { signed: true, userId: "u-supervisor", name: "主管乙" },
    ...overrides,
  };
}

/** 已登记且处于上锁态的隔离锁基线：与基线作业票关联 */
function lock(overrides: Record<string, any> = {}) {
  return {
    lockNo: "LOTO-001",
    permitNo: "SP-2026-001",
    status: "locked",
    lockedBy: "李志强 (电气专工)",
    lockedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    ...overrides,
  };
}

/** 断言 promise 以 SafetyInterlockError 拒绝，且消息包含给定片段 */
async function expectBlocked(fn: () => unknown | Promise<unknown>, fragment: RegExp) {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SafetyInterlockError);
  const err = caught as SafetyInterlockError;
  expect(err.code).toBe("SAFETY_INTERLOCK_BLOCKED");
  expect(err.message).toMatch(fragment);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([] as any);
  vi.mocked(LotoLockRepository.getAll).mockResolvedValue([] as any);
});

describe("requireValidPermit：作业票有效期校验", () => {
  it("已过期（validUntil 早于 now）→ 拦截", () => {
    const now = Date.parse("2026-06-01T08:00:00Z");
    expect(() =>
      requireValidPermit({ validUntil: "2026-01-01T00:00:00Z" }, now),
    ).toThrow(SafetyInterlockError);
    expect(() => requireValidPermit({ validUntil: "2026-01-01T00:00:00Z" }, now)).toThrow(/已过期/);
  });

  it("有效期恰好等于 now → 视为过期拦截（边界）", () => {
    const now = Date.parse("2026-06-01T08:00:00Z");
    expect(() => requireValidPermit({ validUntil: "2026-06-01T08:00:00Z" }, now)).toThrow(/已过期/);
  });

  it("validUntil 无法解析为日期 → 拦截（有效期不明确）", () => {
    const now = Date.parse("2026-06-01T08:00:00Z");
    expect(() => requireValidPermit({ validUntil: "not-a-date" }, now)).toThrow(/已过期|有效期不明确/);
  });

  it("validUntil 晚于 now → 通过", () => {
    const now = Date.parse("2026-06-01T08:00:00Z");
    expect(requireValidPermit({ validUntil: "2026-06-01T09:00:00Z" }, now)).toBeUndefined();
  });
});

describe("requireDistinctApprovals：双人会签校验", () => {
  it("缺少监护签署（guardian.signed=false）→ 拦截", () => {
    const p = permit({ guardianApproval: { signed: false, userId: "u-guardian", name: "监护员甲" } });
    expect(() => requireDistinctApprovals(p)).toThrow(/双人会签/);
  });

  it("缺少主管签署节点（supervisorApproval 缺失）→ 拦截", () => {
    const p = permit({ supervisorApproval: undefined });
    expect(() => requireDistinctApprovals(p)).toThrow(/双人会签/);
  });

  it("同一账户同时签署监护与主管（userId 相同）→ 拦截，杜绝自签自批", () => {
    const p = permit({ supervisorApproval: { signed: true, userId: "u-guardian", name: "监护员甲" } });
    expect(() => requireDistinctApprovals(p)).toThrow(/两个不同账户/);
  });

  it("历史签名（无 userId）姓名相同 → 拦截（视为不可区分）", () => {
    const p = permit({
      guardianApproval: { signed: true, name: "同名签署人" },
      supervisorApproval: { signed: true, name: "同名签署人" },
    });
    expect(() => requireDistinctApprovals(p)).toThrow(/可区分的签署身份/);
  });

  it("历史签名（无 userId）姓名缺失 → 拦截", () => {
    const p = permit({
      guardianApproval: { signed: true },
      supervisorApproval: { signed: true, name: "主管乙" },
    });
    expect(() => requireDistinctApprovals(p)).toThrow(/可区分的签署身份/);
  });

  it("不同账户会签（userId 不同）→ 通过", () => {
    expect(requireDistinctApprovals(permit())).toBeUndefined();
  });

  it("历史签名姓名可区分 → 通过", () => {
    const p = permit({
      guardianApproval: { signed: true, name: "监护员甲" },
      supervisorApproval: { signed: true, name: "主管乙" },
    });
    expect(requireDistinctApprovals(p)).toBeUndefined();
  });
});

describe("relatedLocks：票-锁关联匹配", () => {
  it("按 permitNo 关联", () => {
    const p = permit();
    const locks = [lock(), lock({ lockNo: "LOTO-002", permitNo: "SP-OTHER" })];
    expect(relatedLocks(p, locks)).toHaveLength(1);
  });

  it("无 permitNo 匹配但 lockNo 与票的 lotoNumber 一致 → 仍视为关联", () => {
    const p = permit({ lotoNumber: "LOTO-009" });
    const locks = [lock({ lockNo: "LOTO-009", permitNo: "SP-OTHER" })];
    expect(relatedLocks(p, locks)).toHaveLength(1);
  });

  it("完全无关的锁不纳入关联", () => {
    const p = permit({ lotoNumber: "LOTO-009" });
    const locks = [lock({ lockNo: "LOTO-002", permitNo: "SP-OTHER" })];
    expect(relatedLocks(p, locks)).toHaveLength(0);
  });
});

describe("assertCanStartWork：开工联锁", () => {
  it("设备上没有任何作业票 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /办理安全作业票/);
    expect(SafetyPermitRepository.getAll).toHaveBeenCalledWith({ equipmentId: EQ });
  });

  it("存在未生效（待审批）作业票 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ status: "pending_approval" }),
    ] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /未生效的作业票/);
  });

  it("作业票已过期 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ validUntil: new Date(Date.now() - 1000).toISOString() }),
    ] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /已过期/);
  });

  it("作业票有效期无法解析 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ validUntil: "bogus" }),
    ] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /已过期|有效期不明确/);
  });

  it("缺少主管会签 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ supervisorApproval: { signed: false, userId: "u-supervisor", name: "主管乙" } }),
    ] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /双人会签/);
  });

  it("同一账户同时签署监护与主管 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ supervisorApproval: { signed: true, userId: "u-guardian", name: "监护员甲" } }),
    ] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /两个不同账户/);
  });

  it("错误票锁关联：声明 LOTO 锁号但锁登记在别的作业票下 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ lotoNumber: "LOTO-001" }),
    ] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([
      lock({ permitNo: "SP-2026-999" }), // lockNo 匹配但 permitNo 不匹配 → 未与该票关联
    ] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /尚未登记或未与作业票关联/);
  });

  it("错误票锁关联：锁挂在票下但锁号与声明的 LOTO 号不一致 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ lotoNumber: "LOTO-001" }),
    ] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([
      lock({ lockNo: "LOTO-002" }), // permitNo 匹配但 lockNo 不匹配声明号
    ] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /尚未登记或未与作业票关联/);
  });

  it("关联锁已被提前解锁 → 拦截（隔离被破坏）", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ lotoNumber: "LOTO-001" }),
    ] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([
      lock({ status: "unlocked", unlockedAt: new Date().toISOString(), unlockRemark: "误操作" }),
    ] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /已解锁记录/);
  });

  it("关联锁缺少上锁人 → 拦截（隔离状态不完整）", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ lotoNumber: "LOTO-001" }),
    ] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([lock({ lockedBy: "" })] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /隔离状态不完整/);
  });

  it("关联锁缺少上锁时间 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ lotoNumber: "LOTO-001" }),
    ] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([lock({ lockedAt: undefined })] as any);
    await expectBlocked(() => assertCanStartWork(EQ), /隔离状态不完整/);
  });

  it("与票无关的解锁锁具不影响开工（不纳入关联）", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([permit()] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([
      lock({ lockNo: "LOTO-OTHER", permitNo: "SP-OTHER", status: "unlocked" }),
    ] as any);
    await expect(assertCanStartWork(EQ)).resolves.toBeUndefined();
  });

  it("无 LOTO 声明 + 会签生效 + 有效期内 → 放行（合法开工）", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([permit()] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([] as any);
    await expect(assertCanStartWork(EQ)).resolves.toBeUndefined();
  });

  it("声明 LOTO 且锁已登记、与票关联、全部上锁 → 放行", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ lotoNumber: "LOTO-001" }),
    ] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([lock()] as any);
    await expect(assertCanStartWork(EQ)).resolves.toBeUndefined();
  });

  it("被驳回（rejected）的作业票不参与开工校验", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ status: "rejected", validUntil: "not-a-date" }),
      permit(),
    ] as any);
    await expect(assertCanStartWork(EQ)).resolves.toBeUndefined();
  });
});

describe("assertPermitLocksReleased：注销前释放证据校验", () => {
  it("锁仍处于上锁态 → 拦截并报出锁号", async () => {
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([lock({ lockNo: "LOTO-007" })] as any);
    await expectBlocked(
      () => assertPermitLocksReleased(permit()),
      /LOTO-007/,
    );
  });

  it("已解锁但缺少释放时间 → 拦截", async () => {
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([
      lock({ status: "unlocked", unlockedAt: undefined, unlockRemark: "已恢复" }),
    ] as any);
    await expectBlocked(() => assertPermitLocksReleased(permit()), /释放时间/);
  });

  it("释放说明为空白字符串 → 拦截", async () => {
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([
      lock({ status: "unlocked", unlockedAt: new Date().toISOString(), unlockRemark: "   " }),
    ] as any);
    await expectBlocked(() => assertPermitLocksReleased(permit()), /释放说明/);
  });

  it("全部锁登记了释放时间与说明 → 通过", async () => {
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([
      lock({ status: "unlocked", unlockedAt: new Date().toISOString(), unlockRemark: "检修完毕恢复送电" }),
      lock({ lockNo: "LOTO-002", status: "unlocked", unlockedAt: new Date().toISOString(), unlockRemark: "双人确认" }),
    ] as any);
    await expect(assertPermitLocksReleased(permit())).resolves.toBeUndefined();
  });

  it("票未声明 LOTO 且无关联锁 → 无锁可校验，直接通过", async () => {
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([
      lock({ lockNo: "LOTO-OTHER", permitNo: "SP-OTHER", status: "locked" }),
    ] as any);
    await expect(assertPermitLocksReleased(permit())).resolves.toBeUndefined();
  });
});

describe("assertCanArchiveWork：验收归档联锁", () => {
  it("存在未注销（open）作业票 → 拦截并包含票号", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ permitNo: "SP-2026-001" }),
    ] as any);
    await expectBlocked(() => assertCanArchiveWork(EQ), /未注销的作业票.*SP-2026-001/);
  });

  it("已结案票的锁缺少释放证据 → 拦截", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ status: "closed" }),
    ] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([lock()] as any); // 仍上锁
    await expectBlocked(() => assertCanArchiveWork(EQ), /释放/);
  });

  it("被驳回的票不需要锁释放证据 → 通过", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ status: "rejected" }),
    ] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([lock()] as any);
    await expect(assertCanArchiveWork(EQ)).resolves.toBeUndefined();
  });

  it("全部结案且释放证据齐全 → 通过", async () => {
    vi.mocked(SafetyPermitRepository.getAll).mockResolvedValue([
      permit({ status: "closed" }),
      permit({ permitNo: "SP-2026-002", status: "closed" }),
    ] as any);
    vi.mocked(LotoLockRepository.getAll).mockResolvedValue([
      lock({ status: "unlocked", unlockedAt: new Date().toISOString(), unlockRemark: "恢复送电" }),
      lock({ lockNo: "LOTO-002", permitNo: "SP-2026-002", status: "unlocked", unlockedAt: new Date().toISOString(), unlockRemark: "解除挂牌" }),
    ] as any);
    await expect(assertCanArchiveWork(EQ)).resolves.toBeUndefined();
  });
});

describe("respondSafetyInterlock：联锁错误响应", () => {
  function response() {
    return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  }

  it("SafetyInterlockError → 写 409 + code + message 并返回 true", () => {
    const res = response();
    const err = new SafetyInterlockError("作业票已过期或有效期不明确，请重新办理带明确截止时间的作业票。");
    expect(respondSafetyInterlock(err, res)).toBe(true);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SAFETY_INTERLOCK_BLOCKED", error: err.message }),
    );
  });

  it("普通错误不处理（返回 false）且不写响应", () => {
    const res = response();
    expect(respondSafetyInterlock(new Error("boom"), res)).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
