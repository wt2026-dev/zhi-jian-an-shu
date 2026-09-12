// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import {
  EquipmentRepository,
  WorkOrderRepository,
  WorkOrderLogRepository,
  SafetyPermitRepository,
  ComplianceCheckRepository,
} from "../../db/repositories/index.ts";
import { pushNotification } from "../services/auditService.ts";
import { callDashScopeJson } from "../services/aiClient.ts";
import { aiCacheInvalidateEquipment } from "../../utils/aiCache.ts";
import { STATUS_LABELS, dbWorkOrderLogs, ALLOWED_TRANSITIONS, DUPLICATE_WINDOW_MS } from "./workOrderController.ts";

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
    const orderNo = `WO-${dateStr}-${Math.floor(100 + Math.random() * 900)}`;
    const id = `wo-${Date.now()}`;
    const createdAtStr =
      now.toLocaleDateString("zh-CN") +
      " " +
      now.toLocaleTimeString("zh-CN", { hour12: false });

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

    dbWorkOrderLogs.unshift({
      id: `log-${Date.now()}`,
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

    if (order.status !== "created") {
      return res.status(400).json({
        code: "STATE_MUTEX_ERROR",
        message: `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] || order.status}】，仅【待派单】工单允许派发。`,
        currentStatus: order.status,
      });
    }

    if (version !== undefined && order.version !== version) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单数据已被其他人更新，请刷新最新状态后再试。",
      });
    }

    const nowStr =
      new Date().toLocaleDateString("zh-CN") +
      " " +
      new Date().toLocaleTimeString("zh-CN", { hour12: false });

    const updated = await WorkOrderRepository.update(id, {
      status: "dispatched",
      dispatcher: dispatcher || "车间主管-陈建平",
      assignee: assigneeName || "张建国 (高级技师)",
      assigneeId: assigneeId || "u-tech",
      dispatchedAt: nowStr,
    });

    dbWorkOrderLogs.unshift({
      id: `log-${Date.now()}`,
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

    if (order.status !== "dispatched") {
      return res.status(400).json({
        code: "STATE_MUTEX_ERROR",
        message: `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] || order.status}】，仅【待接单】工单允许确认接单。`,
        currentStatus: order.status,
      });
    }

    if (version !== undefined && order.version !== version) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单已被其他人接单或修改，请刷新后再试。",
      });
    }

    const nowStr =
      new Date().toLocaleDateString("zh-CN") +
      " " +
      new Date().toLocaleTimeString("zh-CN", { hour12: false });

    const updated = await WorkOrderRepository.update(id, {
      status: "in_progress",
      acceptedAt: nowStr,
    });

    dbWorkOrderLogs.unshift({
      id: `log-${Date.now()}`,
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
    res.status(500).json({ error: "接单失败: " + err.message });
  }
}

// 9. 技师完工上报
