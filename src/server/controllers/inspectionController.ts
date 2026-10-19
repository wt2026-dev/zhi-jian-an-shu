// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { randomUUID } from "node:crypto";
import { InspectionRepository } from "../../db/repositories/index.ts";
import { addAuditLog } from "../services/auditService.ts";
import { nextDailyNo, withDailyNoRetry, withNumberLock } from "../../db/dailyNo.ts";

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
    const id = payload.id || `insp-${randomUUID()}`;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const items = payload.items || [];
    // task_no 列是 UNIQUE 的：旧实现用 3 位随机数摇号（每天只有 900 个号位），摇重就整条请求 500。
    // 现在改成「当天最大号 +1」，并把取号与落库放进同一把进程内锁，避免并发读到同一个最大值；
    // 锁外再兜撞号重试，多副本部署时另一进程可能插了同一个号，重新取号再插。
    const { taskNo, task } = await withDailyNoRetry(() =>
      withNumberLock("inspections", async () => {
        const taskNo =
          payload.taskNo ||
          (await nextDailyNo({ table: "inspections", column: "task_no", prefix: `INSP-${dateStr}-`, pad: 3 }));
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
        return { taskNo, task };
      })
    );
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
