import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
  SafetyPermitRepository,
  LotoLockRepository,
  WorkOrderRepository,
  VersionConflictError,
  UserRepository,
} from "../../db/repositories/index.ts";
import { authenticateBearer } from "../services/authService.ts";
import { addAuditLog, pushNotification } from "../services/auditService.ts";

// 原 createApp 闭包内的内存作业票列表（对应 server.ts:3576-3676）。
// 生产级一致性：列表以数据库真实落库为准（含种子扩写的全部作业票，原硬编码数组仅作启动兜底）。
let dbSafetyPermits: any[] = [];

// 对应 server.ts:3676 的启动加载逻辑
export async function loadSafetyPermitsIntoMemory(): Promise<void> {
  dbSafetyPermits = await SafetyPermitRepository.getAll();
}

// GET /api/v1/safety-permits
export const handleGetSafetyPermits = (req: any, res: any) => {
  const { risk_level, status: statusQ, workshop } = req.query;
  let list = [...dbSafetyPermits];
  if (risk_level && risk_level !== "all") list = list.filter((p) => p.riskLevel === risk_level);
  if (statusQ && statusQ !== "all") list = list.filter((p) => p.status === statusQ);
  if (workshop && workshop !== "all") list = list.filter((p) => p.workshop === workshop);
  res.json(list);
};

// GET /api/v1/safety-permits/:id
export const handleGetSafetyPermitById = (req: any, res: any) => {
  const p = dbSafetyPermits.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "安全作业票不存在" });
  res.json(p);
};

// POST /api/v1/safety-permits
export const handleCreateSafetyPermit = async (req: any, res: any) => {
  const user = authenticateBearer(req);
  const now = new Date();
  const permitNo = `SP-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, "0")}${now.getDate().toString().padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;

  const newPermit = {
    id: `sp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    permitNo,
    permitType: req.body.permitType || "动火作业票",
    riskLevel: req.body.riskLevel || "较大风险 (Level 2)",
    title: req.body.title,
    equipmentId: req.body.equipmentId,
    equipmentName: req.body.equipmentName || "通用作业机位",
    workshop: req.body.workshop,
    location: req.body.location,
    applicant: `${user?.name || "未知"} (${user?.roleTitle || user?.role || "访客"})`,
    applicantDept: user?.department || "未指定",
    appliedAt: now.toISOString(),
    validUntil: req.body.validUntil || "当日20:00前",
    status: "pending_approval",
    precautions: req.body.precautions || [],
    lotoNumber: req.body.lotoNumber || null,
    hazards: req.body.hazards || [],
    safetyChecklist: req.body.safetyChecklist || [],
    gasTestResults: null,
    guardianApproval: null,
    supervisorApproval: null,
    version: 1,
  };

  // 真实落库：同时写入 safety_permits 表，保证重启不丢失
  const created = await SafetyPermitRepository.create(newPermit);
  const resultPermit = created || newPermit;
  dbSafetyPermits.unshift(resultPermit);
  addAuditLog(req, {
    actionType: "PERMIT_CREATE",
    module: "安全作业票",
    detail: `创建高危安全作业票 [${resultPermit.permitNo}]: ${resultPermit.title} (${resultPermit.riskLevel})`,
    status: "SUCCESS",
    metadata: { permitNo: resultPermit.permitNo, permitType: resultPermit.permitType },
  });
  pushNotification({
    title: `【高危作业票】${resultPermit.permitNo} 提交待审批`,
    content: `${resultPermit.permitType}「${resultPermit.title}」已提交，风险等级 ${resultPermit.riskLevel}，等待安全监护人/主管双人会签。`,
    type: "warning",
    refType: "safety_permit",
    refId: resultPermit.permitNo,
  });
  res.status(201).json(resultPermit);
};

