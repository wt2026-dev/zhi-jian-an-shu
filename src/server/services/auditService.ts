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

function normalizeIp(ip: string): string {
  return (ip || "").replace(/^::ffff:/, "").trim();
}

/**
 * 客户端 IP 提取（防伪造）：
 * 默认直接取 socket 直连地址——X-Forwarded-For 头可被任意客户端伪造，
 * 盲目信任会让攻击者绕过限流/登录防爆破并污染审计日志。
 * 仅当满足以下条件之一时才解析 X-Forwarded-For（取第一跳）：
 *   1. 显式设置 TRUST_PROXY=true（部署方确认前面存在可信反代）；
 *   2. 直连来源 IP 在 TRUSTED_PROXY_IPS 白名单（逗号分隔）内。
 * 不满足时一律按 socket 地址处理。
 */
export function getClientIp(req: any): string {
  const socketIp = normalizeIp(req.socket?.remoteAddress || "") || "127.0.0.1";
  const trustProxy = process.env.TRUST_PROXY === "true";
  const trustedList = (process.env.TRUSTED_PROXY_IPS || "")
    .split(",")
    .map((s) => normalizeIp(s))
    .filter(Boolean);
  const isTrustedPeer = trustProxy || (trustedList.length > 0 && trustedList.includes(socketIp));
  if (!isTrustedPeer) return socketIp;

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || !forwarded.trim()) return socketIp;
  return normalizeIp(forwarded.split(",")[0]) || socketIp;
}

export function addAuditLog(req: any, params: AuditLogParams) {
  const user = req ? authenticateBearer(req) : null;
  const clientIp = req ? getClientIp(req) : "system";
  const item: AuditLogRecord = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
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
