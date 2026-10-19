import { describe, it, expect, vi, beforeEach } from "vitest";

// streamAiStructured 是多数"会落地成工单/检修方案/安全评估"的 AI 能力的通用流式管线
// （aiGenerationController / aiForecastController 等都走它）。本测试锁定「可信」硬保证：
//   ① 模型不可用时，若有规则引擎降级，则发 degraded:true 的 rule-engine done 帧，数据来自规则引擎而非伪造；
//   ② 无规则引擎降级时，发 error 帧（带 degraded:true）并审计 FAILED，绝不把失败伪装成成功 done；
//   ③ 模型正常时，发真实 data 的 done 帧、不标 degraded、审计 SUCCESS。

const auditCalls: any[] = [];
const written: string[] = [];
let resEnded = false;

// 控制 mock AI 客户端的行为：fail=true 时 create 抛错；否则以 successJson 构造流式返回
const control: { fail: boolean; successJson: string | null } = { fail: true, successJson: null };

function makeStream(text: string) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => {
          if (i >= text.length) return { value: undefined as any, done: true as any };
          const delta = text.slice(i, i + 12);
          i += 12;
          return { value: { choices: [{ delta: { content: delta } }] }, done: false as any };
        },
      };
    },
  };
}

vi.mock("../src/utils/aiCache.ts", () => ({
  aiCacheGet: () => null,
  aiCacheSet: () => {},
}));

vi.mock("../src/server/services/auditService.ts", () => ({
  addAuditLog: async (_req: any, rec: any) => {
    auditCalls.push(rec);
  },
}));

// 通过 mock 依赖（aiModelRouter）注入可控的 clientFor，绕开"同模块内部自调用导出函数"的 mock 坑。
vi.mock("../src/server/services/aiModelRouter.ts", () => ({
  resolveCandidates: async () => [
    {
      configId: "cfg-test",
      provider: "test",
      displayName: "test-model",
      baseUrl: "https://invalid.test/v1",
      apiKey: "offline-test-key",
      modelName: "test-model",
      capabilities: ["chat", "vision"],
    },
  ],
  markHealth: async () => {},
  isFailoverEligible: () => true,
  clientFor: () => ({
    chat: {
      completions: {
        create: async () => {
          if (control.fail) {
            const e: any = new Error("model unavailable (503)");
            e.status = 503;
            throw e;
          }
          return makeStream(control.successJson as string);
        },
      },
    },
  }),
}));

function makeRes() {
  written.length = 0;
  resEnded = false;
  return {
    setHeader() {},
    flushHeaders() {},
    write(s: string) {
      written.push(s);
      return true;
    },
    end() {
      resEnded = true;
    },
    writableEnded: false,
  };
}

function frames() {
  return written
    .filter((s) => s.startsWith("data: "))
    .map((s) => s.slice(6).trim())
    .filter((p) => p && p !== "[DONE]")
    .map((p) => {
      try {
        return JSON.parse(p);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const { streamAiStructured } = await import("../src/server/services/aiClient.ts");

const baseOpts = {
  actionType: "TEST_STRUCTURED",
  cacheType: "test-structured",
  cacheParams: () => ({ k: "v" }),
  prepare: async () => ({ system: "sys", user: "usr", ctx: { equipmentId: "EQ-1" } }),
  buildSuccessBody: (_ctx: any, data: any) => ({ result: data }),
};

describe("streamAiStructured 降级行为（可信护栏）", () => {
  beforeEach(() => {
    auditCalls.length = 0;
    control.fail = true;
    control.successJson = null;
  });

  it("模型不可用 + 有规则引擎降级：发 degraded:true 的 rule-engine done 帧，数据来自规则引擎而非伪造", async () => {
    const res = makeRes();
    await streamAiStructured(res, undefined, {
      ...baseOpts,
      buildDegraded: () => ({ data: { fallback: true, reason: "规则引擎兜底" }, message: "AI 不可用，已切换规则引擎" }),
    });

    const done = frames().find((f: any) => f.type === "done");
    expect(done).toBeTruthy();
    expect(done!.degraded).toBe(true);
    expect(done!.model).toBe("rule-engine");
    // 关键：done 的数据是规则引擎产物，不是凭空捏造的成功结论
    expect(done!.data).toEqual({ fallback: true, reason: "规则引擎兜底" });

    // 绝不允许同时发一个伪造的 success done 帧
    const fakeDone = frames().find((f: any) => f.type === "done" && f.data && f.data.fallback !== true);
    expect(fakeDone).toBeUndefined();

    const failed = auditCalls.find((a) => a.status === "FAILED");
    expect(failed).toBeTruthy();
    expect(failed!.metadata?.degraded).toBe(true);
    expect(resEnded).toBe(true);
  });

  it("模型不可用 + 无规则引擎降级：发 error 帧（带 degraded:true）并审计 FAILED，绝不发伪造 success done", async () => {
    const res = makeRes();
    await streamAiStructured(res, undefined, { ...baseOpts });

    const errFrame = frames().find((f: any) => f.type === "error");
    expect(errFrame).toBeTruthy();
    expect(errFrame!.degraded).toBe(true);

    // 没有任何 done 帧（成功或伪造都不允许）
    const anyDone = frames().find((f: any) => f.type === "done");
    expect(anyDone).toBeUndefined();

    const failed = auditCalls.find((a) => a.status === "FAILED");
    expect(failed).toBeTruthy();
    expect(resEnded).toBe(true);
  });

  it("模型正常：发真实 data 的 done 帧、不标 degraded、审计 SUCCESS", async () => {
    control.fail = false;
    control.successJson = '{"conclusion":"设备振动超差，建议复对中"}';
    const res = makeRes();
    await streamAiStructured(res, undefined, { ...baseOpts });

    const done = frames().find((f: any) => f.type === "done");
    expect(done).toBeTruthy();
    expect(done!.degraded).toBeFalsy();
    expect(done!.data).toEqual({ result: { conclusion: "设备振动超差，建议复对中" } });

    const success = auditCalls.find((a) => a.status === "SUCCESS");
    expect(success).toBeTruthy();
    expect(resEnded).toBe(true);
  });

  it("prepare 抛错（ctx 未建立）：直接 error 帧、审计 FAILED，不泄露半成品", async () => {
    const res = makeRes();
    await streamAiStructured(res, undefined, {
      ...baseOpts,
      prepare: async () => {
        throw new Error("prepare boom");
      },
    });

    const errFrame = frames().find((f: any) => f.type === "error");
    expect(errFrame).toBeTruthy();
    expect(errFrame!.degraded).toBe(true);
    const anyDone = frames().find((f: any) => f.type === "done");
    expect(anyDone).toBeUndefined();
    expect(auditCalls.some((a) => a.status === "FAILED")).toBe(true);
  });
});
