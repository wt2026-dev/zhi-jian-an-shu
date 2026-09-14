import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { addAuditLog } from "./auditService.ts";
import { resolveCandidates, clientFor, markHealth, isFailoverEligible } from "./aiModelRouter.ts";

// ==================== 阿里云百炼 (DashScope) 大模型客户端与统一调用辅助 ====================
// 原 server.ts 模块级 AI 辅助函数模块化；审计日志通过 addAuditLog 直接依赖（无循环依赖）

// ==================== 多模型路由器外观（原单模型客户端已升级，导出保持兼容） ====================
// getAiClient()/getVisionClient() 保持同步签名，返回懒解析路由客户端：
// - 候选模型在首次 create() 时异步解析（ai_model_configs 5s 缓存 + 环境变量回退），调用方用法完全不变
// - 无任何可用候选时 create() 抛 AiUnavailableError，与原"未配置密钥"降级路径完全一致
// - 失败切换/健康回写/审计见 aiModelRouter.ts

export interface LazyModelRouter {
  chat: {
    completions: {
      create: (params: any) => Promise<any>;
    };
  };
}

/** 同步构建懒解析路由客户端；preferredCapability 仅在请求 model 与任何配置都不匹配时影响候选排序 */
function lazyModelRouter(preferredCapability: "chat" | "vision"): LazyModelRouter {
  return {
    chat: {
      completions: {
        create: async (params: any) => {
          const resolved = await resolveCandidates();
          if (!resolved.length) {
            throw new AiUnavailableError(
              "AI 服务未配置：请在 .env 中配置 DASHSCOPE_API_KEY，或在「AI 模型路由」中添加可用模型配置。"
            );
          }
          // 排序：请求 model 与配置精确一致者优先 > 首选能力 > priority
          let ordered = [...resolved];
          const reqModel = params?.model;
          if (reqModel) {
            const exact = ordered.find((c) => c.modelName === reqModel);
            if (exact) ordered = [exact, ...ordered.filter((c) => c !== exact)];
          } else {
            ordered.sort((a, b) => {
              const aPref = a.capabilities.includes(preferredCapability) ? 0 : 1;
              const bPref = b.capabilities.includes(preferredCapability) ? 0 : 1;
              return aPref - bPref;
            });
          }

          let lastError: any = null;
          for (let i = 0; i < ordered.length; i++) {
            const cand = ordered[i];
            // 环境变量回退候选（configId=null）：完全沿用调用方传入的 model，保持升级前行为
            const attemptParams = cand.configId === null ? { ...params } : { ...params, model: cand.modelName };
            try {
              const client = clientFor(cand);
              const response = await client.chat.completions.create(attemptParams);
              void markHealth(cand.configId, "healthy");
              return response;
            } catch (err: any) {
              lastError = err;
              console.error(`[AI Model Router] ${cand.displayName}(${cand.modelName}) 调用失败:`, err?.message || err);
              void markHealth(cand.configId, "unhealthy");
              if (i < ordered.length - 1 && isFailoverEligible(err)) {
                addAuditLog(undefined, {
                  actionType: "AI_MODEL_FAILOVER",
                  module: "ai",
                  detail: `模型 ${cand.displayName}(${cand.modelName}) 调用失败，自动降级切换到下一候选模型`,
                  status: "FAILED",
                  metadata: { failedProvider: cand.provider, failedModel: cand.modelName, error: String(err?.message || err).slice(0, 200) },
                });
                continue;
              }
              throw err;
            }
          }
          throw lastError;
        },
      },
    },
  };
}

/** chat 能力路由客户端（兼容原 getAiClient 导出与调用方式） */
export function getAiClient(): LazyModelRouter {
  return lazyModelRouter("chat");
}

/** vision 能力路由客户端（新增，供视觉能力使用，同样支持降级） */
export function getVisionClient(): LazyModelRouter {
  return lazyModelRouter("vision");
}

