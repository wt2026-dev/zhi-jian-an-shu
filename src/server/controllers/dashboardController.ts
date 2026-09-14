// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { getDb } from "../../db/db.ts";
import { HazardsRepository, SparePartsRepository } from "../../db/repositories/index.ts";

// 驾驶舱聚合指标 (支持小程序直接调用 /api/v1/cockpit/metrics，登录即可调用)
export async function handleGetCockpitMetrics(_req: any, res: any) {
  try {
    const db = await getDb();
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();

    const [ordersRes, compRes, eqRes, inspRes, aiRes, hazRes, spRes] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'completed')::int AS completed, COUNT(*) FILTER (WHERE priority = 'urgent' AND status != 'completed')::int AS urgent FROM work_orders;"),
      db.query("SELECT COUNT(*)::int AS c FROM work_orders WHERE status = 'completed' AND accepted_by_inspector_at LIKE $1", [new Date().toLocaleDateString("zh-CN") + "%"]),
      db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'normal')::int AS normal, COUNT(*) FILTER (WHERE status IN ('fault','overhauling'))::int AS faulty, COALESCE(AVG(health_score), 0)::int AS avg_health FROM equipments;"),
      db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'completed')::int AS completed, COALESCE(SUM(total_points), 0)::int AS total_pts, COALESCE(SUM(completed_points), 0)::int AS done_pts, COALESCE(SUM(abnormal_count), 0)::int AS abnormal FROM inspections;"),
      db.query("SELECT COUNT(*)::int AS c FROM audit_logs WHERE module = 'ai' AND action_type LIKE 'AI_%';"),
      HazardsRepository.getMetrics(),
      SparePartsRepository.getAll(),
    ]);

    const totalOrders = ordersRes.rows[0]?.total || 0;
    const compOrders = ordersRes.rows[0]?.completed || 0;
    const orderRate = totalOrders > 0 ? Number(((compOrders / totalOrders) * 100).toFixed(1)) : 100;

    const totalInsp = inspRes.rows[0]?.total || 0;
    const compInsp = inspRes.rows[0]?.completed || 0;
    const inspRate = totalInsp > 0 ? Number(((compInsp / totalInsp) * 100).toFixed(1)) : 100;

    const parts = spRes || [];
    const lowStockCount = parts.filter((p: any) => (p.stock || 0) <= (p.safeStock || p.safe_stock || 0)).length;

    res.json({
      equipmentTotal: eqRes.rows[0]?.total || 0,
      equipmentNormal: eqRes.rows[0]?.normal || 0,
      equipmentFaulty: eqRes.rows[0]?.faulty || 0,
      equipmentHealthAvg: eqRes.rows[0]?.avg_health || 0,
      workOrderTotal: totalOrders,
      workOrderCompleted: compOrders,
      workOrderRate: orderRate,
      workOrderUrgent: ordersRes.rows[0]?.urgent || 0,
      inspectionTotal: totalInsp,
      inspectionCompleted: compInsp,
      inspectionRate: inspRate,
      inspectionAbnormal: inspRes.rows[0]?.abnormal || 0,
      hazardsPending: hazRes?.pendingCount || 0,
      hazardsMajor: hazRes?.majorPending || 0,
      aiCallsTotal: aiRes.rows[0]?.c || 0,
      sparePartsTotal: parts.length,
      sparePartsLowStock: lowStockCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: "获取驾驶舱指标失败", message: err.message });
  }
}
