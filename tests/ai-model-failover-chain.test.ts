import { describe, it, expect, vi } from "vitest";
import type { ModelCandidate } from "../src/server/services/aiModelRouter.ts";

// 降级链两条硬要求（2026-10-16 事故复盘）：
// ① 404 "Model not exist" 是候选行本身过期/写错，必须换下一跳，不能把整条链钉死；
// ② 全链失败时报出去的那句必须含**首因**——当时百炼额度耗尽(403) 是真因，
//    界面却显示最后一跳 qwen-vl-max 的 404，排查者被引去找一条不存在的坏模型名。

function cand(model: string, displayName = model, capabilities = ["chat", "vision"]): ModelCandidate {
  return {
    configId: `cfg-${model}`,
    provider: "test",
    displayName,
    baseUrl: "https://invalid.test/v1",
    apiKey: "offline-test-key",
    modelName: model,
    capabilities,
  };
}

const hopErrors = new Map<string, any>();
let candidates: ModelCandidate[] = [];

vi.mock("../src/server/services/aiModelRouter.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/services/aiModelRouter.ts")>();
  return {
    ...actual,
    markHealth: async () => {},
    resolveCandidates: async () => candidates,
    clientFor: () => ({
      chat: {
        completions: {
          create: async (params: any) => {
            const err = hopErrors.get(params.model);
            if (err) throw err;
            return { choices: [{ message: { content: "ok", model: params.model } }], model: params.model };
          },
        },
      },
    }),
  };
});

const { getAiClient, orderCandidates } = await import("../src/server/services/aiClient.ts");
const { isFailoverEligible } = await import("../src/server/services/aiModelRouter.ts");

function httpErr(status: number, message: string) {
  const e: any = new Error(message);
  e.status = status;
  return e;
}

async function createOnce(model: string) {
  const ai = getAiClient();
  return ai.chat.completions.create({ model, messages: [] });
}

async function captureError(model: string): Promise<any> {
  try {
    await createOnce(model);
    return null;
  } catch (e: any) {
    return e;
  }
}

describe("AI 降级链：404 可切换 + 失败上报首因", () => {
  it("isFailoverEligible 双向：403/404 放行切换，400/422 不放行", () => {
    expect(isFailoverEligible(httpErr(404, "404 Model not exist."))).toBe(true);
    expect(isFailoverEligible(httpErr(403, "Free quota exhausted"))).toBe(true);
    expect(isFailoverEligible(httpErr(400, "Bad Request"))).toBe(false);
    expect(isFailoverEligible(httpErr(422, "Unprocessable"))).toBe(false);
  });

  it("首跳 403、次跳 404 全失败：报出去的那句带首因 403，且 404 只作为尾巴", async () => {
    candidates = [cand("qwen-plus", "阿里百炼 qwen-plus"), cand("agnes-2.5-flash", "Agnes 2.5 Flash")];
    hopErrors.clear();
    hopErrors.set("qwen-plus", httpErr(403, "403 Free quota exhausted"));
    hopErrors.set("agnes-2.5-flash", httpErr(404, "404 Model not exist."));

    const err = await captureError("qwen-plus");
    expect(err).toBeTruthy();
    expect(err.message).toContain("Free quota exhausted");
    expect(err.message).toContain("降级链 2 跳全部失败");
    expect(err.message.indexOf("Free quota exhausted")).toBeLessThan(err.message.indexOf("Model not exist"));
  });

  it("404 不再钉死链路：首跳 404、次跳可用时整链成功", async () => {
    candidates = [cand("qwen-vl-max", "阿里百炼 qwen-vl-max"), cand("agnes-2.5-flash", "Agnes 2.5 Flash")];
    hopErrors.clear();
    hopErrors.set("qwen-vl-max", httpErr(404, "404 Model not exist."));
    const res = await createOnce("qwen-vl-max");
    expect(res.model).toBe("agnes-2.5-flash");
  });

  it("首跳挂了、Agnes 能答：整链成功返回（额度耗尽期间的实际存活路径）", async () => {
    candidates = [cand("qwen-plus", "阿里百炼 qwen-plus"), cand("agnes-2.5-flash", "Agnes 2.5 Flash")];
    hopErrors.clear();
    hopErrors.set("qwen-plus", httpErr(403, "403 Free quota exhausted"));
    const res = await createOnce("qwen-plus");
    expect(res.model).toBe("agnes-2.5-flash");
  });

  it("只有一跳：错误原样抛出，不包装成降级链文案", async () => {
    candidates = [cand("qwen-plus", "阿里百炼 qwen-plus")];
    hopErrors.clear();
    hopErrors.set("qwen-plus", httpErr(403, "403 Free quota exhausted"));
    const err = await captureError("qwen-plus");
    expect(err.message).toBe("403 Free quota exhausted");
  });

  it("orderCandidates 回归守卫：vision 请求让具备 vision 的候选排第一", () => {
    const chatOnly = cand("chat-cheap", "chat-cheap", ["chat"]);
    const visionCapable = cand("vision-capable", "vision-capable", ["vision"]);
    expect(orderCandidates([chatOnly, visionCapable], undefined, "vision")[0].modelName).toBe("vision-capable");
    expect(orderCandidates([chatOnly, visionCapable], undefined, "chat")[0].modelName).toBe("chat-cheap");
  });
});
