/**
 * 界面不得写死模型供应商名。
 *
 * 2026-10-16 百炼额度耗尽后，真实应答引擎换成了 Agnes；而站内十几处文案仍写着
 * 「通义千问 / 千问大模型」，`AiLiveInsightBanner` 甚至把来源模型硬兜底成
 * 'DashScope qwen-plus' —— 评委对着屏幕问「现在用的是哪个模型」，界面就当场说谎。
 * 引擎真名的唯一来源是 `GET /api/v1/ai/engine`（`useAiEngineLabel` /
 * `useAiEngineShortLabel`），充值回切后无需再改代码。
 *
 * 需要供应商名的地方只有两类：走接口的动态文案，和「可以接入哪些兼容供应商」的
 * 举例清单（见 ALLOWLIST）。其余一律用「AI 诊断引擎」这类中性说法。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 供应商模型名构件：大小写与「通义/千问/qwen」三种写法一并扫，别只抓整词 */
const VENDOR_PATTERN = /通义|千问|qwen/i;

/**
 * 允许出现供应商名的文件：那里是在列举「可以接入哪些 OpenAI 兼容供应商」，
 * 或是在筛选审计日志里真实记录过的模型名，都不是本站对自身引擎的声明。
 * 只窄不宽 —— 这条守卫若写成「全仓不许出现 DashScope」，会把语音转写
 * （Paraformer 真的走阿里云）与知识库检索的既有口径一起打红。
 */
const ALLOWLIST: Record<string, string> = {
  "src/components/admin-ai-models/AiModelList.tsx": "新增模型时的兼容供应商举例清单",
  "src/components/admin-ai-models/AiModelFormModal.tsx": "模型名输入框的 placeholder 示例",
  "src/components/admin-reviews/AdminReviewsTraceControlBar.tsx": "按审计日志里真实记录过的模型名筛选",
};

function scanComponentFiles(): { rel: string; hits: string[] }[] {
  const out: { rel: string; hits: string[] }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) {
        // 全新检出可能是 CRLF，归一后再匹配，否则本地绿、闸门红
        const text = fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n");
        const hits: string[] = [];
        text.split("\n").forEach((line, i) => {
          const m = line.match(VENDOR_PATTERN);
          if (m) hits.push(`${i + 1}: ${m[0]}`);
        });
        if (hits.length) out.push({ rel: path.relative(ROOT, full).replace(/\\/g, "/"), hits });
      }
    }
  };
  walk(path.join(ROOT, "src", "components"));
  return out;
}

describe("界面文案不得写死模型供应商名", () => {
  const offenders = scanComponentFiles().filter((f) => !ALLOWLIST[f.rel]);

  it(`src/components 下不得出现 通义/千问/qwen（例外：${Object.keys(ALLOWLIST).join(", ")}）`, () => {
    expect(
      offenders,
      `以下文件写死了供应商名，应改为 useAiEngineShortLabel() 的动态引擎名或中性说法：\n` +
        offenders.map((f) => `  ${f.rel} → ${f.hits.join(", ")}`).join("\n")
    ).toEqual([]);
  });

  it("豁免清单里确实有货（证明扫描器在跑，不是空转出来的绿）", () => {
    const scanned = new Map(scanComponentFiles().map((f) => [f.rel, f.hits]));
    for (const rel of Object.keys(ALLOWLIST)) {
      expect(scanned.has(rel), `豁免清单指向 ${rel}，但扫描没在其中找到供应商名 —— 要么文件改了名，要么该清掉这条豁免`).toBe(true);
    }
  });

  it("引擎名的取数通道仍然在册（防止守卫变成没人用的死规则）", () => {
    const hook = fs
      .readFileSync(path.join(ROOT, "src/components/ai/useAiEngineLabel.ts"), "utf8")
      .replace(/\r\n/g, "\n");
    expect(hook).toContain("useAiEngineLabel");
    expect(hook).toContain("useAiEngineShortLabel");
    expect(hook).toContain("aiEngineApi");
  });
});
