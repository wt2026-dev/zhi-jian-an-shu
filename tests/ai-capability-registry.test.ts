/**
 * AI 能力清单防漂移测试。
 *
 * 背景：对外说"20 项 AI 能力"，而代码里 legacy 兼容层、6 个没人调的 /stream 双胞胎、
 * 2 个不建模的占位接口混在一起，被追问"哪 20 项"时答不齐。
 * 现在能力数只有一个来源（src/aiCapabilities.ts），本测试把这张表钉在三处事实之上：
 *   ① 表里的每一条必须在真实注册的 express 路由里存在（不允许文档能力实际 404）；
 *   ② 真实注册的 /api/v1/ai/* 必须在表里（新增接口不走表就红）；
 *   ③ package.json 与 openapi 文案里的能力数必须等于表里的 core 条数。
 */
import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createApp } from "../server.ts";
import { buildOpenApiSpec } from "../src/openapi.ts";
import {
  AI_CAPABILITIES,
  AI_CORE_CAPABILITY_COUNT,
  AI_STUB_ENDPOINT_COUNT,
  AI_API_PREFIX,
  capabilitiesOf,
} from "../src/aiCapabilities.ts";

let app: any;

/** 递归收集 express 已注册的 `METHOD path`；express 4/5 的 stack 形状都能覆盖。 */
function collectRegisteredPaths(server: any): Set<string> {
  const out = new Set<string>();
  const walk = (stack: any[]) => {
    for (const layer of stack || []) {
      const route = layer?.route;
      if (route) {
        for (const m of Object.keys(route.methods || {})) out.add(`${m.toUpperCase()} ${route.path}`);
      } else if (layer?.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(server?._router?.stack || server?.router?.stack || []);
  return out;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
}, 60000);

/** 从对外文案里抠出能力数；抠不出来直接报错，不让断言空转。 */
function countFrom(text: string, pattern: RegExp): number {
  const m = text.match(pattern);
  if (!m) throw new Error(`文案里没找到能力数（${pattern}）：${text.slice(0, 100)}`);
  return Number(m[1]);
}

describe("AI 能力清单 ↔ 真实路由", () => {
  it("路由表采集本身可用（避免形状变化导致断言空转）", () => {
    const registered = collectRegisteredPaths(app);
    expect(registered.size, "未从 express 栈里采到路由，采集逻辑需随版本调整").toBeGreaterThan(50);
    expect(registered.has("POST /api/v1/ai/chat")).toBe(true);
  });

  it("清单里每条能力都真的注册了（文档能力不得 404）", () => {
    const registered = collectRegisteredPaths(app);
    for (const cap of AI_CAPABILITIES) {
      expect(registered.has(`${cap.method} ${cap.path}`), `${cap.method} ${cap.path} 未注册却写在清单里`).toBe(true);
    }
  });

  it("真实注册的 AI 接口都在清单里（新增接口必须先登记）", () => {
    const registered = collectRegisteredPaths(app);
    const known = new Set(AI_CAPABILITIES.map((c) => `${c.method} ${c.path}`));
    const orphans = [...registered].filter((r) => {
      const path = r.slice(r.indexOf(" ") + 1);
      // 只认 /api/v1/ai/ 前缀：/api/v1/ai-stats 不是 AI 接口族
      return path.startsWith(AI_API_PREFIX) && !known.has(r);
    });
    expect(orphans, `未登记的 AI 接口：${orphans.join(", ")}`).toEqual([]);
  });

  it("已下线的 legacy 与无人调用的 stream 双胞胎确实不再注册", () => {
    const registered = collectRegisteredPaths(app);
    for (const gone of [
      "POST /api/ai/chat",
      "POST /api/ai/diagnose",
      "POST /api/ai/vision",
      "POST /api/v1/ai/vision",
      "POST /api/v1/ai/health-forecast/stream",
      "POST /api/v1/ai/root-cause-analysis/stream",
      "POST /api/v1/ai/equipment-summary/stream",
      "POST /api/v1/ai/safety-risk-assessment/stream",
      "POST /api/v1/ai/generate-maintenance-plan/stream",
      "POST /api/v1/ai/generate-smart-report/stream",
    ]) {
      expect(registered.has(gone), `${gone} 应已下线`).toBe(false);
    }
    // 唯一有真实调用方的流式接口必须还在
    expect(registered.has("POST /api/v1/ai/chat/stream")).toBe(true);
  });
});

describe("AI 能力数单一来源", () => {
  it("占位接口不混进能力数，且每条占位都写明了原因", () => {
    const stubs = capabilitiesOf("stub");
    expect(stubs.length).toBe(AI_STUB_ENDPOINT_COUNT);
    for (const s of stubs) {
      expect(s.note, `${s.id} 缺 note：占位接口必须说明为什么不宣传`).toBeTruthy();
    }
    // core 与 stub 不允许有同路径
    const corePaths = new Set(capabilitiesOf("core").map((c) => c.path));
    for (const s of stubs) expect(corePaths.has(s.path)).toBe(false);
  });

  it("package.json 文案里的能力数 = 清单 core 条数", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(countFrom(String(pkg.description), /(\d+)\s*项\s*AI/)).toBe(AI_CORE_CAPABILITY_COUNT);
    expect(String(pkg.description)).not.toMatch(/预判|预测/);
  });

  it("openapi 文案里的能力数 = 清单 core 条数，且每条对外能力都有文档", () => {
    const spec = buildOpenApiSpec();
    expect(countFrom(String(spec.info.description), /(\d+)\s*项能力/)).toBe(AI_CORE_CAPABILITY_COUNT);

    const paths = spec.paths as Record<string, any>;
    for (const cap of [...capabilitiesOf("core"), ...capabilitiesOf("transport"), ...capabilitiesOf("stub")]) {
      expect(paths[cap.path], `${cap.path} 未写进 openapi`).toBeDefined();
      expect(String(paths[cap.path]?.[cap.method.toLowerCase()]?.summary || "").length, `${cap.path} summary 为空`).toBeGreaterThan(0);
    }
  });

  it("清单没有重复登记，能力数为 18（改动时同步对外口径）", () => {
    const ids = AI_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const paths = AI_CAPABILITIES.map((c) => `${c.method} ${c.path}`);
    expect(new Set(paths).size).toBe(paths.length);
    expect(AI_CORE_CAPABILITY_COUNT).toBe(18);
  });
});
