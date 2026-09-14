import OpenAI from "openai";

// ==================== DashScope Embedding 服务（OpenAI 兼容模式） ====================
// 模型：text-embedding-v3（默认），维度 1024。
// 降级契约：未配置 DASHSCOPE_API_KEY / 输入为空 / 调用失败 / 维度校验不通过 → 返回 null，
// 由调用方回退关键词检索路径；本模块绝不抛错阻塞业务请求。
// 维度校验不通过的向量一律拒绝返回（视为脏数据，防止写坏索引）。

const EMBEDDING_DIMS = 1024;
const MAX_INPUT_CHARS = 8000; // text-embedding-v3 token 上限内，按字符数保守截断
const EMBEDDING_MODEL = process.env.DASHSCOPE_EMBEDDING_MODEL || "text-embedding-v3";
const BASE_URL = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";

export const EMBEDDING_DIMENSIONS = EMBEDDING_DIMS;

// undefined=未初始化，null=无 Key（负缓存），OpenAI 实例=可用
let cachedClient: OpenAI | null | undefined;

function getClient(): OpenAI | null {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.DASHSCOPE_API_KEY;
  cachedClient = apiKey
    ? new OpenAI({ apiKey, baseURL: BASE_URL, timeout: 30000, maxRetries: 0 })
    : null;
  return cachedClient;
}

/** embedding 通道是否可用（已配置 Key）。真实可用性以 embed() 返回值为准。 */
export function isEmbeddingAvailable(): boolean {
  return getClient() !== null;
}

function sanitize(text: string): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_INPUT_CHARS);
}

function isValidVector(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === EMBEDDING_DIMS &&
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

// 测试注入点：生产代码永不设置（tests 中用于 mock embedding 模型）
let embedOverride: ((text: string) => Promise<number[] | null>) | null = null;
export function __setEmbedOverrideForTests(fn: ((text: string) => Promise<number[] | null>) | null) {
  embedOverride = fn;
}

// 测试注入点：直接替换/重置 OpenAI 客户端（undefined = 恢复按环境变量惰性初始化）
export function __setClientForTests(client: OpenAI | null | undefined) {
  cachedClient = client;
}

/** 单文本向量化。失败/不可用返回 null（不抛错）。 */
export async function embed(text: string): Promise<number[] | null> {
  const input = sanitize(text);
  if (!input) return null;
  if (embedOverride) return embedOverride(input);

  const client = getClient();
  if (!client) return null;
  try {
    const resp: any = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input,
      dimensions: EMBEDDING_DIMS,
    });
    const vector = resp?.data?.[0]?.embedding;
    if (!isValidVector(vector)) {
      // 维度/类型不符视为脏数据：拒绝返回，交由调用方走关键词降级
      console.warn(
        `[Embedding] 维度校验失败（期望 ${EMBEDDING_DIMS} 维，实际 ${Array.isArray(vector) ? vector.length : "非数组"}），拒绝写入`
      );
      return null;
    }
    return vector;
  } catch (err: any) {
    console.warn("[Embedding] 调用失败（降级为不可用）:", err?.message || err);
    return null;
  }
}

/** 批量向量化。单批 ≤ 10 条（兼容模式单请求上限），返回与输入等长数组，失败位为 null。 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const client = getClient();
  if (!client) return texts.map(() => null);

  const inputs = texts.map((t) => sanitize(t) ?? "");
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const BATCH_SIZE = 10;

  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const idxs: number[] = []; // 批内非空输入的原数组下标
    const batchInputs: string[] = [];
    for (let j = start; j < Math.min(start + BATCH_SIZE, inputs.length); j++) {
      if (inputs[j]) {
        idxs.push(j);
        batchInputs.push(inputs[j]);
      }
    }
    if (batchInputs.length === 0) continue;

    try {
      const resp: any = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batchInputs,
        dimensions: EMBEDDING_DIMS,
      });
      const data: any[] = resp?.data || [];
      for (const d of data) {
        const localIdx = typeof d.index === "number" ? d.index : data.indexOf(d);
        const globalIdx = idxs[localIdx];
        if (globalIdx === undefined) continue;
        if (!isValidVector(d.embedding)) {
          console.warn(`[Embedding] 批量结果第 ${globalIdx} 项维度校验失败，该条置空拒绝写入`);
          continue;
        }
        results[globalIdx] = d.embedding;
      }
    } catch (err: any) {
      console.warn(`[Embedding] 批量调用失败（${batchInputs.length} 条置空）:`, err?.message || err);
    }
  }
  return results;
}
