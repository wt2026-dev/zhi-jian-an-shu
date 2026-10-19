/**
 * 旧 API 前缀 /api/* 下线守卫（2026-10-19 清理后的回归锁）。
 *
 * 背景：清理前 206 条路由里有 191 条以 /api/* 与 /api/v1/* 成对注册 —— 同一组 handler
 * 挂两个前缀，前端只用 v1，旧前缀却一直暴露着，攻击面与维护成本双份。
 * 2026-10-19 已把 35 条旧前缀路由全部删除，并在 server/index.ts 加了一道
 * "非 /api/v1 的 /api/* 一律 404" 的拦截。
 *
 * 本文件锁两件事：
 *   1. **静态**：src/server/routes 下不得再出现 `app.xxx("/api/...")`（不含 v1）的注册。
 *      这条比运行时断言更早发现问题 —— 新加一行旧路由，这里就红，不用等有人调到。
 *   2. **运行时**：代表性旧路径真的返回 404 + LEGACY_API_PREFIX_REMOVED，且响应里给出的
 *      successor 指向 /api/v1（让调用方知道该改到哪个地址）。
 *
 * 为什么不用「not.toContain」式断言：那种写法在目标元素本来就不含该文本时零信息
 * （见项目记忆里的教训）。这里断言的是**具体判定值** code === "LEGACY_API_PREFIX_REMOVED"。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let app: any;
let adminToken: string;

beforeAll(async () => {
  app = await createApp();
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "Admin@2026#Demo" });
  adminToken = login.body.token;
  expect(adminToken, "admin 登录取不到 token，后续断言会全部失真").toBeTruthy();
}, 60000);

describe("旧前缀 /api/* 已下线", () => {
  it("静态：routes/ 下不存在非 v1 的 /api/ 路由注册", () => {
    const dir = path.join(ROOT, "src/server/routes");
    const offenders: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const lines = fs.readFileSync(path.join(dir, name), "utf8").split("\n");
      lines.forEach((ln, i) => {
        // 只认真正的路由注册行；注释里提到 /api/ 不算
        const code = ln.replace(/^\s*\/\/.*$/, "");
        if (/app\.(get|post|put|patch|delete|all)\(\s*["']\/api\/(?!v1\/)/.test(code)) {
          offenders.push(`${name}:${i + 1}  ${ln.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `发现旧前缀路由注册（应改用 /api/v1）：\n${offenders.join("\n")}\n` +
        `如果确实需要兼容，走 /api/v1 加别名，不要复活 /api/* 顶层前缀。`
    ).toEqual([]);
  });

  it("运行时：代表性旧路径返回 404 且带 LEGACY_API_PREFIX_REMOVED", async () => {
    const legacyPaths: [string, string][] = [
      ["get", "/api/work-orders"],
      ["get", "/api/equipments"],
      ["get", "/api/notifications"],
      ["get", "/api/health"],
      ["post", "/api/debug-log"],
    ];
    for (const [method, p] of legacyPaths) {
      const res = await (request(app) as any)[method](p).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status, `${method.toUpperCase()} ${p} 应已下线`).toBe(404);
      expect(res.body?.code, `${p} 应返回可诊断的 code 而不是裸 404`).toBe("LEGACY_API_PREFIX_REMOVED");
    }
  });

  it("运行时：successor 指向对应的 /api/v1 地址", async () => {
    const res = await request(app)
      .get("/api/work-orders")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.successor).toBe("/api/v1/work-orders");
  });

  it("运行时：/api/v1 前缀不受影响（对照组）", async () => {
    const res = await request(app)
      .get("/api/v1/work-orders")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("运行时：/api-docs 等非 v1 资源不误伤", async () => {
    // /api-docs 以 /api- 开头但没有斜杠，不应被 /api/ 规则吞掉
    const res = await request(app).get("/api-docs.json");
    expect(res.status).toBe(200);
  });
});
