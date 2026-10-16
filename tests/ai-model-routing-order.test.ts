import { describe, it, expect } from "vitest";
import { orderCandidates } from "../src/server/services/aiClient.ts";
import type { ModelCandidate } from "../src/server/services/aiModelRouter.ts";

// 纯函数单测：候选排序是"多模型路由"唯一的选路依据，回归会让视觉请求静默落到纯对话模型上。
function cand(model: string, capabilities: string[]): ModelCandidate {
  return {
    configId: `cfg-${model}`,
    provider: model.startsWith("agnes") ? "agnes" : "dashscope",
    displayName: model,
    baseUrl: "https://example.invalid/v1",
    apiKey: "offline-test-key",
    modelName: model,
    capabilities,
  };
}

describe("AI 模型路由候选排序 orderCandidates", () => {
  const chatOnly = cand("chat-cheap", ["chat"]); // priority 更小（入参靠前）
  const bothCaps = cand("chat-and-vision", ["chat", "vision"]); // priority 更大（入参靠后）
  const input = [chatOnly, bothCaps];

  it("请求 model 未精确命中时，视觉请求必须让具备 vision 能力的候选排第一（即使 priority 更大）", () => {
    const ordered = orderCandidates(input, "qwen-vl-max", "vision");
    expect(ordered.map((c) => c.modelName)).toEqual(["chat-and-vision", "chat-cheap"]);
  });

  it("同一组候选、同一入参，对话请求仍按 priority 让纯对话模型在前（证明排序方向由 capability 决定）", () => {
    const ordered = orderCandidates(input, "qwen-plus", "chat");
    expect(ordered.map((c) => c.modelName)).toEqual(["chat-cheap", "chat-and-vision"]);
  });

  it("请求 model 精确命中时优先该候选，能力排序不得越过它（保持既有向后兼容语义）", () => {
    const ordered = orderCandidates(input, "chat-cheap", "vision");
    expect(ordered[0].modelName).toBe("chat-cheap");
  });

  it("同能力组内保持入参顺序（稳定排序，不破坏 priority）", () => {
    const a = cand("vision-a", ["vision"]);
    const b = cand("vision-b", ["vision"]);
    const ordered = orderCandidates([a, b], "not-configured-model", "vision");
    expect(ordered.map((c) => c.modelName)).toEqual(["vision-a", "vision-b"]);
  });

  it("不修改入参数组", () => {
    orderCandidates(input, "qwen-vl-max", "vision");
    expect(input.map((c) => c.modelName)).toEqual(["chat-cheap", "chat-and-vision"]);
  });
});