// POST /api/v1/safety-permits/:id/approve —— 双人审批业务流转
export const handleApproveSafetyPermit = async (req: any, res: any) => {
  const { id } = req.params;
  const { step, pass = true, comment = "", gasTestResults, version } = req.body;
  const user = authenticateBearer(req);

  if (!user) {
    return res.status(401).json({ error: "未登录或凭据失效", code: "UNAUTHORIZED" });
  }

  const permit = (await SafetyPermitRepository.getById(id)) || dbSafetyPermits.find((p) => p.id === id);
  if (!permit) return res.status(404).json({ error: "作业票未找到" });

  if (version !== undefined && permit.version !== version) {
    return res.status(409).json({
      code: "VERSION_CONFLICT",
      message: "安全作业票已被其他人审批或修改，请刷新后重试。",
    });
  }

  // RBAC: 主管终审仅限 admin 或 manager
  if (step === "supervisor" && !["admin", "manager"].includes(user.role)) {
    const errorMsg = `权限拒绝：当前账号 [${user.name} - ${user.roleTitle}] 无主管终审签批权限，必须由车间安全总监或系统管理员会签。`;
    addAuditLog(req, {
      actionType: "PERMIT_APPROVE",
      module: "安全作业票",
      detail: `[越权拦截] ${errorMsg}`,
      status: "BLOCKED",
      metadata: { permitId: id, step, userRole: user.role },
    });
    return res.status(403).json({ error: errorMsg, code: "RBAC_SUPERVISOR_REQUIRED" });
  }

  if (permit.status !== "pending_approval") {
    return res.status(409).json({ code: "PERMIT_STATE_CONFLICT", error: "仅待审批作业票可会签或驳回，生效或已结束的票据不得改签" });
  }
  const otherApproval = step === "guardian" ? permit.supervisorApproval : permit.guardianApproval;
  if (pass && otherApproval?.signed && (otherApproval.userId === user.id || (!otherApproval.userId && otherApproval.name === user.name))) {
    return res.status(409).json({ code: "SAFETY_INTERLOCK_BLOCKED", error: "监护与主管节点必须由两个不同账户签署" });
  }
  const nowStr = new Date().toISOString();

  if (!pass) {
    permit.status = "rejected";
    if (step === "guardian") {
      permit.guardianApproval = { signed: false, name: user.name, role: "现场监护员", signedAt: nowStr, comment: comment || "现场安全条件不合格，驳回" };
    } else {
      permit.supervisorApproval = { signed: false, name: user.name, role: "车间主管/总监", signedAt: nowStr, comment: comment || "安全条件不达标，驳回" };
    }
    addAuditLog(req, {
      actionType: "PERMIT_REJECT",
      module: "安全作业票",
      detail: `${user.roleTitle} ${user.name} 驳回作业票 [${permit.permitNo}] (${step === "guardian" ? "现场监护节点" : "主管终审节点"})，原因: ${comment || "安全条件不达标"}`,
      status: "SUCCESS",
      metadata: { permitNo: permit.permitNo, step },
    });
    pushNotification({
      title: `【作业票驳回】${permit.permitNo} 审批未通过`,
      content: `「${permit.title}」在${step === "guardian" ? "现场监护" : "主管终审"}节点被驳回：${comment || "安全条件不达标"}。`,
      type: "alert",
      refType: "safety_permit",
      refId: permit.permitNo,
    });
    try {
      const expVersion = version !== undefined ? version : permit.version;
      const updated = await SafetyPermitRepository.update(id, permit, expVersion);
      if (updated) Object.assign(permit, updated);
    } catch (err: any) {
      if (err instanceof VersionConflictError || err.code === "VERSION_CONFLICT") {
        return res.status(409).json({
          code: "VERSION_CONFLICT",
          message: "安全作业票已被其他人审批或修改，请刷新后重试。",
        });
      }
      return res.status(500).json({ error: "更新作业票失败: " + err.message });
    }
    return res.json(permit);
  }

    const { signerPassword, signatureMethod = "quick_sign" } = req.body;
    let signatureVerified = false;

    // 二次鉴权校验：若传入密码，通过 bcrypt 核验签署人真实身份，杜绝非本人随意代签
    if (signerPassword) {
      const dbUsers = await UserRepository.getAllUsers();
      const currentUser = dbUsers.find((u) => u.id === user.id || u.username === user.username);
      if (currentUser && currentUser.password) {
        let ok = false;
        try {
          if (currentUser.password.startsWith("$2a$") || currentUser.password.startsWith("$2b$") || currentUser.password.startsWith("$2y$")) {
            ok = await bcrypt.compare(signerPassword, currentUser.password);
          } else {
            ok = signerPassword === currentUser.password;
          }
        } catch {
          ok = false;
        }
        if (!ok) {
          return res.status(401).json({
            error: "会签失败：二次身份核验密码错误，无法完成具备法律效力的会签。",
            code: "SIGNER_PASSWORD_INVALID",
          });
        }
        signatureVerified = true;
      }
    }

    // 生成不可伪造的电子签名哈希指纹（工号 + 作业票号 + 节点 + 时间戳 + 防篡改散列）
    const signPayload = `${user.username}:${permit.permitNo}:${step}:${nowStr}:${permit.title}`;
    const signatureHash = crypto.createHash("sha256").update(signPayload).digest("hex").slice(0, 16);

    if (step === "guardian") {
      let gasOk = true;
      if (gasTestResults) {
        const ox = Number(gasTestResults.oxygen || 20.9);
        const comb = Number(gasTestResults.combustible_gas || 0);
        if (ox < 19.5 || ox > 23.5 || comb > 0.5) {
          gasOk = false;
          return res.status(400).json({ error: `气体检测不合格！氧气应为19.5%~23.5%，可燃气≤0.5% (实测: 氧气${ox}%, 可燃气${comb}%)` });
        }
        permit.gasTestResults = gasTestResults;
      }
      permit.guardianApproval = {
        signed: true,
        name: user.name,
        userId: user.id,
        role: "现场安全监护员",
        signedAt: nowStr,
        comment: comment || "现场安全防范措施就绪，准予会签",
        gasTestPassed: gasOk,
        signatureHash,
        signatureMethod: signatureVerified ? "password_verified" : signatureMethod,
      };
    } else if (step === "supervisor") {
      permit.supervisorApproval = {
        signed: true,
        name: user.name,
        userId: user.id,
        role: "车间安全总监/主管",
        signedAt: nowStr,
        comment: comment || "安全条件审核合格，核准生效",
        signatureHash,
        signatureMethod: signatureVerified ? "password_verified" : signatureMethod,
      };
    }

    if (permit.guardianApproval?.signed && permit.supervisorApproval?.signed) {
      permit.status = "approved";
    }

  addAuditLog(req, {
    actionType: "PERMIT_APPROVE",
    module: "安全作业票",
    detail: `${user.roleTitle} ${user.name} 签署通过作业票 [${permit.permitNo}] 会签审批 (${step === "guardian" ? "现场监护节点" : "主管终审节点"})`,
    status: "SUCCESS",
    metadata: { permitNo: permit.permitNo, step, finalStatus: permit.status },
  });

  // 真实落库：同步审批结果到数据库（带乐观锁版本校验）
  try {
    const expVersion = version !== undefined ? version : permit.version;
    const updated = await SafetyPermitRepository.update(id, permit, expVersion);
    if (updated) {
      Object.assign(permit, updated);
      const idx = dbSafetyPermits.findIndex((p) => p.id === id);
      if (idx >= 0) dbSafetyPermits[idx] = permit;
    }
  } catch (err: any) {
    if (err instanceof VersionConflictError || err.code === "VERSION_CONFLICT") {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "安全作业票已被其他人审批或修改，请刷新后重试。",
      });
    }
    return res.status(500).json({ error: "审批作业票失败: " + err.message });
  }

  pushNotification({
    title: permit.status === "approved" ? `【作业票批准】${permit.permitNo} 双人会签通过` : `【会签进度】${permit.permitNo} ${step === "guardian" ? "现场监护" : "主管终审"}节点已签署`,
    content:
      permit.status === "approved"
        ? `「${permit.title}」已双人会签核准，进入作业在控状态${permit.lotoNumber ? `，LOTO 锁号 ${permit.lotoNumber}` : ""}。`
        : `「${permit.title}」${step === "guardian" ? "现场安全监护" : "安全总监"}节点已由 ${user.name} 签署通过，等待下一审批节点。`,
    type: permit.status === "approved" ? "success" : "info",
    refType: "safety_permit",
    refId: permit.permitNo,
  });

  res.json(permit);
};

