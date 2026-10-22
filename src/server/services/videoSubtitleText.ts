/**
 * 教学视频字幕文案域（自 videoGenerationService.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：中文字体探测（标题粗体/字幕常规体）、显示宽度与折行口径
 * （displayWidth / wrapDisplayLines / SUBTITLE_LINE_MAX_WIDTH）、安全提示行判定、
 * 步骤字幕与解说词的装配（buildStepSubtitleLines / resolveStepName /
 * buildStepNarrationText）。纯字符串逻辑，不碰 ffmpeg / 网络。
 */
import { existsSync } from "fs";
import { getAgnesTitleFont } from "../utils/config.ts";
import { getTeachingStep } from "./videoTeachingScript.ts";
const TITLE_FONT_CANDIDATES = [
  getAgnesTitleFont(),
  "C:/Windows/Fonts/msyhbd.ttc", // Windows 微软雅黑 粗体
  "C:/Windows/Fonts/msyh.ttc", // Windows 微软雅黑
  "C:/Windows/Fonts/simhei.ttf", // Windows 黑体
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  "/System/Library/Fonts/PingFang.ttc", // macOS
];

/** 探测可用的中文字体；探测不到返回 null（此时跳过标题烧录，不让任务失败） */
export function resolveTitleFont(): string | null {
  for (const f of TITLE_FONT_CANDIDATES) {
    if (f && existsSync(f)) return f;
  }
  return null;
}

/**
 * 字幕字体：**常规体**优先，与粗体标题拉开层次。
 * 之前字幕直接复用标题字体（雅黑粗体），"底部整行粗体"和顶部标题一样重，
 * 画面上下两块都在喊，反而分不出主次。
 */
const SUBTITLE_FONT_CANDIDATES = [
  "C:/Windows/Fonts/msyh.ttc", // Windows 微软雅黑 常规
  "C:/Windows/Fonts/simhei.ttf", // Windows 黑体
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  "/System/Library/Fonts/PingFang.ttc", // macOS
];

/** 探测字幕字体；找不到常规体时退回标题字体（宁可字重不对，也不能没字幕） */
export function resolveSubtitleFont(): string | null {
  for (const f of SUBTITLE_FONT_CANDIDATES) {
    if (f && existsSync(f)) return f;
  }
  return resolveTitleFont();
}

// ==================== 教学字幕排版（视觉宽度 / 不截断折行） ====================
//
// 旧路径（wrapSubtitleLines + markTruncated）按**字符个数**折行，于是
// `记录排气压力（0.7~0.8 MPa）` 里的 `0.7~0.8 MPa` 被当成 11 个"字"占满半行，
// 而它实际只有约 5 个汉字的视觉宽度 —— 宽窄混排的句子因此被过早折断、剩下的只能丢。
//
// 教学字幕改用**视觉宽度**：CJK / 全角记 2，ASCII 记 1，上限 40（≈20 个汉字，即用户口径的
// "不超过 20 字"）。并且**只折行、不截断** —— 宁可占两行，也不出现省略号。
// ⚠️ 旧路径的字数上限被 tests/video-subtitle-fidelity.test.ts 锁死（断言 `.length <= 22`），
// 因此两套度量**刻意共存**：有教学脚本的规程走新度量，其余规程行为逐字不变。

/** 全角 / 宽字符范围（与终端 wcwidth 的常用子集一致；含 CJK 字体按全宽渲染的几何符号） */
const WIDE_CHAR_RE =
  /[\u1100-\u115F\u25A0-\u25FF\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** 一行字幕的视觉宽度上限：40 ≈ 20 个汉字（用户口径"不超过 20 字"） */
export const SUBTITLE_LINE_MAX_WIDTH = 40;
/**
 * 教学字幕里"操作说明"最多占几行（安全提示固定 1 行）。
 * ⚠️ 这是**由守卫测试断言**的预算，不是运行时的截断开关 ——
 * `wrapDisplayLines` 只会折行、永不丢字，超限必须靠测试在提交前发现。
 */
export const TEACHING_OP_MAX_LINES = 2;
/**
 * 安全提示行前缀。`▲` 既是给色觉障碍用户的第二通道，也是渲染端判定"这行要标红"的依据。
 *
 * ⚠️ 为什么不是更常见的 `⚠`（U+26A0）：**中文字体里没有这个字形**。
 * 实测 `C:/Windows/Fonts/msyh.ttc`（微软雅黑，本机字幕首选字体）渲染 U+26A0 得到的是
 * **豆腐块（□）** —— 成片里会变成"□ 安全：运行中禁止触碰高温排气管路"，比没有图标更糟。
 * 同一测试里 `▲`(U+25B2) / `●`(U+25CF) / `※`(U+203B) / `！`(U+FF01) 均正常。
 * 所以改用几何符号区的 `▲`：所有 CJK 字体都含该区字形，且"三角形=警示"语义仍在。
 * 守卫见 tests/video-teaching-script.test.ts（禁止把 ⚠ 改回来）。
 */
export const SAFETY_LINE_PREFIX = "▲ 安全：";
/** 字幕配色：操作说明=白，安全提示=红（配 0xE53935 偏亮的红，深色画面上仍清晰） */
export const SUBTITLE_COLOR_NORMAL = "white";
export const SUBTITLE_COLOR_ALERT = "0xE53935";

/** 文本的显示宽度：CJK/全角记 2，其余记 1（"0.7~0.8 MPa" 不该按 11 个字算） */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of String(text ?? "")) w += WIDE_CHAR_RE.test(ch) ? 2 : 1;
  return w;
}

