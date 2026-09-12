import { getDb } from "../db.ts";

export const WorkOrderLogRepository = {
  async add(log: {
    id?: string;
    workOrderId: string;
    action: string;
    previousStatus?: string | null;
    newStatus?: string | null;
    operatorName?: string;
    comment?: string;
    createdAt?: string;
  }) {
    const id = log.id || `log-${Date.now()}`;
    const createdAt = log.createdAt || new Date().toLocaleString("zh-CN");
    const db = await getDb();
    try {
      await db.query(
        `INSERT INTO work_order_logs (id, work_order_id, action, previous_status, new_status, operator_name, comment, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
        [
          id,
          log.workOrderId,
          log.action,
          log.previousStatus || null,
          log.newStatus || null,
          log.operatorName || null,
          log.comment || null,
          createdAt,
        ]
      );
    } catch (err) {
      console.error("[WorkOrderLog] 写入工单日志异常:", err);
    }
    return {
      id,
      workOrderId: log.workOrderId,
      action: log.action,
      previousStatus: log.previousStatus || null,
      newStatus: log.newStatus || null,
      operatorName: log.operatorName || null,
      comment: log.comment || null,
      createdAt,
    };
  },

  async getByWorkOrderId(workOrderId: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM work_order_logs WHERE work_order_id = $1 ORDER BY created_at_dt DESC, id DESC;`,
      [workOrderId]
    );
    return rows.map((r: any) => ({
      id: r.id,
      workOrderId: r.work_order_id,
      action: r.action,
      previousStatus: r.previous_status,
      newStatus: r.new_status,
      operatorName: r.operator_name,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  },
};
