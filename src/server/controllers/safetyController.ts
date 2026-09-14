// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import {
  SafetyPermitRepository,
  LotoLockRepository,
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
    id: `sp-${Date.now()}`,
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
    appliedAt: now.toLocaleString("zh-CN"),
    validUntil: req.body.validUntil || "当日20:00前",
    status: "pending_approval",
    precautions: req.body.precautions || [],
    lotoNumber: req.body.lotoNumber || null,
    hazards: req.body.hazards || [],
    safetyChecklist: req.body.safetyChecklist || [],
    gasTestResults: null,
    guardianApproval: null,
    supervisorApproval: null,
  };

  // 真实落库：同时写入 safety_permits 表，保证重启不丢失
  await SafetyPermitRepository.create(newPermit);
  dbSafetyPermits.unshift(newPermit);
  addAuditLog(req, {
    actionType: "PERMIT_CREATE",
    module: "安全作业票",
    detail: `创建高危安全作业票 [${newPermit.permitNo}]: ${newPermit.title} (${newPermit.riskLevel})`,
    status: "SUCCESS",
    metadata: { permitNo: newPermit.permitNo, permitType: newPermit.permitType },
  });
  pushNotification({
    title: `【高危作业票】${newPermit.permitNo} 提交待审批`,
    content: `${newPermit.permitType}「${newPermit.title}」已提交，风险等级 ${newPermit.riskLevel}，等待安全监护人/主管双人会签。`,
    type: "warning",
    refType: "safety_permit",
    refId: newPermit.permitNo,
  });
  res.status(201).json(newPermit);
};

// POST /api/v1/safety-permits/:id/approve —— 双人审批业务流转
export const handleApproveSafetyPermit = async (req: any, res: any) => {
  const { id } = req.params;
  const { step, pass = true, comment = "", gasTestResults } = req.body;
  const user = authenticateBearer(req);

  if (!user) {
    return res.status(401).json({ error: "未登录或凭据失效", code: "UNAUTHORIZED" });
  }

  const permit = dbSafetyPermits.find((p) => p.id === id);
  if (!permit) return res.status(404).json({ error: "作业票未找到" });

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

  const nowStr = new Date().toLocaleString("zh-CN");

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
    return res.json(permit);
  }

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
      role: "现场安全监护员",
      signedAt: nowStr,
      comment: comment || "现场安全防范措施就绪，准予会签",
      gasTestPassed: gasOk,
    };
  } else if (step === "supervisor") {
    permit.supervisorApproval = {
      signed: true,
      name: user.name,
      role: "车间安全总监/主管",
      signedAt: nowStr,
      comment: comment || "安全条件审核合格，核准生效",
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

  // 真实落库：同步审批结果到数据库
  await SafetyPermitRepository.update(id, permit);

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
  const { closeRemark } = req.body;
  const user = authenticateBearer(req);

  if (!user) {
    return res.status(401).json({ error: "未登录或凭据失效", code: "UNAUTHORIZED" });
  }

  const permit = dbSafetyPermits.find((p) => p.id === id);
  if (!permit) return res.status(404).json({ error: "作业票未找到" });

  permit.status = "closed";
  permit.closedAt = new Date().toLocaleString("zh-CN");
  permit.closedBy = `${user.name} (${user.roleTitle})`;
  permit.closeRemark = closeRemark || "现场作业完毕，工完料净场地清，LOTO安全锁具已解锁释放。";

  addAuditLog(req, {
    actionType: "PERMIT_CLOSE",
    module: "安全作业票",
    detail: `责任人 [${user.name} - ${user.roleTitle}] 办理完成高危作业票 [${permit.permitNo}] 注销闭环，确认安全锁具已释放`,
    status: "SUCCESS",
    metadata: { permitNo: permit.permitNo },
  });

  // 真实落库：同步注销闭环状态到数据库
  await SafetyPermitRepository.update(id, permit);

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
  const permit = dbSafetyPermits.find((p) => p.id === req.params.id);
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
