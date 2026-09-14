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
      db.query("SELECT COUNT(*)::int AS c FROM work_orders WHERE status = 'completed' AND (accepted_by_inspector_at LIKE $1 OR accepted_by_inspector_at LIKE $2)", [new Date().toLocaleDateString("zh-CN") + "%", new Date().toISOString().slice(0, 10) + "%"]),
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

// ==================== 驾驶舱异常下钻：受影响设备明细 ====================
// GET /api/v1/cockpit/abnormal-equipments?type=health|order|inspection|hazard
// 为驾驶舱「监测 → 定位 → 干预」闭环提供数据源：按指标类型返回异常设备/事件明细，
// 每行包含设备名/编号/车间/异常类型/指标值/最近巡检时间/健康分，供前端一键生成检修工单。

type AbnormalItem = {
  equipmentId: string | null;
  equipmentName: string;
  equipmentCode: string;
  workshop: string | null;
  abnormalType: string;
  detail: string;
  metricLabel: string;
  metricValue: number | string;
  lastInspectionAt: string | null;
  healthScore: number | null;
  severity: "high" | "medium";
  refId: string;
  refTitle?: string;
};

/** 车间 → 最近巡检时间映射（巡检表无设备外键，按车间聚合最近一次巡检） */
async function buildWorkshopLastInspectionMap(db: any): Promise<Record<string, string>> {
  const { rows } = await db.query(
    `SELECT workshop, MAX(COALESCE(NULLIF(finished_at, ''), scheduled_date)) AS last_at
     FROM inspections WHERE COALESCE(workshop, '') <> '' GROUP BY workshop;`
  );
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (r.workshop && r.last_at) map[r.workshop] = String(r.last_at);
  }
  return map;
}

