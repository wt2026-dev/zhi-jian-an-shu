// G6 日志脱敏测试（2026-10-19 试点加固）
// 目标：logger 输出的结构化 JSON 中，敏感字段（password/token/secret/authorization/apikey 类）
// 的值一律替换为 [REDACTED]，嵌套对象与数组内对象同样覆盖；普通业务字段不受影响。
import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../src/utils/logger.ts";

function captureConsoleOutput(level: "info" | "warn" | "error", fn: () => void): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console as any, level).mockImplementation((...args: any[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("日志敏感字段脱敏 (Log Redaction Suite)", () => {
  it("顶层敏感字段（password/token）值替换为 [REDACTED]", () => {
    const lines = captureConsoleOutput("info", () =>
      logger.info({ action: "login", password: "SuperSecret123", token: "jwt-abc.def" }, "登录请求")
    );
    expect(lines.length).toBe(1);
    const line = lines[0];
    expect(line).toContain("[REDACTED]");
    expect(line).not.toContain("SuperSecret123");
    expect(line).not.toContain("jwt-abc.def");
    // 普通字段保留
    expect(line).toContain("\"action\":\"login\"");
    expect(line).toContain("登录请求");
  });

  it.each(["secret", "authorization", "apiKey", "api_key", "refreshToken", "accessToken"])(
    "敏感键名变体 %s 同样被脱敏",
    (key) => {
      const lines = captureConsoleOutput("info", () =>
        logger.info({ [key]: "leak-me-123" }, "凭证输出")
      );
      expect(lines[0]).not.toContain("leak-me-123");
      expect(lines[0]).toContain("[REDACTED]");
    }
  );

  it("嵌套对象内的敏感字段被递归脱敏", () => {
    const lines = captureConsoleOutput("warn", () =>
      logger.warn(
        { user: { name: "张三", password: "nested-secret", profile: { apiToken: "deep-leak" } } },
        "嵌套脱敏"
      )
    );
    const line = lines[0];
    expect(line).not.toContain("nested-secret");
    expect(line).not.toContain("deep-leak");
    expect(line).toContain("张三");
    expect(line).toContain("[REDACTED]");
  });

  it("数组元素为对象时同样脱敏，普通数组保留", () => {
    const lines = captureConsoleOutput("info", () =>
      logger.info(
        {
          records: [{ username: "op1", password: "arr-leak" }, { username: "op2" }],
          tags: ["a", "b"],
        },
        "数组脱敏"
      )
    );
    const line = lines[0];
    expect(line).not.toContain("arr-leak");
    expect(line).toContain("op1");
    expect(line).toContain("op2");
    expect(line).toContain("\"tags\":[\"a\",\"b\"]");
  });

  it("非敏感业务字段值不受影响（避免误伤）", () => {
    const lines = captureConsoleOutput("error", () =>
      logger.error(
        { equipmentName: "tokenizer-传送带", passwordPolicy: "12位以上", workOrderNo: "WO-2026-TEST" },
        "误伤检查"
      )
    );
    const line = lines[0];
    // passwordPolicy 命中 password 提示 → 值被脱敏（保守策略，宁可误脱敏不可泄露）
    expect(line).toContain("\"passwordPolicy\":\"[REDACTED]\"");
    // 非敏感键的值原样保留
    expect(line).toContain("tokenizer-传送带");
    expect(line).toContain("WO-2026-TEST");
  });
});
