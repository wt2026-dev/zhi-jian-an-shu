import crypto from "crypto";
import jwt from "jsonwebtoken";
import { UserRepository } from "../../db/repositories/userRepository.ts";
import { JWT_SECRET } from "../utils/config.ts";

// ==================== 用户缓存与 JWT 签发/校验（原 createApp 闭包逻辑模块化） ====================

// 用户缓存：启动时由 initAuthCache() 预加载，用户变更后调用 reloadUsers() 刷新
let dbUsers: any[] = [];

// Token 失效黑名单集合
const revokedTokens = new Set<string>();

/** 启动时预加载用户缓存（原 createApp 中 `let dbUsers = await UserRepository.getAllUsers()` 的等价物） */
export async function initAuthCache() {
  dbUsers = await UserRepository.getAllUsers();
}

export async function reloadUsers() {
  try {
    dbUsers = await UserRepository.getAllUsers();
  } catch (e) {
    console.error("[Users] 刷新用户缓存失败:", e);
  }
}

/**
 * 用户对外视图（安全修复）：剔除仅服务端使用的敏感字段。
 *
 * 背景：dbUsers 缓存中的用户对象直接来自 UserRepository.getAllUsers()，包含
 * `password`（Bcrypt 散列）与 `wxOpenId`（微信 openid）。任何把该对象整体回传
 * 前端的端点都会造成凭据材料泄露，因此统一经此函数收敛字段。
 *
 * 约定：所有"返回当前登录用户"的端点必须使用本函数，禁止直接 res.json(user)。
 */
export function toPublicUser(user: any) {
  if (!user) return null;
  // 同时兼容驼峰与下划线两种 openid 字段命名
  const { password: _password, wxOpenId: _wxOpenId, wx_open_id: _wxOpenIdSnake, ...rest } = user;
  return rest;
}

export function signJwtToken(user: any) {
  const payload = {
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    roleTitle: user.roleTitle,
    department: user.department,
    jti: crypto.randomUUID(),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function verifyJwtToken(token: string) {
  if (revokedTokens.has(token)) {
    return null;
  }
  // 安全修复：仅接受经 JWT_SECRET 签名校验通过的 Token，拒绝一切硬编码/未验签的绕过方式。
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const user = dbUsers.find((u) => u.id === decoded.sub || u.username === decoded.username);
    if (!user) return null;
    // 安全校验：用户状态必须为 active，非 active（如已禁用/停用）视为认证失败
    if (user.status && user.status !== "active") return null;
    return user;
  } catch {
    return null;
  }
}

export function revokeToken(token: string) {
  revokedTokens.add(token);
}

export function extractToken(req: any): string | null {
  if (!req || !req.headers) return null;
  // 1. 优先从 cookie 读 token（生产前端 HttpOnly Cookie 闭环）
  const cookieHeader = req.headers["cookie"];
  if (cookieHeader && typeof cookieHeader === "string") {
    const match = cookieHeader.match(/(?:^|;\s*)token=([^;]*)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1].trim());
    }
  }
  // 2. 兼容 Authorization: Bearer（保留给 API 客户端与自动化测试）
  const auth = req.headers["authorization"];
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export function authenticateBearer(req: any) {
  const token = extractToken(req);
  if (!token) return null;
  return verifyJwtToken(token);
}