/**
 * 按标点断句 + 视觉宽度折行，**不丢任何字符**。
 * 单段自身就超宽时按宽度硬切（仍不丢字）—— 这样"折行"永远只是换行，不会变成"截断"。
 *
 * ⚠️ 这里**没有** `maxLines` 参数，是刻意的：截断会让"画面少了一句话"重新变得不可见。
 * 行数预算（教学脚本 1~2 行）由 `tests/video-teaching-script.test.ts` 在提交前拦下，
 * 而不是在成片里悄悄丢内容。
 */
export function wrapDisplayLines(text: string, maxWidth: number): string[] {
  const parts = String(text ?? "").split(/(?<=[。；;，,、：:])/).filter(Boolean);
  const packed: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (!cur) { cur = p; continue; }
    if (displayWidth(cur + p) <= maxWidth) cur += p;
    else { packed.push(cur); cur = p; }
  }
  if (cur) packed.push(cur);

  const lines: string[] = [];
  for (const l of packed) {
    if (displayWidth(l) <= maxWidth) { lines.push(l); continue; }
    let buf = "";
    for (const ch of l) {
      if (buf && displayWidth(buf + ch) > maxWidth) { lines.push(buf); buf = ch; }
      else buf += ch;
    }
    if (buf) lines.push(buf);
  }
  return lines;
}

/**
 * 该字幕行是否为"安全提示"（渲染成红色）。
 * 判据是行首标记而非内容关键词：`▲` 由教学脚本产出（见 SAFETY_LINE_PREFIX），
 * `安全：` 是旧路径的既有前缀（旧路径的安全行因此也一并标红，风格统一）。
 */
export function isSafetySubtitleLine(line: string): boolean {
  const t = String(line ?? "").trimStart();
  // "⚠" 留在判据里只为兼容历史文案，新产出的行一律用 "▲"
  return t.startsWith("▲") || t.startsWith("⚠") || t.startsWith("安全：");
}

/**
 * 把一段文字按中文标点断句、再按最大字数折行，并合并过短的残句。
 * 目的是让底部字幕每行都是完整语义、且不会孤零零只剩几个字。
 */
function wrapSubtitleLines(text: string, max: number): string[] {
  const parts = String(text || "").split(/(?<=[。；;，,、：:])/).filter(Boolean);
  const raw: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length <= max) cur += p;
    else {
      if (cur) raw.push(cur);
      cur = p;
    }
  }
  if (cur) raw.push(cur);

  const lines: string[] = [];
  for (const s of raw) {
    if (s.length <= max) lines.push(s);
    else for (let i = 0; i < s.length; i += max) lines.push(s.slice(i, i + max));
  }

  const merged: string[] = [];
  for (const l of lines) {
    const prev = merged[merged.length - 1];
    if (prev && l.length < 10 && prev.length + l.length <= max + 8) merged[merged.length - 1] = prev + l;
    else merged.push(l);
  }
  return merged;
}

export const clipSubtitle = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

/**
 * 截断必须**可见**：`wrapSubtitleLines` 会把长句按标点切成多段，而字幕只取前几段 ——
 * 被丢掉的部分原本是**静默**的。
 *
 * 实测（10 份规程 / 58 个步骤）：**100% 的步骤都有内容被丢**（累计 2783 字），
 * 其中 **52 个连省略号都没有**。于是画面上的 `验收：轴承温度≤75℃，` 看起来像一句
 * 完整的话，而 `振动烈度≤2.8mm/s`、`4小时试车轴承最高温≤70℃` 这类**真实验收指标
 * 已经被丢掉了**。对检修作业来说，"看不出被截断"比"显示不全"更危险。
 *
 * ⚠️ 只**追加**标记，绝不删除原字：这样"画面显示"永远是"原文前缀 + …"，
 * 保留下来的内容与改动前逐字一致。标记本身只进画面 —— `utterancesOf()` 送 TTS 前会
 * 把 "…" 去掉，所以标记不会被念出来，音频时长与语速不受影响。
 * 回归守卫见 tests/video-subtitle-fidelity.test.ts。
 */
