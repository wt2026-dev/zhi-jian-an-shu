import { AuditLogRepository, NotificationRepository } from "../../db/repositories/index.ts";
import { authenticateBearer } from "./authService.ts";

// ==================== 生产级操作审计日志系统 (Operation Audit Log) ====================
// 原 createApp 闭包函数模块化：auditLogHook 注入机制保持原语义

export interface AuditLogRecord {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: string;
  ip: string;
  actionType: string;
  module: string;
  detail: string;
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  metadata?: any;
}

export type AuditLogParams = {
  actionType: string;
  module: string;
  detail: string;
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  metadata?: any;
};

/** 审计日志钩子：由应用装配时注入 (供无法直接依赖审计服务的底层模块使用) */
let auditLogHook: ((req: any, params: AuditLogParams) => any) | null = null;

export function setAuditLogHook(hook: (req: any, params: AuditLogParams) => any) {
  auditLogHook = hook;
}

export function getClientIp(req: any): string {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = typeof forwarded === "string" ? forwarded.split(",")[0] : req.socket?.remoteAddress || "127.0.0.1";
  return rawIp.replace("::ffff:", "").trim();
}

export function addAuditLog(req: any, params: AuditLogParams) {
  const user = authenticateBearer(req);
  const clientIp = getClientIp(req);
  const item: AuditLogRecord = {
    id: `audit-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
    timestamp: new Date().toLocaleString("zh-CN"),
    userId: user?.id || "u-guest",
    userName: user?.name || "未知用户",
    userRole: user?.roleTitle || user?.role || "访客",
    ip: clientIp,
    actionType: params.actionType,
    module: params.module,
    detail: params.detail,
    status: params.status,
    metadata: params.metadata,
  };
  AuditLogRepository.add(item).catch((err: any) => {
    console.error("[AuditLog] 写入数据库失败:", err);
  });
  return item;
}

/** 应用装配时调用：注入模块级 AI 审计钩子，供 AI 扩展功能的统一异常处理写审计日志 */
export function installAuditHook() {
  setAuditLogHook(addAuditLog);
}

export { auditLogHook };

// 系统通知真实落库写入 (通知中心 / Header 未读角标数据源，异步写库不阻塞主流程)
export function pushNotification(params: {
  title: string;
  content?: string;
  type?: "info" | "alert" | "warning" | "success";
  refType?: string;
  refId?: string;
  userId?: string;
}) {
  const item = {
    title: params.title,
    content: params.content || "",
    type: params.type || "info",
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    read: false,
    refType: params.refType || null,
    refId: params.refId || null,
    userId: params.userId || null,
  };
  NotificationRepository.create(item).catch((err: any) => {
    console.error("[Notification] 写入数据库失败:", err);
  });
  return item;
}
