import { getDb } from "../db.ts";
import { nextDailyNo, withDailyNoRetry, withNumberLock } from "../dailyNo.ts";
import { parseJson, VersionConflictError } from "./shared.ts";

export const WorkOrderRepository = {
  async getAll(filters?: { status?: string; priority?: string; workshop?: string; equipmentId?: string; assigneeId?: string; search?: string }) {
    const db = await getDb();
    let sql = `SELECT * FROM work_orders WHERE 1=1`;
    const params: any[] = [];

    if (filters?.status && filters.status !== "all") {
      params.push(filters.status);
      sql += ` AND status = $${params.length}`;
    }
    if (filters?.priority && filters.priority !== "all") {
      params.push(filters.priority);
      sql += ` AND priority = $${params.length}`;
    }
    if (filters?.workshop && filters.workshop !== "all") {
      params.push(filters.workshop);
      sql += ` AND workshop = $${params.length}`;
    }
    if (filters?.equipmentId) {
      params.push(filters.equipmentId);
      sql += ` AND equipment_id = $${params.length}`;
    }
    if (filters?.assigneeId) {
      params.push(filters.assigneeId);
      sql += ` AND assignee_id = $${params.length}`;
    }
    if (filters?.search) {
      params.push(`%${filters.search}%`);
      sql += ` AND (title ILIKE $${params.length} OR order_no ILIKE $${params.length} OR equipment_name ILIKE $${params.length} OR equipment_code ILIKE $${params.length})`;
    }

    sql += ` ORDER BY created_timestamp DESC NULLS LAST, id DESC;`;
    const { rows } = await db.query(sql, params);
    return rows.map(mapWorkOrderRow);
  },

  async getStats() {
    const db = await getDb();
    const { rows: statusRows } = await db.query(
      `SELECT status, COUNT(*)::int AS cnt FROM work_orders GROUP BY status;`
    );
    const { rows: priorityRows } = await db.query(
      `SELECT priority, COUNT(*)::int AS cnt FROM work_orders GROUP BY priority;`
    );
    const statusMap: Record<string, number> = {};
    for (const r of statusRows as any[]) statusMap[r.status] = r.cnt;
    const priorityMap: Record<string, number> = {};
    for (const r of priorityRows as any[]) priorityMap[r.priority] = r.cnt;
    const total = Object.values(statusMap).reduce((a, b) => a + b, 0);
    return {
      total,
      created: statusMap['created'] || 0,
      dispatched: statusMap['dispatched'] || 0,
      in_progress: statusMap['in_progress'] || 0,
      pending_acceptance: statusMap['pending_acceptance'] || 0,
      completed: statusMap['completed'] || 0,
      cancelled: statusMap['cancelled'] || 0,
      urgent: priorityMap['urgent'] || 0,
      high: priorityMap['high'] || 0,
      medium: priorityMap['medium'] || 0,
      low: priorityMap['low'] || 0,
    };
  },

  /**
   * 可靠性指标（由真实工单数据计算，杜绝硬编码假值）：
   * - MTTR：已完成工单的 (completed_at - created_at) 均值，单位小时。
   * - MTBF：全部工单按 created_at 排序后，相邻两次故障工单创建的均值间隔，单位小时。
   *   全局口径（非逐设备），用作看板趋势参考；样本不足 2 条时返回 0。
   */
  async getReliabilityMetrics() {
    const db = await getDb();
    const { rows: mttrRows } = await db.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600.0) AS mttr
         FROM work_orders
        WHERE status = 'completed'
          AND completed_at IS NOT NULL
          AND created_at IS NOT NULL;`
    );
    const mttrHours =
      mttrRows[0]?.mttr != null && !isNaN(Number(mttrRows[0].mttr))
        ? Number(Number(mttrRows[0].mttr).toFixed(2))
        : 0;

    const { rows: tsRows } = await db.query(
      `SELECT created_at FROM work_orders WHERE created_at IS NOT NULL ORDER BY created_at ASC;`
    );
    let mtbfHours = 0;
    if (tsRows.length >= 2) {
      let sum = 0;
      for (let i = 1; i < tsRows.length; i++) {
        const prev = new Date(tsRows[i - 1].created_at).getTime();
        const cur = new Date(tsRows[i].created_at).getTime();
        if (!isNaN(prev) && !isNaN(cur) && cur > prev) sum += (cur - prev) / 3600000;
      }
      mtbfHours = Number((sum / (tsRows.length - 1)).toFixed(2));
    }
    return { mttrHours, mtbfHours };
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM work_orders WHERE id = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    return mapWorkOrderRow(rows[0]);
  },

  /** 只在 create() 与显式传号的调用方内部使用；缺号时的取号必须发生在锁内，见 create()。 */
  async insert(order: any) {
    const db = await getDb();
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const id = order.id || `wo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const orderNo =
      order.orderNo ||
      (await nextDailyNo({ table: "work_orders", column: "order_no", prefix: `WO-${dateStr}-`, pad: 4 }));
    const createdAt = order.createdAt || now.toISOString();
    const status = order.status || (order.assigneeId || order.assignee ? "dispatched" : "created");

    const source = order.source || (order.description?.includes("wx_scan") || order.title?.includes("扫码") ? "wx_scan" : "manual");

    await db.query(
      `INSERT INTO work_orders (id, order_no, title, equipment_id, equipment_name, equipment_code, workshop, fault_type, priority, status, creator, dispatcher, assignee, assignee_id, created_at, dispatched_at, accepted_at, completed_at, accepted_by_inspector_at, description, safety_requirements, photos, repair_log, acceptance, version, created_timestamp, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27);`,
      [
        id,
        orderNo,
        order.title || "工业维保工单",
        order.equipmentId || "eq-101",
        order.equipmentName || "通用工业机组",
        order.equipmentCode || "EQ-GEN-01",
        order.workshop || "动力一车间",
        order.faultType || "机械振动",
        order.priority || "medium",
        status,
        order.creator || "现场维保人员",
        order.dispatcher || null,
        order.assignee || null,
        order.assigneeId || null,
        createdAt,
        order.dispatchedAt || null,
        order.acceptedAt || null,
        order.completedAt || null,
        order.acceptedByInspectorAt || null,
        order.description || "",
        JSON.stringify(order.safetyRequirements || []),
        JSON.stringify(order.photos || []),
        order.repairLog ? JSON.stringify(order.repairLog) : null,
        order.acceptance ? JSON.stringify(order.acceptance) : null,
        order.version || 1,
        order.createdTimestamp || Date.now(),
        source,
      ]
    );
    return this.getById(id);
  },

  /**
   * `work_orders.order_no` 是 UNIQUE 的：旧实现拿 `Date.now()` 尾 4 位再拼 4 位随机数，
   * 同毫秒并发或尾号每 100 秒轮回一次都会撞号，而撞号的后果不是覆盖旧单，是
   * 整条创建请求 500（扫码报修、隐患整改、业务闭环三处入口共用这条链）。
   * 缺号时把「取号 + 插入」放进同一次进程内互斥里，显式传号的调用方不必排队；
   * 锁外再兜撞号重试，多副本部署时另一进程插了同一个号也能自动重新取号。
   */
  async create(order: any) {
    if (order.orderNo) return this.insert(order);
    return withDailyNoRetry(() => withNumberLock("work_orders", () => this.insert(order)));
  },

  async update(id: string, updates: Partial<any>, expectedVersion?: number) {
    const current = await this.getById(id);
    if (!current) return null;

    const targetVersion = expectedVersion !== undefined ? expectedVersion : updates.version;

    if (targetVersion !== undefined && current.version !== targetVersion) {
      throw new VersionConflictError("工单已被其他操作修改，请刷新后重试", current.version, targetVersion);
    }

    const merged = { ...current, ...updates };
    const nextVersion = (current.version || 1) + 1;

    const db = await getDb();
    if (targetVersion !== undefined) {
      const { rowCount } = await db.query(
        `UPDATE work_orders SET
           title = $1,
           equipment_id = $2,
           equipment_name = $3,
           equipment_code = $4,
           workshop = $5,
           fault_type = $6,
           priority = $7,
           status = $8,
           dispatcher = $9,
           assignee = $10,
           assignee_id = $11,
           dispatched_at = $12,
           accepted_at = $13,
           completed_at = $14,
           accepted_by_inspector_at = $15,
           description = $16,
           safety_requirements = $17,
           photos = $18,
           repair_log = $19,
           acceptance = $20,
           version = $21,
           updated_at_dt = CURRENT_TIMESTAMP
         WHERE id = $22 AND version = $23;`,
        [
          merged.title,
          merged.equipmentId,
          merged.equipmentName,
          merged.equipmentCode,
          merged.workshop,
          merged.faultType,
          merged.priority,
          merged.status,
          merged.dispatcher || null,
          merged.assignee || null,
          merged.assigneeId || null,
          merged.dispatchedAt || null,
          merged.acceptedAt || null,
          merged.completedAt || null,
          merged.acceptedByInspectorAt || null,
          merged.description,
          JSON.stringify(merged.safetyRequirements || []),
          JSON.stringify(merged.photos || []),
          merged.repairLog ? JSON.stringify(merged.repairLog) : null,
          merged.acceptance ? JSON.stringify(merged.acceptance) : null,
          nextVersion,
          id,
          targetVersion,
        ]
      );
      if (rowCount === 0) {
        const fresh = await this.getById(id);
        throw new VersionConflictError("工单已被其他操作修改，请刷新后重试", fresh?.version, targetVersion);
      }
    } else {
      await db.query(
        `UPDATE work_orders SET
           title = $1,
           equipment_id = $2,
           equipment_name = $3,
           equipment_code = $4,
           workshop = $5,
           fault_type = $6,
           priority = $7,
           status = $8,
           dispatcher = $9,
           assignee = $10,
           assignee_id = $11,
           dispatched_at = $12,
           accepted_at = $13,
           completed_at = $14,
           accepted_by_inspector_at = $15,
           description = $16,
           safety_requirements = $17,
           photos = $18,
           repair_log = $19,
           acceptance = $20,
           version = $21,
           updated_at_dt = CURRENT_TIMESTAMP
         WHERE id = $22;`,
        [
          merged.title,
          merged.equipmentId,
          merged.equipmentName,
          merged.equipmentCode,
          merged.workshop,
          merged.faultType,
          merged.priority,
          merged.status,
          merged.dispatcher || null,
          merged.assignee || null,
          merged.assigneeId || null,
          merged.dispatchedAt || null,
          merged.acceptedAt || null,
          merged.completedAt || null,
          merged.acceptedByInspectorAt || null,
          merged.description,
          JSON.stringify(merged.safetyRequirements || []),
          JSON.stringify(merged.photos || []),
          merged.repairLog ? JSON.stringify(merged.repairLog) : null,
          merged.acceptance ? JSON.stringify(merged.acceptance) : null,
          nextVersion,
          id,
        ]
      );
    }
    return this.getById(id);
  },

  async delete(id: string) {
    const db = await getDb();
    const { rowCount } = await db.query(`DELETE FROM work_orders WHERE id = $1;`, [id]);
    return rowCount > 0;
  },

  async hasOtherActiveOrders(equipmentId: string, excludeOrderId: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT COUNT(*) as cnt FROM work_orders
       WHERE equipment_id = $1 AND id != $2 AND status IN ('created', 'dispatched', 'in_progress', 'pending_acceptance');`,
      [equipmentId, excludeOrderId]
    );
    return Number(rows[0]?.cnt || 0) > 0;
  },
};

function mapWorkOrderRow(r: any) {
  return {
    id: r.id,
    orderNo: r.order_no,
    title: r.title,
    equipmentId: r.equipment_id,
    equipmentName: r.equipment_name,
    equipmentCode: r.equipment_code,
    workshop: r.workshop,
    faultType: r.fault_type,
    priority: r.priority,
    status: r.status,
    creator: r.creator,
    dispatcher: r.dispatcher,
    assignee: r.assignee,
    assigneeId: r.assignee_id,
    createdAt: r.created_at,
    dispatchedAt: r.dispatched_at,
    acceptedAt: r.accepted_at,
    completedAt: r.completed_at,
    acceptedByInspectorAt: r.accepted_by_inspector_at,
    description: r.description,
    safetyRequirements: parseJson(r.safety_requirements, []),
    photos: parseJson(r.photos, []),
    repairLog: parseJson(r.repair_log, null),
    acceptance: parseJson(r.acceptance, null),
    version: r.version,
    createdTimestamp: Number(r.created_timestamp || 0),
    source: r.source || (r.description?.includes("wx_scan") || r.title?.includes("扫码") ? "wx_scan" : "manual"),
  };
}
