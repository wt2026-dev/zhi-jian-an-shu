import crypto from "crypto";

/**
 * AI 响应缓存（LRU + 按类型 TTL）
 * - Key: 功能类型 + 输入参数 MD5
 * - 容量: 1000 条（超出淘汰最久未使用）
 * - TTL: 普通问答 1h / 设备画像 24h / 根因分析 7d / 默认 1h
 * - 统计: 命中率、节省的 API 调用次数（供 /api/v1/admin/ai-stats）
 */

const MAX_ENTRIES = 1000;

const TTL_MS: Record<string, number> = {
  chat: 60 * 60 * 1000,
  "equipment-summary": 24 * 60 * 60 * 1000,
  "root-cause-analysis": 7 * 24 * 60 * 60 * 1000,
  "health-forecast": 60 * 60 * 1000,
  "generate-maintenance-plan": 24 * 60 * 60 * 1000,
  "generate-report": 60 * 60 * 1000,
  "safety-risk-assessment": 24 * 60 * 60 * 1000,
  "recommend-assignee": 60 * 60 * 1000,
  "alarm-correlation": 30 * 60 * 1000,
  default: 60 * 60 * 1000,
};

interface Entry {
  value: any;
  type: string;
  params: any;
  createdAt: number;
  expiresAt: number;
  equipmentId?: string;
}

const store = new Map<string, Entry>();

export const cacheStats = {
  hits: 0,
  misses: 0,
  savedApiCalls: 0,
  sets: 0,
  evictions: 0,
  byType: {} as Record<string, { hits: number; misses: number }>,
};

function touchType(type: string, hit: boolean) {
  if (!cacheStats.byType[type]) cacheStats.byType[type] = { hits: 0, misses: 0 };
  if (hit) cacheStats.byType[type].hits += 1;
  else cacheStats.byType[type].misses += 1;
}

export function aiCacheKey(type: string, params: any): string {
  return type + ":" + crypto.createHash("md5").update(JSON.stringify(params ?? {})).digest("hex");
}

export function aiCacheGet(type: string, params: any): { value: any; cachedAt: number } | null {
  var key = aiCacheKey(type, params);
  var entry = store.get(key);
  if (!entry) {
    cacheStats.misses += 1;
    touchType(type, false);
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    cacheStats.misses += 1;
    touchType(type, false);
    return null;
  }
  // LRU: 删除后重新插入刷新位置
  store.delete(key);
  store.set(key, entry);
  cacheStats.hits += 1;
  cacheStats.savedApiCalls += 1;
  touchType(type, true);
  return { value: entry.value, cachedAt: entry.createdAt };
}

export function aiCacheSet(
  type: string,
  params: any,
  value: any,
  opts?: { equipmentId?: string; ttlMs?: number }
): void {
  var ttl = opts?.ttlMs || TTL_MS[type] || TTL_MS["default"];
  var key = aiCacheKey(type, params);
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    // LRU 淘汰：删除最早插入的条目
    var oldest = store.keys().next().value;
    if (oldest !== undefined) {
      store.delete(oldest);
      cacheStats.evictions += 1;
    }
  }
  store.set(key, {
    value: value,
    type: type,
    params: params,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttl,
    equipmentId: opts?.equipmentId,
  });
  cacheStats.sets += 1;
}

/** 数据一致性：设备状态变化后主动清除该设备的 AI 分析缓存 */
export function aiCacheInvalidateEquipment(equipmentId: string): number {
  var removed = 0;
  for (var [key, entry] of Array.from(store.entries())) {
    if (entry.equipmentId === equipmentId) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function aiCacheClear(type?: string): number {
  var removed = 0;
  for (var [key, entry] of Array.from(store.entries())) {
    if (!type || entry.type === type) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function aiCacheSize(): number {
  return store.size;
}

/** 供管理端点读取当前缓存条目数 */
export const aiCache = { size: function (): number { return store.size; } };
