/**
 * AI 对话 SSE 的唯一读端口径（useAiChat 与 AiAssistantView 共用）。
 *
 * 两条硬规则都来自「页面永远停在正在生成」那次实测（服务端 25 秒就 res.end 了，
 * 前端读循环却再也没返回）：
 * 1. `data: [DONE]` 是权威结束信号，收到即收尾——不能只等 socket EOF，
 *    中间任何一层代理或端口转发把最后的终止块吞掉，读循环就会永久挂住。
 * 2. 静默即断：单次 read() 超过 idleMs 没有返回就判定上游失联并抛 SseIdleError，
 *    由调用方保留已收到的部分并如实标注中断，不让 UI 无限期停在流式态。
 */

/** 上游静默多久判定失联：比一次正常回答的 chunk 间隔大一个量级，比用户耐心小 */
export const SSE_IDLE_TIMEOUT_MS = 30000;

export interface SseChatEvent {
  chatId?: string;
  content?: string;
  model?: string;
  error?: string;
  degraded?: boolean;
}

export class SseIdleError extends Error {
  readonly idleMs: number;
  constructor(idleMs: number) {
    super(`AI 应答中断：${Math.round(idleMs / 1000)} 秒未收到新内容`);
    this.name = "SseIdleError";
    this.idleMs = idleMs;
  }
}

async function readWithIdleTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  idleMs: number,
): Promise<ReadableStreamReadResult<T>> {
  const pending = reader.read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 超时后 read() 会以 cancel 的结果落地，这里先吞掉，避免未处理的 rejection
  pending.catch(() => {});
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // 顺序是硬约束：cancel() 会把挂起的 read() 以 done:true 就地落地，
          // 先 cancel 再 reject 的话 Promise.race 抢到的是「正常结束」，看门狗等于没装。
          reject(new SseIdleError(idleMs));
          reader.cancel().catch(() => {});
        }, idleMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 逐帧回调 SSE 事件；收到 [DONE] 或 socket EOF 即正常返回，静默超时抛 SseIdleError。 */
export async function readSseChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (evt: SseChatEvent) => void,
  idleMs: number = SSE_IDLE_TIMEOUT_MS,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await readWithIdleTimeout(reader, idleMs);
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const evt of events) {
      const line = evt.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        await reader.cancel().catch(() => {});
        return;
      }
      try {
        onEvent(JSON.parse(payload));
      } catch {
        // 半帧或非 JSON 心跳：与旧口径一致，跳过
      }
    }
  }
}
