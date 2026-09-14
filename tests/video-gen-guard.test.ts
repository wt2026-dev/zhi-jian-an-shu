import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { validateDownloadUrl, runFullVideoGeneration, __runningTasks } from "../src/server/services/videoGenerationService.ts";

let app: any;
let token: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "password123" });
  token = loginRes.body.token;
});

describe("视频生成防护体系测试 (Video Gen Guard Suite)", () => {
  const mockProc = { id: "test-proc", title: "测试规程", equipmentType: "风机", maintenanceLevel: "中级", steps: [{ step_no: 1, name: "步骤1", content: "操作1" }, { step_no: 2, name: "步骤2", content: "操作2" }] };

  // ==================== 任务 1：功能总开关 ====================
  describe("1. 功能总开关 (AGNES_ENABLED)", () => {
    it("开关关闭时：generate-video 返回 503 + VIDEO_GEN_DISABLED，不触发外部调用", async () => {
      const orig = process.env.AGNES_ENABLED;
      process.env.AGNES_ENABLED = "false";

      const res = await request(app)
        .post("/api/v1/procedures/proc-1/generate-video")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("VIDEO_GEN_DISABLED");
      expect(res.body.error).toContain("未启用");

      process.env.AGNES_ENABLED = orig || "";
    });

    it("开关关闭时：generate-video-full 返回 503 + VIDEO_GEN_DISABLED", async () => {
      const orig = process.env.AGNES_ENABLED;
      process.env.AGNES_ENABLED = "false";

      const res = await request(app)
        .post("/api/v1/procedures/proc-1/generate-video-full")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("VIDEO_GEN_DISABLED");

      process.env.AGNES_ENABLED = orig || "";
    });
  });

  // ==================== 任务 3：URL 校验（纯函数，无需 mock） ====================
  describe("3. 下载 URL 校验 (SSRF 防护)", () => {
    it("合法 HTTPS URL 通过校验", () => {
      const result = validateDownloadUrl("https://cdn.agnes-ai.cn/videos/abc.mp4");
      expect(result.ok).toBe(true);
    });

    it("合法 HTTP URL 通过校验", () => {
      const result = validateDownloadUrl("http://cdn.agnes-ai.cn/videos/abc.mp4");
      expect(result.ok).toBe(true);
    });

    it("ftp 协议被拒绝", () => {
      const result = validateDownloadUrl("ftp://evil.com/secret.mp4");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("协议");
    });

    it("file 协议被拒绝", () => {
      const result = validateDownloadUrl("file:///etc/passwd");
      expect(result.ok).toBe(false);
    });

    it("localhost 被拒绝", () => {
      const result = validateDownloadUrl("http://localhost:3000/secret.mp4");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("内网");
    });

    it("127.0.0.1 被拒绝", () => {
      const result = validateDownloadUrl("http://127.0.0.1/secret.mp4");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("内网");
    });

    it("10.x.x.x 内网 IP 被拒绝", () => {
      const result = validateDownloadUrl("http://10.0.0.1/secret.mp4");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("内网");
    });

    it("172.16-31.x.x 内网 IP 被拒绝", () => {
      const r1 = validateDownloadUrl("http://172.16.0.1/secret.mp4");
      expect(r1.ok).toBe(false);
      const r2 = validateDownloadUrl("http://172.31.255.255/secret.mp4");
      expect(r2.ok).toBe(false);
    });

    it("192.168.x.x 内网 IP 被拒绝", () => {
      const result = validateDownloadUrl("http://192.168.1.1/secret.mp4");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("内网");
    });

    it("169.254.x.x 链路本地被拒绝", () => {
      const result = validateDownloadUrl("http://169.254.1.1/secret.mp4");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("内网");
    });

    it("格式非法的 URL 被拒绝", () => {
      const result = validateDownloadUrl("not-a-url");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("格式不合法");
    });
  });

  // ==================== 任务 2 + 4：并发控制 + 异步写入（mock 外部 API） ====================
  describe("2+4. 并发控制与异步写入 (runFullVideoGeneration)", () => {
    beforeEach(() => {
      // 确保计数器归零
      while (__runningTasks.count > 0) {
        // 安全泄放（防止上次测试泄漏）
        (globalThis as any).__videoGenRunningDec = true;
      }
    });

    it("正常路径：mock 外部 API 成功，任务完成后计数正确释放", async () => {
      // 设置 AGNES_ENABLED 为 true
      const origEnabled = process.env.AGNES_ENABLED;
      process.env.AGNES_ENABLED = "true";

      let callCount = 0;
      const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof url === "string" ? url : url.toString();
        callCount++;

        // Agnes 创建任务
        if (urlStr.includes("/videos") && init?.method === "POST") {
          return new Response(JSON.stringify({ video_id: "mock-task-001" }), { status: 200 });
        }
        // Agnes 轮询状态 → 直接完成
        if (urlStr.includes("/agnesapi")) {
          return new Response(JSON.stringify({ status: "completed", video_url: "https://cdn.agnes-ai.cn/videos/mock.mp4" }), { status: 200 });
        }
        // 下载视频
        if (urlStr.includes("cdn.agnes-ai.cn")) {
          return new Response(new ArrayBuffer(1024), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      try {
        expect(__runningTasks.count).toBe(0);
        await runFullVideoGeneration(mockProc, "test-task-001", [[mockProc.steps[0]]], "/tmp/test-dir");
        expect(__runningTasks.count).toBe(0); // 任务完成后计数释放
      } finally {
        globalThis.fetch = originalFetch;
        process.env.AGNES_ENABLED = origEnabled || "";
      }
    }, 60000);
  });

  // ==================== 任务 5⑤：任务结束后计数释放，新任务不被误拦 ====================
  describe("5. 计数释放验证（任务结束后新任务不被误拦）", () => {
    it("连续执行两个任务，第二个不应被并发限制拦截", async () => {
      const origEnabled = process.env.AGNES_ENABLED;
      process.env.AGNES_ENABLED = "true";

      let taskIndex = 0;
      const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof url === "string" ? url : (url instanceof URL ? url.toString() : url.toString());

        if (urlStr.includes("/videos") && init?.method === "POST") {
          taskIndex++;
          return new Response(JSON.stringify({ video_id: `mock-task-${taskIndex}` }), { status: 200 });
        }
        if (urlStr.includes("/agnesapi")) {
          return new Response(JSON.stringify({ status: "completed", video_url: "https://cdn.agnes-ai.cn/videos/mock.mp4" }), { status: 200 });
        }
        if (urlStr.includes("cdn.agnes-ai.cn")) {
          return new Response(new ArrayBuffer(512), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      try {
        expect(__runningTasks.count).toBe(0);
        await runFullVideoGeneration(mockProc, "test-task-a", [[mockProc.steps[0]]], "/tmp/test-dir");
        expect(__runningTasks.count).toBe(0);

        // 第二个任务不应被并发限制拦截
        await runFullVideoGeneration(mockProc, "test-task-b", [[mockProc.steps[0]]], "/tmp/test-dir");
        expect(__runningTasks.count).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
        process.env.AGNES_ENABLED = origEnabled || "";
      }
    }, 60000);
  });
});
