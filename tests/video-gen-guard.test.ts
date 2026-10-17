import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { validateDownloadUrl, runFullVideoGeneration, buildFullSegmentPrompt, __runningTasks, cjkRatio, buildStepSubtitleLines, buildStepNarrationText, shrinkIfOversize, buildNarrationAudioFilter } from "../src/server/services/videoGenerationService.ts";
import { getAgnesMaxConcurrent, getAgnesTotalTimeoutMin, getAgnesSegmentWindowMin, getAgnesSegmentGapSec, getAgnesArtifactMaxMb } from "../src/server/utils/config.ts";
import { ProcedureVideoRepository, ProcedureRepository } from "../src/db/repositories/index.ts";
import { estimateRemainingMinutes, formatElapsed, resolveTaskStartMs, MAX_POLL_SECONDS } from "../src/utils/videoProgress.ts";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

let app: any;
let token: string;

/**
 * 等待在途任务计数归零。
 *
 * 为什么需要：`POST /generate-video-full` 是 fire-and-forget（后台跑、接口立刻返回），
 * 用例无法 await 它。而并发上限默认已收紧为 1（实测并发提交会让先提交的被饿死），
 * 所以上一个用例留下的在途任务会直接让下一个用例被判"已达并发上限"而失败。
 * 这类失败是测试互相干扰，不是被测逻辑的问题 —— 必须在用例之间显式等干净。
 */