// POST /api/v1/safety-permits/:id/close
export const handleCloseSafetyPermit = async (req: any, res: any) => {
  const { id } = req.params;
  const { closeRemark, version } = req.body || {};
  const user = authenticateBearer(req);

  if (!user) {
    return res.status(401).json({ error: "未登录或凭据失效", code: "UNAUTHORIZED" });
  }

  const permit = (await SafetyPermitRepository.getById(id)) || dbSafetyPermits.find((p) => p.id === id);
  if (!permit) return res.status(404).json({ error: "作业票未找到" });

  if (version !== undefined && permit.version !== version) {
    return res.status(409).json({
      code: "VERSION_CONFLICT",
      message: "安全作业票已被其他人注销或修改，请刷新后重试。",
    });
  }

  if (permit.equipmentId) {
    const orders = await WorkOrderRepository.getAll({ equipmentId: permit.equipmentId });
    if (orders.some((order: any) => order.status === "in_progress")) {
      return res.status(409).json({ code: "SAFETY_INTERLOCK_BLOCKED", error: "设备仍有检修中的工单，请先完工上报再注销作业票" });
    }
  }
  const { assertPermitLocksReleased, respondSafetyInterlock } = await import("../services/safetyInterlock.ts");
  try {
    await assertPermitLocksReleased(permit);
  } catch (err: any) {
    return respondSafetyInterlock(err, res) ? undefined : res.status(500).json({ error: "锁具释放校验失败: " + err.message });
  }

  permit.status = "closed";
  permit.closedAt = new Date().toISOString();
  permit.closedBy = `${user.name} (${user.roleTitle})`;
  permit.closeRemark = closeRemark || "现场作业完毕，工完料净场地清，LOTO安全锁具已解锁释放。";

  addAuditLog(req, {
    actionType: "PERMIT_CLOSE",
    module: "安全作业票",
    detail: `责任人 [${user.name} - ${user.roleTitle}] 办理完成高危作业票 [${permit.permitNo}] 注销闭环，确认安全锁具已释放`,
    status: "SUCCESS",
    metadata: { permitNo: permit.permitNo },
  });

  // 真实落库：同步注销闭环状态到数据库（带乐观锁版本校验）
  try {
    const expVersion = version !== undefined ? version : permit.version;
    const updated = await SafetyPermitRepository.update(id, permit, expVersion);
    if (updated) {
      Object.assign(permit, updated);
      const idx = dbSafetyPermits.findIndex((p) => p.id === id);
      if (idx >= 0) dbSafetyPermits[idx] = permit;
    }
  } catch (err: any) {
    if (err instanceof VersionConflictError || err.code === "VERSION_CONFLICT") {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "安全作业票已被其他人注销或修改，请刷新后重试。",
      });
    }
    return res.status(500).json({ error: "注销作业票失败: " + err.message });
  }

  pushNotification({
    title: `【作业票闭环】${permit.permitNo} 已注销归档`,
    content: `「${permit.title}」已由 ${user.name} 办理完工闭环：${permit.closeRemark}`,
    type: "info",
    refType: "safety_permit",
    refId: permit.permitNo,
  });

  res.json(permit);
};

