// 重构说明：多模型路由器——按 ai_model_configs 配置在多个 OpenAI 兼容模型间做主备选择与自动降级。
// 兼容性约定：
// - 数据库无任何配置行时，回退到 DASHSCOPE_* 环境变量（升级无感）；
// - 请求参数携带的 model 若与某条启用配置的 model_name 精确一致，该配置优先尝试（视觉等显式模型调用不受路由重排影响）；
// - 失败切换仅针对 超时/网络错误/5xx/鉴权失败，其余错误（如 400 参数错误）原样抛出；
// - 降级事件写审计日志（AI_MODEL_FAILOVER），成功/失败异步回写 health_status。
import OpenAI from "openai";
import crypto from "crypto";
import { JWT_SECRET } from "../utils/config.ts";
import { addAuditLog } from "./auditService.ts";
import { AiModelConfigRepository } from "../../db/repositories/index.ts";
import { logger } from "../../utils/logger.ts";

export type ModelCapability = "chat" | "vision" | "video";

export interface ModelCandidate {
  configId: string | null; // null = 环境变量回退
  provider: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  capabilities: string[];
}

// ==================== API Key 加密（AES-256-GCM，密钥由 JWT_SECRET 派生） ====================

function derivedKey(): Buffer {
  return crypto.createHash("sha256").update(JWT_SECRET).digest();
}

export function encryptApiKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptApiKey(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

export function maskApiKey(config: { apiKeyEnv?: string | null; hasEncryptedKey?: boolean }): string {
  if (config.apiKeyEnv) return `env:${config.apiKeyEnv}`;
  if (config.hasEncryptedKey) return "••••（已加密存储）";
  return "未配置";
}

function resolveApiKey(config: { apiKeyEnv?: string | null; hasEncryptedKey?: boolean; encrypted?: string | null }): string | null {
  if (config.apiKeyEnv && process.env[config.apiKeyEnv]) return process.env[config.apiKeyEnv] as string;
  if (config.encrypted) {
    try {
      return decryptApiKey(config.encrypted);
    } catch (e: any) {
      logger.error("[AI Model Router] 密钥解密失败:", e?.message || e);
      return null;
    }
  }
  return null;
}

// ==================== 候选模型解析（5s 内存缓存，配置变更后失效） ====================

let cacheTs = 0;
let cachedEnabled: any[] = [];

export function invalidateModelConfigCache() {
  cacheTs = 0;
  cachedEnabled = [];
}

async function getEnabledConfigs(): Promise<any[]> {
  if (Date.now() - cacheTs < 5000 && cachedEnabled.length >= 0 && cacheTs > 0) return cachedEnabled;
  try {
    cachedEnabled = await AiModelConfigRepository.getEnabled();
    cacheTs = Date.now();
  } catch (e: any) {
    logger.warn("[AI Model Router] 读取模型配置失败，回退环境变量:", e?.message || e);
    cachedEnabled = [];
  }
  return cachedEnabled;
}

/** 环境变量回退候选（数据库无配置行时使用，保持升级前行为） */
function envFallbackCandidates(): ModelCandidate[] {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return [];
  const baseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  return [
    {
      configId: null,
      provider: "dashscope",
      displayName: "DashScope（环境变量回退）",
      baseUrl,
      apiKey,
      modelName: process.env.DASHSCOPE_MODEL || "qwen-plus",
      capabilities: ["chat"],
    },
  ];
}

export async function resolveCandidates(): Promise<ModelCandidate[]> {
  const configs = await getEnabledConfigs();
  const out: ModelCandidate[] = [];
  for (const c of configs) {
    const apiKey = resolveApiKey({ apiKeyEnv: c.apiKeyEnv, hasEncryptedKey: c.hasEncryptedKey, encrypted: (c as any).encrypted });
    if (!apiKey) continue; // 密钥缺失的配置跳过
    out.push({
      configId: c.id,
      provider: c.provider,
      displayName: c.displayName,
      baseUrl: c.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey,
      modelName: c.modelName,
      capabilities: c.capabilities || [],
    });
  }
  return out;
}

// 客户端实例按 configId 缓存，避免每次调用重建
const clientPool = new Map<string, OpenAI>();

export function clientFor(candidate: ModelCandidate): OpenAI {
  if (candidate.configId) {
    const hit = clientPool.get(candidate.configId);
    if (hit) return hit;
    const created = new OpenAI({
      apiKey: candidate.apiKey,
      baseURL: candidate.baseUrl,
      timeout: 120000,
      maxRetries: 0, // 重试由路由器跨模型处理
    });
    clientPool.set(candidate.configId, created);
    return created;
  }
  return new OpenAI({ apiKey: candidate.apiKey, baseURL: candidate.baseUrl, timeout: 120000, maxRetries: 0 });
}

// ==================== 失败分类：超时/网络错误/5xx/鉴权失败/模型名不存在(404) 触发切换 ====================

export function isFailoverEligible(err: any): boolean {
  const status = err?.status || err?.httpResponseStatusCode;
  if (status === 401 || status === 403) return true;
  // 404 = 这个 model 名在该 provider 上不存在（账号换了、配置行写死了过期模型名）。
  // 它是"这条候选本身不可用"，不是"用户请求有问题"，必须换下一跳；
  // 早先不放行 404，导致一条过期行把整条降级链钉死，气泡里只剩一句误导的 "Model not exist"。
  if (status === 404) return true;
  if (typeof status === "number" && status >= 500) return true;
  // OpenAI SDK 网络层错误（APIConnectionError / APIConnectionTimeoutError，cause.code 携带底层 errno）
  const errName = err?.name || "";
  if (errName === "APIConnectionError" || errName === "APIConnectionTimeoutError") return true;
  const causeCode = err?.cause?.code || err?.code || "";
  if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(causeCode)) return true;
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("timeout") || msg.includes("timed out") || msg.includes("socket hang up") || msg.includes("connection error");
}

