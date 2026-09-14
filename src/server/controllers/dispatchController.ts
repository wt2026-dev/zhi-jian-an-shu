// 重构说明：内部师傅距离调度控制器——位置上报 / 在岗列表 / 就近推荐 / 派单确认 / 演示模拟。
import { DispatchRepository } from "../../db/repositories/dispatchRepository.ts";
import { WorkOrderRepository } from "../../db/repositories/index.ts";
import {
  recommendForWorkOrder,
  assignWorkOrder,
  METERS_PER_UNIT,
} from "../services/dispatchService.ts";

const DISPATCH_ROLES = ["admin", "manager", "technician"];
const REPORT_ROLES = ["technician", "inspector"];

function hasRole(user: any, roles: string[]): boolean {
  // admin 作为 requireRole 直通角色恒可访问
  return !!user && (user.role === "admin" || roles.includes(user.role));
}

// POST /api/v1/dispatch/location —— 师傅位置上报（仅 technician/inspector）
export const handleReportLocation = async (req: any, res: any) => {
  try {
    const user = req.currentUser;
    if (!hasRole(user, REPORT_ROLES)) {
      return res.status(403).json({ error: "只有检修技师（technician）或点检员（inspector）可上报位置", code: "RBAC_PERMISSION_DENIED" });
    }
    const { mapX, mapY, status } = req.body || {};
    const x = Number(mapX);
    const y = Number(mapY);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) {
      return res.status(400).json({ error: "mapX / mapY 必须是 0~1000 之间的厂区平面坐标", code: "INVALID_INPUT" });
    }
    const normalizedStatus = ["online", "idle", "offline"].includes(status) ? status : "online";
    const reportedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const id = `tloc-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    await DispatchRepository.insertLocation({ id, userId: user.id, mapX: x, mapY: y, status: normalizedStatus, reportedAt });
    await DispatchRepository.updateUserPresence(user.id, x, y, normalizedStatus, reportedAt);

    res.status(201).json({
      success: true,
      locationId: id,
      mapX: x,
      mapY: y,
      status: normalizedStatus,
      reportedAt,
      message: "位置上报成功",
    });
  } catch (err: any) {
    res.status(500).json({ error: "位置上报失败", message: err.message });
  }
};

// GET /api/v1/dispatch/technicians —— 在岗师傅列表
export const handleListDutyTechnicians = async (req: any, res: any) => {
  try {
    if (!hasRole(req.currentUser, DISPATCH_ROLES)) {
      return res.status(403).json({ error: "仅管理员 / 维保主管 / 检修技师可查看调度信息", code: "RBAC_PERMISSION_DENIED" });
    }
    const technicians = await DispatchRepository.listDutyTechnicians();
    res.json({
      success: true,
      count: technicians.length,
      idleCount: technicians.filter((t: any) => t.onlineStatus === "idle").length,
      technicians,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: "获取在岗师傅列表失败", message: err.message });
  }
};

// GET /api/v1/dispatch/recommend?workOrderId=xxx —— 就近派单推荐
export const handleRecommendDispatch = async (req: any, res: any) => {
  try {
    if (!hasRole(req.currentUser, DISPATCH_ROLES)) {
      return res.status(403).json({ error: "仅管理员 / 维保主管 / 检修技师可获取派单推荐", code: "RBAC_PERMISSION_DENIED" });
    }
    const workOrderId = req.query.workOrderId;
    if (!workOrderId) {
      return res.status(400).json({ error: "workOrderId 必填", code: "INVALID_INPUT" });
    }
    const { workOrder, equipment, requiredKeywords, recommendations } = await recommendForWorkOrder(workOrderId, req);
    res.json({
      success: true,
      workOrder: {
        id: workOrder.id,
        orderNo: workOrder.orderNo,
        title: workOrder.title,
        faultType: workOrder.faultType,
        priority: workOrder.priority,
        status: workOrder.status,
      },
      equipment: {
        id: equipment.id,
        code: equipment.code,
        name: equipment.name,
        workshop: equipment.workshop,
        mapX: equipment.mapX,
        mapY: equipment.mapY,
      },
      requiredKeywords,
      recommendations,
      meterPerUnit: METERS_PER_UNIT,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    const msg = err?.message || "";
    const status = msg.includes("不存在") ? 404 : msg.includes("尚未标定") ? 422 : 500;
    res.status(status).json({ error: msg || "获取派单推荐失败" });
  }
};

// POST /api/v1/dispatch/assign —— 派单确认
export const handleAssignDispatch = async (req: any, res: any) => {
  try {
    if (!hasRole(req.currentUser, ["admin", "manager"])) {
      return res.status(403).json({ error: "仅管理员 / 维保主管可执行派单", code: "RBAC_PERMISSION_DENIED" });
    }
    const { workOrderId, userId } = req.body || {};
    if (!workOrderId || !userId) {
      return res.status(400).json({ error: "workOrderId 与 userId 必填", code: "INVALID_INPUT" });
    }
    const dispatcherName = req.currentUser?.name || req.currentUser?.username || "调度台";
    const { workOrder, technician } = await assignWorkOrder({
      workOrderId,
      userId,
      dispatcherName,
      req,
    });
    res.status(200).json({
      success: true,
      workOrder: {
        id: workOrder.id,
        orderNo: workOrder.orderNo,
        title: workOrder.title,
        status: workOrder.status,
        assignee: workOrder.assignee,
        assigneeId: workOrder.assigneeId,
        dispatchedAt: workOrder.dispatchedAt,
      },
      technician: { id: technician.id, name: technician.name, roleTitle: technician.roleTitle },
      message: `已派单给 ${technician.name}`,
    });
  } catch (err: any) {
    const msg = err?.message || "";
    const status = msg.includes("不存在") ? 404 : msg.includes("仅待派单") ? 409 : 500;
    res.status(status).json({ error: msg || "派单失败" });
  }
};

// POST /api/v1/dispatch/mock —— 演示接口：按车间区域随机扰动在岗师傅坐标（仅显式调用时生效）
export const handleMockLocations = async (req: any, res: any) => {
  try {
    if (!hasRole(req.currentUser, ["admin", "manager"])) {
      return res.status(403).json({ error: "仅管理员 / 维保主管可执行演示模拟", code: "RBAC_PERMISSION_DENIED" });
    }
    const technicians = await DispatchRepository.listDutyTechnicians();
    if (!technicians.length) {
      return res.status(422).json({ error: "当前无在岗师傅（可先用技师账号上报位置）" });
    }
    // 演示区域锚点：随机落在全厂区主要车间带内（0~1000 画布的 60~940 安全区）
    const anchors = [
      [140, 160], [140, 500], [420, 160], [420, 500], [420, 810],
      [710, 160], [710, 500], [710, 810], [900, 500],
    ];
    const reportedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const updates = technicians.map((t: any, i: number) => {
      const anchor = anchors[Math.floor(Math.random() * anchors.length)];
      return {
        userId: t.id,
        mapX: Math.min(990, Math.max(10, Math.round(anchor[0] + (Math.random() - 0.5) * 160))),
        mapY: Math.min(990, Math.max(10, Math.round(anchor[1] + (Math.random() - 0.5) * 160))),
        status: i % 3 === 0 ? "idle" : "online",
        reportedAt,
      };
    });
    await DispatchRepository.applyMockPositions(updates);
    res.json({
      success: true,
      demo: true,
      updated: updates.length,
      positions: updates.map((u) => ({ userId: u.userId, mapX: u.mapX, mapY: u.mapY, status: u.status })),
      message: "演示位置已刷新（仅演示环境使用，请勿在生产数据上频繁调用）",
    });
  } catch (err: any) {
    res.status(500).json({ error: "模拟位置生成失败", message: err.message });
  }
};

// 供大屏聚合：设备点位列表（复用 requireAuth + 角色校验）
export const handleListEquipmentPoints = async (req: any, res: any) => {
  try {
    if (!hasRole(req.currentUser, DISPATCH_ROLES)) {
      return res.status(403).json({ error: "仅管理员 / 维保主管 / 检修技师可查看调度信息", code: "RBAC_PERMISSION_DENIED" });
    }
    const points = await DispatchRepository.listEquipmentPoints();
    // 待派工单（大屏下拉选择）
    const allOrders = await WorkOrderRepository.getAll();
    const pendingOrders = allOrders
      .filter((w: any) => w.status === "created")
      .map((w: any) => ({
        id: w.id,
        orderNo: w.orderNo,
        title: w.title,
        equipmentId: w.equipmentId,
        equipmentName: w.equipmentName,
        faultType: w.faultType,
        priority: w.priority,
      }));
    res.json({ success: true, equipmentPoints: points, pendingOrders, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: "获取调度大屏数据失败", message: err.message });
  }
};
