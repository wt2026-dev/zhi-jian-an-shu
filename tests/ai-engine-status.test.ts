// 「当前应答引擎」只读投影端点测试（2026-10-19）
// 背景：引擎名原来只有 /api/v1/admin/ai-models 一个来源，而那条是 admin 专属
// （requireRole(["admin"])，实测 manager 拿 403 RBAC_PERMISSION_DENIED），
// 于是主管/操作员登录时角标只能显示「未探测」。这里补一条只要求登录、
// 且只投影展示字段的通道，并钉住两件事：①非管理员读得到；②绝不带出密钥材料。
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { pickFirstChatHop } from "../src/server/services/aiClient.ts";
import { DASHSCOPE_CHAT_MODEL } from "../src/server/utils/config.ts";
import type { ModelCandidate } from "../src/server/services/aiModelRouter.ts";

let app: any;
let adminToken: string;
let managerToken: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  // 离线：注入伪造 Key 只为了触发启动种子（ensureAiModelSeed 依赖非空 Key，种子不发外部调用）
  process.env.DASHSCOPE_API_KEY = "offline-test-key-for-engine-status";
  app = await createApp();

  const login = async (username: string, password: string) => {
    const res = await request(app).post("/api/v1/auth/login").send({ username, password });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin", "Admin@2026#Demo");
  managerToken = await login("manager", "Manager@2026#Safe");
});

const cand = (over: Partial<ModelCandidate> = {}): ModelCandidate => ({
  configId: "aimc-x",
  provider: "agnes",
  displayName: "占位引擎",
  baseUrl: "https://example.invalid/v1",
  apiKey: "sk-secret-should-never-leave",
  modelName: "placeholder",
  capabilities: ["chat"],
  ...over,
});

describe("pickFirstChatHop —— 投影出来的就是路由实际的第一跳", () => {
  it("没有候选时返回 null（ configured=false 的真值来源，不是默认在线）", () => {
    expect(pickFirstChatHop([])).toBeNull();
  });

  it("请求 model 与某行精确一致时该行置顶，即使它 priority 更大", () => {
    // 与 lazyModelRouter 同口径：调用方总会带上 config.ts 里写死的 model 名
    const hit = cand({ configId: "aimc-hit", displayName: "精确命中引擎", modelName: DASHSCOPE_CHAT_MODEL });
    const first = pickFirstChatHop([cand({ displayName: "priority 更小的引擎" }), hit]);
    expect(first?.displayName).toBe("精确命中引擎");
  });

  it("没命中 model 时，纯视觉行不顶替对话引擎", () => {
    const first = pickFirstChatHop([
      cand({ displayName: "视觉专用", capabilities: ["vision"] }),
      cand({ displayName: "对话引擎", capabilities: ["chat"] }),
    ]);
    expect(first?.displayName).toBe("对话引擎");
  });
});

describe("GET /api/v1/ai/engine —— 只投影展示字段", () => {
  it("未登录 401：引擎名不对外匿名可见", async () => {
    const res = await request(app).get("/api/v1/ai/engine");
    expect(res.status).toBe(401);
  });

  it("主管（非 admin）读得到，且与 admin 读到的一致", async () => {
    // 反证旧口径：同一次会话里 manager 打 /admin/ai-models 是 403
    const denied = await request(app)
      .get("/api/v1/admin/ai-models")
      .set("Authorization", `Bearer ${managerToken}`);
    expect(denied.status).toBe(403);

    const asManager = await request(app)
      .get("/api/v1/ai/engine")
      .set("Authorization", `Bearer ${managerToken}`);
    const asAdmin = await request(app)
      .get("/api/v1/ai/engine")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(asManager.status).toBe(200);
    expect(asAdmin.status).toBe(200);
    expect(asManager.body).toEqual(asAdmin.body);
    expect(asManager.body.configured).toBe(true);
    expect(typeof asManager.body.displayName).toBe("string");
    expect(asManager.body.displayName.length).toBeGreaterThan(0);
  });

  it("响应里不出现密钥材料与上游地址：这条通道对全体登录角色开放", async () => {
    const res = await request(app)
      .get("/api/v1/ai/engine")
      .set("Authorization", `Bearer ${managerToken}`);
    const raw = JSON.stringify(res.body);
    expect(res.status).toBe(200);
    // 白名单口径：投影字段就这些，多一个都算泄露
    expect(Object.keys(res.body).sort()).toEqual(
      ["chatCandidateCount", "configured", "displayName", "healthStatus", "modelName", "provider"].sort()
    );
    for (const banned of ["apiKey", "encrypted", "sk-", "baseUrl", "aliyuncs", "agnes-ai"]) {
      expect(raw.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("chatCandidateCount 与配置列表里启用的 chat 行数一致（降级链长度不是编的）", async () => {
    const [engine, models] = await Promise.all([
      request(app).get("/api/v1/ai/engine").set("Authorization", `Bearer ${adminToken}`),
      request(app).get("/api/v1/admin/ai-models").set("Authorization", `Bearer ${adminToken}`),
    ]);
    const enabledChatRows = models.body.filter(
      (m: any) => m.enabled && (m.capabilities || []).includes("chat")
    );
    expect(engine.body.chatCandidateCount).toBe(enabledChatRows.length);
  });
});
