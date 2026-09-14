import { getDb } from "../db.ts";

export const NotificationRepository = {
  mapRow(r: any) {
    return {
      id: r.id,
      userId: r.user_id || null,
      title: r.title,
      content: r.content,
      type: r.type,
      time: r.time,
      read: r.read === true || r.read === "true",
      refType: r.ref_type || null,
      refId: r.ref_id || null,
      createdAt: r.created_at,
    };
  },

  async getAll(filters?: { unreadOnly?: boolean; limit?: number; userId?: string }) {
    const db = await getDb();
    let sql = `SELECT * FROM notifications WHERE 1=1`;
    const params: any[] = [];
    if (filters?.userId) {
      params.push(filters.userId);
      sql += ` AND (user_id = $${params.length} OR user_id IS NULL OR user_id = '')`;
    }
    if (filters?.unreadOnly) {
      sql += ` AND read = FALSE`;
    }
    sql += ` ORDER BY created_at DESC, id DESC`;
    if (filters?.limit) {
      sql += ` LIMIT ${Number(filters.limit)}`;
    }
    sql += `;`;
    const { rows } = await db.query(sql, params);
    return rows.map((r: any) => this.mapRow(r));
  },

  async getUnreadCount(userId?: string) {
    const db = await getDb();
    let sql = `SELECT COUNT(*) AS count FROM notifications WHERE read = FALSE`;
    const params: any[] = [];
    if (userId) {
      params.push(userId);
      sql += ` AND (user_id = $${params.length} OR user_id IS NULL OR user_id = '')`;
    }
    sql += `;`;
    const { rows } = await db.query(sql, params);
    return Number(rows[0]?.count || 0);
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM notifications WHERE id = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    return this.mapRow(rows[0]);
  },

  async create(notification: {
    id?: string;
    userId?: string;
    title: string;
    content?: string;
    type?: string;
    time?: string;
    read?: boolean;
    refType?: string;
    refId?: string;
  }) {
    const db = await getDb();
    const id = notification.id || `notif-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await db.query(
      `INSERT INTO notifications (id, user_id, title, content, type, time, read, ref_type, ref_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING;`,
      [
        id,
        notification.userId || null,
        notification.title,
        notification.content || "",
        notification.type || "info",
        notification.time || new Date().toLocaleString("zh-CN"),
        notification.read === true,
        notification.refType || null,
        notification.refId || null,
      ]
    );
    return this.getById(id);
  },

  async markRead(id: string) {
    const db = await getDb();
    await db.query(`UPDATE notifications SET read = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`, [id]);
    return this.getById(id);
  },

  async markAllRead(userId?: string) {
    const db = await getDb();
    if (userId) {
      await db.query(`UPDATE notifications SET read = TRUE, updated_at = CURRENT_TIMESTAMP WHERE read = FALSE AND (user_id = $1 OR user_id IS NULL OR user_id = '');`, [userId]);
    } else {
      await db.query(`UPDATE notifications SET read = TRUE, updated_at = CURRENT_TIMESTAMP WHERE read = FALSE;`);
    }
    return this.getUnreadCount(userId);
  },
};
