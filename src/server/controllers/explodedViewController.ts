/**
 * 拆解视图 ↔ 检修业务联动接口的 HTTP 处理器。
 * 提供两个真实 DB 查询接口：
 *   1. GET /api/v1/work-orders/:id/exploded-brief
 *      工单 → 跳转拆解视图所需上下文（设备 + 真实 BOM 命中的目标位号）
 *   2. GET /api/v1/equipments/:deviceId/parts/:partId/maintenance-history
 *      位号 → 真实维修历史（真实工单 / 真实备件目录 / 真实出入库流水）
 */
import type { Request, Response } from "express";
import {
  getWorkOrderExplodedContext,
  getPartMaintenanceHistory,
} from "../services/partHistoryService.ts";
import { getCatalogForDevice } from "../services/partMatchService.ts";
import { getDeviceFaultDiagnostics } from "../services/equipmentFaultLocatorService.ts";
import { getDevicePartLifeDiagnostics } from "../services/partLifeService.ts";

export async function handleGetWorkOrderExplodedBrief(req: Request, res: Response) {
  try {
    const result = await getWorkOrderExplodedContext(String(req.params.id ?? ""));
    if (!result) {
      return res.status(404).json({ error: "工单不存在", code: "WORK_ORDER_NOT_FOUND" });
    }
    return res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "查询工单拆解上下文失败: " + msg });
  }
}

export async function handleGetPartMaintenanceHistory(req: Request, res: Response) {
  try {
    const deviceId = String(req.params.deviceId ?? "");
    const partId = String(req.params.partId ?? "");
    if (!deviceId || !partId) {
      return res.status(400).json({ error: "deviceId 与 partId 必填", code: "INVALID_INPUT" });
    }
    // 位号必须在真实 BOM 中存在；目录未知（设备没有拆解页）→ 直接 404，避免"伪历史"
    if (getCatalogForDevice(deviceId).length === 0) {
      return res.status(404).json({ error: "该设备没有拆解视图 BOM 目录", code: "NO_EXPLODED_CATALOG" });
    }
    const result = await getPartMaintenanceHistory(deviceId, partId);
    if (!result) {
      // partId 不在真实 BOM 里 —— 拒答而不是返回编造数据
      return res.status(404).json({ error: "位号不存在于该设备拆解页 BOM", code: "PART_NOT_IN_CATALOG" });
    }
    return res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "查询零件维修历史失败: " + msg });
  }
}

/** GET /api/v1/equipments/:deviceId/fault-diagnostics —— 真实遥测故障定位（拆解页红色脉冲高亮用） */
export async function handleGetDeviceFaultDiagnostics(req: Request, res: Response) {
  try {
    const deviceId = String(req.params.deviceId ?? "");
    if (!deviceId) {
      return res.status(400).json({ error: "deviceId 必填", code: "INVALID_INPUT" });
    }
    return res.json(await getDeviceFaultDiagnostics(deviceId));
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "EQUIPMENT_NOT_FOUND") {
      return res.status(404).json({ error: "设备未找到", code: "EQUIPMENT_NOT_FOUND" });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "查询设备故障诊断失败: " + msg });
  }
}

/** GET /api/v1/equipments/:deviceId/part-life-diagnostics —— 真实零件寿命预警（拆解页黄/红寿命高亮用） */
export async function handleGetDevicePartLifeDiagnostics(req: Request, res: Response) {
  try {
    const deviceId = String(req.params.deviceId ?? "");
    if (!deviceId) {
      return res.status(400).json({ error: "deviceId 必填", code: "INVALID_INPUT" });
    }
    return res.json(await getDevicePartLifeDiagnostics(deviceId));
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "EQUIPMENT_NOT_FOUND") {
      return res.status(404).json({ error: "设备未找到", code: "EQUIPMENT_NOT_FOUND" });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "查询零件寿命预警失败: " + msg });
  }
}
