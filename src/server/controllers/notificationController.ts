// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { NotificationRepository } from "../../db/repositories/index.ts";

// 通知列表 (登录即可查看，按用户真实隔离落库)
export const handleGetNotifications = async (req: any, res: any) => {
  try {
    const isManagerOrAdmin = req.currentUser?.role === "admin" || req.currentUser?.role === "manager";
    const viewAll = req.query.all === "true" && isManagerOrAdmin;
    const targetUserId = viewAll ? undefined : (req.query.user_id || req.currentUser?.id);

    const list = await NotificationRepository.getAll({
      userId: targetUserId,
      unreadOnly: req.query.unread_only === "true",
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "获取通知列表失败: " + err.message });
  }
};

// 标记单条通知已读
export const handleMarkNotificationRead = async (req: any, res: any) => {
  try {
    const updated = await NotificationRepository.markRead(req.params.id);
    if (!updated) return res.status(404).json({ error: "通知不存在" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: "标记通知已读失败: " + err.message });
  }
};

// 标记全部通知已读 (支持按当前用户隔离)
export const handleMarkAllNotificationsRead = async (req: any, res: any) => {
  try {
    const unreadCount = await NotificationRepository.markAllRead(req.currentUser?.id);
    res.json({ success: true, unreadCount });
  } catch (err: any) {
    res.status(500).json({ error: "标记全部已读失败: " + err.message });
  }
};
