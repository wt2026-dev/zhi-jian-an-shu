import { LotoLockRepository, SafetyPermitRepository } from "../../db/repositories/index.ts";

export class SafetyInterlockError extends Error {
  readonly code = "SAFETY_INTERLOCK_BLOCKED";
  constructor(message: string) { super(message); }
}

// 作业票生效状态：approved 为双人会签生效；"active" 为种子/历史数据中的作业中状态
const EFFECTIVE_PERMIT_STATUSES = ["approved", "active"];

export function requireDistinctApprovals(permit: any) {
  const guardian = permit.guardianApproval;
  const supervisor = permit.supervisorApproval;
  if (!guardian?.signed || !supervisor?.signed) {
    throw new SafetyInterlockError("作业票必须完成现场监护与主管双人会签。");
  }
  // 新签名带 userId：必须来自两个不同账户，杜绝同一人自签自批。
  if (guardian.userId && supervisor.userId) {
    if (guardian.userId === supervisor.userId) {
      throw new SafetyInterlockError("作业票会签必须由两个不同账户完成，禁止同一人同时签署监护与主管节点。");
    }
    return;
  }
  // 历史签名（种子数据）没有 userId，只能按姓名近似校验；姓名缺失或相同则不放行。
  if (!guardian.name || !supervisor.name || guardian.name === supervisor.name) {
    throw new SafetyInterlockError("作业票历史会签缺少可区分的签署身份，请重新办理双人会签后再开工。");
  }
}

export function requireValidPermit(permit: any, now = Date.now()) {
  const expiry = Date.parse(permit.validUntil);
  if (!Number.isFinite(expiry) || expiry <= now) {
    throw new SafetyInterlockError("作业票已过期或有效期不明确，请重新办理带明确截止时间的作业票。");
  }
}

export function relatedLocks(permit: any, locks: any[]) {
  return locks.filter(lock => lock.permitNo === permit.permitNo || (permit.lotoNumber && lock.lockNo === permit.lotoNumber));
}

// 开工联锁：设备上所有未结案的作业票必须会签生效且在有效期；
// 声明了 LOTO 锁号的作业票，锁必须已登记、与票关联且全部处于上锁状态。
export async function assertCanStartWork(equipmentId: string) {
  const permits = await SafetyPermitRepository.getAll({ equipmentId });
  const active = permits.filter(permit => !["closed", "rejected"].includes(permit.status));
  if (!active.length) {
    throw new SafetyInterlockError("开工前必须为该设备办理安全作业票，并完成双人会签与 LOTO 隔离登记。");
  }
  const locks = await LotoLockRepository.getAll();
  for (const permit of active) {
    if (!EFFECTIVE_PERMIT_STATUSES.includes(permit.status)) {
      throw new SafetyInterlockError("该设备仍有未生效的作业票（待审批或被驳回），禁止开工。");
    }
    requireDistinctApprovals(permit);
    requireValidPermit(permit);
    const linked = relatedLocks(permit, locks);
    if (permit.lotoNumber) {
      if (!linked.some(lock => lock.lockNo === permit.lotoNumber && lock.permitNo === permit.permitNo)) {
        throw new SafetyInterlockError("作业票声明的 LOTO 锁尚未登记或未与作业票关联，未登记不能视为已隔离。");
      }
    }
    // 已登记到该票的锁只要还有处于上锁态之外的（被提前解锁），说明隔离已被破坏。
    if (linked.some(lock => lock.status !== "locked" || !lock.lockedBy || !lock.lockedAt)) {
      throw new SafetyInterlockError("作业票关联的隔离锁存在未登记或已解锁记录，隔离状态不完整，禁止开工。");
    }
  }
}

// 注销作业票前：票关联的锁必须全部登记了释放时间与现场释放说明（有票无锁则无锁可校验）。
export async function assertPermitLocksReleased(permit: any) {
  const locks = relatedLocks(permit, await LotoLockRepository.getAll());
  if (!locks.length) return;
  const bad = locks.find(lock => lock.status !== "unlocked" || !lock.unlockedAt || !String(lock.unlockRemark || "").trim());
  if (bad) {
    throw new SafetyInterlockError(`注销前必须确认锁具 ${bad.lockNo} 已释放，并登记释放时间与现场释放说明；缺少记录不能视为已解锁。`);
  }
}

// 验收归档联锁：设备上不允许存在未结案作业票；已结案票的锁必须留有释放证据。
export async function assertCanArchiveWork(equipmentId: string) {
  const permits = await SafetyPermitRepository.getAll({ equipmentId });
  const open = permits.find(permit => !["closed", "rejected"].includes(permit.status));
  if (open) {
    throw new SafetyInterlockError(`该设备仍有未注销的作业票【${open.permitNo}】，请先完成现场收尾、锁具释放与作业票注销，再验收归档。`);
  }
  for (const permit of permits.filter(permit => permit.status !== "rejected")) {
    await assertPermitLocksReleased(permit);
  }
}

export function respondSafetyInterlock(error: unknown, res: any): boolean {
  if (!(error instanceof SafetyInterlockError)) return false;
  res.status(409).json({ code: error.code, error: error.message, message: error.message });
  return true;
}
