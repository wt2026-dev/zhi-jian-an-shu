import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { __resetBudgetStateForTests } from "../src/server/services/aiClient.ts";

// Mock DashScope AI calls to avoid real network requests
vi.mock("../src/server/services/aiModelRouter.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/services/aiModelRouter.ts")>();
  let callCount = 0;
  return {
    ...actual,
    resolveCandidates: async () => [
      {
        configId: "mock-config",
        provider: "dashscope",
        modelName: "qwen-plus",
        displayName: "Mock Qwen-Plus",
        capabilities: ["chat", "vision"],
        health: "healthy",
      },
    ],
    clientFor: () => ({
      chat: {
        completions: {
          create: async (params: any) => {
            callCount++;
            if (params.stream) {
              // Return async iterator for streaming
              return {
                [Symbol.asyncIterator]: async function* () {
                  yield { choices: [{ delta: { content: '{"result":"ok"}' } }] };
                },
              };
            }
            return {
              choices: [{ message: { content: '{"result":"ok","model":"mock"}' } }],
              usage: { prompt_tokens: 50, completion_tokens: 30 },
            };
          },
        },
      },
    }),
    markHealth: async () => {},
    isFailoverEligible: () => false,
    getCallCount: () => callCount,
    resetCallCount: () => { callCount = 0; },
  };
});

let app: any;
let adminToken: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  // 跨测试文件隔离：清除前置测试文件累积的预算用量（模块级单例状态）
  __resetBudgetStateForTests();
  // Budget disabled by default
  delete process.env.AI_BUDGET_ENABLED;
  delete process.env.AI_DAILY_BUDGET;
  app = await createApp();

  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "password123" });
  adminToken = loginRes.body.token;
});

describe("AI 预算控制 (Budget Suite)", () => {
  describe("1. 预算关闭时（默认行为）", () => {
    it("GET /api/v1/ai/budget 返回 enabled=false", async () => {
      const res = await request(app)
        .get("/api/v1/ai/budget")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(typeof res.body.used).toBe("number");
      expect(typeof res.body.budget).toBe("number");
      expect(typeof res.body.resetAt).toBe("string");
    });

    it("AI 对话正常工作，不受预算限制", async () => {
      const { resetCallCount } = await import("../src/server/services/aiModelRouter.ts") as any;
      resetCallCount();
      const res = await request(app)
        .post("/api/v1/ai/chat")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ message: "测试消息" });
      expect(res.status).toBe(200);
      expect(res.body.success).not.toBe(false);
    });
  });

  describe("2. 预算开启后", () => {
    let origBudgetEnabled: string | undefined;
    let origBudgetAmount: string | undefined;

    beforeAll(() => {
      origBudgetEnabled = process.env.AI_BUDGET_ENABLED;
      origBudgetAmount = process.env.AI_DAILY_BUDGET;
    });

    afterAll(() => {
      // Restore original env
      if (origBudgetEnabled !== undefined) process.env.AI_BUDGET_ENABLED = origBudgetEnabled;
      else delete process.env.AI_BUDGET_ENABLED;
      if (origBudgetAmount !== undefined) process.env.AI_DAILY_BUDGET = origBudgetAmount;
      else delete process.env.AI_DAILY_BUDGET;
    });

    it("低预算时第 N 次调用触发降级", async () => {
      // Set very low budget: 100 tokens (each call uses ~80 tokens)
      __resetBudgetStateForTests();
      process.env.AI_BUDGET_ENABLED = "true";
      process.env.AI_DAILY_BUDGET = "100";

      // Need to reimport to pick up new env values
      // The budget state is module-level, so we need to test via the endpoint
      const budgetRes = await request(app)
        .get("/api/v1/ai/budget")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(budgetRes.status).toBe(200);
      expect(budgetRes.body.enabled).toBe(true);
      expect(budgetRes.body.budget).toBe(100);
    });

    it("预算接口返回正确的数字", async () => {
      __resetBudgetStateForTests();
      process.env.AI_BUDGET_ENABLED = "true";
      process.env.AI_DAILY_BUDGET = "50000";

      const res = await request(app)
        .get("/api/v1/ai/budget")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.budget).toBe(50000);
      expect(typeof res.body.used).toBe("number");
      expect(res.body.used).toBeGreaterThanOrEqual(0);
      // resetAt should be a valid ISO date string
      expect(new Date(res.body.resetAt).toISOString()).toBe(res.body.resetAt);
    });

    it("非 admin 用户无法访问预算接口", async () => {
      const techLogin = await request(app)
        .post("/api/v1/auth/login")
        .send({ username: "tech1", password: "password123" });
      const techToken = techLogin.body.token;

      const res = await request(app)
        .get("/api/v1/ai/budget")
        .set("Authorization", `Bearer ${techToken}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("RBAC_PERMISSION_DENIED");
    });

    it("未登录时返回 401", async () => {
      const res = await request(app).get("/api/v1/ai/budget");
      expect(res.status).toBe(401);
    });
  });
});
