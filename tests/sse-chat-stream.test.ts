import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readSseChatStream,
  SseIdleError,
  SSE_IDLE_TIMEOUT_MS,
  type SseChatEvent,
} from "../src/utils/sseChatStream.ts";

const enc = new TextEncoder();

/** 手动控制的流：测试自己决定什么时候吐帧、什么时候沉默、什么时候关闭 */
function manualStream() {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return { stream, push: (s: string) => ctrl.enqueue(enc.encode(s)) };
}

describe("AI 对话 SSE 读端口径（[DONE] 权威结束 + 静默看门狗）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("上游发完 [DONE] 却不关 socket：读循环必须收尾，不能等 EOF 等到永远", async () => {
    // 这条就是 2026-10-19 那次「服务端 25 秒结束、页面永远停在正在生成」的形状：
    // 中间层把最后的终止块吞掉时，只认 EOF 的实现会永久挂住。
    const { stream, push } = manualStream();
    push('data: {"chatId":"chat-1"}\n\n');
    push('data: {"content":"轴承劣化"}\n\n');
    push('data: {"content":"（润滑不良）"}\n\n');
    push("data: [DONE]\n\n");
    // 故意不 close()：流保持打开
    const got: SseChatEvent[] = [];
    await expect(readSseChatStream(stream, (e) => got.push(e))).resolves.toBeUndefined();
    expect(got.map((e) => e.content).join("")).toBe("轴承劣化（润滑不良）");
  });

  it("半句之后静默：超过 30 秒无字节要抛 SseIdleError，并取消 reader 释放连接", async () => {
    vi.useFakeTimers();
    const { stream, push } = manualStream();
    const got: SseChatEvent[] = [];
    let outcome = "pending";
    let thrown: unknown;
    const p = readSseChatStream(stream, (e) => got.push(e)).then(
      () => { outcome = "resolved"; },
      (e: unknown) => { thrown = e; outcome = `rejected:${(e as Error).name}`; },
    );

    push('data: {"content":"一、"}\n\n');
    await vi.advanceTimersByTimeAsync(SSE_IDLE_TIMEOUT_MS - 1);
    expect(outcome).toBe("pending"); // 差 1 毫秒都不许提前判死

    await vi.advanceTimersByTimeAsync(1);
    await p.catch(() => {});
    expect(outcome).toBe("rejected:SseIdleError");
    expect(thrown).toBeInstanceOf(SseIdleError);
    expect((thrown as SseIdleError).idleMs).toBe(SSE_IDLE_TIMEOUT_MS);
    expect(got.map((e) => e.content).join("")).toBe("一、"); // 已收到的部分要交回调用方
  });

  it("每 10 秒续帧的慢回答不许被掐断：看门狗量的是静默间隔，不是总时长", async () => {
    vi.useFakeTimers();
    const { stream, push } = manualStream();
    const got: SseChatEvent[] = [];
    const p = readSseChatStream(stream, (e) => got.push(e));

    for (let i = 1; i <= 5; i++) {
      await vi.advanceTimersByTimeAsync(10000);
      push(`data: {"content":"段${i}"}\n\n`);
      // 排空微任务，让这一帧真的被读循环消费掉（只 await 一个 tick 会漏掉最后一帧）
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(got).toHaveLength(5);
    push("data: [DONE]\n\n");
    await expect(p).resolves.toBeUndefined();
    // 5 段 × 10 秒 = 50 秒，远超 30 秒预算，但每次 read() 都有返回
    expect(got.map((e) => e.content).join("")).toBe("段1段2段3段4段5");
  });

  it("没有 [DONE] 但 socket 正常关闭：EOF 仍是兜底出口，畸形帧跳过不打断流", async () => {
    let ctrl: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    ctrl!.enqueue(enc.encode('data: {"content":"只有正文"}\n\n'));
    ctrl!.enqueue(enc.encode('data: {"broken\n\n')); // 畸形帧：解析失败要跳过
    ctrl!.close(); // 没有 [DONE]，只靠 EOF 收尾
    const got: SseChatEvent[] = [];
    await expect(readSseChatStream(stream, (e) => got.push(e))).resolves.toBeUndefined();
    expect(got.map((e) => e.content).join("")).toBe("只有正文");
  });

  it("默认静默预算 30 秒（改这个数要连用例一起改）", () => {
    expect(SSE_IDLE_TIMEOUT_MS).toBe(30000);
  });
});

describe("两处消费方不许各自再写一份读循环", () => {
  const root = join(process.cwd());
  const files = ["src/hooks/useAiChat.ts", "src/components/AiAssistantView.tsx"];

  for (const rel of files) {
    it(`${rel} 走共享读端口径`, () => {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src).toContain("readSseChatStream(");
      // 自己 getReader / 自己把 [DONE] 丢掉 都是这次故障的形状
      expect(src).not.toMatch(/getReader\(\)/);
      expect(src).not.toMatch(/'\[DONE\]'\)\s*continue/);
    });
  }
});
