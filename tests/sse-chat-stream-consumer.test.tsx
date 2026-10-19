// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiChat } from "../src/hooks/useAiChat";
import { SSE_IDLE_TIMEOUT_MS } from "../src/utils/sseChatStream";

// 追问建议走 aiApi，本用例只关对流式收尾的行为，打成桩避免真发请求
vi.mock("../src/api", () => ({
  aiApi: { suggestFollowups: vi.fn(async () => ({ success: true, suggestions: [] })) },
  safeStorage: { getItem: () => null, setItem: () => {} },
}));

const enc = new TextEncoder();

/** 假上游：什么时候吐帧、什么时候沉默、关不关闭 socket，全由用例决定 */
function manualStream() {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return { stream, push: (s: string) => ctrl.enqueue(enc.encode(s)) };
}

function stubFetch(stream: ReadableStream<Uint8Array>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, body: stream, json: async () => ({}) })),
  );
}

describe("useAiChat 遇到异常流形状必须落回非流式态", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const ask = () => "2#无油螺杆空压机主机振动偏高，怎么排查";

  it("上游发完 [DONE] 不关 socket：气泡收满正文且 streaming=false", async () => {
    const { stream, push } = manualStream();
    push('data: {"chatId":"chat-1"}\n\n');
    push('data: {"content":"可能原因："}\n\n');
    push('data: {"content":"1. 轴承劣化（润滑不良）"}\n\n');
    push("data: [DONE]\n\n"); // 到此为止：socket 故意不关，等价于 2026-10-19 13:26 那次
    stubFetch(stream);

    const { result } = renderHook(() => useAiChat("运维主管"));
    await act(async () => {
      await result.current.sendMessage(ask());
      await new Promise((r) => setTimeout(r, 0)); // 追问建议的 setState 也要落在 act 内
    });

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.sender).toBe("assistant");
    expect(last.text).toBe("可能原因：1. 轴承劣化（润滑不良）");
    expect(last.streaming).toBe(false); // 这条就是「永远停在正在生成」的反面断言
    expect(last.kind).toBe("normal");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("只发半句就静默：看门狗超时后保留部分正文并如实标注中断", async () => {
    vi.useFakeTimers();
    const { stream, push } = manualStream();
    push('data: {"content":"1. 轴承劣化（润滑不良 /"}\n\n'); // 截图里被截断的那半句
    stubFetch(stream);

    const { result } = renderHook(() => useAiChat("运维主管"));
    let sending: Promise<void> | undefined;
    await act(async () => {
      sending = result.current.sendMessage(ask());
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SSE_IDLE_TIMEOUT_MS - 1);
    });
    // 差 1 毫秒仍是流式态：看门狗不许提前判死
    expect(result.current.messages[result.current.messages.length - 1].streaming).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2); // 过线，看门狗落地引发的 setState 落在 act 内
    });
    await act(async () => {
      await sending;
    });

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.text).toContain("1. 轴承劣化（润滑不良 /"); // 已收到的部分不丢
    expect(last.text).toContain("未收到新内容"); // 中断要写出来，不伪装成完整回答
    expect(last.streaming).toBe(false);
    expect(last.kind).toBe("normal"); // 中断不是「AI 服务请求失败」，不该抢错误样式
    expect(result.current.isStreaming).toBe(false);
  });
});
