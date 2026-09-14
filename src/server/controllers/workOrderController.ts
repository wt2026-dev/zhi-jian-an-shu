// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { WorkOrderRepository, WorkOrderLogRepository, ComplianceCheckRepository } from "../../db/repositories/index.ts";

// 工单状态标签表（原 createApp 闭包内常量，工单子域共用，逻辑保持原样）
export const STATUS_LABELS: Record<string, string> = {
  created: "待派单",
  dispatched: "待接单",
  in_progress: "检修中",
  pending_acceptance: "待验收",
  completed: "已归档",
  cancelled: "已取消",
};

// 工单内存操作日志（原 createApp 闭包内 let 数组，仅 unshift/filter，从不整体重新赋值，逻辑保持原样）
export const dbWorkOrderLogs: any[] = [];

// 3. 工单统计接口
export async function handleGetWorkOrderStats(req: any, res: any) {
  try {
    const stats = await WorkOrderRepository.getStats();
    const total = stats.total;
    const completed = stats.completed;

    res.json({
      totalCount: total,
      createdCount: stats.created,
      dispatchedCount: stats.dispatched,
      inProgressCount: stats.in_progress,
      pendingAcceptanceCount: stats.pending_acceptance,
      completedCount: stats.completed,
      cancelledCount: stats.cancelled,
      urgentCount: stats.urgent,
      highCount: stats.high,
      mediumCount: stats.medium,
      lowCount: stats.low,
      mttrHours: 3.2,
      mtbfHours: 720.0,
      completionRate: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 100,
    });
  } catch (err: any) {
    res.status(500).json({ error: "获取工单统计失败: " + err.message });
  }
}

// 4. 获取工单列表
export async function handleGetWorkOrders(req: any, res: any) {
  try {
    const { status, priority, equipment_id, search, workshop } = req.query;
    const result = await WorkOrderRepository.getAll({
      status: status as string,
      priority: priority as string,
      equipmentId: equipment_id as string,
      workshop: workshop as string,
      search: search as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "获取工单列表失败: " + err.message });
  }
}

// 5. 获取工单详情
// 工单详情
export async function handleGetWorkOrderById(req: any, res: any) {
  try {
    const wo = await WorkOrderRepository.getById(req.params.id);
    if (!wo) return res.status(404).json({ error: "工单未找到" });
    const logs = dbWorkOrderLogs.filter((l) => l.workOrderId === wo.id);
    res.json({ ...wo, logs });
  } catch (err: any) {
    res.status(500).json({ error: "获取工单详情失败: " + err.message });
  }
}

// 工单台账导出 Excel/CSV (必须在 /:id 路由之前注册，避免 Express 把 "export" 当作 :id 匹配)
export async function handleExportWorkOrders(req: any, res: any) {
  try {
    const { status, priority, workshop } = req.query;
    const list = await WorkOrderRepository.getAll({
      status: status as string,
      priority: priority as string,
      workshop: workshop as string,
    });

    const headers = ["工单号", "工单标题", "设备名称", "设备编号", "所属车间", "故障类型", "优先级", "状态", "提单人", "主修技师", "创建时间", "故障描述"];
    const rows = list.map((w: any) => [
      `"${w.orderNo}"`,
      `"${(w.title || "").replace(/"/g, '""')}"`,
      `"${w.equipmentName}"`,
      `"${w.equipmentCode}"`,
      `"${w.workshop}"`,
      `"${w.faultType}"`,
      `"${w.priority}"`,
      `"${w.status}"`,
      `"${w.creator}"`,
      `"${w.assignee || "--"}"`,
      `"${w.createdAt}"`,
      `"${(w.description || "").replace(/"/g, '""').replace(/\n/g, " ")}"`,
    ]);

    const csvContent = "\ufeff" + [headers.join(","), ...rows.map((r: any) => r.join(","))].join("\r\n");
    res.setHeader("Content-Disposition", 'attachment; filename="industrial_work_orders.csv"');
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(Buffer.from(csvContent, "utf-8"));
  } catch (err: any) {
    res.status(500).json({ error: "导出工单失败: " + err.message });
  }
}

// 工单流转时间线（完整操作日志，供详情页时间线渲染）
export async function handleGetWorkOrderLogs(req: any, res: any) {
  try {
    const logs = await WorkOrderLogRepository.getByWorkOrderId(req.params.id);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: "获取工单流转时间线失败: " + err.message });
  }
}

// 12. 删除/取消工单
export async function handleDeleteWorkOrder(req: any, res: any) {
  try {
    const { id } = req.params;
    const order = await WorkOrderRepository.getById(id);
    if (!order) return res.status(404).json({ error: "工单未找到" });

    if (order.status === "completed") {
      return res.status(400).json({ error: "已归档闭环工单禁止删除" });
    }

    await WorkOrderRepository.delete(id);
    res.json({ success: true, message: `工单 ${order.orderNo} 已删除` });
  } catch (err: any) {
    res.status(500).json({ error: "删除工单失败: " + err.message });
  }
}

// 工单合规审查记录查询
export async function handleGetWorkOrderCompliance(req: any, res: any) {
  try {
    const check = await ComplianceCheckRepository.getByWorkOrderId(req.params.id);
    res.json(check || {
      workOrderId: req.params.id,
      score: 100,
      violations: [],
      summary: "工单符合规范作业标准，未发现违规项。",
    });
  } catch (err: any) {
    res.status(500).json({ error: "获取工单合规审查记录失败: " + err.message });
  }
}
// 工单状态机：允许的状态流转表（工单创建与流转共用）
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  created: ["dispatched", "cancelled"],
  dispatched: ["in_progress", "created", "cancelled"],
  in_progress: ["pending_acceptance", "cancelled"],
  pending_acceptance: ["completed", "in_progress"],
  completed: [],
  cancelled: [],
};


// 工单防重复提交窗口（创建工单去重用）
export const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