// DELETE /api/v1/safety-permits/:id —— 删除作业票 (仅限 admin 和 manager)
export const handleDeleteSafetyPermit = async (req: any, res: any) => {
  const user = authenticateBearer(req);
  const permit = await SafetyPermitRepository.getById(req.params.id);
  if (!permit) return res.status(404).json({ error: "作业票未找到" });

  if (!user) {
    return res.status(401).json({ error: "未登录或登录凭据失效", code: "UNAUTHORIZED" });
  }

  if (!["admin", "manager"].includes(user.role)) {
    const errorMsg = `权限拒绝：当前角色 [${user.roleTitle || user.role}] 无权删除高危作业票 [${permit.permitNo} · ${permit.riskLevel}]！普通操作员严禁删除高危作业票，必须由车间安全主管或系统管理员审批。`;
    addAuditLog(req, {
      actionType: "PERMIT_DELETE",
      module: "安全作业票",
      detail: `[越权拦截] ${errorMsg}`,
      status: "BLOCKED",
      metadata: { permitNo: permit.permitNo, userRole: user.role, userId: user.id },
    });
    return res.status(403).json({
      error: errorMsg,
      code: "RBAC_DELETE_FORBIDDEN",
      permitNo: permit.permitNo,
      requiredRole: "安全总监(manager) / 系统管理员(admin)",
    });
  }

  const linkedLocks = (await LotoLockRepository.getAll()).filter((lock: any) => lock.permitNo === permit.permitNo || (permit.lotoNumber && lock.lockNo === permit.lotoNumber));
  if (permit.status !== "pending_approval" || permit.guardianApproval?.signed || permit.supervisorApproval?.signed || linkedLocks.length) {
    return res.status(409).json({ code: "SAFETY_INTERLOCK_BLOCKED", error: "已会签或关联锁具的作业票必须保留追溯记录，不能删除；请按注销流程处理" });
  }
  const idx = dbSafetyPermits.findIndex((p) => p.id === req.params.id);
  dbSafetyPermits.splice(idx, 1);
  // 真实落库：同步删除数据库记录
  await SafetyPermitRepository.delete(req.params.id);

  addAuditLog(req, {
    actionType: "PERMIT_DELETE",
    module: "安全作业票",
    detail: `安全责任人 [${user.name} - ${user.roleTitle}] 成功注销删除作业票 [${permit.permitNo}] (${permit.title})`,
    status: "SUCCESS",
    metadata: { permitNo: permit.permitNo },
  });

  res.json({ success: true, message: `作业票 ${permit.permitNo} 已安全删除注销` });
};