export async function markHealth(configId: string | null, status: "healthy" | "unhealthy") {
  if (!configId) return;
  try {
    await AiModelConfigRepository.updateHealth(configId, status);
  } catch {
    /* 健康状态回写失败不影响调用 */
  }
}

// ==================== 路由器工厂 ====================

// ==================== 连接测试（管理端） ====================

export async function testModelConfig(candidate: ModelCandidate): Promise<{ success: boolean; latencyMs: number; model: string; error?: string; reply?: string }> {
  const start = Date.now();
  try {
    const client = new OpenAI({ apiKey: candidate.apiKey, baseURL: candidate.baseUrl, timeout: 30000, maxRetries: 0 });
    const res = await client.chat.completions.create({
      model: candidate.modelName,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
      temperature: 0,
    });
    const latencyMs = Date.now() - start;
    void markHealth(candidate.configId, "healthy");
    return { success: true, latencyMs, model: candidate.modelName, reply: res.choices?.[0]?.message?.content || "" };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    void markHealth(candidate.configId, "unhealthy");
    return { success: false, latencyMs, model: candidate.modelName, error: String(err?.message || err).slice(0, 200) };
  }
}

// ==================== 启动种子：DASHSCOPE_* / AGNES_* 环境变量 → 配置行（升级无感） ====================

/**
 * 环境里配了 AGNES_API_KEY 就必须存在一条 Agnes 候选行。
 * 为什么不能只在空表时 seed：PGlite 是进程独占的嵌入式库，两个实例抢同一数据目录时后来者会
 * fork 一份带时间戳的副本（openPgliteWithFallback），副本里只有迁移期那两条百炼行——百炼免费
 * 额度一耗尽，这种副本一开机就是"403→404、全站 AI 死"，且管理员在旧库里配的路由看不见。
 * 只补不覆盖：已有 provider=agnes 的行（哪怕被停用）一律不动，人工开关优先于环境变量。
 */
async function ensureAgnesCandidate(configs: { provider?: string }[]): Promise<boolean> {
  if (!process.env.AGNES_API_KEY) return false;
  if (configs.some((c) => c.provider === "agnes")) return false;
  await AiModelConfigRepository.insert({
    id: "aimc-agnes-flash",
    provider: "agnes",
    displayName: "Agnes 2.5 Flash（对话+视觉）",
    baseUrl: process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.cn/v1",
    apiKeyEnv: "AGNES_API_KEY",
    modelName: process.env.AGNES_MODEL || "agnes-2.5-flash",
    capabilities: ["chat", "vision"],
    // 必须小于百炼两行的 10：路由器会把与请求 model 精确一致的行强制排第一，
    // Agnes 只能靠 priority 抢在降级链前面（额度耗尽的百炼行否则先吃掉请求）。
    priority: 5,
    enabled: true,
  });
  logger.log("[AI Model Router] 检测到 AGNES_API_KEY 且库内无 agnes 候选行，已自动补入（priority=5, chat+vision）");
  return true;
}

export async function ensureAiModelSeed(): Promise<void> {
  try {
    const configs = await AiModelConfigRepository.getAll();
    let changed = false;
    if (!configs.length && process.env.DASHSCOPE_API_KEY) {
      const baseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
      await AiModelConfigRepository.insert({
        id: "aimc-dashscope-chat",
        provider: "dashscope",
        displayName: "阿里百炼 qwen-plus（对话/文本）",
        baseUrl,
        apiKeyEnv: "DASHSCOPE_API_KEY",
        modelName: process.env.DASHSCOPE_MODEL || "qwen-plus",
        capabilities: ["chat"],
        priority: 10,
        enabled: true,
      });
      await AiModelConfigRepository.insert({
        id: "aimc-dashscope-vision",
        provider: "dashscope",
        displayName: "阿里百炼 qwen-vl-max（视觉）",
        baseUrl,
        apiKeyEnv: "DASHSCOPE_API_KEY",
        modelName: process.env.DASHSCOPE_VISION_MODEL || "qwen-vl-max",
        capabilities: ["vision"],
        priority: 10,
        enabled: true,
      });
      logger.log("[AI Model Router] 已从 DASHSCOPE_* 环境变量初始化 2 条模型配置（chat/vision）");
      changed = true;
    }
    if (await ensureAgnesCandidate(configs)) changed = true;
    if (changed) invalidateModelConfigCache();
  } catch (e: any) {
    logger.warn("[AI Model Router] 模型配置种子写入失败（不影响启动）:", e?.message || e);
  }
}
