/**
 * 字幕保真守卫：**截断必须可见，且绝不删原字。**
 *
 * 背景（实测数据，2026-09-18）：
 *   旧实现 `clipSubtitle("验收：" + wrapSubtitleLines(step.acceptance, 19)[0], 22)` 有两处静默丢失 ——
 *   ① `[0]` 只取自动换行后的第一段，后面的段全部丢弃；
 *   ② `clipSubtitle` 再硬截到 22 字。
 *   结果：10 份规程 58 个步骤**100% 都有内容被丢**（累计 2783 字），
 *   其中 **52 个连省略号都没有** —— 画面上的 `验收：轴承温度≤75℃，` 看起来像一句完整的话，
 *   而 `振动烈度≤2.8mm/s`、`4小时试车轴承最高温≤70℃` 这类真实验收指标已经被丢掉了。
 *   对检修作业来说，"看不出被截断"比"显示不全"更危险。
 *
 * 本文件锁住三条不变量：
 *   A. 显示内容短于原文 ⇒ 该行**必须**带 "…"（截断可见）；
 *   B. 去掉 "…" 后必须是原文的**字面前缀**（不删原字，保留内容与改动前逐字一致）；
 *   C. "…" 只进画面、**不进 TTS**（否则配音会去念一个显示标记）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildStepSubtitleLines,
  buildStepNarrationText,
  utterancesOf,
} from "../src/server/services/videoGenerationService";

type Step = {
  step_no: number;
  name: string;
  content?: string;
  safety?: string;
  acceptance?: string;
};

const procedures: any[] = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "src", "db", "seed-data", "maintenance-procedures.json"),
    "utf8"
  )
);

/** 全部真实步骤（58 个）—— 守卫必须建立在真实数据上，而不是手搓的样例。 */
const allSteps: Step[] = procedures.flatMap((p) => (p.steps || []) as Step[]);

const bodyOf = (line: string, prefix: string) =>
  line.startsWith(prefix) ? line.slice(prefix.length) : line;
const stripMark = (s: string) => s.replace(/…+$/, "");

describe("字幕保真：截断必须可见（真实 58 个步骤）", () => {
  it("种子数据确实被加载（防止守卫空跑）", () => {
    expect(procedures.length).toBe(10);
    expect(allSteps.length).toBe(58);
  });

  it("A. 安全/验收：显示短于原文时，必须带 “…”", () => {
    const invisible: string[] = [];
    for (const step of allSteps) {
      const subs = buildStepSubtitleLines(step);
      for (const [prefix, full] of [
        ["安全：", step.safety],
        ["验收：", step.acceptance],
      ] as const) {
        if (!full) continue;
        const shown = subs.find((l) => l.startsWith(prefix));
        expect(shown, `${step.name} 缺少 ${prefix} 行`).toBeTruthy();
        const body = stripMark(bodyOf(shown as string, prefix));
        if (body.length < full.length && !(shown as string).includes("…")) {
          invisible.push(`${prefix}${body}  (原文 ${full.length} 字)`);
        }
      }
    }
    expect(invisible).toEqual([]);
  });

  it("B. 安全/验收：去掉 “…” 后必须是原文的字面前缀（不删原字）", () => {
    for (const step of allSteps) {
      const subs = buildStepSubtitleLines(step);
      for (const [prefix, full] of [
        ["安全：", step.safety],
        ["验收：", step.acceptance],
      ] as const) {
        if (!full) continue;
        const shown = subs.find((l) => l.startsWith(prefix)) as string;
        const body = stripMark(bodyOf(shown, prefix));
        expect(
          full.startsWith(body),
          `${step.name} 的 ${prefix}行不是原文前缀\n  显示: ${body}\n  原文: ${full}`
        ).toBe(true);
      }
    }
  });

  it("C. 内容行同样：短于原文时带 “…”，且去掉后是原文前缀", () => {
    for (const step of allSteps) {
      const subs = buildStepSubtitleLines(step);
      const contentLines = subs.filter((l) => !l.startsWith("安全：") && !l.startsWith("验收："));
      const full = String(step.content || "");
      const joined = stripMark(contentLines.map(stripMark).join(""));
      expect(full.startsWith(joined), `${step.name} 内容行不是原文前缀`).toBe(true);
      if (joined.length < full.length) {
        expect(
          contentLines.some((l) => l.includes("…")),
          `${step.name} 内容被截断却没标 “…”`
        ).toBe(true);
      }
    }
  });

  it("未截断时不得凭空添加 “…”", () => {
    const step: Step = {
      step_no: 1,
      name: "短内容",
      content: "断电。",
      safety: "戴手套。",
      acceptance: "无泄漏。",
    };
    const subs = buildStepSubtitleLines(step);
    expect(subs.join("")).not.toContain("…");
  });

  it("超长文本必须同时满足：带 “…” + 是原文前缀 + 不超宽", () => {
    const long =
      "激光对中平行偏差≤0.05mm，角向偏差≤0.04mm/100mm；4小时试车轴承最高温≤70℃，振动≤2.3mm/s，各相电流稳定正常。";
    const step: Step = { step_no: 1, name: "对中", acceptance: long };
    const subs = buildStepSubtitleLines(step);
    const line = subs.find((l) => l.startsWith("验收：")) as string;
    expect(line).toContain("…");
    const body = stripMark(bodyOf(line, "验收："));
    expect(long.startsWith(body)).toBe(true);
    // 尾部行受 width 约束（clipSubtitle 的硬上限）
    expect(line.length).toBeLessThanOrEqual(22);
  });

  it("行数仍受 maxLines 约束（加标记不得多出行）", () => {
    for (const step of allSteps) {
      expect(buildStepSubtitleLines(step).length).toBeLessThanOrEqual(5);
      expect(buildStepSubtitleLines(step, 3).length).toBeLessThanOrEqual(3);
    }
  });
});

describe("字幕保真：“…” 只进画面，不进 TTS", () => {
  it("utterancesOf：text 不含 “…”，subtitle 保留 “…”", () => {
    const seg = {
      intro: "第1步，测试。",
      lines: ["操作要点一；", "安全：请注意…", "验收：偏差≤0.05mm…"],
    };
    const utts = utterancesOf(seg);
    // 开场白不进字幕
    expect(utts[0]).toEqual({ text: "第1步，测试。", subtitle: null });
    for (const u of utts.slice(1)) {
      expect(u.text).not.toContain("…");
      expect(u.subtitle).not.toBeNull();
      // 念的 = 显示去掉标记，逐字一致
      expect(u.text).toBe((u.subtitle as string).replace(/…/g, ""));
    }
    // 显示的标记确实还在
    expect(utts[utts.length - 1].subtitle).toContain("…");
  });

  it("真实步骤：送 TTS 的每一句都不含 “…”", () => {
    for (const step of allSteps) {
      const lines = buildStepSubtitleLines(step);
      const utts = utterancesOf({ intro: `第${step.step_no}步，${step.name}。`, lines });
      for (const u of utts) expect(u.text).not.toContain("…");
    }
  });

  it("口播稿不含 “…”（buildStepNarrationText 已剥离）", () => {
    for (const step of allSteps) {
      expect(buildStepNarrationText(step)).not.toContain("…");
    }
  });
});
