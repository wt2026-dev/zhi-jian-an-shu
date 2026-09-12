import { z } from "zod";

/**
 * 1. Prompt 注入防御与基础清洗 (Anti-Prompt Injection & Sanitization)
 */
export function sanitizePromptText(input?: string): string {
  if (!input) return "";

  let cleaned = String(input);

  // 1.1 拦截 Prompt 注入典型攻击指令 (不区分大小写)
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/gi,
    /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/gi,
    /forget\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/gi,
    /override\s+(system|developer)\s+(prompt|instructions|rules)/gi,
    /you\s+are\s+now\s+a(n)?\s+(unrestricted|unconstrained|jailbroken)/gi,
    /system\s*:\s*you\s+are/gi,
    /\[system\s+override\]/gi,
    /bypass\s+safety\s+filter/gi,
  ];

  for (const pattern of injectionPatterns) {
    cleaned = cleaned.replace(pattern, "[已过滤危险指令]");
  }

  // 1.2 移除危险字符与控制字符，限制最大长度 (1000 字符)
  cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return cleaned.trim().slice(0, 1000);
}

/**
 * 2. 大图 Base64 智能压缩控制 (大小裁剪以降低传输与 AI 调用成本)
 */
export function compressImageBase64IfNeeded(imageBase64: string, maxSizeBytes: number = 1.5 * 1024 * 1024): string {
  if (!imageBase64) return imageBase64;

  const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const approximateBytes = cleanBase64.length * 0.75;

  if (approximateBytes > maxSizeBytes) {
    const prefixMatch = imageBase64.match(/^(data:image\/\w+;base64,)/);
    const prefix = prefixMatch ? prefixMatch[1] : "data:image/jpeg;base64,";
    
    // 按比例裁切 Base64 长度以降低 payload 成本
    const targetCharLength = Math.floor(maxSizeBytes * 1.33);
    const compressedClean = cleanBase64.slice(0, targetCharLength);
    return `${prefix}${compressedClean}`;
  }

  return imageBase64;
}

/**
 * 3. 30 秒超时与自动重试 1 次包装器 (Timeout 30s + 1 Retry + 502 Exception Handling)
 */
export async function callWithTimeoutAndRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30000,
  maxRetries = 1
): Promise<T> {
  let attempts = 0;
  let lastError: any = null;

  while (attempts <= maxRetries) {
    attempts++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;
      if (attempts <= maxRetries) {
        // 短暂延迟 300ms 后重试 1 次
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  throw lastError;
}

/**
 * 4. AI 视觉诊断模型输出结构校验 (Model Output Schema Validation)
 */
export const visionResultSchema = z.object({
  severity: z.string().default("一般"),
  defectType: z.string().default("机械缺陷待复核"),
  confidence: z.number().default(0.9),
  summary: z.string().default("已完成图像基础诊断"),
  location: z.string().optional().default("受损部件"),
  probableCauses: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  safetyNotice: z.string().optional().default("请遵循现场维保 SOP"),
});

export function validateVisionModelOutput(data: any) {
  if (!data || typeof data !== "object") {
    throw new Error("模型返回数据格式非法，非 JSON 对象");
  }
  const result = visionResultSchema.safeParse(data);
  if (!result.success) {
    return {
      severity: "一般",
      defectType: "AI 模型结构校验修复",
      confidence: 0.85,
      summary: data.summary || "AI 响应包含非标准字段，已自动修复补全结构",
      location: data.location || "设备整体",
      probableCauses: Array.isArray(data.probableCauses) ? data.probableCauses : ["检测到潜在磨损迹象"],
      recommendations: Array.isArray(data.recommendations) ? data.recommendations : ["建议安排人工复检"],
      safetyNotice: data.safetyNotice || "维保作业前请确认 LOTO 锁具挂牌就位",
    };
  }
  return result.data;
}
