import { authenticateBearer } from "../services/authService.ts";
import { addAuditLog } from "../services/auditService.ts";

// ==================== 用户与 RBAC 鉴权中间件（原 createApp 闭包逻辑模块化） ====================

// 必须登录鉴权中间件
export function requireAuth(req: any, res: any, next: any) {
  const user = authenticateBearer(req);
  if (!user) {
    return res.status(401).json({ error: "未登录或登录凭据失效", code: "UNAUTHORIZED" });
  }
  req.currentUser = user;
  next();
}

// RBAC 权限守卫
export function requireRole(allowedRoles: string[], actionDesc?: string) {
  return (req: any, res: any, next: any) => {
    const user = authenticateBearer(req);
    if (!user) {
      return res.status(401).json({ error: "未登录或登录凭据失效", code: "UNAUTHORIZED" });
    }
    const isAllowed = allowedRoles.includes(user.role) || user.role === "admin";
    if (!isAllowed) {
      const errorMsg = `权限拒绝：操作 [${actionDesc || req.path}] 需要 [${allowedRoles.join(" / ")}] 权限，当前账号角色为 [${user.roleTitle || user.role}]，禁止执行。`;
      addAuditLog(req, {
        actionType: "RBAC_ACCESS_DENIED",
        module: "安全合规",
        detail: errorMsg,
        status: "BLOCKED",
        metadata: { requiredRoles: allowedRoles, currentRole: user.role, path: req.path },
      });
      return res.status(403).json({
        error: errorMsg,
        code: "RBAC_PERMISSION_DENIED",
        userRole: user.role,
        requiredRoles: allowedRoles,
      });
    }
    req.currentUser = user;
    next();
  };
}
