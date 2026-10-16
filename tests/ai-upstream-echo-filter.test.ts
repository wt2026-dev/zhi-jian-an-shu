import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { looksLikeUpstreamEcho, UPSTREAM_ECHO_NOTICE } from "../src/server/services/aiClient.ts";

// 正文级异常检测：上游（Agnes 网关）抖动时会把它自身的错误话术当作 assistant 正文返回，
// 实测 content = "注：Agnes 接口异常，请稍后重试。"。这类文本不能当答案展示，也不能进专家纠错队列。
// 阈值判定必须双向断言：既要把回声判出来，也要放过正常回答里顺带提到"重试/余额"的内容。

describe("正文级异常检测 looksLikeUpstreamEcho", () => {
  it("命中：上游把网关错误当正文（含实测原句与中英变体）", () => {
    expect(looksLikeUpstreamEcho("注：Agnes 接口异常，请稍后重试。")).toBe(true);
    expect(looksLikeUpstreamEcho("**服务暂时不可用**，请稍后重试")).toBe(true);
    expect(looksLikeUpstreamEcho("Error 429: Too Many Requests, rate limit exceeded")).toBe(true);
    expect(looksLikeUpstreamEcho("额度已用尽")).toBe(true);
  });

  it("不命中：正常回答（哪怕顺带提到重试、余额、余额不足的处理建议）", () => {
    const legitShort = "轴承游隙超差，建议更换并复对中。";
    expect(looksLikeUpstreamEcho(legitShort)).toBe(false);
    const mentionsRetry =
      "该离心泵机封渗漏的根因多为静环密封圈老化与介质含颗粒。处理步骤：①停机并执行 LOTO 挂牌上锁；②拆护罩更换机封套件；③复核对中偏差≤0.05mm；④试机后回读振动值。若现场仪器读数异常，请稍后重试测量并记录环境温升与轴承座温度，同时核对润滑油牌号与油位，避免把油品问题误判为机封失效。";
    expect(looksLikeUpstreamEcho(mentionsRetry)).toBe(false);
  });

  it("不命中：含 JSON 结构的输出交给 extractAiJson 判定，不由本函数拦截", () => {
    expect(looksLikeUpstreamEcho('{"defectType":"接口异常","summary":"请稍后重试"}')).toBe(false);
  });

  it("不命中：空文本与全符号文本", () => {
    expect(looksLikeUpstreamEcho("")).toBe(false);
    expect(looksLikeUpstreamEcho(undefined)).toBe(false);
    expect(looksLikeUpstreamEcho("  \n\t ")).toBe(false);
  });

  it("边界：长度阈值 120 字双向卡住（同话术，加一句即不误判）", () => {
    const echo = "接口异常，请稍后重试。";
    expect(looksLikeUpstreamEcho(echo)).toBe(true);
    const longAnswer =
      "离心泵振动超标应先排除基础松动与联轴器对中偏差，再按频谱判断是否为轴承保持架或滚道故障；" +
      "现场须用测振仪与红外测温枪复测，记录工况负荷与介质温度；如需拆检，严格执行 GB 30871 与 LOTO 上锁挂牌。" +
      "以上为排查优先级建议，处理后连续两班回读振动与温升方可复位，并把读数归档到设备台账。";
    expect(longAnswer.length).toBeGreaterThan(120);
    expect(looksLikeUpstreamEcho(longAnswer)).toBe(false);
  });
});

// ---------- SSE 链路：命中回声后必须发 error 事件、不得记成功 ----------
const ECHO_TEXT = "注：Agnes 接口异常，请稍后重试。";
const LEGIT_TEXT =
  "【安全警示】拆检前必须执行 LOTO 上锁挂牌并确认能量隔离。离心泵端盖渗漏的排查优先级：①查静环密封圈是否老化；②查机封冲洗方案与冲洗压力；③复核对中偏差；④取样化验油品。所需工具为力矩扳手、百分表与油品检测套盒，处理后连续两班回读振动与温度方可复位。";

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

let streamPayload: string = ECHO_TEXT;
let app: any;
let token: string;

vi.mock("../src/server/services/aiClient.ts", async (importActual) => {
  const mod: any = await importActual();
  return {
    ...mod,
    getAiClient: () => ({
      chat: { completions: { create: async () => makeStream(streamPayload) } },
    }),
  };
});

describe("AI 流式对话的正文级异常拦截", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    app = (await import("../server.ts")).createApp;
    app = await app();
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "Admin@2026#Demo" });
    token = loginRes.body.token;
  });

  async function runStream(message: string) {
    const res = await request(app)
      .post("/api/v1/ai/chat/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ message, history: [] });
    expect(res.status).toBe(200);
    const events = String(res.text || "")
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter((p) => p && p !== "[DONE]")
      .map((p) => {
        try {
          return JSON.parse(p);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return events;
  }

  it("回声正文：补发 error + degraded 事件，且没有伪装成正常完成的 content 尾巴", async () => {
    streamPayload = ECHO_TEXT;
    const events = await runStream("机封渗漏怎么处理");
    const errEvent = events.find((e: any) => e.error);
    expect(errEvent).toBeTruthy();
    expect(errEvent!.degraded).toBe(true);
    expect(errEvent!.error).toBe(UPSTREAM_ECHO_NOTICE);
    // 前端两个消费方收到 error 都会整条覆盖气泡，所以被拦截的抖动文本不应再出现在最终展示语义里
    expect(errEvent!.error).not.toContain("Agnes 接口异常");
  });

  it("正常长回答：原样流式返回 content，不发 error 事件", async () => {
    streamPayload = LEGIT_TEXT;
    const events = await runStream("机封渗漏怎么处理");
    expect(events.some((e: any) => e.error)).toBe(false);
    const assembled = events
      .filter((e: any) => e.content)
      .map((e: any) => e.content)
      .join("");
    expect(assembled).toBe(LEGIT_TEXT);
  });
});
