import { addAuditLog, getClientIp } from "../services/auditService.ts";

// ==================== 接口滑动窗口限流引擎 (Rate Limiter)（原 createApp 闭包逻辑模块化） ====================

interface RateLimitRecord {
  timestamps: number[];
}
const rateLimitStore = new Map<string, RateLimitRecord>();

export function createRateLimiter(options: { windowMs: number; max: number; name: string }) {
  return (req: any, res: any, next: any) => {
    const ip = getClientIp(req);
    const clientKey = `${options.name}:${ip}`;
    const now = Date.now();
    const windowStart = now - options.windowMs;

    let record = rateLimitStore.get(clientKey);
    if (!record) {
      record = { timestamps: [] };
      rateLimitStore.set(clientKey, record);
    }

    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (record.timestamps.length >= options.max) {
      const oldest = record.timestamps[0];
      const retryAfter = Math.ceil((oldest + options.windowMs - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", options.max);
      res.setHeader("X-RateLimit-Remaining", 0);

      addAuditLog(req, {
        actionType: "RATE_LIMIT_BLOCKED",
        module: "网关安全",
        detail: `触发接口限流保护 [${options.name}]: 每分钟上限 ${options.max} 次，超限拦截 (IP: ${ip})。`,
        status: "BLOCKED",
        metadata: { clientKey, limit: options.max, retryAfter },
      });

      return res.status(429).json({
        error: `请求过于频繁，触发安全限流保护，请 ${retryAfter} 秒后重试`,
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter,
      });
    }

    record.timestamps.push(now);
    res.setHeader("X-RateLimit-Limit", options.max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, options.max - record.timestamps.length));
    next();
  };
}

export const globalLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 240, name: "global" });
export const authLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, name: "auth" });
export const aiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, name: "ai" });

// ==================== 登录防爆破限流与 IP 锁定引擎（原 createApp 闭包逻辑模块化） ====================

interface LoginFailureRecord {
  count: number;
  lockedUntil: number;
}
const loginFailureStore = new Map<string, LoginFailureRecord>();

export function checkLoginBruteForce(req: any, res: any): boolean {
  const ip = getClientIp(req);
  const record = loginFailureStore.get(ip);
  const now = Date.now();
  if (record && record.lockedUntil > now) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    res.status(429).json({
      error: `连续登录失败次数过多，IP已临时锁定，请 ${remainingSeconds} 秒后再试`,
      code: "IP_LOCKED",
      remainingSeconds,
    });
    return false;
  }
  return true;
}

export function recordLoginFailure(ip: string) {
  const now = Date.now();
  let record = loginFailureStore.get(ip);
  if (!record || record.lockedUntil <= now) {
    record = { count: 0, lockedUntil: 0 };
  }
  record.count += 1;
  if (record.count >= 5) {
    record.lockedUntil = now + 15 * 60 * 1000; // 锁定 15 分钟
  }
  loginFailureStore.set(ip, record);
}

export function recordLoginSuccess(ip: string) {
  loginFailureStore.delete(ip);
}