/** AI 服务未配置 (DASHSCOPE_API_KEY 缺失) 时的友好降级错误 */
export class AiUnavailableError extends Error {}

/** 从模型返回文本中稳健提取 JSON (容忍 ```json 围栏与前后说明文字) */
export function extractAiJson(text: string): any | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "```").trim();
  const fenced = cleaned.match(/```([\s\S]*?)```/);
  const candidates = [fenced ? fenced[1] : null, cleaned];
  for (const cand of candidates) {
    if (!cand) continue;
    const start = cand.indexOf("{");
    const end = cand.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cand.slice(start, end + 1));
      } catch {}
    }
  }
  return null;
}

/** 统一调用 DashScope qwen-plus 并解析结构化 JSON；未配置密钥抛 AiUnavailableError */
export async function callDashScopeJson(
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.3
): Promise<{ data: any; raw: string }> {
  const ai = getAiClient();
  if (!ai) {
    throw new AiUnavailableError(
      "AI 服务未配置：请在 .env 中配置 DASHSCOPE_API_KEY 后重启服务，本功能暂不可用。"
    );
  }
  const response = await ai.chat.completions.create({
    model: DASHSCOPE_CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
  });
  const raw = response.choices?.[0]?.message?.content || "";
  const data = extractAiJson(raw);
  if (!data) {
    throw new Error("AI 返回内容无法解析为结构化 JSON，请重试。原始片段: " + raw.slice(0, 160));
  }
  return { data, raw };
}

/** DashScope 原生 Embedding API（text-embedding-v3，1024 维）。不使用关键词或伪向量降级。 */
export async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new AiUnavailableError("AI 服务未配置：缺少 DASHSCOPE_API_KEY，无法生成知识向量。");
  const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-v3", input: { texts: [text.slice(0, 8000)] }, parameters: { dimension: 1024 } }),
  });
  if (!response.ok) throw new Error(`DashScope embedding 调用失败: ${response.status} ${await response.text()}`);
  const body: any = await response.json();
  const vector = body?.output?.embeddings?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== 1024 || !vector.every((x: any) => typeof x === "number")) {
    throw new Error("DashScope embedding 返回的向量不是 1024 维数值数组");
  }
  return vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? Math.max(0, Math.min(1, dot / Math.sqrt(na * nb))) : 0;
}

/** 统一 AI 路由异常处理：未配置密钥 → 200 友好降级；调用失败 → 200 降级响应（原逻辑保持 200 语义），绝不本地伪造结果 */
export async function handleAiRouteError(res: any, err: any, actionType: string, req?: any, degradedBuilder?: (e: any) => Promise<any>): Promise<any> {
  if (err instanceof AiUnavailableError) {
    if (req) {
      addAuditLog(req, {
        actionType,
        module: "ai",
        detail: `AI 功能降级 (未配置密钥): ${err.message}`,
        status: "FAILED",
        metadata: { degraded: true },
      });
    }
    return res.status(200).json({ success: false, message: err.message, degraded: true });
  }
  console.error(`[AI:${actionType}] 调用失败:`, err?.message || err);
  if (req) {
    addAuditLog(req, {
      actionType,
      module: "ai",
      detail: `AI 调用失败: ${err?.message || err}`,
      status: "FAILED",
      metadata: { error: String(err?.message || err).slice(0, 200) },
    });
  }
  if (typeof degradedBuilder === "function") {
    try {
      const body = await degradedBuilder(err);
      return res.status(200).json(body);
    } catch (be: any) {
      console.error(`[AI:${actionType}] 规则引擎降级也失败:`, be?.message || be);
    }
  }
  return res
    .status(200)
    .json({ success: false, degraded: true, message: `AI 服务暂不可用（${String(err?.message || err).slice(0, 120)}），请稍后重试。` });
}

// ==================== 结构化 AI 生成通用流式管道（SSE） ====================

export function sseInit(res: any) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
}

