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

export function signJwtToken(user: any) {
  const payload = {
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    roleTitle: user.roleTitle,
    department: user.department,
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

export function authenticateBearer(req: any) {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return verifyJwtToken(token);
}
