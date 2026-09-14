// 重构说明：本模块自 server.ts 拆出（工单完工/验收/状态流转子域，因 workflow 文件超 400 行再次拆分），逻辑保持原样。
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
import { STATUS_LABELS, dbWorkOrderLogs, ALLOWED_TRANSITIONS } from "./workOrderController.ts";

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

    if (order.status !== "in_progress") {
      return res.status(400).json({
        code: "STATE_MUTEX_ERROR",
        message: `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] || order.status}】，仅【检修中】工单允许提交完工。`,
        currentStatus: order.status,
      });
    }

    if (version !== undefined && order.version !== version) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单已被其他人修改，请刷新重试。",
      });
    }

    const nowStr =
      new Date().toLocaleDateString("zh-CN") +
      " " +
      new Date().toLocaleTimeString("zh-CN", { hour12: false });

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
    });
    aiCacheInvalidateEquipment(order.equipmentId);

    dbWorkOrderLogs.unshift({
      id: `log-${Date.now()}`,
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

    // 触发 AI 合规审查并真实落库 compliance_checks
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
        // 规则引擎降级计算（严禁 mock）
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
    res.status(500).json({ error: "完工上报失败: " + err.message });
  }
}

// 10. 质检验收归档
export async function handleAcceptWorkOrder(req: any, res: any) {
  try {
    const { id } = req.params;
    const { inspectorName, pass = true, score = 5, comment = "", version } = req.body;

    const order = await WorkOrderRepository.getById(id);
    if (!order) return res.status(404).json({ error: "工单未找到" });

    if (order.status !== "pending_acceptance") {
      return res.status(400).json({
        code: "STATE_MUTEX_ERROR",
        message: `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] || order.status}】，仅【待验收】工单允许执行质检验收。`,
        currentStatus: order.status,
      });
    }

    const nowStr =
      new Date().toLocaleDateString("zh-CN") +
      " " +
      new Date().toLocaleTimeString("zh-CN", { hour12: false });

    const newStatus = pass ? "completed" : "in_progress";
    const acceptance = {
      inspectorName: inspectorName || "王安全 (安全总监)",
      pass,
      score,
      comment,
      signatureDate: new Date().toLocaleDateString("zh-CN"),
    };

    const updated = await WorkOrderRepository.update(id, {
      status: newStatus,
      acceptedByInspectorAt: pass ? nowStr : undefined,
      acceptance,
    });

    dbWorkOrderLogs.unshift({
      id: `log-${Date.now()}`,
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
    res.status(500).json({ error: "质检验收失败: " + err.message });
  }
}

// 11. 通用状态流转接口
export async function handleTransitionStatus(req: any, res: any) {
  try {
    const { id } = req.params;
    const { targetStatus, operatorName = "系统操作员", comment, version } = req.body;

    const order = await WorkOrderRepository.getById(id);
    if (!order) return res.status(404).json({ error: "工单未找到" });

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

    if (version !== undefined && order.version !== version) {
      return res.status(409).json({
        code: "VERSION_CONFLICT",
        message: "工单状态已被其他人修改，请刷新后重试。",
      });
    }

    const nowStr =
      new Date().toLocaleDateString("zh-CN") +
      " " +
      new Date().toLocaleTimeString("zh-CN", { hour12: false });

    const updated = await WorkOrderRepository.update(id, {
      status: targetStatus,
    });

    dbWorkOrderLogs.unshift({
      id: `log-${Date.now()}`,
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
    res.status(500).json({ error: "工单状态流转失败: " + err.message });
  }
}