async function waitForNoRunningTask(timeoutMs = 20000) {
  const t0 = Date.now();
  while (__runningTasks.count > 0 && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "Admin@2026#Demo" });
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

  // ==================== 任务 6：完整检修视频按步骤规范化生成 ====================
  describe("6. 完整检修视频按步骤规范化生成测试", () => {
    const proc5Steps = {
      id: "proc-feedpump-test",
      title: "离心式高压给水泵一级维保",
      equipmentType: "给水泵",
      maintenanceLevel: "一级维保",
      steps: [
        { step_no: 1, name: "泵组运行参数记录与渗漏跑冒滴漏排查", content: "巡检参数记录与外观检查" },
        { step_no: 2, name: "机械密封自冲洗管路与旋流过滤器清污", content: "冲洗管路拆卸清洗" },
        { step_no: 3, name: "轴承箱润滑油取样与油质理化分析", content: "润滑油取样化验" },
        { step_no: 4, name: "联轴器对中同轴度激光复核与垫片微调", content: "激光对中调整" },
        { step_no: 5, name: "试运转与温升振动验收", content: "负荷试运转与验收" },
      ],
    };

    beforeAll(async () => {
      const existing = await ProcedureRepository.getById(proc5Steps.id);
      if (!existing) {
        await ProcedureRepository.create(proc5Steps);
      }
    });

    it("6.1 接口分组：5步规程严格一步一段，返回 segmentCount=5, estimatedSeconds=90", async () => {
      const origEnabled = process.env.AGNES_ENABLED;
      const origKey = process.env.AGNES_API_KEY;
      process.env.AGNES_ENABLED = "true";
      process.env.AGNES_API_KEY = "mock-key";

      // 本用例只关心接口返回的分组结果，后台那条任务怎么失败都无所谓 ——
      // 但必须让它**快速失败并释放并发计数**，否则会拖累后面的用例（见 waitForNoRunningTask）。
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ message: "mock: 本用例不真正提交" }), { status: 500 })) as any;
      try {
        const res = await request(app)
          .post(`/api/v1/procedures/${proc5Steps.id}/generate-video-full`)
          .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.segmentCount).toBe(5);
        expect(res.body.estimatedSeconds).toBe(90);
        expect(res.body.message).toContain("共 5 段");

        await waitForNoRunningTask();
      } finally {
        globalThis.fetch = originalFetch;
        process.env.AGNES_ENABLED = origEnabled || "";
        process.env.AGNES_API_KEY = origKey || "";
      }
    });

    it("6.2 段 Prompt：连续单镜头 + 严禁画面文字 + 严禁模型生成人声（配音由 edge-tts 后期混入）", async () => {
      const step2 = [proc5Steps.steps[1]];
      const prompt = await buildFullSegmentPrompt(proc5Steps, step2);
      const lower = prompt.toLowerCase();

      // 1. 不再要求画面写字：实测 Agnes 渲染中文只会得到乱码（字形不可读）且只显示数秒，
      //    因此 prompt 里不得再出现标题文字要求，且要显式禁止任何画面文字；标题改由 FFmpeg 后期烧录。
      expect(prompt).not.toContain("第2步：机械密封自冲洗管路与旋流过滤器清污");
      expect(lower).not.toContain("chinese title text");
      expect(lower).toContain("no text");

      // 2. 隔离性：严禁混入其他步骤或连接词
      expect(prompt).not.toContain("Then Step");
      expect(prompt).not.toContain("Then 第");

      // 3. 严禁模型生成人声。旧实现要求 Agnes 念 "第N步，<步骤名>。"，它**真的照做了** ——
      //    于是成片里有两条中文男声（模型 + edge-tts）内容相近、时间错位，听感"糊、重影"。
      //    配音只能有一个来源：模型只出机械环境音，人声一律 edge-tts 后期混入。
      expect(prompt).not.toContain("第2步，机械密封自冲洗管路与旋流过滤器清污。");
      expect(lower).not.toContain("male voiceover");
      expect(lower).not.toContain("voiceover narrating");
      expect(lower).not.toContain("narrating");
      // 负面要求必须显式写全（只说 "ambient sounds" 模型会自行脑补旁白）
      expect(lower).toContain("no voiceover");
      expect(lower).toContain("no narration");
      expect(lower).toContain("no human voice");
    });

    it("6.3 失败场景：第2步生成失败时，任务立即置 failed 且注明'失败于第2步'", async () => {
      const origEnabled = process.env.AGNES_ENABLED;
      process.env.AGNES_ENABLED = "true";

      // 并发上限为 1，先把前面用例可能残留的在途任务等干净，否则这里会先撞并发上限
      await waitForNoRunningTask();

      const taskId = `fail-test-${Date.now()}`;
      await ProcedureVideoRepository.create({
        procedureId: proc5Steps.id,
        taskId,
        status: "processing",
        prompt: "测试任务",
      });

      const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/videos") && init?.method === "POST") {
          const bodyStr = typeof init.body === "string" ? init.body : "";
          // 第1步成功
          if (bodyStr.includes("泵组运行参数记录") || bodyStr.includes("第1步")) {
            return new Response(JSON.stringify({ video_id: "mock-task-step1" }), { status: 200 });
          }
          // 第2步模拟失败
          if (bodyStr.includes("机械密封自冲洗管路") || bodyStr.includes("第2步")) {
            return new Response(JSON.stringify({ message: "Network connection refused" }), { status: 500 });
          }
          return new Response(JSON.stringify({ video_id: "mock-task-default" }), { status: 200 });
        }

        if (urlStr.includes("/agnesapi")) {
          return new Response(JSON.stringify({ status: "completed", video_url: "https://cdn.agnes-ai.cn/videos/mock1.mp4" }), { status: 200 });
        }

        if (urlStr.includes("cdn.agnes-ai.cn")) {
          return new Response(new ArrayBuffer(512), { status: 200 });
        }

        return new Response("Not found", { status: 404 });
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      try {
        const groups = proc5Steps.steps.map((s) => [s]);
        // 产物目录必须走系统临时目录：原先写死 "d:/实验/实验项目2/uploads/full-videos"，
        // 会让每次跑测试都在仓库根目录留下一个 uploads/full-videos（实测已攒 20 个 mp4）。
        // 用 tmp 还有个好处：路径严格在 os.tmpdir() 之下时沙箱批量删除守卫直接放行，清理无需确认。
        await runFullVideoGeneration(proc5Steps, taskId, groups, path.join(os.tmpdir(), "wb-tests-full-videos"));

        // 查询数据库记录，验证错误标记
        const records = await ProcedureVideoRepository.getByProcedureId(proc5Steps.id);
        const record = records.find((r: any) => r.taskId === taskId);
        expect(record).toBeDefined();
        expect(record?.status).toBe("failed");
        expect(record?.error).toContain("失败于第2步 机械密封自冲洗管路与旋流过滤器清污");
      } finally {
        globalThis.fetch = originalFetch;
        process.env.AGNES_ENABLED = origEnabled || "";
      }
    }, 60000);
  });

  // ==================== Prompt 语言护栏 ====================
  // 实测依据（同一账号、同一时刻、同一 payload：441 帧 / 1088x832 / 24fps / agnes-video-v2.0）：
  //   英文 prompt（仅标题与解说词为中文）→ 262 秒完成；
  //   全中文 prompt（大模型直出）→ 13.6 分钟仍停在 internal_status=inference，最终耗尽 20 分钟轮询窗口。
  // 因此必须在提交给 Agnes 之前拦住中文占比过高的 prompt。
  describe("Prompt 语言护栏 (Agnes 对全中文 prompt 会卡在推理)", () => {
    it("英文备用模板（实测中文占比约 26.6%）判定为可用", () => {
      const tpl = `In a clean modern high-tech industrial workshop, a certified technician performs maintenance for 水泵: Step 1: 泵组运行参数记录与渗漏跑冒滴漏排查. Smooth steady continuous cinematic tracking shot, realistic industrial lighting, 4K texture. The video must display prominent red Chinese title text "第1步：泵组运行参数记录与渗漏跑冒滴漏排查" at the top center with bold white outline.`;
      expect(cjkRatio(tpl)).toBeLessThanOrEqual(0.45);
    });

    it("全中文 prompt（实测会卡住）判定为不可用", () => {
      const cn =
        "单镜头连续跟拍，画面顶部中央显示红色背景白色文字标题“第1步：泵组运行参数记录与渗漏跑冒滴漏排查”。镜头平稳移动，展示维修人员手持记录本和红外测温仪，依次读取水泵进出口压力表、流量计数值并记录。";
      expect(cjkRatio(cn)).toBeGreaterThan(0.45);
    });

    it("空串与纯英文不抛异常", () => {
      expect(cjkRatio("")).toBe(0);
      expect(cjkRatio("pure english prompt only")).toBe(0);
    });
  });

  // ==================== 混音：Agnes 原音轨必须被丢弃 ====================
  // 背景：prompt 要了中文旁白，模型真的生成了，于是成片里有两条中文男声
  // （模型 + edge-tts）内容相近、时间错位，听感"糊、重影"。
  // 配音只能有一个来源 ⇒ 混音时 Agnes 音轨整体丢弃。
  describe("混音底噪：Agnes 原音轨必须被丢弃（否则与 TTS 口播叠成双人声）", () => {
    const parts = [
      { atempo: null, delayMs: 0 },
      { atempo: 1.25, delayMs: 3600 },
    ];

    it("底噪是静音 anullsrc，且完全不引用 Agnes 音轨 [0:a]", () => {
      const f = buildNarrationAudioFilter(parts, 18.375, "-16");
      expect(f).toContain("anullsrc=");
      // 这一条是本次修复的核心断言：只要出现 [0:a]，Agnes 的人声就会重新混进来
      expect(f).not.toContain("[0:a]");
      expect(f).not.toContain("volume=");
      // 时长取实测视频时长 ⇒ amix 的 duration=first 与画面等长
      expect(f).toContain("duration=18.375");
    });

    it("人声轨数量与顺序不变（静音底 + 每句一路），首尾标签正确", () => {
      const f = buildNarrationAudioFilter(parts, 18.375, "-16");
      expect(f).toContain("amix=inputs=3");
      expect(f).toContain("duration=first");
      expect(f).toContain("normalize=0");
      expect(f).toContain("[amb]");
      expect(f).toContain("[1:a]");
      expect(f).toContain("[2:a]");
      expect(f.endsWith("amix=inputs=3:duration=first:normalize=0[aout]")).toBe(true);
    });

    it("语音参数保持原样（本次任务不改 loudnorm / atempo / 延迟）", () => {
      const f = buildNarrationAudioFilter(parts, 18.375, "-16");
      expect(f).toContain("loudnorm=I=-16:TP=-1.5:LRA=11");
      expect(f).toContain("atempo=1.2500");
      expect(f).toContain("adelay=3600|3600[v2]");
      // 没有 atempo 的那句不应凭空多出 atempo=
      expect(f).toContain("[1:a]loudnorm=");
    });

    it("句数为 1 时仍然成立（amix=inputs=2）", () => {
      const f = buildNarrationAudioFilter([{ atempo: null, delayMs: 0 }], 10, "-16");
      expect(f).toContain("amix=inputs=2");
      expect(f).not.toContain("[0:a]");
    });
  });

  // ==================== 底部字幕（口播稿） ====================
  describe("底部中文字幕行生成", () => {
    const step = {
      step_no: 2,
      name: "机械密封自冲洗管路与旋流过滤器清污",
      content: "拆卸机封Plan 11冲洗液循环引出管；清洗在线旋流分离过滤器滤芯内部沉积铁锈结垢；检查冲洗管路节流孔板无异物堵塞。",
      safety: "清洗前必须关闭冲洗管路一次根部截止阀并缓慢松开螺母泄压。",
      acceptance: "冲洗管道内壁清洁通畅无水垢附着；旋流分离器各接口螺纹完好。",
    };

    it("字幕不得重复顶部标题（'第N步，<步骤名>。'改由口播开场白承载）", () => {
      const lines = buildStepSubtitleLines(step);
      // 标题是整段常驻的"第N步：<步骤名>"，字幕若再写一遍，每段开头会上下出现同一句话
      expect(lines.some((l) => l.includes("第2步，机械密封自冲洗管路与旋流过滤器清污"))).toBe(false);
      // 该句仍要由口播念出来，念它时标题正在画面上，听到的与看到的对得上
      expect(buildStepNarrationText(step).startsWith("第2步，机械密封自冲洗管路与旋流过滤器清污。")).toBe(true);
    });

    it("行数不超过 5 行（每段约 18 秒，行数再多会来不及看）", () => {
      const lines = buildStepSubtitleLines(step);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.length).toBeLessThanOrEqual(5);
    });

    it("每行长度受控，不出现超长行（1088 宽下 28 字以内可读）", () => {
      for (const l of buildStepSubtitleLines(step)) expect(l.length).toBeLessThanOrEqual(30);
    });

    it("含安全与验收要点行", () => {
      const lines = buildStepSubtitleLines(step);
      expect(lines.some((l) => l.startsWith("安全："))).toBe(true);
      expect(lines.some((l) => l.startsWith("验收："))).toBe(true);
    });

    it("字段缺失时不抛异常；只有步骤名时字幕为空（该句由标题承载，不重复）", () => {
      expect(() => buildStepSubtitleLines({ step_no: 1, name: "仅名称" })).not.toThrow();
      expect(buildStepSubtitleLines({ step_no: 1, name: "仅名称" })).toEqual([]);
      // 空数组必须被 burnStepTitles 安全跳过 —— 那里有 `!lines.length` 守卫，
      // 否则 seg/lines.length 会算出 NaN 并把整条 drawtext 滤镜链打坏。
      expect(buildStepNarrationText({ step_no: 1, name: "仅名称" })).toBe("第1步，仅名称。");
    });
  });

  // 配音要念的就是字幕上写的内容：两者不同源就会出现"听到的"和"看到的"对不上
  describe("口播稿生成（配音读的就是字幕）", () => {
    const step = {
      step_no: 3,
      name: "泵轴轴向窜动间隙与对中状态静态预检",
      content: "将磁力表座吸附在泵壳上，表针顶在轴头端面上；使用撬棒轴向前后撬动轴系；读取百分表最大与最小差值。",
      safety: "撬动轴系必须在轴颈非受力过渡区衬垫铜皮。",
      acceptance: "轴向总窜动量处于0.08-0.15mm 范围内。",
    };

    it("由字幕行拼成一句连续口播稿", () => {
      const text = buildStepNarrationText(step);
      expect(text).toContain("第3步，泵轴轴向窜动间隙与对中状态静态预检。");
      expect(text).toContain("安全：");
      expect(text).toContain("验收：");
    });

    it("去掉行尾顿号/分号/逗号，避免念出来一顿一顿的", () => {
      const text = buildStepNarrationText(step);
      // 行尾标点已并入下一句，句中不应残留"；"或"，"紧跟下一行首
      expect(text).not.toMatch(/[；;]$/);
      expect(text).not.toContain("；使用撬棒");
    });

    it("去掉截断省略号（'…' 念不出来）", () => {
      const long = { step_no: 1, name: "很长的步骤名".repeat(4), content: "内容".repeat(60) };
      expect(buildStepNarrationText(long)).not.toContain("…");
    });

    it("以句号收尾", () => {
      expect(buildStepNarrationText(step).endsWith("。")).toBe(true);
    });

    it("字段缺失时不抛异常", () => {
      expect(() => buildStepNarrationText({ step_no: 1, name: "仅名称" })).not.toThrow();
      expect(buildStepNarrationText({ step_no: 1, name: "仅名称" })).toBe("第1步，仅名称。");
    });
  });

  // ==================== 任务 7：进度口径（"已耗时 / 剩余时间"不得误导） ====================
  // 实测事故：任务已跑 36 分钟，界面显示"已耗时 0秒 / 预计剩余约 29 分钟"，用户以为卡死了。
  // 成因有二：① 已耗时用"本轮轮询开始时刻"当起点，刷新页面即归零；
  //          ② 剩余时间按"每段 4 分钟"折算，把最坏 3.4 小时的任务说成 29 分钟。
  describe("7. 进度口径：已耗时与剩余时间", () => {
    it("7.1 剩余时间只给区间：5 段任务在第 1 段时，上限必须覆盖单段跑满轮询窗口的情形", () => {
      const { fast, slow } = estimateRemainingMinutes(1, 5);
      // 旧口径（每段 6 分钟 + 65s）给出 29 分钟，远低于真实的 3 小时级最坏值
      expect(slow).toBeGreaterThanOrEqual(200);
      expect(fast).toBeLessThanOrEqual(25);
      expect(fast).toBeLessThan(slow);
    });

    it("7.2 最后一段时区间收敛：只剩当前段，最坏即单段轮询窗口", () => {
      const { fast, slow } = estimateRemainingMinutes(5, 5);
      expect(fast).toBe(0);
      expect(slow).toBe(40);
    });

    it("7.3 越靠后剩余越少（单调不增）", () => {
      const first = estimateRemainingMinutes(1, 5);
      const third = estimateRemainingMinutes(3, 5);
      expect(third.slow).toBeLessThan(first.slow);
      expect(third.fast).toBeLessThan(first.fast);
    });

    it("7.4 段序号越界不产生负数", () => {
      expect(estimateRemainingMinutes(7, 5)).toEqual({ fast: 0, slow: 40 });
    });

    it("7.5 已耗时格式化：不足 1 分钟只报秒，超过则报分秒", () => {
      expect(formatElapsed(0)).toBe("0秒");
      expect(formatElapsed(45_000)).toBe("45秒");
      expect(formatElapsed(36 * 60_000 + 12_000)).toBe("36分12秒");
      // 负数（时钟回拨）不得输出 "-1分"
      expect(formatElapsed(-5_000)).toBe("0秒");
    });

    it("7.6 已耗时起点优先取任务入库时间；非法值/未来时间退回兜底值", () => {
      const fallback = Date.now();
      const real = new Date(Date.now() - 36 * 60_000).toISOString();
      expect(resolveTaskStartMs(real, fallback)).toBeLessThan(fallback);

      expect(resolveTaskStartMs(undefined, fallback)).toBe(fallback);
      expect(resolveTaskStartMs("不是时间", fallback)).toBe(fallback);
      // 未来时间（时钟漂移）不能用，否则已耗时会是负数
      expect(resolveTaskStartMs(new Date(Date.now() + 60_000).toISOString(), fallback)).toBe(fallback);
    });

    it("7.7 前端放弃轮询的上限与后端全局超时（240 分钟）一致，不再 60 分钟就放弃", () => {
      expect(MAX_POLL_SECONDS).toBe(240 * 60);
    });
  });

  // ==================== 任务 8：video-status 必须回传任务入库时间 ====================
  // 前端算"真实已耗时"要用它。不回传的话前端只能拿"本轮轮询开始时刻"兜底，
  // 一刷新页面耗时就被清零（即上述 36 分钟显示成 0秒 的直接原因）。
  describe("8. video-status 回传 createdAt", () => {
    const proc = {
      id: "proc-status-createdat",
      title: "进度口径测试规程",
      equipmentType: "给水泵",
      maintenanceLevel: "一级维保",
      steps: [{ step_no: 1, name: "步骤1", content: "操作1" }],
    };

    beforeAll(async () => {
      const existing = await ProcedureRepository.getById(proc.id);
      if (!existing) await ProcedureRepository.create(proc);
    });

    it("8.1 full- 任务（进度存在本地库、不查远端）返回 createdAt", async () => {
      const taskId = `full-${Date.now()}`;
      await ProcedureVideoRepository.create({
        procedureId: proc.id,
        taskId,
        status: "processing",
        error: "正在生成第 1/5 段：步骤1（剩余约 20 分钟）",
      });

      const res = await request(app)
        .get(`/api/v1/procedures/video-status?taskId=${taskId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.fullMode).toBe(true);
      expect(typeof res.body.createdAt).toBe("string");
      expect(Number.isFinite(new Date(res.body.createdAt).getTime())).toBe(true);
      expect(Date.now() - new Date(res.body.createdAt).getTime()).toBeLessThan(60_000);
    });

    it("8.2 已 failed 的单段任务同样返回 createdAt", async () => {
      const taskId = `single-${Date.now()}`;
      await ProcedureVideoRepository.create({
        procedureId: proc.id,
        taskId,
        status: "failed",
        error: "视频生成超时（40 分钟）",
      });

      const res = await request(app)
        .get(`/api/v1/procedures/video-status?taskId=${taskId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("failed");
      expect(typeof res.body.createdAt).toBe("string");
    });
  });

  // ==================== 任务 9：队列与产物体积护栏 ====================
  // 事故背景（2026-09-17）：
  //  ① 两条任务并发时，后提交的约 4 分钟跑完、**先提交的卡满 40 分钟窗口**；
  //     远端查询证实被卡的 `perf_infer_s=0`（推理一秒没跑）→ 并发上限必须为 1。
  //  ② 全局超时写死 240 分钟，对 8 段规程只有 29 分钟/段，**比单段窗口 40 分钟还短** → 必然失败。
  //  ③ 工作区静默删除 ≥10MiB 的 mp4，成片天然 30~40 MiB → 做完即消失。
  describe("9. 队列与产物体积护栏", () => {
    it("9.1 并发上限默认 1（严格串行）—— 并发提交只会让先提交的被饿死", () => {
      const orig = process.env.AGNES_MAX_CONCURRENT;
      delete process.env.AGNES_MAX_CONCURRENT;
      expect(getAgnesMaxConcurrent()).toBe(1);
      if (orig === undefined) delete process.env.AGNES_MAX_CONCURRENT;
      else process.env.AGNES_MAX_CONCURRENT = orig;
    });

    it("9.2 全局超时按段数自适应：5 段用下限 240，8 段自动放宽", () => {
      const five = getAgnesTotalTimeoutMin(5);
      const eight = getAgnesTotalTimeoutMin(8);
      // 5 段 × 40 分钟 + 4 × 65 秒 ≈ 205 分钟 < 240，取下限
      expect(five).toBe(240);
      // 8 段 × 40 分钟 + 7 × 65 秒 ≈ 328 分钟 > 240，必须放宽
      expect(eight).toBeGreaterThanOrEqual(328);
      // 不传段数时退回配置下限，保持向后兼容
      expect(getAgnesTotalTimeoutMin()).toBe(240);
    });

    it("9.3 全局超时永远覆盖得下单段窗口总和（自洽性，8 段不再自相矛盾）", () => {
      const win = getAgnesSegmentWindowMin();
      const gap = getAgnesSegmentGapSec();
      for (const n of [1, 4, 5, 7, 8, 12]) {
        const budget = getAgnesTotalTimeoutMin(n) * 60;
        const needed = n * win * 60 + (n - 1) * gap;
        expect(budget).toBeGreaterThanOrEqual(needed);
      }
    });

    it("9.4 单段窗口与段间等待可通过环境变量覆盖", () => {
      const ow = process.env.AGNES_SEGMENT_WINDOW_MIN;
      const og = process.env.AGNES_SEGMENT_GAP_SEC;
      process.env.AGNES_SEGMENT_WINDOW_MIN = "25";
      process.env.AGNES_SEGMENT_GAP_SEC = "30";
      expect(getAgnesSegmentWindowMin()).toBe(25);
      expect(getAgnesSegmentGapSec()).toBe(30);
      // 窗口改小后，8 段预算随之下降，但依然自洽
      const budget = getAgnesTotalTimeoutMin(8) * 60;
      expect(budget).toBeGreaterThanOrEqual(8 * 25 * 60 + 7 * 30);
      if (ow === undefined) delete process.env.AGNES_SEGMENT_WINDOW_MIN; else process.env.AGNES_SEGMENT_WINDOW_MIN = ow;
      if (og === undefined) delete process.env.AGNES_SEGMENT_GAP_SEC; else process.env.AGNES_SEGMENT_GAP_SEC = og;
    });

    it("9.5 体积上限默认 9MiB（留在工作区 10MiB 删除阈值之下）", () => {
      const orig = process.env.AGNES_ARTIFACT_MAX_MB;
      delete process.env.AGNES_ARTIFACT_MAX_MB;
      expect(getAgnesArtifactMaxMb()).toBe(9);
      expect(getAgnesArtifactMaxMb() * 1024 * 1024).toBeLessThan(10 * 1024 * 1024);
      if (orig === undefined) delete process.env.AGNES_ARTIFACT_MAX_MB;
      else process.env.AGNES_ARTIFACT_MAX_MB = orig;
    });

    it("9.6 shrinkIfOversize：未越线的文件原样不动（不白白损失画质）", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnes-shrink-"));
      const small = path.join(dir, "small.mp4");
      await fs.writeFile(small, Buffer.alloc(1024, 7));
      const before = (await fs.stat(small)).size;
      expect(await shrinkIfOversize(small)).toBe(false);
      expect((await fs.stat(small)).size).toBe(before);
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("9.7 shrinkIfOversize：越线视频被压到上限以下（否则会被工作区静默删除）", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnes-shrink-"));
      const big = path.join(dir, "big.mp4");
      const maxBytes = getAgnesArtifactMaxMb() * 1024 * 1024;

      // 造一条无损（crf 0）的合成视频，必然超过上限
      await new Promise<void>((resolve, reject) => {
        execFile(
          "ffmpeg",
          ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24", "-t", "8",
           "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", big],
          { timeout: 60000 },
          (e: any) => (e ? reject(e) : resolve())
        );
      });
      const before = (await fs.stat(big)).size;
      expect(before).toBeGreaterThan(maxBytes);

      expect(await shrinkIfOversize(big)).toBe(true);
      const after = (await fs.stat(big)).size;
      expect(after).toBeLessThan(maxBytes);
      expect(after).toBeGreaterThan(0);
      // 临时文件不能残留
      await expect(fs.stat(`${big}.shrink.mp4`)).rejects.toThrow();

      await fs.rm(dir, { recursive: true, force: true });
    }, 60000);
  });
});