export async function handleGetAbnormalEquipments(req: any, res: any) {
  try {
    const type = req.query.type as string;
    const db = await getDb();
    let items: AbnormalItem[] = [];

    if (type === "health") {
      // 设备健康：状态异常（预警/故障/检修中）或健康分低于阈值 70
      const { rows } = await db.query(
        `SELECT id, code, name, workshop, status, health_score
         FROM equipments
         WHERE status IN ('warning','fault','overhauling') OR health_score < 70
         ORDER BY health_score ASC, status DESC
         LIMIT 20;`
      );
      const lastInspMap = await buildWorkshopLastInspectionMap(db);
      items = rows.map((r: any) => {
        const score = Number(r.health_score ?? 0);
        const detail =
          r.status === "fault"
            ? "设备处于故障停机状态"
            : r.status === "overhauling"
            ? "设备检修中，暂未恢复运行"
            : r.status === "warning"
            ? "运行参数触发预警阈值"
            : "健康分低于 70 分阈值";
        return {
          equipmentId: r.id,
          equipmentName: r.name,
          equipmentCode: r.code,
          workshop: r.workshop,
          abnormalType: "设备健康",
          detail,
          metricLabel: "健康分",
          metricValue: score,
          lastInspectionAt: lastInspMap[r.workshop] || null,
          healthScore: score,
          severity: r.status === "fault" || score < 60 ? ("high" as const) : ("medium" as const),
          refId: r.id,
        };
      });
    } else if (type === "order") {
      // 工单积压：按设备聚合未完结（created/dispatched/in_progress/pending_acceptance）工单
      const { rows } = await db.query(
        `SELECT e.id, e.code, e.name, e.workshop, e.health_score,
                COUNT(w.id)::int AS backlog,
                COUNT(w.id) FILTER (WHERE w.priority = 'urgent')::int AS urgent,
                MAX(w.created_at) AS last_order_at
         FROM work_orders w
         JOIN equipments e ON e.id = w.equipment_id
         WHERE w.status NOT IN ('completed','cancelled')
         GROUP BY e.id, e.code, e.name, e.workshop, e.health_score
         HAVING COUNT(w.id) >= 1
         ORDER BY backlog DESC, urgent DESC
         LIMIT 20;`
      );
      const lastInspMap = await buildWorkshopLastInspectionMap(db);
      items = rows.map((r: any) => {
        const score = Number(r.health_score ?? 0);
        return {
          equipmentId: r.id,
          equipmentName: r.name,
          equipmentCode: r.code,
          workshop: r.workshop,
          abnormalType: "工单积压",
          detail: `未完结工单 ${r.backlog} 单${Number(r.urgent) > 0 ? `（紧急 ${r.urgent} 单）` : ""}，最近创建 ${r.last_order_at || "—"}`,
          metricLabel: "积压工单数",
          metricValue: Number(r.backlog),
          lastInspectionAt: lastInspMap[r.workshop] || null,
          healthScore: score,
          severity: Number(r.urgent) > 0 || Number(r.backlog) >= 3 ? ("high" as const) : ("medium" as const),
          refId: r.id,
          refTitle: r.last_order_at ? `最近工单创建于 ${r.last_order_at}` : undefined,
        };
      });
    } else if (type === "inspection") {
      // 巡检异常：存在异常点位的巡检任务，映射到同车间健康分最低的设备（无匹配设备时回退为任务本身）
      const { rows } = await db.query(
        `SELECT i.id, i.task_no, i.title, i.workshop, i.abnormal_count, i.total_points,
                COALESCE(NULLIF(i.finished_at, ''), i.scheduled_date) AS inspected_at, i.status
         FROM inspections i
         WHERE i.abnormal_count > 0
         ORDER BY inspected_at DESC NULLS LAST, i.abnormal_count DESC
         LIMIT 20;`
      );
      const eqRes = await db.query(
        `SELECT id, code, name, workshop, health_score FROM equipments ORDER BY health_score ASC;`
      );
      const lastInspMap = await buildWorkshopLastInspectionMap(db);
      items = rows.map((r: any) => {
        const sameWs = (eqRes.rows as any[]).filter((e) => e.workshop && e.workshop === r.workshop);
        const target = sameWs[0]; // 已按健康分升序，取最差的一台
        const score = target ? Number(target.health_score ?? 0) : null;
        return {
          equipmentId: target?.id || null,
          equipmentName: target?.name || r.title,
          equipmentCode: target?.code || r.task_no,
          workshop: r.workshop,
          abnormalType: "巡检异常",
          detail: `巡检任务「${r.title}」发现 ${r.abnormal_count}/${r.total_points} 个异常点位`,
          metricLabel: "异常点数",
          metricValue: Number(r.abnormal_count),
          lastInspectionAt: r.inspected_at || lastInspMap[r.workshop] || null,
          healthScore: score,
          severity: Number(r.abnormal_count) >= 2 ? ("high" as const) : ("medium" as const),
          refId: r.id,
          refTitle: r.title,
        };
      });
    } else if (type === "hazard") {
      // 隐患待处理：未闭环隐患（pending/rectifying/verifying），重大等级置顶
      const { rows } = await db.query(
        `SELECT h.id, h.title, h.level, h.status, h.deadline, h.equipment_id,
                e.code AS eq_code, e.name AS eq_name, e.workshop AS eq_workshop, e.health_score
         FROM hazards h
         LEFT JOIN equipments e ON e.id = h.equipment_id
         WHERE h.status != 'closed'
         ORDER BY CASE h.level WHEN 'major' THEN 0 ELSE 1 END, h.created_at DESC
         LIMIT 20;`
      );
      const lastInspMap = await buildWorkshopLastInspectionMap(db);
      items = rows.map((r: any) => {
        const statusLabel = r.status === "pending" ? "待整改" : r.status === "rectifying" ? "整改中" : "待复核";
        return {
          equipmentId: r.equipment_id || null,
          equipmentName: r.eq_name || r.title,
          equipmentCode: r.eq_code || "—",
          workshop: r.eq_workshop || null,
          abnormalType: "隐患待处理",
          detail: `「${r.title}」${statusLabel}${r.deadline ? `，整改截止 ${r.deadline}` : ""}`,
          metricLabel: "隐患等级",
          metricValue: r.level === "major" ? "重大" : "一般",
          lastInspectionAt: r.eq_workshop ? lastInspMap[r.eq_workshop] || null : null,
          healthScore: r.health_score != null ? Number(r.health_score) : null,
          severity: r.level === "major" ? ("high" as const) : ("medium" as const),
          refId: r.id,
          refTitle: r.title,
        };
      });
    } else {
      return res.status(400).json({
        error: "无效的异常类型 type，可选值：health | order | inspection | hazard",
        code: "INVALID_INPUT",
      });
    }

    res.json({ type, count: items.length, items, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: "获取异常设备明细失败", message: err.message });
  }
}
