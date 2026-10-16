import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 启动种子必须保证：环境里配了 AGNES_API_KEY，任何一份库里都有一条能用的 Agnes 候选行。
// 真因（2026-10-16 一天三次）：PGlite 是进程独占的嵌入式库，第二个实例发现目录被锁就 fork
// 一份带时间戳的副本，副本里只有迁移期的两条百炼行；百炼免费额度耗尽 ⇒ 新副本一开机就 403→404。

let rows: any[] = [];
const inserted: any[] = [];

vi.mock("../src/db/repositories/index.ts", () => ({
  AiModelConfigRepository: {
    getAll: async () => rows,
    insert: async (config: any) => {
      inserted.push(config);
      rows = [...rows, config];
      return config;
    },
  },
}));

const { ensureAiModelSeed } = await import("../src/server/services/aiModelRouter.ts");

const dashscopeRows = () => [
  { id: "aimc-dashscope-chat", provider: "dashscope", modelName: "qwen-plus", priority: 10, enabled: true },
  { id: "aimc-dashscope-vision", provider: "dashscope", modelName: "qwen-vl-max", priority: 10, enabled: true },
];

beforeEach(() => {
  inserted.length = 0;
  rows = [];
  process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
  process.env.AGNES_API_KEY = "test-agnes-key";
  process.env.AGNES_BASE_URL = "https://agnes.test/v1";
});

afterEach(() => {
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.AGNES_API_KEY;
  delete process.env.AGNES_BASE_URL;
});

describe("AI 模型配置启动种子", () => {
  it("空库 + 两把 key：seed 两条百炼行，并补一条 Agnes（priority 5、chat+vision、密钥走 env 引用）", async () => {
    await ensureAiModelSeed();
    expect(inserted.map((c) => c.id)).toEqual(["aimc-dashscope-chat", "aimc-dashscope-vision", "aimc-agnes-flash"]);
    const agnes = inserted.find((c) => c.provider === "agnes");
    expect(agnes.modelName).toBe("agnes-2.5-flash");
    expect(agnes.priority).toBeLessThan(10);
    expect(agnes.capabilities).toEqual(["chat", "vision"]);
    expect(agnes.apiKeyEnv).toBe("AGNES_API_KEY");
    expect(agnes.apiKey).toBeUndefined(); // 明文密钥不入库
  });

  it("新 fork 出来的副本库（只有两条百炼行）：只补 Agnes，不动已有行", async () => {
    rows = dashscopeRows();
    await ensureAiModelSeed();
    expect(inserted.map((c) => c.id)).toEqual(["aimc-agnes-flash"]);
  });

  it("已存在 Agnes 行（哪怕被管理员停用）：一律不覆盖，人工开关优先", async () => {
    rows = [...dashscopeRows(), { id: "aimc-agnes-flash", provider: "agnes", modelName: "agnes-2.5-flash", priority: 20, enabled: false }];
    await ensureAiModelSeed();
    expect(inserted.length).toBe(0);
  });

  it("没配 AGNES_API_KEY：什么都不补（保持升级前行为）", async () => {
    delete process.env.AGNES_API_KEY;
    rows = dashscopeRows();
    await ensureAiModelSeed();
    expect(inserted.length).toBe(0);
  });

  it("幂等：连跑两次不会插出第二条 Agnes", async () => {
    await ensureAiModelSeed();
    const afterFirst = inserted.filter((c) => c.provider === "agnes").length;
    await ensureAiModelSeed();
    expect(inserted.filter((c) => c.provider === "agnes").length).toBe(afterFirst);
  });
});