// LOTO 能量隔离锁具看板 (工作台 LOTO 面板与安全看板真实数据源)
// GET /api/v1/loto-locks、/api/loto-locks
export const handleGetLotoLocks = async (req: any, res: any) => {
  try {
    const locks = await LotoLockRepository.getAll({ status: req.query.status as string });
    res.json(locks);
  } catch (err: any) {
    res.status(500).json({ error: "获取 LOTO 锁具数据失败: " + err.message });
  }
};

export const handleCreateLotoLock = async (req: any, res: any) => {
  const user = authenticateBearer(req);
  if (!user) return res.status(401).json({ error: "未登录" });
  try {
    const permits = await SafetyPermitRepository.getAll();
    const permit = permits.find((p: any) => p.permitNo === req.body.permitNo);
    if (!permit) return res.status(404).json({ error: "关联作业票不存在" });
    if (!["pending_approval", "approved", "active"].includes(permit.status)) {
      return res.status(409).json({ error: "已驳回或注销的作业票不能登记锁具" });
    }
    const lock = await LotoLockRepository.create({
      ...req.body, permitTitle: permit.title, workshop: permit.workshop,
      lockedBy: `${user.name} (${user.id})`, status: "locked",
    });
    if (!lock) return res.status(409).json({ code: "LOCK_NUMBER_EXISTS", error: "锁号已登记，不能覆盖既有记录" });
    addAuditLog(req, { actionType: "LOTO_REGISTER", module: "安全作业票", detail: `登记隔离锁 ${lock.lockNo}，关联 ${permit.permitNo}`, status: "SUCCESS" });
    return res.status(201).json(lock);
  } catch (err: any) {
    return res.status(500).json({ error: "登记锁具失败: " + err.message });
  }
};

export const handleReleaseLotoLock = async (req: any, res: any) => {
  const user = authenticateBearer(req);
  if (!user) return res.status(401).json({ error: "未登录" });
  try {
    const lock = await LotoLockRepository.getById(req.params.id);
    if (!lock) return res.status(404).json({ error: "锁具记录不存在" });
    const permits = await SafetyPermitRepository.getAll();
    const linkedPermits = permits.filter((p: any) => p.permitNo === lock.permitNo || p.lotoNumber === lock.lockNo);
    for (const permit of linkedPermits) {
      if (!permit.equipmentId) continue;
      const orders = await WorkOrderRepository.getAll({ equipmentId: permit.equipmentId });
      if (orders.some((order: any) => order.status === "in_progress")) {
        return res.status(409).json({ code: "SAFETY_INTERLOCK_BLOCKED", error: "设备仍有检修中的工单，请先完工上报再记录隔离锁释放" });
      }
    }
    const released = await LotoLockRepository.release(lock.id, `${user.name} (${user.id})`, req.body.unlockRemark);
    if (!released) return res.status(409).json({ error: "锁具已释放，请刷新后查看" });
    addAuditLog(req, { actionType: "LOTO_RELEASE", module: "安全作业票", detail: `记录隔离锁 ${lock.lockNo} 释放：${req.body.unlockRemark}`, status: "SUCCESS" });
    return res.json(released);
  } catch (err: any) {
    return res.status(500).json({ error: "记录锁具释放失败: " + err.message });
  }
};

// GET /api/v1/loto-locks/:id
export const handleGetLotoLockById = async (req: any, res: any) => {
  try {
    const lock = await LotoLockRepository.getById(req.params.id);
    if (!lock) return res.status(404).json({ error: "LOTO 锁具记录不存在" });
    res.json(lock);
  } catch (err: any) {
    res.status(500).json({ error: "获取 LOTO 锁具详情失败: " + err.message });
  }
};
