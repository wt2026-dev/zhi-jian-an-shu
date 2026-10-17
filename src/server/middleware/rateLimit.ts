import { addAuditLog, getClientIp } from "../services/auditService.ts";

// ==================== 接口滑动窗口限流引擎 (Rate Limiter)（原 createApp 闭包逻辑模块化） ====================

// ==================== 架构约束声明（Architecture Constraint Notice）====================
// 【重要】当前限流实现为「进程内内存存储」，具有以下约束：
//
//   ✅ 适用场景：单实例部署（docker compose up，不使用 --scale 参数）
//   ❌ 不适用：多副本水平扩展（docker compose up --scale app=N，N>1）
//
// 约束原因：rateLimitStore 和 loginFailureStore 存储在当前 Node.js 进程的堆内存中；
// 多副本部署时，各实例各自维护独立计数器，同一 IP 的请求分散到不同实例会导致：
//   - 限流阈值实际等效为「单实例阈值 × 副本数」，限流失效
//   - 登录防爆破 IP 锁定在同一 IP 请求落到不同副本时无法累积计数
//
// 后续升级路径（需要水平扩展时）：
//   1. 引入 Redis（推荐 redis@4.x）
//   2. 限流改为 Redis + Lua 原子脚本（EVALSHA + sliding window）
//   3. 登录防爆破改为 Redis SET / INCR + TTL
//   推荐库：ioredis + express-rate-limit（配合 rate-limit-redis store adapter）
//
// 当前单实例内存实现的优势：
//   - 零依赖（无需 Redis）、零配置、零延迟（纯内存 O(1)）
//   - 对于工业内网部署单节点场景（本系统设计目标）完全足够
//   - 附带超阈值自动清扫（sweepRateLimitStore）防止长跑服务内存持续增长
// ====================================================================================

interface RateLimitRecord {
  timestamps: number[];
}
const rateLimitStore = new Map<string, RateLimitRecord>();
// 内存防护：key 以 IP/路由维度只增不减（仅清数组不清 key），长跑服务内存无限增长。
// 参考 wxRepairRateLimitMap 的超阈值清扫模式：写入时超过阈值即清扫窗口外过期 key。
const RATE_LIMIT_STORE_MAX = 10000;
const LOGIN_FAILURE_STORE_MAX = 5000;

function sweepRateLimitStore(windowMs: number) {
  if (rateLimitStore.size <= RATE_LIMIT_STORE_MAX) return;
  const cutoff = Date.now() - windowMs;
  for (const [key, rec] of rateLimitStore) {
    // 窗口内无任何请求记录的 key 已无计数意义（下次触达会被过滤为空数组），可安全删除
    if (!rec.timestamps.some((ts) => ts > cutoff)) rateLimitStore.delete(key);
  }
}

function sweepLoginFailureStore(now: number) {
  if (loginFailureStore.size <= LOGIN_FAILURE_STORE_MAX) return;
  for (const [key, rec] of loginFailureStore) {
    // 未处于锁定态且超过 15 分钟无新失败的记录已无防护意义（与锁定窗口一致），可安全删除
    if (rec.lockedUntil <= now && now - (rec.lastFailureAt || 0) > 15 * 60 * 1000) {
      loginFailureStore.delete(key);
    }
  }
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  name: string;
  /**
   * 白名单前缀：命中（req.originalUrl 命中该前缀）的请求直接放行且不计数。
   * 用于把「会话保活类」请求从全局限流中摘出去，避免限流误伤导致前端被踢回登录页。
   * 必须基于 req.originalUrl 判断：限流器挂载在 "/api/v1/" 上，挂载后 req.url
   * 已被剥离挂载前缀（只剩 "/auth/me"），拿它比对 "/api/v1/auth/me" 永远不成立。
   *
   * 匹配语义为「精确路径 或 其子路径」，不做裸字符串前缀匹配：
   *   /api/v1/auth/me          ✅ 豁免
   *   /api/v1/auth/me/avatar   ✅ 豁免（子路径）
   *   /api/v1/auth/me?x=1      ✅ 豁免（带查询串）
   *   /api/v1/auth/members     ❌ 不豁免（否则将来新增的兄弟路由会被静默豁免）
   */
  exemptPrefixes?: string[];
}) {
  const exemptPrefixes = options.exemptPrefixes ?? [];
  const isExempt = (url: string) =>
    exemptPrefixes.some((p) => url === p || url.startsWith(p + "/") || url.startsWith(p + "?"));
  return (req: any, res: any, next: any) => {
    // 白名单豁免必须先于计数：既不累加计数，也不做任何窗口过滤（零副作用直通）。
    if (exemptPrefixes.length > 0 && isExempt(req.originalUrl || req.url || "")) {
      return next();
    }

    const ip = getClientIp(req);
    const clientKey = `${options.name}:${ip}`;
    const now = Date.now();
    const windowStart = now - options.windowMs;

    let record = rateLimitStore.get(clientKey);
    if (!record) {
      // 先清扫再插入：新 key 此刻 timestamps 为空，若插入后再清扫会被误判为"窗口外"而删掉
      sweepRateLimitStore(options.windowMs);
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

// 全局限流：/api/v1/* 共用一个「每 IP 每分钟」滑动窗口计数。
//
// 阈值定为 600 的原因：一次页面加载本身就会打出十余个接口（台账/工单/看板/告警等），
// 演示场景下快速切页、连续刷新会在 60 秒窗口内轻易逼近旧阈值 240，触发 429。
// 一旦 429 命中 /auth/me（会话恢复探针），前端会误判为"未登录"而弹回登录页——
// 现象与崩溃无法区分（且 60 秒后自动恢复），属于典型的"假掉线"误伤。
// 600 在保留粗粒度防刷能力的同时，给正常交互留出充足余量。
//
// 另：/auth/me 直接白名单豁免，不计数。它是会话保活探针，高频是设计使然，
// 限流它没有任何安全收益，只会制造假掉线。登录防爆破由 authLimiter + IP 锁定负责。
export const globalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 600,
  name: "global",
  exemptPrefixes: ["/api/v1/auth/me"],
});
export const authLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, name: "auth" });
export const aiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, name: "ai" });

// ==================== 登录防爆破限流与 IP 锁定引擎（原 createApp 闭包逻辑模块化） ====================

interface LoginFailureRecord {
  count: number;
  lockedUntil: number;
  lastFailureAt?: number;
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
  // 既有 bug 修复：原条件 lockedUntil <= now 在未锁定（lockedUntil=0）时恒为真，
  // 导致每次失败都把 count 重置为 0，连续失败计数永远到不了 5，IP 锁定从未生效。
  // 现仅在"锁定已设置且已过期"时才重置计数。
  if (!record || (record.lockedUntil > 0 && record.lockedUntil <= now)) {
    record = { count: 0, lockedUntil: 0 };
  }
  record.count += 1;
  record.lastFailureAt = now;
  if (record.count >= 5) {
    record.lockedUntil = now + 15 * 60 * 1000; // 锁定 15 分钟
  }
  loginFailureStore.set(ip, record);
  sweepLoginFailureStore(now);
}

export function recordLoginSuccess(ip: string) {
  loginFailureStore.delete(ip);
}

// 内部状态观测口（供回归测试与运维诊断使用，业务代码勿用）
export const __rateLimitStore = rateLimitStore;
export const __loginFailureStore = loginFailureStore;
export const __RATE_LIMIT_STORE_MAX = RATE_LIMIT_STORE_MAX;
