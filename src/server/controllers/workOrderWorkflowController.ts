// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import {
  EquipmentRepository,
  WorkOrderRepository,
  WorkOrderLogRepository,
  SafetyPermitRepository,
  ComplianceCheckRepository,
  VersionConflictError,
} from "../../db/repositories/index.ts";
import { pushNotification } from "../services/auditService.ts";
import { callDashScopeJson } from "../services/aiClient.ts";
import { aiCacheInvalidateEquipment } from "../../utils/aiCache.ts";
import { STATUS_LABELS, pushWorkOrderLog, ALLOWED_TRANSITIONS, DUPLICATE_WINDOW_MS } from "./workOrderController.ts";
import { logger } from "../../utils/logger.ts";

// 6. 创建工单
export async function handleCreateWorkOrder(req: any, res: any) {
  try {
    const {
      title,
      equipmentId,
      faultType = "机械振动",
      priority = "high",
      description,
      safetyRequirements = [],
      creator = "现场维保人员",
      forceSubmit = false,
      idempotencyKey,
    } = req.body;

    if (!title || !equipmentId || !description) {
      return res.status(400).json({ error: "缺少必填参数: 标题、设备ID或描述" });
    }

    const eq = await EquipmentRepository.getById(equipmentId);
    if (!eq) {
      return res.status(404).json({ error: "所报修的设备不存在" });
    }

    if (!forceSubmit) {
      const nowTime = Date.now();
      const duplicateWindowStart = nowTime - DUPLICATE_WINDOW_MS;
      const activeStatuses = ["created", "dispatched", "in_progress"];

      const allOrders = await WorkOrderRepository.getAll();
      const existingDuplicate = allOrders.find(
        (w) =>
          w.equipmentId === equipmentId &&
          activeStatuses.includes(w.status) &&
          (w.createdTimestamp || 0) >= duplicateWindowStart
      );

      if (existingDuplicate) {
        const statusLabel = STATUS_LABELS[existingDuplicate.status] || existingDuplicate.status;
        return res.status(409).json({
          code: "DUPLICATE_WORK_ORDER",
          message: `防重复报单拦截：设备【${eq.name}】在15分钟内已存在处理中的同类工单【${existingDuplicate.orderNo}】(${statusLabel})，请勿重复提交。`,
          existingOrder: {
            id: existingDuplicate.id,
            orderNo: existingDuplicate.orderNo,
            title: existingDuplicate.title,
            status: existingDuplicate.status,
            statusLabel,
            priority: existingDuplicate.priority,
            createdAt: existingDuplicate.createdAt,
          },
        });
      }
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const orderNo = `WO-${dateStr}-${Date.now().toString().slice(-4)}${Math.floor(1000 + Math.random() * 9000)}`;
    const id = `wo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const createdAtStr = now.toISOString();

    const newOrder = {
      id,
      orderNo,
      title,
      equipmentId: eq.id,
      equipmentName: eq.name,
      equipmentCode: eq.code,
      workshop: eq.workshop,
      faultType,
      priority,
      status: "created",
      creator,
      createdAt: createdAtStr,
      description,
      safetyRequirements:
        safetyRequirements.length > 0
          ? safetyRequirements
          : ["穿戴劳保鞋与安全帽", "实施 LOTO 停电挂牌"],
      photos: [],
      repairLog: null,
      acceptance: null,
      version: 1,
      idempotencyKey,
      createdTimestamp: Date.now(),
    };

    const created = await WorkOrderRepository.create(newOrder);

    if (priority === "urgent" || priority === "high") {
      await EquipmentRepository.updateStatus(eq.id, "fault");
    }

    pushWorkOrderLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      workOrderId: id,
      action: "CREATE",
      previousStatus: null,
      newStatus: "created",
      operatorName: creator,
      comment: `创建工单: ${title}`,
      createdAt: createdAtStr,
    });

    pushNotification({
      title: priority === "urgent" ? `【紧急工单】${orderNo} 待派单` : `【新工单】${orderNo} 已创建待派单`,
      content: `${title} —— 设备 ${eq.name} (${eq.code})，提单人 ${creator}，请及时派单处置。`,
      type: priority === "urgent" ? "alert" : "info",
      refType: "work_order",
      refId: orderNo,
    });

    res.status(201).json(created || newOrder);
  } catch (err: any) {
    logger.error({ err }, `[handleCreateWorkOrder] 创建工单失败: ${err?.message}`);
    res.status(500).json({ error: "创建工单失败: " + err.message });
  }
}

// 7. 主管派发工单
export async function handleDispatchWorkOrder(req: any, res: any) {
  try {
    const { id } = req.params;
    const { assigneeId, assigneeName, dispatcher, estimatedHours = 2.0, version } = req.body;

    const order = await WorkOrderRepository.getById(id);
    if (!order) return res.status(404).json({ error: "工单未找到" });

    if (version !== undefined && order.version !== version) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单数据已被其他人更新，请刷新最新状态后再试。",
      });
    }

    if (order.status !== "created") {
      return res.status(400).json({
        code: "STATE_MUTEX_ERROR",
        message: `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] || order.status}】，仅【待派单】工单允许派发。`,
        currentStatus: order.status,
      });
    }

    const nowStr = new Date().toISOString();
    const expVersion = version !== undefined ? version : order.version;

    const updated = await WorkOrderRepository.update(id, {
      status: "dispatched",
      dispatcher: dispatcher || "车间主管-陈建平",
      assignee: assigneeName || "张建国 (高级技师)",
      assigneeId: assigneeId || "u-tech",
      dispatchedAt: nowStr,
    }, expVersion);

    pushWorkOrderLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      workOrderId: id,
      action: "DISPATCH",
      previousStatus: "created",
      newStatus: "dispatched",
      operatorName: dispatcher || "车间主管-陈建平",
      comment: `指派责任技师: ${assigneeName || "张建国 (高级技师)"}，预估耗时: ${estimatedHours}h`,
      createdAt: nowStr,
    });

    pushNotification({
      title: `【工单派发】${order.orderNo} 已派发至 ${assigneeName || "张建国 (高级技师)"}`,
      content: `${order.title} 已由主管派单，请责任技师尽快接单。`,
      type: "info",
      refType: "work_order",
      refId: order.orderNo,
      userId: assigneeId || "u-tech",
    });

    res.json(updated || order);
  } catch (err: any) {
    if (err instanceof VersionConflictError || err.code === "VERSION_CONFLICT") {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单数据已被其他人更新，请刷新最新状态后再试。",
      });
    }
    res.status(500).json({ error: "派发工单失败: " + err.message });
  }
}

// 8. 技师接单
export async function handleClaimWorkOrder(req: any, res: any) {
  try {
    const { id } = req.params;
    const { operatorName, version } = req.body || {};

    const order = await WorkOrderRepository.getById(id);
    if (!order) return res.status(404).json({ error: "工单未找到" });

    if (version !== undefined && order.version !== version) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单已被其他人接单或修改，请刷新后再试。",
      });
    }

    if (order.status !== "dispatched") {
      return res.status(400).json({
        code: "STATE_MUTEX_ERROR",
        message: `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] || order.status}】，仅【待接单】工单允许确认接单。`,
        currentStatus: order.status,
      });
    }

    const nowStr = new Date().toISOString();
    const expVersion = version !== undefined ? version : order.version;

    const updated = await WorkOrderRepository.update(id, {
      status: "in_progress",
      acceptedAt: nowStr,
    }, expVersion);

    pushWorkOrderLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      workOrderId: id,
      action: "CLAIM",
      previousStatus: "dispatched",
      newStatus: "in_progress",
      operatorName: operatorName || order.assignee || "责任技师",
      comment: "确认接单，执行安全隔离并开展检修",
      createdAt: nowStr,
    });

    pushNotification({
      title: `【工单流转】${order.orderNo} 已接单进入检修`,
      content: `${operatorName || order.assignee || "责任技师"} 已接单响应「${order.title}」，当前状态：检修中。`,
      type: "info",
      refType: "work_order",
      refId: order.orderNo,
    });

    res.json(updated || order);
  } catch (err: any) {
    if (err instanceof VersionConflictError || err.code === "VERSION_CONFLICT") {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单已被其他人接单或修改，请刷新后再试。",
      });
    }
    res.status(500).json({ error: "接单失败: " + err.message });
  }
}

// ==================== 完工上报 / 质检验收 / 通用状态流转 ====================

export async function handleCompleteWorkOrder(req: any, res: any) {
  try {
    const { id } = req.params;
    const {
      causeAnalysis,
      resolutionSteps,
      partsUsed = [],
      workHours = 2.0,
      completionPhotos = [],
      remark = "",
      operatorName,
      version,
    } = req.body;

    const order = await WorkOrderRepository.getById(id);
    if (!order) return res.status(404).json({ error: "工单未找到" });

    if (version !== undefined && order.version !== version) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单已被其他人修改，请刷新重试。",
      });
    }

    if (order.status !== "in_progress") {
      return res.status(400).json({
        code: "STATE_MUTEX_ERROR",
        message: `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] || order.status}】，仅【检修中】工单允许提交完工。`,
        currentStatus: order.status,
      });
    }

    const nowStr = new Date().toISOString();
    const expVersion = version !== undefined ? version : order.version;

    const repairLog = {
      causeAnalysis,
      resolutionSteps,
      partsUsed,
      workHours,
      completionPhotos,
      remark,
    };

    const updated = await WorkOrderRepository.update(id, {
      status: "pending_acceptance",
      completedAt: nowStr,
      repairLog,
    }, expVersion);
    aiCacheInvalidateEquipment(order.equipmentId);

    pushWorkOrderLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      workOrderId: id,
      action: "COMPLETE",
      previousStatus: "in_progress",
      newStatus: "pending_acceptance",
      operatorName: operatorName || order.assignee || "责任技师",
      comment: `完工上报，工时: ${workHours}h，备件: ${partsUsed.length}项`,
      createdAt: nowStr,
    });

    pushNotification({
      title: `【待验收】${order.orderNo} 完工上报已提交`,
      content: `「${order.title}」检修完工 (工时 ${workHours}h)，等待质检验收闭环。`,
      type: "warning",
      refType: "work_order",
      refId: order.orderNo,
    });

    try {
      const orderLogs = await WorkOrderLogRepository.getByWorkOrderId(id);
      const relatedPermits = await (SafetyPermitRepository.getAll as any)({ equipmentId: order.equipmentId });
      const prompt = `你是工业重型设备检修作业合规与安全质检总监。请对刚完工的工单【${order.orderNo} - ${order.title}】执行操作合规性审查。