export function markTruncated(lines: string[], keep: number): string[] {
  const kept = lines.slice(0, Math.max(0, keep));
  if (lines.length > kept.length && kept.length) {
    // 只追加，不删尾标点 —— 删掉的话，画面与语音都会少一个字。
    kept[kept.length - 1] += "…";
  }
  return kept;
}

/** 安全/验收各占 1 行。超宽时沿用原有的 clipSubtitle 硬截（它自带 "…"）；未超宽但有剩余段时只追加 "…"。 */
function tailLine(prefix: string, text: string, width: number): string {
  const all = wrapSubtitleLines(text, width - 3);
  const base = prefix + all.slice(0, 1).join("");
  // 已超宽 ⇒ 交给 clipSubtitle（它会补 "…"）。此处不能再自己插标记，
  // 否则标记会占掉一个字符位，可见内容反而比改动前少一个字。
  if (base.length > width) return clipSubtitle(base, width);
  return all.length > 1 ? base + "…" : base;
}

/**
 * 为一个步骤生成底部字幕行（画面用）：操作要点 → 安全 → 验收。
 *
 * 为什么**不再包含**"第N步，<步骤名>。"这一行：顶部红底标题已经用 `第N步：<步骤名>` 显示了它，
 * 而标题是**整段常驻**的（见 burnStepTitles 的 `enable='between(t, i*seg, (i+1)*seg)'`），
 * 字幕首行又要占掉段内前 1/5 时长 —— 两者叠加会让**每段开头约 3.7 秒在画面上出现
 * 上下两处完全相同的文字**（同一句话只差一个冒号/逗号）。
 * 该句改为只保留在口播开场白里（见 buildStepNarrationText）：念它的时候标题正显示在画面上，
 * "听到的"与"看到的"依然对得上，而且开场白照旧能报出步骤号。
 *
 * 行数上限 5 行：每段约 18 秒，行数再多每行停留不足 3 秒会来不及看。
 */
export function buildStepSubtitleLines(step: any, maxLines = 5, width = 22, procId?: string): string[] {
  // 有教学脚本的步骤：走"操作说明（白）+ 安全提示（红）"两段式，**只折行不截断**。
  // 脚本是人工校订过的，长度已由守卫保证落在 1~2 行内，因此这里不需要省略号。
  const teaching = getTeachingStep(procId, step?.step_no);
  if (teaching) {
    return [
      ...wrapDisplayLines(teaching.operation, SUBTITLE_LINE_MAX_WIDTH),
      `${SAFETY_LINE_PREFIX}${teaching.safety}`,
    ];
  }

  const lines: string[] = [];
  const tail: string[] = [];
  if (step?.safety) tail.push(tailLine("安全：", step.safety, width));
  if (step?.acceptance) tail.push(tailLine("验收：", step.acceptance, width));
  // 刻意保留"腾出的那一行"不用：字幕每多一行，口播就多约 22 字，
  // 而每段槽位只有 18.375 秒，超出的部分只能靠 atempo 提速来压。
  // 实测 114 字 = 24.26 秒 → 已要 1.32 倍速；再塞一行就逼近 1.5 倍上限
  // （源码注释原话："再快就不像人说话了"）。所以只把重复的那一行拿掉，
  // 口播文本与改动前逐字一致，音频时长与语速完全不变。
  const room = Math.max(1, maxLines - 1 - tail.length);
  lines.push(...markTruncated(wrapSubtitleLines(step?.content || "", width), room));
  lines.push(...tail);
  return lines;
}

/**
 * 取该步在**画面与口播**里使用的步骤名：有教学脚本时用脚本里的（术语已校订），
 * 否则用规程原文的 `step.name`。顶部标题条与口播开场白必须共用这一个来源，
 * 否则会出现"标题写着 A、配音念着 B"。
 */
export function resolveStepName(procId: string | null | undefined, step: any, stepNo?: number): string {
  const teaching = getTeachingStep(procId, stepNo ?? step?.step_no);
  return teaching?.title || step?.name || "";
}

/**
 * 把一个步骤的字幕行合并成一句口播稿（配音要念的是画面上看得到的内容）。
 *
 * 开场白"第N步，<步骤名>。"**单独补在最前**：它不再进字幕（避免与顶部标题重复，
 * 见 buildStepSubtitleLines），但口播仍然要报出步骤号 —— 念它时顶部标题正在画面上，
 * 所以"听到的"和"看到的"依旧对得上。
 *
 * 去掉行尾的顿号/分号/逗号与截断省略号，避免念出来一顿一顿的。
 */
export function buildStepNarrationText(step: any, procId?: string): string {
  const no = step?.step_no ?? 1;
  const name = resolveStepName(procId, step, no);
  const lines = [`第${no}步，${name}。`, ...buildStepSubtitleLines(step, 5, 22, procId)];
  const body = lines
    .map((l) => l.replace(/…/g, "").replace(/[▲⚠]/g, "").replace(/[，,；;、]$/g, ""))
    .join("");
  return body.endsWith("。") ? body : body + "。";
}
