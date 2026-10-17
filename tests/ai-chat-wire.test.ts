import { describe, it, expect } from "vitest";
import { buildChatHistory, readWireError, MAX_CHAT_HISTORY, HISTORY_ITEM_MAX_CHARS } from "../src/utils/chatWire.ts";
import { aiChatSchema } from "../src/server/schemas/ai.ts";

// 前后端契约的双向钉：后端 aiChatSchema 对 history 是硬拒绝（>12 条或单条 >2000 字
// 整包 400），所以"客户端输出必过 schema"是 AI 对话能发出去的前提；
// 而 tests/ai-features.test.ts 钉住的是"未压缩的同一份输入必被拒"——两条都在跑，
// 任何一侧偷偷放宽预算都会红。

function msg(sender: "user" | "assistant", text: string) {
  return { sender, text };
}

describe("AI 对话出网组包 chatWire", () => {
  it("最坏情况（超量 + 单条超长）经 buildChatHistory 后必过 aiChatSchema", () => {
    const raw = [
      ...Array.from({ length: 14 }, (_, i) => msg(i % 2 ? "assistant" : "user", `第 ${i} 轮`)),
      msg("assistant", "长".repeat(5000)),
    ];
    const history = buildChatHistory(raw);
    const result = aiChatSchema.safeParse({ message: "泵振动超标怎么办", history });
    expect(result.success).toBe(true);
  });

  it("同一份输入未经压缩必被 schema 拒绝（证明这层为什么存在）", () => {
    const raw = [msg("assistant", "长".repeat(2001))];
    const asHistory = raw.map((m) => ({ role: m.sender, content: m.text }));
    const result = aiChatSchema.safeParse({ message: "泵振动超标怎么办", history: asHistory });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("单条对话内容不能超过 2000 个字符");
    }
  });

  it("单条超长截到恰好 2000 个字符（含截断标记），不越界也不放宽", () => {
    const history = buildChatHistory([msg("assistant", "x".repeat(9999))]);
    expect(history[0].content).toHaveLength(HISTORY_ITEM_MAX_CHARS);
    expect(history[0].content.endsWith("…（已截断）")).toBe(true);
    expect(
      aiChatSchema.safeParse({ message: "ok", history }).success
    ).toBe(true);
  });

  it("未超预算的历史原样透传，不追加标记", () => {
    const history = buildChatHistory([msg("user", "轴承发热怎么处理")]);
    expect(history).toEqual([{ role: "user", content: "轴承发热怎么处理" }]);
  });

  it("超过 12 条只留最近 12 条，顺序与角色映射不变", () => {
    const raw = Array.from({ length: 15 }, (_, i) =>
      msg(i % 2 ? "assistant" : "user", `第 ${i} 轮`)
    );
    const history = buildChatHistory(raw);
    expect(history).toHaveLength(MAX_CHAT_HISTORY);
    expect(history[0].content).toBe("第 3 轮");
    expect(history[history.length - 1].content).toBe("第 14 轮");
    expect(history.map((h) => h.role)).toEqual(raw.slice(-12).map((m) => (m.sender === "user" ? "user" : "assistant")));
  });
});

describe("校验类 400 的归因文案", () => {
  it("优先取 details[0].message，其次 error，都没有才回退 HTTP 状态", () => {
    expect(
      readWireError(
        { error: "请求体输入参数校验失败", details: [{ message: "对话历史过长，请刷新后重试" }] },
        "HTTP 400"
      )
    ).toBe("对话历史过长，请刷新后重试");
    expect(readWireError({ error: "AI 服务未配置" }, "HTTP 502")).toBe("AI 服务未配置");
    expect(readWireError(null, "HTTP 500")).toBe("HTTP 500");
  });
});
