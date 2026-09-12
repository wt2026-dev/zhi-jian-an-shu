import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

export const AuditLogRepository = {
  async add(entry: {
    id?: string;
    timestamp?: string;
    userId: string;
    userName: string;
    userRole: string;
    ip: string;
    actionType: string;
    module: string;
    detail: string;
    status: "SUCCESS" | "FAILED" | "BLOCKED";
    metadata?: any;
  }) {
    const id = entry.id || `audit-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const timestamp = entry.timestamp || new Date().toLocaleString("zh-CN");
    const db = await getDb();

    try {
      await db.query(
        `INSERT INTO audit_logs (id, timestamp, user_id, user_name, user_role, ip, action_type, module, detail, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
        [
          id,
          timestamp,
          entry.userId,
          entry.userName,
          entry.userRole,
          entry.ip,
          entry.actionType,
          entry.module,
          entry.detail,
          entry.status,
          JSON.stringify(entry.metadata || {}),
        ]
      );
    } catch (err) {
      console.error("[AuditLog] 写入审计日志异常:", err);
    }

    return {
      id,
      timestamp,
      userId: entry.userId,
      userName: entry.userName,
      userRole: entry.userRole,
      ip: entry.ip,
      actionType: entry.actionType,
      module: entry.module,
      detail: entry.detail,
      status: entry.status,
      metadata: entry.metadata,
    };
  },

  async getAll(filters?: { module?: string; actionType?: string; status?: string; limit?: number }) {
    const db = await getDb();
    let sql = `SELECT * FROM audit_logs WHERE 1=1`;
    const params: any[] = [];

    if (filters?.module && filters.module !== "all") {
      params.push(filters.module);
      sql += ` AND module = $${params.length}`;
    }
    if (filters?.actionType && filters.actionType !== "all") {
      params.push(filters.actionType);
      sql += ` AND action_type = $${params.length}`;
    }
    if (filters?.status && filters.status !== "all") {
      params.push(filters.status);
      sql += ` AND status = $${params.length}`;
    }

    const limit = filters?.limit ? Math.min(Number(filters.limit), 2000) : 500;
    sql += ` ORDER BY created_at DESC, id DESC LIMIT ${limit};`;

    const { rows } = await db.query(sql, params);
    return rows.map((r: any) => ({
      id: r.id,
      timestamp: r.timestamp,
      userId: r.user_id,
      userName: r.user_name,
      userRole: r.user_role,
      ip: r.ip,
      actionType: r.action_type,
      module: r.module,
      detail: r.detail,
      status: r.status,
      metadata: parseJson(r.metadata, {}),
    }));
  },
};
