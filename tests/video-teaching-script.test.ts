/**
 * 教学字幕守卫：**每行不超过 20 字（视觉宽度 40），超长只折行、绝不截断。**
 *
 * 背景（用户反馈，2026-09-18）：
 *   空压机日常巡检教学视频的底部字幕出现两类问题 ——
 *   ① 被截断：成片里显示 `安全：观察机组仪表严禁随意改动PLC内部出…`，句子没说完就断了，
 *      而"禁止改动 PLC 出厂保护定值"这个真正的安全要求恰好落在省略号后面；
 *   ② 操作说明与安全提示混在一起，看不出哪句是警告。
 *
 * 本文件锁住四条不变量：
 *   A. 有教学脚本的步骤，字幕 = 1~2 行操作说明 + 恰好 1 行安全提示，**不含 "…"**；
 *   B. 每行视觉宽度 ≤ SUBTITLE_LINE_MAX_WIDTH（40 ≈ 20 个汉字），超限即失败（而不是在成片里悄悄断句）；
 *   C. 安全提示行必须能被 isSafetySubtitleLine 识别（渲染端据此标红），且**独占一行**；
 *   D. 安全标记只进画面、**不进 TTS**（否则 edge-tts 会把它念成插入语）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { utterancesOf } from "../src/server/services/videoGenerationService";
import {
  buildStepSubtitleLines,
  buildStepNarrationText,
  resolveStepName,
  isSafetySubtitleLine,
  displayWidth,
  wrapDisplayLines,
  SUBTITLE_LINE_MAX_WIDTH,
  TEACHING_OP_MAX_LINES,
  SAFETY_LINE_PREFIX,
} from "../src/server/services/videoSubtitleText";
import { TEACHING_SCRIPTS, getTeachingStep } from "../src/server/services/videoTeachingScript";

type Step = {
  step_no: number;
  name: string;
  content?: string;
  safety?: string;
  acceptance?: string;
};

const PROC = "proc-compressor-daily";
/** 安全提示的视觉标记（由渲染端用于判定标红），从共享常量取，避免测试与实现各写一份 */
const MARK = SAFETY_LINE_PREFIX.trim().charAt(0);

const procedures: any[] = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "src", "db", "seed-data", "maintenance-procedures.json"),
    "utf8"
  )
);
const compressorSteps: Step[] = (
  procedures.find((p) => p.id === PROC)?.steps || []
) as Step[];

/** 该步的教学字幕（走脚本路径） */
const subsOf = (step: Step) => buildStepSubtitleLines(step, 5, 22, PROC);
const opLinesOf = (lines: string[]) => lines.filter((l) => !isSafetySubtitleLine(l));
const safetyLineOf = (lines: string[]) => lines.find(isSafetySubtitleLine);

describe("显示宽度度量（CJK 记 2、ASCII 记 1）", () => {
  it("汉字/全角记 2，ASCII 与半角记 1", () => {
    expect(displayWidth("排气压力")).toBe(8);
    expect(displayWidth("0.7~0.8 MPa")).toBe(11);
    expect(displayWidth("（0.7~0.8 MPa）")).toBe(15); // 全角括号各占 2
    expect(displayWidth("")).toBe(0);
  });

  it("20 个汉字正好是 40 的上限", () => {
    expect(displayWidth("一".repeat(20))).toBe(SUBTITLE_LINE_MAX_WIDTH);
  });
});

describe("折行只换行、不丢字", () => {
  it("按标点断句，不截断", () => {
    const lines = wrapDisplayLines("打开排污阀，排放冷凝水至无水流出后关闭", SUBTITLE_LINE_MAX_WIDTH);
    expect(lines).toEqual(["打开排污阀，排放冷凝水至无水流出后关闭"]);
  });

  it("超宽时折成两行，且拼接后与原文逐字一致（无丢字）", () => {
    const text = "记录排气压力（0.7~0.8 MPa），排气温度 ≤ 95℃";
    const lines = wrapDisplayLines(text, SUBTITLE_LINE_MAX_WIDTH);
    expect(lines.length).toBe(2);
    expect(lines.join("")).toBe(text);
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(SUBTITLE_LINE_MAX_WIDTH);
  });

  it("刚好等于上限时保持一行（不为凑行数而硬折）", () => {
    // 26 + 14 = 40，正好压线 ⇒ 不该折
    const text = "观察油位在视镜刻度范围内，油色清澈无乳化";
    expect(displayWidth(text)).toBe(SUBTITLE_LINE_MAX_WIDTH);
    expect(wrapDisplayLines(text, SUBTITLE_LINE_MAX_WIDTH)).toEqual([text]);
  });

  it("单段自身超宽时按宽度硬切，仍不丢字", () => {
    const text = "一".repeat(50);
    const lines = wrapDisplayLines(text, SUBTITLE_LINE_MAX_WIDTH);
    expect(lines.join("")).toBe(text);
  });
});

