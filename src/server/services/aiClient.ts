import OpenAI from "openai";
import { aiCacheGet, aiCacheSet } from "../../utils/aiCache.ts";
import { DASHSCOPE_CHAT_MODEL } from "../utils/config.ts";
import { addAuditLog } from "./auditService.ts";

// ==================== 阿里云百炼 (DashScope) 大模型客户端与统一调用辅助 ====================
// 原 server.ts 模块级 AI 辅助函数模块化；审计日志通过 addAuditLog 直接依赖（无循环依赖）

let aiClient: OpenAI | null = null;
let aiWarned = false;

export function getAiClient(): OpenAI | null {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    // 密钥缺失时仅告警一次并返回 null，由各路由做友好降级，绝不崩溃
    if (!aiWarned) {
      console.warn("[AI] 未配置 DASHSCOPE_API_KEY，AI 功能将使用本地规则引擎友好降级。");
      aiWarned = true;
    }
    return null;
  }
  if (!aiClient) {
    try {
      aiClient = new OpenAI({
        apiKey,
        baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
        timeout: 120000,
        maxRetries: 1,
      });
      const visionModel = process.env.DASHSCOPE_VISION_MODEL || "qwen-vl-max";
      console.log(`[AI] 阿里云百炼 DashScope 客户端初始化成功 (chat: ${DASHSCOPE_CHAT_MODEL} / vision: ${visionModel})`);
    } catch (e) {
      console.error("[AI] DashScope OpenAI 兼容客户端初始化失败:", e);
      return null;
    }
  }
  return aiClient;
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