export function sseSend(res: any, obj: any) {
  try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (e) {}
}

/**
 * 结构化 AI 生成通用流式管道：
 * - 缓存命中 → 直接 done 帧
 * - stream:true 逐 chunk 推 {type:"content"} 帧
 * - 结束解析 JSON → {type:"done", data: 结构化结果}
 * - 失败 → 规则引擎降级结果作为 done 帧（degraded 标记）或 error 帧
 */
export async function streamAiStructured(
  res: any,
  req: any,
  opts: {
    actionType: string;
    cacheType: string;
    cacheParams: () => any;
    equipmentId?: (ctx: any) => string | undefined;
    prepare: () => Promise<{ system: string; user: string; ctx: any }>;
    buildSuccessBody: (ctx: any, data: any) => any;
    buildDegraded: (ctx: any) => { data: any; message: string };
  }
): Promise<void> {
  sseInit(res);
  let full = "";
  let ctx: any = null;
  try {
    const cached = aiCacheGet(opts.cacheType, opts.cacheParams());
    if (cached) {
      sseSend(res, { type: "done", data: cached.value, fromCache: true, cachedAt: cached.cachedAt, model: "cache" });
      res.end();
      return;
    }
    const ai = getAiClient();
    if (!ai) {
      throw new AiUnavailableError("AI 服务未配置：请在 .env 中配置 DASHSCOPE_API_KEY 后重启服务。");
    }
    const prepared = await opts.prepare();
    ctx = prepared.ctx;
    const stream = await ai.chat.completions.create({
      model: DASHSCOPE_CHAT_MODEL,
      messages: [
        { role: "system", content: prepared.system },
        { role: "user", content: prepared.user },
      ],
      temperature: 0.3,
      stream: true,
    });
    for await (const chunk of stream as any) {
      if (res.writableEnded) break;
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (delta) {
        full += delta;
        sseSend(res, { type: "content", content: delta });
      }
    }
    const data = extractAiJson(full);
    if (!data) throw new Error("AI 返回内容无法解析为结构化 JSON");
    const body = opts.buildSuccessBody(ctx, data);
    aiCacheSet(opts.cacheType, opts.cacheParams(), body, { equipmentId: opts.equipmentId ? opts.equipmentId(ctx) : undefined });
    sseSend(res, { type: "done", data: body, model: DASHSCOPE_CHAT_MODEL });
    res.end();
    addAuditLog(req, {
      actionType: opts.actionType,
      module: "ai",
      detail: `AI 流式生成完成 (${full.length} 字)`,
      status: "SUCCESS",
      metadata: { model: DASHSCOPE_CHAT_MODEL, replyLength: full.length },
    });
  } catch (err: any) {
    console.error(`[AI:${opts.actionType}] 流式调用失败:`, err?.message || err);
    if (ctx && typeof opts.buildDegraded === "function") {
      try {
        const deg = opts.buildDegraded(ctx);
        sseSend(res, { type: "done", data: deg.data, degraded: true, message: deg.message, model: "rule-engine" });
        res.end();
        addAuditLog(req, {
          actionType: opts.actionType,
          module: "ai",
          detail: `AI 流式失败，规则引擎降级: ${String(err?.message || err).slice(0, 120)}`,
          status: "FAILED",
          metadata: { degraded: true },
        });
        return;
      } catch (de: any) {
        console.error(`[AI:${opts.actionType}] 规则降级失败:`, de?.message || de);
      }
    }
    sseSend(res, { type: "error", message: `AI 流式调用失败: ${String(err?.message || err).slice(0, 160)}` });
    res.write("data: [DONE]\n\n");
    res.end();
    addAuditLog(req, {
      actionType: opts.actionType,
      module: "ai",
      detail: `AI 流式调用失败: ${String(err?.message || err).slice(0, 200)}`,
      status: "FAILED",
      metadata: { error: String(err?.message || err).slice(0, 200) },
    });
  }
}