describe("教学字幕：空压机日常巡检（真实种子数据）", () => {
  it("脚本覆盖 4 个步骤，且步骤号与种子数据一致", () => {
    expect(compressorSteps.length).toBe(4);
    for (const step of compressorSteps) {
      expect(getTeachingStep(PROC, step.step_no), `第${step.step_no}步缺脚本`).toBeTruthy();
    }
  });

  it("术语已按教学口径修正", () => {
    const titles = compressorSteps.map((s) => resolveStepName(PROC, s, s.step_no)).join("|");
    expect(titles).toContain("油气分离器");
    expect(titles).toContain("油质外观检查");
    expect(titles).toContain("外表面反吹清灰");
    expect(titles).not.toContain("油气桶");
    expect(titles).not.toContain("外观品质判定");
    expect(titles).not.toContain("外部反吹除尘");
  });

  it("A. 每步 = 1~2 行操作说明 + 恰好 1 行安全提示，且不含 “…”", () => {
    for (const step of compressorSteps) {
      const lines = subsOf(step);
      const op = opLinesOf(lines);
      const safety = safetyLineOf(lines);
      expect(safety, `第${step.step_no}步缺安全提示行`).toBeTruthy();
      expect(op.length, `第${step.step_no}步操作说明行数`).toBeGreaterThanOrEqual(1);
      expect(op.length, `第${step.step_no}步操作说明行数`).toBeLessThanOrEqual(TEACHING_OP_MAX_LINES);
      expect(lines.filter(isSafetySubtitleLine).length, `第${step.step_no}步安全提示必须独占一行`).toBe(1);
      expect(lines.join("")).not.toContain("…");
    }
  });

  it("B. 每行视觉宽度 ≤ 40（≈20 个汉字），超限即失败", () => {
    const over: string[] = [];
    for (const step of compressorSteps) {
      for (const line of subsOf(step)) {
        if (displayWidth(line) > SUBTITLE_LINE_MAX_WIDTH) {
          over.push(`第${step.step_no}步「${line}」宽 ${displayWidth(line)}`);
        }
      }
    }
    expect(over).toEqual([]);
  });

  it("C. 安全提示行 = 前缀 + 脚本原文，且与操作说明不同行", () => {
    for (const step of compressorSteps) {
      const t = getTeachingStep(PROC, step.step_no)!;
      const lines = subsOf(step);
      expect(safetyLineOf(lines)).toBe(`${SAFETY_LINE_PREFIX}${t.safety}`);
      for (const l of opLinesOf(lines)) {
        expect(isSafetySubtitleLine(l), `操作说明行不该被判为安全提示: ${l}`).toBe(false);
      }
    }
  });

  it("安全提示前缀只用中文字体确实含有的字形（⚠ 会渲染成豆腐块）", () => {
    // 实测：msyh.ttc（本机字幕首选字体）没有 U+26A0，drawtext 会画出 "□"。
    // 这条守卫防止有人"顺手改回更常见的 ⚠"而在成片里引入豆腐块。
    expect(MARK).not.toBe("⚠");
    expect(["▲", "●", "■", "！", "※"]).toContain(MARK);
  });

  it("操作说明行拼接后 = 脚本原文（折行不丢字）", () => {
    for (const step of compressorSteps) {
      const t = getTeachingStep(PROC, step.step_no)!;
      expect(opLinesOf(subsOf(step)).join("")).toBe(t.operation);
    }
  });

  it("口播稿：开场白用校订后的标题，且不含 “…”/标记", () => {
    for (const step of compressorSteps) {
      const t = getTeachingStep(PROC, step.step_no)!;
      const text = buildStepNarrationText(step, PROC);
      expect(text.startsWith(`第${step.step_no}步，${t.title}。`)).toBe(true);
      expect(text).not.toContain("…");
      expect(text).not.toContain(MARK);
      expect(text.endsWith("。")).toBe(true);
    }
  });

  it("D. 安全标记只进画面、不进 TTS", () => {
    for (const step of compressorSteps) {
      const lines = subsOf(step);
      const utts = utterancesOf({ intro: `第${step.step_no}步，${step.name}。`, lines });
      const safetyUtt = utts[utts.length - 1];
      expect(safetyUtt.subtitle).toContain(MARK);
      expect(safetyUtt.text).not.toContain(MARK);
      // 念的 = 显示去掉标记，逐字一致
      expect(safetyUtt.text).toBe((safetyUtt.subtitle as string).replace(/[▲⚠]/g, "").trim());
      for (const u of utts) expect(u.text).not.toContain("…");
    }
  });
});

describe("回退：未收录脚本的规程行为逐字不变", () => {
  it("同一份步骤数据不传 procId ⇒ 仍走旧路径（含 “安全：” 与可见截断 “…”）", () => {
    const step = compressorSteps[0];
    const lines = buildStepSubtitleLines(step);
    expect(lines.some((l) => l.startsWith("安全："))).toBe(true);
    expect(lines.join("")).toContain("…");
    // 旧路径不产出 "▲" 前缀（它的安全行靠 "安全：" 前缀被识别为安全提示，同样标红）
    expect(lines.some((l) => l.trimStart().startsWith(MARK))).toBe(false);
  });

  it("未收录的规程 id ⇒ 回退旧路径", () => {
    const step = compressorSteps[0];
    const lines = buildStepSubtitleLines(step, 5, 22, "proc-pump-lvl1");
    expect(lines.join("")).toContain("…");
    expect(getTeachingStep("proc-pump-lvl1", step.step_no)).toBeNull();
  });

  it("resolveStepName：有脚本用脚本标题，无脚本用规程原文", () => {
    const step = compressorSteps[1]; // 原文"储气罐与油气桶冷凝水手动排放"
    expect(resolveStepName(PROC, step, step.step_no)).toBe(
      TEACHING_SCRIPTS[PROC][step.step_no].title
    );
    expect(resolveStepName(undefined, step, step.step_no)).toBe(step.name);
  });

  it("脚本条目的三段文案都不为空", () => {
    for (const [procId, byStep] of Object.entries(TEACHING_SCRIPTS)) {
      for (const [no, t] of Object.entries(byStep)) {
        expect(t.title.trim(), `${procId} 第${no}步 title`).not.toBe("");
        expect(t.operation.trim(), `${procId} 第${no}步 operation`).not.toBe("");
        expect(t.safety.trim(), `${procId} 第${no}步 safety`).not.toBe("");
      }
    }
  });
});
