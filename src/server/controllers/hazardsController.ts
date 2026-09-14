// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { HazardsRepository, EquipmentRepository, WorkOrderRepository } from "../../db/repositories/index.ts";
import { addAuditLog } from "../services/auditService.ts";

// ==================== 安全隐患闭环管理 API ====================
// 1. 获取隐患列表 (重大隐患置顶)
export async function handleGetHazards(req: any, res: any) {
  const { status, level, equipmentId, query } = req.query as any;
  const hazards = await HazardsRepository.getAll({
    status: status ? String(status) : undefined,
    level: level ? String(level) : undefined,
    equipmentId: equipmentId ? String(equipmentId) : undefined,
    query: query ? String(query) : undefined,
  });
  res.json(hazards);
}

// 2. 隐患统计指标 (待整改、重大隐患数量等)
export async function handleGetHazardMetrics(req: any, res: any) {
  const metrics = await HazardsRepository.getMetrics();
  res.json(metrics);
}

// 3. 获取单项隐患详情
export async function handleGetHazardById(req: any, res: any) {
  const hazard = await HazardsRepository.getById(req.params.id);
  if (!hazard) return res.status(404).json({ success: false, error: "隐患记录不存在" });
  res.json(hazard);
}

// 4. 现场上报或排查登记新隐患
export async function handleCreateHazard(req: any, res: any) {
  const body = req.body;
  const eqId = body.equipmentId || body.equipment_id;
  let validEquipmentId: string | null = null;
  if (eqId && typeof eqId === "string" && eqId.trim() !== "") {
    const eq = await EquipmentRepository.getById(eqId.trim());
    if (eq) validEquipmentId = eq.id;
  }

  const hazard = await HazardsRepository.create({
    title: body.title,
    equipmentId: validEquipmentId || undefined,
    location: body.location,
    level: body.level,
    description: body.description,
    discoverer: body.discoverer || body.reported_by || (req.currentUser ? `${req.currentUser.name} (${req.currentUser.roleTitle || req.currentUser.role})` : "现场巡检员"),
    source: body.source || "report",
    deadline: body.deadline,
    rectificationPlan: body.rectificationPlan || body.rectification_plan,
  });

  addAuditLog(req, {
    actionType: "CREATE_HAZARD",
    module: "隐患闭环",
    detail: `登记现场【${hazard.level === "major" ? "重大隐患" : "一般隐患"}】: ${hazard.title} (${hazard.no})`,
    status: "SUCCESS",
    metadata: { hazardId: hazard.id, level: hazard.level },
  });

  res.status(201).json(hazard);
}

// 5. 更新隐患信息
export async function handleUpdateHazard(req: any, res: any) {
  const updated = await HazardsRepository.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ success: false, error: "隐患不存在" });
  res.json(updated);
}

// 6. 隐患一键下发整改工单 (生成抢修/整改工单并关联)
export async function handleAssignHazard(req: any, res: any) {
  const hazard = await HazardsRepository.getById(req.params.id);
  if (!hazard) return res.status(404).json({ success: false, error: "隐患不存在" });

  // 自动在 work_orders 创建整改工单
  const user = (req as any).user;
  const priority = req.body.priority || (hazard.level === "major" ? "urgent" : "high");
  const assigneeId = req.body.assigneeId || null;

  let eq = null;
  if (hazard.equipmentId) {
    eq = await EquipmentRepository.getById(hazard.equipmentId);
  }

  const createdOrder = await WorkOrderRepository.create({
    title: `【隐患整改】${hazard.title}`,
    equipmentId: eq?.id || hazard.equipmentId || "eq-101",
    equipmentName: eq?.name || hazard.equipmentName || "工业检修机组",
    equipmentCode: eq?.code || "EQ-GEN-01",
    workshop: eq?.workshop || "检修一车间",
    faultType: hazard.level === "major" ? "安全隐患" : "现场排查",
    priority: priority,
    status: assigneeId ? "dispatched" : "created",
    assigneeId: assigneeId,
    assignee: assigneeId === "u-tech" ? "李建国 (检修技师)" : (assigneeId || null),
    dispatcher: user ? user.name : "安全调度中心",
    description: `【现场安全隐患下发整改任务】\n隐患编号: ${hazard.no}\n隐患等级: ${hazard.level === "major" ? "重大隐患" : "一般隐患"}\n发生部位: ${hazard.location}\n现场特征: ${hazard.description}\n整改要求: ${req.body.dispatch_note || hazard.rectificationPlan || "排除安全隐患并落实防范措施后提请验收"}`,
    safetyRequirements: ["落实作业前危险源辨识", "执行安全交底并经两人复核签收"],
    creator: user ? `${user.name} (${user.roleTitle || user.role})` : "安全环保部",
    forceSubmit: true,
  });

  const workOrderNo = createdOrder?.orderNo || `WO-HZ-${Date.now().toString().slice(-6)}`;

  // 关联工单并推进隐患状态至 rectifying
  const updatedHazard = await HazardsRepository.assignWorkOrder(hazard.id, workOrderNo);

  addAuditLog(req, {
    actionType: "ASSIGN_HAZARD_WORK_ORDER",
    module: "隐患闭环",
    detail: `隐患 ${hazard.no} 成功派发整改工单 ${workOrderNo}，状态变更为整改中`,
    status: "SUCCESS",
    metadata: { hazardId: hazard.id, workOrderNo },
  });

  res.json({
    success: true,
    hazard: updatedHazard,
    workOrder: createdOrder,
  });
}

// 7. 隐患现场复核验收与闭环归档
export async function handleVerifyHazard(req: any, res: any) {
  const { verificationNotes, comment, pass, passed, verifierName, verifier } = req.body;
  const hazard = await HazardsRepository.getById(req.params.id);
  if (!hazard) return res.status(404).json({ success: false, error: "隐患不存在" });

  const user = (req as any).user;
  const inspector = verifierName || verifier || (user ? `${user.name} (${user.roleTitle || user.role})` : "复核验收安全员");
  const isPass = pass !== undefined ? pass : (passed !== undefined ? passed : true);
  const notes = verificationNotes || comment || "现场复核合格，同意闭环销号";

  if (!isPass) {
    // 验收不通过，驳回继续整改
    const updated = await HazardsRepository.update(hazard.id, {
      status: "rectifying",
      rectificationPlan: `${hazard.rectificationPlan || ""}\n【${new Date().toLocaleDateString("zh-CN")} 验收驳回】${inspector}: ${notes}`,
    });
    return res.json({ success: false, message: "整改验收未通过，已驳回整改责任班组继续落实治理", hazard: updated });
  }

  const closedHazard = await HazardsRepository.verifyAndClose(
    hazard.id,
    `验收人: ${inspector} | 验收时间: ${new Date().toLocaleString("zh-CN")} | 意见: ${notes}`
  );

  addAuditLog(req, {
    actionType: "VERIFY_HAZARD_CLOSED",
    module: "隐患闭环",
    detail: `隐患 ${hazard.no} 现场复查验收合格，正式闭环归档`,
    status: "SUCCESS",
    metadata: { hazardId: hazard.id, verifier: inspector },
  });

  res.json({ success: true, hazard: closedHazard });
}
