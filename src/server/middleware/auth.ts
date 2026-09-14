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

// ==================== 全局 API 鉴权基线（默认拒绝，白名单放行） ====================
// 所有 /api/* 请求默认必须携带有效 JWT；此前鉴权依赖各路由逐个挂 requireAuth，
// 存在漏挂面（安全作业票、调度、知识库等 15+ 写接口匿名可写），故收口为全局默认拒绝。
const PUBLIC_API_EXACT = new Set([
  "/api/v1/auth/login", // 登录本身
  "/api/v1/auth/refresh", // 刷新 token（凭 refresh token，非 Bearer）
  "/api/v1/auth/wx-login", // 微信小程序 code2session 登录
  "/api/health", // 健康探针
  "/api/v1/health",
  "/health/detail",
  "/api-docs.json", // OpenAPI 规范
]);

const PUBLIC_API_PREFIXES = [
  "/api/v1/wx/repair", // 微信扫码免登录快速报修（/repairs 与别名 /repair，自带限流+防重）
  "/api/v1/wechat/", // 微信公众号二维码
  "/uploads", // 静态资源
  "/public",
];

export function globalAuthGuard(req: any, res: any, next: any) {
  const p = req.path;
  // 仅对 /api/* 强制鉴权；健康探针、Swagger UI、静态资源等非 /api 路径不受影响
  if (!p.startsWith("/api")) return next();
  if (PUBLIC_API_EXACT.has(p) || PUBLIC_API_PREFIXES.some((pre) => p.startsWith(pre))) return next();
  const user = authenticateBearer(req);
  if (!user) {
    return res.status(401).json({ error: "未登录或登录凭据失效", code: "UNAUTHORIZED" });
  }
  req.currentUser = user;
  next();
}