设备: ${order.equipmentName || "受检设备"}
检修技师: ${operatorName || order.assignee || "责任技师"}
报修故障与分析: ${order.faultType || order.title || ""} | ${causeAnalysis || ""}
检修措施步骤: ${JSON.stringify(resolutionSteps || [])}
消耗备件: ${JSON.stringify(partsUsed || [])}
申报耗时: ${workHours}小时
操作日志记录: ${JSON.stringify(orderLogs.slice(0, 5))}
安全作业票信息: ${JSON.stringify(relatedPermits.slice(0, 2))}

请以严格合法的 JSON 输出合规评分（0-100分）、违规点清单及审计总结：
{
  "score": 92,
  "violations": ["若有违规如工时偏低、缺少二次验电、未按规程紧固螺栓、未归还LOTO锁具等，列出具体违规点；无违规放空数组"],
  "summary": "专业简短的合规性审查意见（50字以内）"
}`;

      let complianceResult: any = null;
      try {
        const { data } = await callDashScopeJson("你是工业检修作业合规专家。只输出合法JSON。", prompt, 0.2);
        complianceResult = {
          score: typeof data.score === "number" ? Math.max(0, Math.min(100, data.score)) : 90,
          violations: Array.isArray(data.violations) ? data.violations : [],
          summary: data.summary || "AI 合规性审查完毕。",
        };
      } catch (e: any) {
        const violations: string[] = [];
        let score = 100;
        if (workHours < 0.5) {
          violations.push("申报工时过短（<0.5h），疑似简化操作步骤");
          score -= 15;
        }
        if (!resolutionSteps || resolutionSteps.length < 2) {
          violations.push("检修步骤描述不详实，未记录关键工艺参数");
          score -= 10;
        }
        if (order.priority === "high" && (!partsUsed || partsUsed.length === 0)) {
          violations.push("高等级检修未填报备件更换与探伤记录");
          score -= 8;
        }
        complianceResult = {
          score: Math.max(60, score),
          violations,
          summary: violations.length ? "规则引擎检测到操作不规范项，建议质检复验。" : "符合标准化作业规程规范。",
        };
      }

      await ComplianceCheckRepository.create({
        workOrderId: id,
        operator: operatorName || order.assignee || "责任技师",
        deviceName: order.equipmentName || "工业设备",
        violations: complianceResult.violations,
        totalSteps: Array.isArray(resolutionSteps) ? Math.max(3, resolutionSteps.length) : 5,
        passedSteps: Array.isArray(resolutionSteps) ? Math.max(1, resolutionSteps.length - complianceResult.violations.length) : 4,
        score: complianceResult.score,
        summary: complianceResult.summary,
      });
    } catch (err: any) {
      console.warn("[Compliance] 自动合规审查执行异常:", err?.message || err);
    }

    res.json(updated || order);
  } catch (err: any) {
    if (err instanceof VersionConflictError || err.code === "VERSION_CONFLICT") {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单已被其他人修改，请刷新重试。",
      });
    }
    res.status(500).json({ error: "完工上报失败: " + err.message });
  }
}

export async function handleAcceptWorkOrder(req: any, res: any) {
  try {
    const { id } = req.params;
    const { inspectorName, pass = true, score = 5, comment = "", version } = req.body;

    const order = await WorkOrderRepository.getById(id);
    if (!order) return res.status(404).json({ error: "工单未找到" });

    if (version !== undefined && order.version !== version) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单状态已被其他人修改，请刷新后重试。",
      });
    }

    if (order.status !== "pending_acceptance") {
      return res.status(400).json({
        code: "STATE_MUTEX_ERROR",
        message: `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] || order.status}】，仅【待验收】工单允许执行质检验收。`,
        currentStatus: order.status,
      });
    }

    const nowStr = new Date().toISOString();
    const expVersion = version !== undefined ? version : order.version;

    const newStatus = pass ? "completed" : "in_progress";
    const acceptance = {
      inspectorName: inspectorName || "王安全 (安全总监)",
      pass,
      score,
      comment,
      signatureDate: new Date().toISOString().slice(0, 10),
    };

    const updated = await WorkOrderRepository.update(id, {
      status: newStatus,
      acceptedByInspectorAt: pass ? nowStr : undefined,
      acceptance,
    }, expVersion);

    pushWorkOrderLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      workOrderId: id,
      action: pass ? "ACCEPT" : "REJECT",
      previousStatus: "pending_acceptance",
      newStatus,
      operatorName: inspectorName || "质检专员",
      comment: pass ? `验收合格闭环 (评分: ${score}星) - ${comment}` : `验收驳回 - ${comment}`,
      createdAt: nowStr,
    });

    aiCacheInvalidateEquipment(order.equipmentId);
    if (pass) {
      const otherActive = await WorkOrderRepository.hasOtherActiveOrders(order.equipmentId, order.id);
      if (!otherActive) {
        const eq = await EquipmentRepository.getById(order.equipmentId);
        if (eq) {
          await EquipmentRepository.updateStatus(order.equipmentId, "running", Math.max(eq.healthScore || 85, 94));
        }
      }
    }

    pushNotification({
      title: pass ? `【验收归档】${order.orderNo} 质检合格闭环` : `【验收驳回】${order.orderNo} 退回检修`,
      content: pass
        ? `「${order.title}」已通过质检验收 (评分 ${score} 星) 并归档闭环。`
        : `「${order.title}」验收未通过：${comment || "无补充说明"}，工单退回检修中。`,
      type: pass ? "success" : "alert",
      refType: "work_order",
      refId: order.orderNo,
      userId: order.assigneeId || "u-tech",
    });

    res.json(updated || order);
  } catch (err: any) {
    if (err instanceof VersionConflictError || err.code === "VERSION_CONFLICT") {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单状态已被其他人修改，请刷新后重试。",
      });
    }
    res.status(500).json({ error: "质检验收失败: " + err.message });
  }
}

export async function handleTransitionStatus(req: any, res: any) {
  try {
    const { id } = req.params;
    const { targetStatus, operatorName = "系统操作员", comment, version } = req.body;

    const order = await WorkOrderRepository.getById(id);
    if (!order) return res.status(404).json({ error: "工单未找到" });

    if (version !== undefined && order.version !== version) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单状态已被其他人修改，请刷新后重试。",
      });
    }

    const current = order.status;
    const allowed = ALLOWED_TRANSITIONS[current] || [];

    if (!allowed.includes(targetStatus)) {
      return res.status(400).json({
        code: "INVALID_STATE_TRANSITION",
        message: `状态互斥拦截：当前工单状态为【${STATUS_LABELS[current] || current}】，无法直接变更为【${STATUS_LABELS[targetStatus] || targetStatus}】。允许流转至：${allowed.map((s) => STATUS_LABELS[s] || s).join("、") || "无 (已是终态)"}。`,
        currentStatus: current,
        targetStatus,
        allowedStatuses: allowed,
      });
    }

    const nowStr = new Date().toISOString();
    const expVersion = version !== undefined ? version : order.version;

    const updated = await WorkOrderRepository.update(id, {
      status: targetStatus,
    }, expVersion);

    pushWorkOrderLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      workOrderId: id,
      action: "TRANSITION",
      previousStatus: current,
      newStatus: targetStatus,
      operatorName,
      comment: comment || `状态变更为: ${STATUS_LABELS[targetStatus] || targetStatus}`,
      createdAt: nowStr,
    });

    res.json(updated || order);
  } catch (err: any) {
    if (err instanceof VersionConflictError || err.code === "VERSION_CONFLICT") {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单状态已被其他人修改，请刷新后重试。",
      });
    }
    res.status(500).json({ error: "工单状态流转失败: " + err.message });
  }
}
