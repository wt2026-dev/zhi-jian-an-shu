/**
 * AI 对话 SSE 的唯一读端口径（useAiChat 与 AiAssistantView 共用）。
 *
 * 两条硬规则都来自「页面永远停在正在生成」那次实测（服务端 25 秒就 res.end 了，
 * 前端读循环却再也没返回）：
 * 1. `data: [DONE]` 是权威结束信号，收到即收尾——不能只等 socket EOF，
 *    中间任何一层代理或端口转发把最后的终止块吞掉，读循环就会永久挂住。
 * 2. 静默即断：单次 read() 超过预算没有返回就判定上游失联并抛 SseIdleError，
 *    由调用方保留已收到的部分并如实标注中断，不让 UI 无限期停在流式态。
 * 预算按「首个内容帧之前 / 之后」分两段，理由见下面两个常量的注释。
 */

/** 帧间静默预算：2026-10-19 实测一次跑满 609 秒的长答案（3838 行帧）最大静默只有 4.61 秒，30 秒是 6 倍余量 */
export const SSE_IDLE_TIMEOUT_MS = 30000;

/**
 * 首个内容帧之前的预算。这一段静默通常不是模型吐字慢，而是服务端还在沿降级链重试：
 * 单个上游候选的客户端超时是 120 秒（见 aiModelRouter 建 OpenAI client 那处），
 * 拿帧间的 30 秒去卡它，会把「还在排队换下一跳」误报成「应答中断」。
 */
export const SSE_FIRST_CONTENT_TIMEOUT_MS = 90000;

/** 判死发生在哪一段：文案要如实区分「还没开始吐」和「吐到一半停了」 */
export type SseIdlePhase = 'first-content' | 'between-frames';

export interface SseChatEvent {
  chatId?: string;
  content?: string;
  model?: string;
  error?: string;
  degraded?: boolean;
}

export class SseIdleError extends Error {
  readonly idleMs: number;
  readonly phase: SseIdlePhase;
  constructor(idleMs: number, phase: SseIdlePhase = "between-frames") {
    super(
      phase === "first-content"
        ? `AI 应答中断：${Math.round(idleMs / 1000)} 秒未收到模型首个内容`
        : `AI 应答中断：${Math.round(idleMs / 1000)} 秒未收到新内容`,
    );
    this.name = "SseIdleError";
    this.idleMs = idleMs;
    this.phase = phase;
  }
}

async function readWithIdleTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  idleMs: number,
  phase: SseIdlePhase,
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
          reject(new SseIdleError(idleMs, phase));
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
  firstContentMs: number = SSE_FIRST_CONTENT_TIMEOUT_MS,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // 只有真正带文字的帧才算「首帧到达」：服务端一连接就先发 {"chatId":...} 前奏帧，
  // 把它当首帧等于没放宽——需要覆盖的那段静默发生在它之后。
  let sawContent = false;
  for (;;) {
    const { done, value } = await readWithIdleTimeout(
      reader,
      sawContent ? idleMs : firstContentMs,
      sawContent ? "between-frames" : "first-content",
    );
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
        const parsed = JSON.parse(payload) as SseChatEvent;
        if (typeof parsed.content === "string" && parsed.content.length > 0) sawContent = true;
        onEvent(parsed);
      } catch {
        // 半帧或非 JSON 心跳：与旧口径一致，跳过
      }
    }
  }
}
