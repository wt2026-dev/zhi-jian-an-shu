// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { InspectionRepository } from "../../db/repositories/index.ts";
import { addAuditLog } from "../services/auditService.ts";

// ==================== 16.5 巡检任务真实落库 (Inspections CRUD) ====================

// GET /api/v1/inspections、/api/inspections
export const handleGetInspections = async (req: any, res: any) => {
  try {
    const { status, workshop, search } = req.query;
    const result = await InspectionRepository.getAll({
      status: status as string,
      workshop: workshop as string,
      search: search as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "获取巡检任务失败: " + err.message });
  }
};

// GET /api/v1/inspections/:id
export const handleGetInspectionById = async (req: any, res: any) => {
  try {
    const task = await InspectionRepository.getById(req.params.id);
    if (!task) return res.status(404).json({ error: "巡检任务未找到" });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: "获取巡检任务详情失败: " + err.message });
  }
};

// 创建巡检任务 (巡检主管 / 安全监护 / 管理员 / 技师可发起)
export const handleCreateInspection = async (req: any, res: any) => {
  try {
    const payload = req.body;
    const id = payload.id || `insp-${Date.now()}`;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const taskNo = payload.taskNo || `INSP-${dateStr}-${Math.floor(100 + Math.random() * 900)}`;
    const items = payload.items || [];
    const task = await InspectionRepository.create({
      id,
      taskNo,
      title: payload.title,
      type: payload.type || "daily",
      inspectorId: payload.inspectorId || (req.currentUser ? req.currentUser.id : null),
      inspectorName: payload.inspectorName || (req.currentUser ? `${req.currentUser.name} (${req.currentUser.roleTitle})` : "现场巡检员"),
      workshop: payload.workshop || "动力一车间",
      route: payload.route || "",
      scheduledDate: payload.scheduledDate || new Date().toLocaleDateString("zh-CN"),
      status: payload.status || "pending",
      totalPoints: payload.totalPoints ?? items.length,
      completedPoints: payload.completedPoints ?? 0,
      abnormalCount: payload.abnormalCount ?? 0,
      items,
      startedAt: payload.startedAt,
      finishedAt: payload.finishedAt,
      summary: payload.summary,
    });
    addAuditLog(req, {
      actionType: "INSPECTION_CREATE",
      module: "巡检作业",
      detail: `创建巡检任务 ${taskNo}「${payload.title}」(${task.workshop})`,
      status: "SUCCESS",
      metadata: { taskId: id },
    });
    res.status(201).json(task);
  } catch (err: any) {
    res.status(500).json({ error: "创建巡检任务失败: " + err.message });
  }
};

// 更新巡检任务（测点打卡 / 状态流转 / 汇总）
export const handleUpdateInspection = async (req: any, res: any) => {
  try {
    const updated = await InspectionRepository.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "巡检任务未找到" });
    addAuditLog(req, {
      actionType: "INSPECTION_UPDATE",
      module: "巡检作业",
      detail: `更新巡检任务 ${updated.taskNo}「${updated.title}」状态: ${updated.status}, 已完成测点 ${updated.completedPoints}/${updated.totalPoints}`,
      status: "SUCCESS",
      metadata: { taskId: req.params.id, status: updated.status },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: "更新巡检任务失败: " + err.message });
  }
};
