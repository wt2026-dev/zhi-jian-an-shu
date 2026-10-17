// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
// 承载 /api/v1/procedures/:id/generate-video 与 generate-video-full 中的纯视频生成逻辑
// （不依赖 req/res，参数传入），由 procedureController 调用。
import path from "path";
import os from "os";
import fs from "fs/promises";
import { existsSync } from "fs";
import { exec as execCb, execFile as execFileCb } from "child_process";
import { promisify } from "util";
import {
  AGNES_BASE_URL,
  AGNES_API_KEY,
  AGNES_ENABLED,
  AGNES_MAX_CONCURRENT,
  AGNES_DOWNLOAD_HOST_WHITELIST,
  isAgnesEnabled,
  getAgnesMaxConcurrent,
  getAgnesTotalTimeoutMin,
  getAgnesSegmentWindowMin,
  getAgnesSegmentGapSec,
  getAgnesArtifactMaxMb,
  getAgnesDownloadHostWhitelist,
  getAgnesTitleFont,
  isAgnesTtsEnabled,
  getAgnesTtsVoice,
  getAgnesTtsPython,
  getAgnesTtsLufs,
  getAgnesStaleAfterMin,
} from "../utils/config.ts";
import { getAiClient, callDashScopeJson } from "./aiClient.ts";
import { getTeachingStep } from "./videoTeachingScript.ts";
import { ProcedureVideoRepository } from "../../db/repositories/index.ts";

const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === "test" ? Math.min(ms, 10) : ms));
const execAsync = promisify(execCb);
// 标题烧录用 execFile：滤镜串里含冒号、逗号、引号，走 shell 会被二次解释，极易踩坑
const execFileAsync = promisify(execFileCb);

// ==================== 并发控制 ====================
let runningTasks = 0;

// Agnes 远端会返回的状态集合。凡是不在这个集合里的状态都打警告 ——
// 这样"状态值没被识别导致静默跑满超时"能被立刻发现，而不是事后无据可查。
const KNOWN_AGNES_STATUS = new Set([
  "completed", "succeeded", "success",
  "failed", "error",
  "processing", "in_progress", "running",
  "queued", "pending", "waiting",
]);

// ==================== Prompt 语言护栏 ====================
// 实测（同一账号、同一时刻、同一 payload：441 帧 / 1088x832 / 24fps / agnes-video-v2.0）：
//   英文 prompt（仅标题与解说词为中文）：262 秒完成
//   全中文 prompt（大模型直出）：13.6 分钟仍停在 status=in_progress/internal_status=inference，
//                                最终把 20 分钟轮询窗口耗尽 → 报"视频生成超时"。
// 即 Agnes 对"整段中文 prompt"会长时间卡在推理阶段。此前把轮询窗口从 10 分钟放宽到 20 分钟
// 并未解决问题（任务 full-1789621230669 仍在整 20 分钟处失败），根因是 prompt 语言而非窗口长度。
// 实测中文占比：已验证可完成的英文模板 26.6%，会卡住的全中文 prompt 90.0%，取 45% 作为分界。
const MAX_PROMPT_CJK_RATIO = 0.45;

/**
 * 配音自检下限：成片 300–3400Hz 语音带的 RMS 必须高于这个值，否则判定"人声没进去"。
 *
 * 底噪改成静音后（Agnes 原音轨被整体丢弃），成片语音带里除了 edge-tts 人声不可能有别的
 * 来源，所以判据从"人声压过环境床多少 dB"改成绝对下限。实测：edge-tts 成片 ≈ -23 dB，
 * 纯数字静音 = -inf。取 -40 dB 留 17 dB 余量 —— 即使只有一小部分句子合成成功（人声时长短），
 * 也不会被误判成"没配音"。
 */
const SPEECH_PRESENT_FLOOR_DB = -40;

/** 中文（CJK 统一表意文字）占比；忽略空白，标点/数字/拉丁字母计入分母（导出供单测使用） */
export function cjkRatio(text: string): number {
  const chars = Array.from(String(text).replace(/\s/g, ""));
  if (!chars.length) return 0;
  let cjk = 0;
  for (const ch of chars) if (/[\u4e00-\u9fff]/.test(ch)) cjk++;
  return cjk / chars.length;
}

// ==================== 中文标题烧录（替代视频模型写字） ====================
// 实测：即便 prompt 明确要求"画面顶部红色中文大标题"，Agnes 也只会在正确位置画出**乱码字形**
// （"第1步：泵组运行参数记录与渗漏跑冒滴漏排查" → "業11.毕 笄: 誒浹廩叕与ヲ与隟隟隟隟隟隟隟空"），
// 且标题只出现数秒即消失，不满足"贯穿全片"。缩短标题措辞也无效。
// 因此改为：prompt 里不再要求模型写字，标题统一由 FFmpeg 用系统 CJK 字体烧录到成片上。
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
function resolveTitleFont(): string | null {
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
function resolveSubtitleFont(): string | null {
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
const SUBTITLE_COLOR_NORMAL = "white";
const SUBTITLE_COLOR_ALERT = "0xE53935";

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

const clipSubtitle = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

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
function markTruncated(lines: string[], keep: number): string[] {
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

/** edge-tts 需要外部 Python 环境，按 环境变量 → 托管 venv → PATH 的顺序探测 */
const TTS_PYTHON_CANDIDATES = [
  getAgnesTtsPython(),
  "C:/Users/26783/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe",
  "python",
  "python3",
];

async function resolveTtsPython(): Promise<string | null> {
  for (const p of TTS_PYTHON_CANDIDATES) {
    if (!p) continue;
    if (p.includes("/") || p.includes("\\")) { if (!existsSync(p)) continue; }
    try {
      await execFileAsync(p, ["-c", "import edge_tts"], { timeout: 20000 });
      return p;
    } catch { /* 换下一个候选 */ }
  }
  return null;
}

/**
 * 量"语音带"（300–3400 Hz）的 RMS —— 人声的主要能量就落在这个频段。
 * 传 volume 时先按该音量渲染成纯环境床（当作基准），不传则直接量文件本身。
 * 注意：astats 的输出走 **stderr**，stdout 是空的，必须从 stderr 里解析。
 */
async function speechBandRms(file: string, volume?: string): Promise<number> {
  const af = `${volume ? `volume=${volume},` : ""}highpass=f=300,lowpass=f=3400,astats=metadata=1:reset=0`;
  const { stderr } = await execFileAsync("ffmpeg", ["-hide_banner", "-i", file, "-af", af, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1024 * 1024 * 32 });
  // 纯数字静音时 ffmpeg 报的是 `RMS level dB: -inf`，而 `Number("-inf")` 是 NaN。
  // 必须归一成 -Infinity：否则 `NaN > 阈值` 恒为 false，会静默落进"自检未通过"分支，
  // 日志还只打印一个 NaN，看不出是"没声音"还是"算错了"。
  const raw = (String(stderr || "").match(/RMS level dB: ([^\s]+)/g) || []).pop() || "";
  const v = Number(raw.split(": ")[1]);
  return Number.isFinite(v) ? v : -Infinity;
}

/** 一段口播的组成：`intro` 只念不显示字幕（念它时顶部标题正显示着），`lines` 逐行显示字幕。 */
export interface NarrationSegment {
  intro: string;
  lines: string[];
}

/** 一行字幕的显示时段（绝对秒，相对成片起点）。 */
export interface SubtitleCue {
  text: string;
  start: number;
  end: number;
}

export interface NarrationResult {
  /** 是否成功混入配音 */
  ok: boolean;
  /** 由**真实语音时长**推出的字幕时间轴；ok=false 时为空 */
  cues: SubtitleCue[];
}

/** 排好的口播时间轴。 */
export interface CuePlan {
  /** 每句的播放起始秒（绝对，相对成片起点），顺序与 utterancesOf 展开后一致 */
  starts: number[];
  /** 每句应用的 atempo（1 = 不变速） */
  tempos: number[];
  /** 字幕行时间轴 */
  cues: SubtitleCue[];
}

/**
 * 把一段口播展开成"要念的句子"序列：`intro` 在前（不进字幕），随后是各行字幕。
 * 空白项会被剔除，因此返回顺序 = 合成顺序 = starts/tempos 的下标顺序。
 */
export function utterancesOf(seg: NarrationSegment): { text: string; subtitle: string | null }[] {
  const out: { text: string; subtitle: string | null }[] = [];
  const intro = String(seg?.intro ?? "").trim();
  if (intro) out.push({ text: intro, subtitle: null });
  for (const l of seg?.lines ?? []) {
    const raw = String(l ?? "").trim();
    if (!raw) continue;
    // 字幕可能带 "…"（内容被截断的显式标记，见 markTruncated）或 "▲"（安全提示的视觉前缀，
    // 见 SAFETY_LINE_PREFIX）。两者都是**给人看的**，不能念出来 —— 去掉后再送 TTS。
    // 标记尤其不能念：edge-tts 会把它读成"警告"之类的插入语，听起来像另一个人在说话。
    // 这同时修掉一个既有小瑕疵：clipSubtitle 早先补的 "…"
    // 也会被原样送进 edge-tts（实测 39 行 / 33 个步骤），等于让配音去念一个显示标记。
    // text=念的、subtitle=显示的，二者刻意分开。
    const spoken = raw.replace(/…/g, "").replace(/[▲⚠]/g, "").trim();
    if (!spoken) continue;
    out.push({ text: spoken, subtitle: raw });
  }
  return out;
}

/**
 * 纯函数：按每句的**自然语音时长**排出整条成片的口播时间轴与字幕时间轴。
 *
 * 规则（这三条就是"音画同步"的全部定义）：
 *   1. 每段从 `i * 段长` 开始，段内句子按压缩后的真实时长**首尾相接**顺排；
 *   2. 某段语音总长超过段长时，该段统一提速（atempo），上限 `tempoCap`（默认 1.5 —— 再快不像人说话）；
 *   3. 字幕行的显示时段 = **该行自己的语音起止时间**；段尾余量归最后一行，避免字幕提前消失。
 *
 * 开场白（subtitle=null）只占时间、不产字幕 —— 它念的是顶部标题那句话，
 * 此时画面上正显示着顶部红字，所以"听到的"和"看到的"仍然一致，且不与底部字幕重复。
 */
export function planNarrationTimeline(
  segments: NarrationSegment[],
  natural: number[][],
  totalDuration: number,
  tempoCap = 1.5
): CuePlan {
  const starts: number[] = [];
  const tempos: number[] = [];
  const cues: SubtitleCue[] = [];
  const n = segments.length;
  if (!n || !(totalDuration > 0)) return { starts, tempos, cues };
  const segLen = totalDuration / n;

  for (let i = 0; i < n; i++) {
    const utts = utterancesOf(segments[i]);
    if (!utts.length) continue;
    const durs = natural[i] ?? [];
    const naturalTotal = utts.reduce((a, _u, k) => a + Math.max(0, durs[k] || 0), 0);
    const tempo = naturalTotal > segLen ? Math.min(tempoCap, naturalTotal / segLen) : 1;

    let cursor = i * segLen;
    let lastCue = -1;
    for (let k = 0; k < utts.length; k++) {
      const eff = Math.max(0, durs[k] || 0) / tempo;
      starts.push(cursor);
      tempos.push(tempo);
      if (utts[k].subtitle !== null) {
        cues.push({ text: utts[k].subtitle as string, start: cursor, end: cursor + eff });
        lastCue = cues.length - 1;
      }
      cursor += eff;
    }
    // 段尾余量留给最后一行字幕，避免它比画面提前消失
    const segEnd = (i + 1) * segLen;
    if (lastCue >= 0 && cues[lastCue].end < segEnd) cues[lastCue].end = segEnd;
  }
  return { starts, tempos, cues };
}

/**
 * 构造"静音底 + 逐句 edge-tts 人声"的 ffmpeg filter_complex。
 *
 * ⚠️ **底噪必须是静音，绝不能拿 Agnes 的原音轨 `[0:a]` 当环境床。**
 * 模型会不会照着 prompt 生成中文旁白是不可控的 —— 用户实测反馈"两个男声叠在一起、听感糊"，
 * 量测也对得上：Agnes 原始分段在 300–3400Hz 语音带里有 -25.2 dB 能量，而新旧成片的语音带
 * 分别是 -23.19 / -23.16 dB —— **Agnes 音轨在语音带里的贡献和人声是同一量级**，
 * 两条内容相近、时间错位的男声叠起来就是"重影"。
 * 配音只能有一个来源，所以这里把 Agnes 音轨整体丢弃。
 *
 * 用 `anullsrc` 而不是 `[0:a]volume=0`：① 与 Agnes 音轨彻底解耦，连"它有没有音轨"都不再是
 * 前提（无音轨的成片也能合成）；② 静音是结构性保证，不依赖任何增益算术。
 * 时长取实测视频时长，保证 `amix=duration=first` 得到的音轨与画面等长。
 *
 * 导出目的：混音结果是**用户听得见**的部分，没有回归手段就只能靠耳朵发现
 * （"两个男声叠在一起"正是这样被用户先发现的）。导出后可在不跑 30–90 分钟 Agnes 流水线、
 * 也不依赖 edge-tts 的前提下，对 filter 字符串本身做回归断言。
 */
export function buildNarrationAudioFilter(
  parts: { atempo: number | null; delayMs: number }[],
  totalDuration: number,
  lufs: string
): string {
  const chains: string[] = [];
  const labels: string[] = [];
  chains.push(`anullsrc=channel_layout=stereo:sample_rate=48000:duration=${totalDuration.toFixed(3)}[amb]`);
  labels.push("[amb]");
  parts.forEach((p, i) => {
    const tempo = p.atempo ? `atempo=${p.atempo.toFixed(4)},` : "";
    chains.push(
      `[${i + 1}:a]${tempo}loudnorm=I=${lufs}:TP=-1.5:LRA=11,` +
        `aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
        `adelay=${p.delayMs}|${p.delayMs}[v${i + 1}]`
    );
    labels.push(`[v${i + 1}]`);
  });
  // normalize=0：amix 默认 normalize=true 会按输入数衰减各路，正是"配音被稀释"的元凶之一
  return `${chains.join(";")};${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[aout]`;
}

/**
 * 用 edge-tts 合成中文男声口播，并把字幕时间轴对齐到真实语音。
 *
 * 为什么不用 Agnes 自己的语音：它会不会生成人声**不可控**（旧 prompt 明确要了中文旁白，
 * 它照做了 —— 用户实测听到两条男声重叠）。所以 Agnes 音轨在混音阶段被整体丢弃，
 * 配音只由 edge-tts 提供。⚠️ 注意：单看"语音带能量"**分不出**环境音和人声
 * （实测 Agnes 环境音的语音带就有 -24.5 dB），所以判据只能是"丢弃音轨"，不能靠频谱甄别。
 * 为什么人声要走 loudnorm：edge-tts 干声只有约 -25.9 LUFS、语音带(300-3400Hz) -28.1 dB，
 * 比 Agnes 环境音的语音带(-24.5 dB)还低，纯线性增益（如 ×1.6）混完人声贡献只有 +8 dB，
 * 仍被环境音压住；按感知响度归一到 -16 LUFS 后贡献可达 +12 dB，人声才真正听得清。
 *
 * ⚠️ **为什么必须逐行合成**：旧实现"每段整体合成一条音频 + 字幕按行数平均切时间"，
 * 两套时间轴互不相干。而口播比字幕多出一句开场白"第N步，<步骤名>。"（它不进字幕，
 * 避免与顶部标题重复），于是**声音一路领先字幕约一整行（实测约 3.7 秒）**。
 * 现在改成逐行合成、逐行量时长，字幕的 enable 时段直接用**该行语音的真实起止时间**，
 * 音画严格同步；开场白单独占段首一小段（此时只有顶部标题在画面上）。
 *
 * 返回 ok=false 表示"没做成配音"，调用方应保留无配音成片而不是让任务失败。
 */
export async function synthesizeNarration(
  inputPath: string,
  outputPath: string,
  segments: NarrationSegment[]
): Promise<NarrationResult> {
  const fail = (): NarrationResult => ({ ok: false, cues: [] });
  if (!segments.length) return fail();
  const py = await resolveTtsPython();
  if (!py) {
    console.warn("[AgnesVideoFull] 未找到可用的 edge-tts（设置 AGNES_TTS_PYTHON 指向已安装 edge-tts 的 Python），跳过配音");
    return fail();
  }
  const voice = getAgnesTtsVoice();
  const lufs = getAgnesTtsLufs();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agnes-tts-"));
  try {
    const total = Number((await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath], { encoding: "utf8" })).stdout.trim()) || 0;
    if (!(total > 0)) return fail();
    const seg = total / segments.length;

    // 一条待念的语音片段。subtitle=null 表示"只念、不显示字幕"（开场白）。
    type Utter = { text: string; subtitle: string | null; mp3: string; atempo: number | null; delayMs: number };

    /**
     * 合成一句口播，失败重试 3 次（退避 0.8s / 1.6s）。
     *
     * ⚠️ **必须有重试**：edge-tts 走的是微软在线服务，偶发网络抖动/限流很常见。
     * 旧实现没有任何重试 —— 实测 2026-09-18 的任务在第 3 句上抖了一下，
     * 结果**整条配音全丢**（成片只剩环境音），而任务照样显示成功，
     * 用户只能从成片里人肉发现。仍失败则返回 null，由调用方降级为"只显示字幕不念"，
     * 而不是让整条配音陪葬。
     */
    const synth = async (text: string, tag: string): Promise<number | null> => {
      const mp3 = path.join(tmpDir, `${tag}.mp3`);
      const txt = path.join(tmpDir, `${tag}.txt`);
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // 中文必须走 --file：Windows 下把中文经 Node 的 execFile 作为 argv 传给 Python 会损坏编码
          await fs.writeFile(txt, text, "utf8");
          await execFileAsync(py, ["-m", "edge_tts", "--voice", voice, "--rate", "+0%", "--file", txt, "--write-media", mp3], { maxBuffer: 1024 * 1024 * 8 });
          const d = Number((await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", mp3], { encoding: "utf8" })).stdout.trim()) || 0;
          if (d > 0) return d;
          lastErr = new Error("edge-tts 未产出有效音频");
        } catch (e) {
          lastErr = e;
        }
        if (attempt < 2) await sleepMs(800 * (attempt + 1));
      }
      console.warn(
        `[AgnesVideoFull] 该句配音重试 3 次仍失败，降级为"只显示字幕、不念这句"：${text.slice(0, 24)}…`,
        (lastErr as { message?: string })?.message || lastErr
      );
      return null;
    };

    // 中文口播语速实测约 4.7 字/秒（114 字 ≈ 24.26s）。给"合成失败的那句"估一个占位时长，
    // 这样后续句子与字幕的时间轴不会被顶偏（否则失败一句就会连累后面全部错位）。
    const EST_CHARS_PER_SEC = 4.7;

    // 1) 逐句合成，量出每句的**自然**时长（合成失败的用估算时长占位）
    const utterLists: { text: string; subtitle: string | null; mp3: string | null }[][] = [];
    const natural: number[][] = [];
    for (let i = 0; i < segments.length; i++) {
      const utts = utterancesOf(segments[i]);
      const durs: number[] = [];
      const withMp3: { text: string; subtitle: string | null; mp3: string | null }[] = [];
      for (let k = 0; k < utts.length; k++) {
        const tag = k === 0 && utts[k].subtitle === null ? `s${i}_intro` : `s${i}_l${k}`;
        const d = await synth(utts[k].text, tag);
        durs.push(d === null ? Math.max(0.6, utts[k].text.length / EST_CHARS_PER_SEC) : d);
        withMp3.push({ ...utts[k], mp3: d === null ? null : path.join(tmpDir, `${tag}.mp3`) });
      }
      utterLists.push(withMp3);
      natural.push(durs);
    }

    // 2) 纯函数排时间轴：字幕 enable 直接用该行语音的真实起止时间 ⇒ 音画严格同步
    const plan = planNarrationTimeline(segments, natural, total);
    if (!plan.starts.length) return fail();

    // 3) 按 plan 组装 ffmpeg 输入（mp3 为 null 的句子只占时间轴、不喂音频）
    const parts: Utter[] = [];
    let flat = 0;
    for (let i = 0; i < utterLists.length; i++) {
      for (const u of utterLists[i]) {
        if (u.mp3) {
          const tempo = plan.tempos[flat];
          parts.push({
            text: u.text,
            subtitle: u.subtitle,
            mp3: u.mp3,
            atempo: tempo > 1 ? tempo : null,
            delayMs: Math.round(plan.starts[flat] * 1000),
          });
        }
        flat++;
      }
    }
    const cues = plan.cues;

    if (!parts.length) return fail();

    const inputs = ["-i", inputPath, ...parts.flatMap((p) => ["-i", p.mp3])];
    const filter = buildNarrationAudioFilter(parts, total, lufs);
    await execFileAsync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outputPath], { maxBuffer: 1024 * 1024 * 16 });

    // 自检：只报"合成完成"没有意义 —— 必须证明人声**真的进了成片**。
    //
    // 判据随底噪改动一起变了：以前要证"人声压过了环境床"，现在 Agnes 音轨已被整体丢弃、
    // 底噪是静音，成片语音带里除了 edge-tts 人声**不可能有别的来源**。
    // 所以改成绝对判据：语音带必须有真实人声能量。实测 edge-tts 成片约 -23 dB，
    // 纯数字静音是 -inf，两者差几十 dB，这个判据既灵敏又不会被环境音干扰。
    const mixed = await speechBandRms(outputPath);
    if (!(mixed > SPEECH_PRESENT_FLOOR_DB)) {
      console.warn(
        `[AgnesVideoFull] 配音自检未通过：成片语音带仅 ${mixed} dB（阈值 ${SPEECH_PRESENT_FLOOR_DB} dB），` +
          `说明 edge-tts 人声没进去、成片几乎全静音。` +
          `请检查 edge-tts 是否可用（AGNES_TTS_PYTHON），以及 AGNES_TTS_LUFS 是否被设得过低。`
      );
      return fail();
    }
    console.log(`[AgnesVideoFull] 中文配音合成完成（${voice}，${segments.length} 段 / ${parts.length} 句，人声 loudnorm ${lufs} LUFS，成片语音带 ${mixed.toFixed(2)} dB，Agnes 原音轨已丢弃，字幕轴 ${cues.length} 条）`);
    return { ok: true, cues };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 把"第N步：步骤名"作为红底白字整宽标题条烧录到成片上。
 * 标题条铺满顶部 22% 高度，顺带遮住模型自己画出的乱码文字。
 *
 * @returns 是否成功烧录（false 时调用方应保留未烧录的成片）
 */
// 导出目的：标题/字幕的排版是"用户看得见"的部分，没有回归手段就只能在成片里人肉发现
// （"顶部红色字和下面的重合了"就是这样被用户先发现的）。导出后可在不跑 30–90 分钟 Agnes
// 流水线的前提下，拿一条现成分段直接烧录出对照片段做人工/程序化核对。
export async function burnStepTitles(
  inputPath: string,
  outputPath: string,
  titles: string[],
  subs?: string[][],
  cues?: SubtitleCue[]
): Promise<boolean> {
  const font = resolveTitleFont();
  if (!font) {
    console.warn("[AgnesVideoFull] 未找到可用的中文字体，跳过标题烧录（可用 AGNES_TITLE_FONT 指定字体路径）");
    return false;
  }
  if (!titles.length) return false;

  // 字幕字体单独探测：标题用粗体、字幕用常规体，读起来更舒服
  const subFont = subs?.length ? resolveSubtitleFont() : null;

  // 取时长与分辨率：标题要按时间轴均匀铺开，字号要随分辨率缩放
  let duration = 0;
  let height = 832;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-show_entries", "format=duration",
      "-of", "json",
      inputPath,
    ]);
    const j = JSON.parse(String(stdout));
    duration = Number(j?.format?.duration) || 0;
    height = Number(j?.streams?.[0]?.height) || 832;
  } catch (e: any) {
    console.warn("[AgnesVideoFull] ffprobe 读取时长/分辨率失败，跳过标题烧录:", e?.message || e);
    return false;
  }
  if (!duration) return false;

  const seg = duration / titles.length;
  const fontsize = Math.round(height / 19);
  const barH = Math.round(height * 0.22);
  const y = Math.max(0, Math.round((barH - fontsize) / 2));
  // ffmpeg 滤镜里路径的冒号必须转义，否则会被当成参数分隔符
  const fontEsc = font.replace(/\\/g, "/").replace(/:/g, "\\:");

  const filters: string[] = [];
  titles.forEach((text, i) => {
    const enable = `enable='between(t,${(i * seg).toFixed(3)},${((i + 1) * seg).toFixed(3)})'`;
    const textEsc = String(text).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
    filters.push(`drawbox=x=0:y=0:w=iw:h=${barH}:color=0xC62828:t=fill:${enable}`);
    filters.push(
      `drawtext=fontfile='${fontEsc}':text='${textEsc}':fontcolor=white:fontsize=${fontsize}:x=(w-text_w)/2:y=${y}:${enable}`
    );
  });

  // 底部字幕分两级：**操作说明=白字黑描边，安全提示=红字白描边**。
  // 为什么描边颜色跟着文字色反着来：白字要一圈深描边才压得住浅色地面，红字要一圈浅描边
  // 才不会在深色画面里糊成一团。两级各自都是"最高对比"组合，且颜色只是**第二通道** ——
  // 安全行本身带 `⚠` 前缀，色觉障碍用户靠前缀一样能认出来。
  //
  // 时间轴优先用 `cues`（由 synthesizeNarration 按**真实语音时长**算出，音画严格同步）；
  // 没有 cues（配音没做成 / 未启用）时才退回"按行数平均分段时长"的近似排法。
  if (subFont) {
    const subFontSize = Math.round(height / 24);
    const subBorder = Math.max(2, Math.round(subFontSize / 10));
    const subY = height - subFontSize - Math.round(height * 0.05);
    const subFontEsc = subFont.replace(/\\/g, "/").replace(/:/g, "\\:");
    const pushCue = (line: string, s: number, e: number) => {
      if (!(e > s)) return;
      const textEsc = String(line).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
      const enable = `enable='between(t,${s.toFixed(3)},${e.toFixed(3)})'`;
      const style = isSafetySubtitleLine(line)
        ? `fontcolor=${SUBTITLE_COLOR_ALERT}:borderw=${subBorder}:bordercolor=white`
        : `fontcolor=${SUBTITLE_COLOR_NORMAL}:borderw=${subBorder}:bordercolor=black`;
      filters.push(
        `drawtext=fontfile='${subFontEsc}':text='${textEsc}':${style}` +
          `:fontsize=${subFontSize}:x=(w-text_w)/2:y=${subY}:${enable}`
      );
    };

    if (cues?.length) {
      for (const c of cues) pushCue(c.text, c.start, c.end);
    } else if (subs?.length) {
      subs.forEach((lines, i) => {
        if (!Array.isArray(lines) || !lines.length) return;
        const segStart = i * seg;
        const per = seg / lines.length; // 该段内每行字幕平均停留时长
        lines.forEach((line, k) => pushCue(line, segStart + k * per, segStart + (k + 1) * per));
      });
    }
  }

  await execFileAsync("ffmpeg", [
    "-v", "error", "-y",
    "-i", inputPath,
    "-vf", filters.join(","),
    "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    outputPath,
  ], { maxBuffer: 1024 * 1024 * 16 });
  return true;
}

// ==================== SSRF 防护 ====================
// 内网 IP 段正则
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.|localhost$|\[::1\]$|::1$)/i;

/**
 * 校验视频下载 URL 合法性（导出供单测使用）
 * 规则：仅允许 http/https，拒绝 localhost/内网 IP，可选域名白名单
 */
export function validateDownloadUrl(rawUrl: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "视频下载地址格式不合法" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `视频下载地址协议不被允许（${parsed.protocol}），仅支持 http/https` };
  }
  const hostname = parsed.hostname;
  if (PRIVATE_IP_RE.test(hostname)) {
    return { ok: false, reason: `视频下载地址指向内网地址（${hostname}），已拒绝` };
  }
  // IPv6 内网地址
  if (/^\[?[0-9a-f:]+\]?$/i.test(hostname) && /:(?:0|f{1,4}|f{2,4}|f{3,4}|f{4}:f{1,4}|f{4}:f{1,4}:f{1,4}|f{4}:f{1,4}:f{1,4}:f{1,4})$/.test(hostname.replace(/^\[|\]$/g, ""))) {
    return { ok: false, reason: `视频下载地址指向内网 IPv6 地址（${hostname}），已拒绝` };
  }
  const whitelist = getAgnesDownloadHostWhitelist();
  if (whitelist.length > 0 && !whitelist.includes(hostname)) {
    return { ok: false, reason: `视频下载地址域名（${hostname}）不在白名单内` };
  }
  return { ok: true };
}

// 将规程浓缩为 60-100 词的连贯英文连续画面 Prompt（自 generate-video handler 拆出）
export async function buildEnglishVideoPrompt(proc: any): Promise<string> {
  let englishPrompt = "";
  const ai = getAiClient();
  const stepsSummary = (proc.steps || [])
    .map((s: any) => `Step ${s.step_no}: ${s.name} (${s.content}). Safety: ${s.safety || 'wear safety gear'}`)
    .join("; ");

  if (ai) {
    try {
      const sysPrompt = "You are an industrial video director. Summarize industrial maintenance SOP into a single continuous-shot English video description prompt. Only output valid JSON with property 'prompt'.";
      const userPrompt = `Summarize this industrial SOP into a 60-100 word coherent continuous-shot English prompt describing realistic industrial scene, specific equipment (${proc.equipmentType}), worker actions, tools, and safety elements. It must describe a SINGLE continuous dynamic camera shot, strictly NO multi-shot montage/cut phrases.
Procedure Title: ${proc.title}
Equipment Type: ${proc.equipmentType}
Maintenance Level: ${proc.maintenanceLevel}
Steps: ${stepsSummary}

Output JSON format:
{"prompt": "A 60-100 word fluent English description..."}`;

      const { data } = await callDashScopeJson(sysPrompt, userPrompt, 0.3);
      englishPrompt = data.prompt || "";
    } catch (err: any) {
      console.warn("[AgnesVideo] 大模型生成英文 Prompt 失败，采用备用模板:", err?.message || err);
    }
  }

  if (!englishPrompt || englishPrompt.length < 20) {
    englishPrompt = `In a clean modern high-tech industrial workshop, a certified technician wearing safety helmet and protective goggles methodically performs ${proc.maintenanceLevel} on an industrial ${proc.equipmentType}. Smooth steady continuous cinematic camera tracking shot showing precise handling of maintenance tools, inspection of machinery components, safety compliance, realistic industrial lighting, ultra high definition 4K texture, professional industrial engineering atmosphere.`;
  }
  return englishPrompt;
}

// 为每个单一步骤生成英文 prompt（连续单镜头 + 中文男声解说音频）
// 注意：不再要求画面出现文字 —— Agnes 渲染中文只会得到乱码，标题改由 FFmpeg 后期烧录（见 burnStepTitles）
export async function buildFullSegmentPrompt(proc: any, groupSteps: any[]): Promise<string> {
  const step = groupSteps[0] || {};
  const stepNo = step.step_no ?? 1;
  const stepName = step.name || "";
  // 注意：这里**不再**拼 "第N步，<步骤名>。" 交给 Agnes 念。开场白由 edge-tts 后期合成
  // （见 buildStepNarrationText / NarrationSegment.intro），prompt 只负责画面与机械环境音。
  const stepDetails = `Step ${stepNo}: ${stepName}. Operation: ${step.content || ""}. Safety: ${step.safety || "strict PPE compliance"}. Acceptance: ${step.acceptance || "qualified"}`;

  const ai = getAiClient();
  let generatedPrompt = "";
  if (ai) {
    try {
      const sys = `You are an industrial training video director. Write ONE continuous-shot English video prompt (55-90 words) for a single maintenance step. Requirements:
0. LANGUAGE (critical): Write the prompt in ENGLISH (ASCII letters). Chinese characters are NOT allowed anywhere in the prompt. The video model stalls on a fully-Chinese prompt.
1. NO ON-SCREEN TEXT (critical): Strictly do NOT request any text, letters, numbers, captions, subtitles, labels, gauges-with-readable-digits or signage anywhere in the frame. The step title is composited in post-production. The video model cannot render text — anything it draws comes out as garbled glyphs.
2. Content isolation: Describe ONLY this step's operation, tools, and safety. Strictly NO transition words like "Then next step" and strictly do NOT mix in any other steps.
3. Audio (critical): ONLY ambient industrial machinery sounds and workshop room tone. ABSOLUTELY NO voiceover, NO speech, NO narration, NO human voice, NO Mandarin dialogue. The Mandarin narration is added in post-production.
4. Camera: Single continuous steady tracking shot, strictly NO montage cuts or shot switching.
Output valid JSON: {"prompt": "..."}`;

      const user = `Equipment: ${proc.equipmentType}, maintenance level: ${proc.maintenanceLevel}. Step details: ${stepDetails}. Output JSON only.`;
      const { data } = await callDashScopeJson(sys, user, 0.3);
      if (data.prompt && data.prompt.length > 30) {
        const ratio = cjkRatio(data.prompt);
        if (ratio > MAX_PROMPT_CJK_RATIO) {
          // 语言护栏：大模型可能无视"用英文写"的要求直出中文（实测即如此，中文占比 90%）。
          // 全中文 prompt 会让 Agnes 长时间卡在 inference 直至轮询窗口耗尽，
          // 因此宁可退回英文备用模板（已验证 262 秒可完成），也不要把它交给 Agnes。
          console.warn(
            `[AgnesVideoFull] 大模型段 Prompt 中文占比 ${(ratio * 100).toFixed(0)}% 超过 ${(MAX_PROMPT_CJK_RATIO * 100).toFixed(0)}%，` +
              `Agnes 对全中文 prompt 会卡在推理阶段，已改用英文备用模板`
          );
        } else {
          generatedPrompt = data.prompt;
        }
      }
    } catch (err: any) {
      console.warn("[AgnesVideoFull] 大模型生成段 Prompt 失败，采用备用模板:", err?.message || err);
    }
  }

  if (!generatedPrompt || generatedPrompt.length < 30) {
    generatedPrompt = `In a clean modern high-tech industrial workshop, a certified technician in safety helmet and goggles performs precise maintenance operations for ${proc.equipmentType}: ${stepDetails}. Smooth steady continuous cinematic tracking shot throughout the entire operation, realistic industrial lighting, 4K texture. Strictly NO text, letters, numbers, captions or subtitles anywhere in the frame. Synchronized audio: ONLY industrial machinery ambient sounds and workshop room tone. ABSOLUTELY NO voiceover, NO speech, NO narration, NO human voice, NO Mandarin dialogue.`;
  }

  return generatedPrompt;
}

/**
 * 将缓冲区异步写入文件
 */
async function writeBufferToFile(filePath: string, data: ArrayBuffer): Promise<void> {
  const buf = Buffer.from(data);
  await fs.writeFile(filePath, buf);
  return;
}

// ==================== 产物体积护栏 ====================
// 运行环境会**静默删除**工作区内 ≥10 MiB（10,485,760 B）的 mp4，跨目录、不可恢复。
// 实测证据：2026-09-17 16:13–16:18 之间，docs/、scratch/、public/uploads/ 三个目录里
// 所有 ≥10 MiB 的 mp4 全部消失；幸存的都刚好在 10 MiB 以下。
// 分段文件（6~11 MB）常年在阈值边缘，成片（30~40 MB）则必然越线 ——
// 结果是"任务 completed、前端播放器 404"，库里再被启动自检改判 failed。
// 所以这里主动把越线文件压回去，宁可损失一点画质，也不要交付物凭空消失。
async function fileSizeBytes(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).size;
  } catch {
    return 0;
  }
}

/**
 * 超过阈值就把视频压小（原地替换）。逐级提高 crf 直到低于阈值。
 * 返回是否真的重编码过；压不下去时保留原文件（至少不比原来更糟）并打警告。
 */
export async function shrinkIfOversize(filePath: string): Promise<boolean> {
  const maxBytes = getAgnesArtifactMaxMb() * 1024 * 1024;
  const size = await fileSizeBytes(filePath);
  if (!size || size < maxBytes) return false;

  const tmp = `${filePath}.shrink.mp4`;
  for (const crf of [26, 30, 34, 38]) {
    try {
      await execFileAsync(
        "ffmpeg",
        ["-v", "error", "-y", "-i", filePath, "-c:v", "libx264", "-preset", "fast",
         "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", tmp],
        { maxBuffer: 1024 * 1024 * 16 }
      );
      const newSize = await fileSizeBytes(tmp);
      if (newSize > 0 && newSize < maxBytes) {
        await fs.rename(tmp, filePath);
        console.log(
          `[AgnesVideoFull] ${path.basename(filePath)} 已压小：` +
            `${(size / 1048576).toFixed(2)}MiB → ${(newSize / 1048576).toFixed(2)}MiB（crf ${crf}）`
        );
        return true;
      }
    } catch (e: any) {
      console.warn(`[AgnesVideoFull] 压缩 ${path.basename(filePath)} 失败（crf ${crf}）:`, e?.message || e);
    }
  }
  await fs.unlink(tmp).catch(() => {});
  console.warn(
    `[AgnesVideoFull] ${path.basename(filePath)} 仍达 ${(size / 1048576).toFixed(2)}MiB，` +
      `超过 ${getAgnesArtifactMaxMb()}MiB 上限，可能被工作区清理`
  );
  return false;
}

// 完整讲解视频后台异步执行：串行生成每段 → 下载 → FFmpeg 拼接（自 generate-video-full 的异步 IIFE 拆出）
export async function runFullVideoGeneration(proc: any, taskId: string, groups: any[][], fullDir: string): Promise<void> {
  // 防御：开关关闭直接置 failed
  if (!isAgnesEnabled()) {
    const errMsg = "视频生成功能未启用";
    console.error("[AgnesVideoFull] 开关关闭，任务终止:", errMsg);
    try { await ProcedureVideoRepository.updateStatus(taskId, { status: "failed", error: errMsg }); } catch {}
    return;
  }
  // 并发控制
  const maxConcurrent = getAgnesMaxConcurrent();

  // 提交前自检回收僵死任务：
  // - 服务端启动时的 sweepStaleVideoTasks 是一次性的（设计如此，避免误杀跨夜慢任务）；
  // - 但同一进程里跑了一整天的任务若 Agnes 侧已挂起（per memory: perf_infer_s=0
  //   等于推理一秒没跑）而本地还在 15s 轮询，runningTasks 会被永久占用，
  //   用户再点"生成"只会拿到"已达并发上限"——无法自愈。
  // - 这里按 stale 阈值回收，槽位立刻释放，提交即可继续。
  const staleMin = getAgnesStaleAfterMin();
  const staleRows = await ProcedureVideoRepository.findStaleProcessing(staleMin * 60 * 1000);
  if (staleRows.length) {
    const ids = staleRows.map((r) => r.taskId);
    const recovered = await ProcedureVideoRepository.failTasksByIds(
      ids,
      `自动回收：已超过 ${staleMin} 分钟无更新，Agnes 侧疑似卡死，已标记失败，请重新发起`
    );
    if (recovered > 0) {
      console.warn(`[AgnesVideoFull] 提交前自检回收 ${recovered} 条僵死任务：${ids.join(", ")}`);
      runningTasks = Math.max(0, runningTasks - recovered);
    }
  }

  if (runningTasks >= maxConcurrent) {
    const errMsg = `视频生成任务已达并发上限（${runningTasks}/${maxConcurrent} 条正在运行）。如有其他活跃任务，请先在历史记录中放弃它们再试。`;
    console.error("[AgnesVideoFull] 并发超限，任务终止:", errMsg);
    try { await ProcedureVideoRepository.updateStatus(taskId, { status: "failed", error: errMsg }); } catch {}
    return;
  }
  runningTasks++;
  const taskStartTime = Date.now();
  // 全局超时必须按段数推导（见 config.getAgnesTotalTimeoutMin）：
  // 写死 240 分钟对 8 段规程只有 29 分钟/段，比单段窗口 40 分钟还短 —— 必然失败。
  const totalTimeoutMin = getAgnesTotalTimeoutMin(groups.length);
  const totalTimeoutMs = totalTimeoutMin * 60 * 1000;
  const segWindowMin = getAgnesSegmentWindowMin();
  // 轮询轮数 = 单段窗口 / 15 秒
  const segMaxPolls = Math.max(1, Math.ceil((segWindowMin * 60) / 15));
  const segGapMs = getAgnesSegmentGapSec() * 1000;
  console.log(
    `[AgnesVideoFull] 任务 ${taskId} 开始：${groups.length} 段，单段窗口 ${segWindowMin} 分钟，` +
      `全局上限 ${totalTimeoutMin} 分钟`
  );
  await fs.mkdir(fullDir, { recursive: true }).catch(() => {});

  try {
    const segPaths: string[] = [];
    for (let g = 0; g < groups.length; g++) {
      // 全局超时检查
      if (Date.now() - taskStartTime > totalTimeoutMs) {
        throw new Error(`视频生成任务全局超时（${totalTimeoutMin}分钟），已终止`);
      }

      // ---- 每段开头自检：若已被外部改为 failed（用户放弃），立即退出 ----
      {
        const dbStatus = await ProcedureVideoRepository.getStatus(taskId);
        if (dbStatus === "failed") {
          console.log(`[AgnesVideoFull] 第${g + 1}段开头检测到 DB 状态已 failed（可能用户放弃），退出循环`);
          return; // finally 会执行 runningTasks--
        }
      }

      const groupSteps = groups[g];
      const step = groupSteps[0] || {};
      const stepNo = step.step_no ?? (g + 1);
      const stepName = resolveStepName(proc?.id, step, stepNo);
      const stepTitle = `第${stepNo}步 ${stepName}`;

      // 剩余时间只报区间，不报单点值。
      // 单段实测 4~40 分钟方差极大，按"每段 4 分钟"折算出的单一数字会把 3.4 小时说成 29 分钟，
      // 界面上的「剩余约 X 分钟」因此严重误导（前端已改为按区间展示，这里同步成区间口径）。
      const afterSegments = groups.length - g - 1;
      const fastMinutes = Math.round((afterSegments * (4 * 60 + getAgnesSegmentGapSec())) / 60);
      const slowMinutes = Math.ceil(
        (afterSegments * (segWindowMin * 60 + getAgnesSegmentGapSec()) + segWindowMin * 60) / 60
      );

      // ---- 段前 updateStatus 前再做一次自检（防竞态） ----
      {
        const dbStatus = await ProcedureVideoRepository.getStatus(taskId);
        if (dbStatus === "failed") {
          console.log(`[AgnesVideoFull] 第${g + 1}段提交前检测到 DB 状态已 failed，跳过`);
          return;
        }
      }
      await ProcedureVideoRepository.updateStatus(taskId, {
        status: "processing",
        error:
          `正在生成第 ${g + 1}/${groups.length} 段：${stepTitle}` +
          `（剩余最快约 ${fastMinutes} 分钟 / 最坏约 ${slowMinutes} 分钟）`,
      });

      let segPrompt = "";
      try {
        segPrompt = await buildFullSegmentPrompt(proc, groupSteps);
      } catch (promptErr: any) {
        throw new Error(`失败于${stepTitle}: Prompt 构建异常 - ${promptErr?.message || promptErr}`);
      }
      console.log(`[AgnesVideoFull] 第${g + 1}/${groups.length}段提交: prompt=${segPrompt.slice(0, 100)}...`);

      // 提交 Agnes 视频任务
      let segTaskId: string;
      try {
        const createRes = await fetch(`${AGNES_BASE_URL}/videos`, {
          method: "POST",
          headers: { Authorization: `Bearer ${AGNES_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "agnes-video-v2.0",
            prompt: segPrompt,
            width: 1152,
            height: 768,
            num_frames: 441,
            frame_rate: 24,
          }),
          signal: AbortSignal.timeout(30000),
        });
        const createBody: any = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          const errDetail = typeof createBody?.message === "string" ? createBody.message : (typeof createBody?.error === "string" ? createBody.error : (createBody && Object.keys(createBody).length ? JSON.stringify(createBody) : `HTTP ${createRes.status}`));
          throw new Error(`创建任务失败: 状态码 ${createRes.status} / 消息 ${errDetail}`);
        }
        segTaskId = createBody.video_id || createBody.task_id || createBody.id;
        if (!segTaskId) throw new Error(`响应缺少 video_id`);
      } catch (createErr: any) {
        throw new Error(`失败于${stepTitle}: ${createErr?.message || createErr}`);
      }

      // 轮询该段完成（窗口长度见 config.AGNES_SEGMENT_WINDOW_MIN，默认 40 分钟；且不超全局超时）
      // 窗口演进：10 分钟 → 20 分钟 → 40 分钟。
      // 2026-09-17 实测：Agnes 推理耗时方差极大 —— 同一账号、同一英文 prompt、同一 payload，
      // 第 1 段 4.3 分钟完成，第 2 段却跑满 20 分钟仍在 internal_status=inference。
      // 即"20 分钟"对 Agnes 只是勉强够用，慢段会被误杀，故再放宽到 40 分钟。
      // 更关键的是：远端作业**提交后无法取消**（Agnes 没有取消接口），超时只是本地放弃，
      // 远端那条会继续挂在账号队列里占槽位 —— 所以超时信息必须带上 video_id，否则事后无法审计。
      let segUrl: string | null = null;
      let lastRaw = "(尚未轮询)";
      let lastSnapshot = "";
      console.log(`[AgnesVideoFull] 第${g + 1}段远端作业 id=${segTaskId}`);
      for (let p = 0; p < segMaxPolls; p++) {
        // 每轮检查全局超时
        if (Date.now() - taskStartTime > totalTimeoutMs) {
          throw new Error(`失败于${stepTitle}: 视频生成任务全局超时（${totalTimeoutMin}分钟），已终止`);
        }
        await sleepMs(15000);
        try {
          const stRes = await fetch(`${AGNES_BASE_URL}/agnesapi?video_id=${encodeURIComponent(segTaskId)}`, {
            headers: { Authorization: `Bearer ${AGNES_API_KEY}` },
            signal: AbortSignal.timeout(15000),
          });
          const st: any = await stRes.json().catch(() => ({}));
          const raw = (st.status || st.state || "").toLowerCase();
          lastRaw = raw || "(响应无 status/state 字段)";
          lastSnapshot = JSON.stringify(st).slice(0, 300);
          // 逐轮留痕：超时是"排队慢"还是"状态值没被识别"，只有把每轮状态打出来才分得清。
          // 实测教训：曾出现跑满 20 分钟、日志里却一条异常都没有的情况，
          // 事后完全无法判断 Agnes 当时到底返回了什么。
          console.log(
            `[AgnesVideoFull] 第${g + 1}段轮询 ${p + 1}/${segMaxPolls}: http=${stRes.status} status=${lastRaw} ` +
              `internal=${st.internal_status ?? "-"} progress=${st.progress ?? st.internal_progress ?? "-"} ` +
              `url=${st.url || st.video_url ? "有" : "无"}`
          );

          // ---- 透传真实进度到 DB ----
          const rawProgressPct: number | null =
            typeof st.progress === "number" ? st.progress :
            typeof st.internal_progress === "number" ? st.internal_progress : null;
          // 若远端无明确百分比，用段位比例兜底（段 g 共 groups.length 段，起点 = g/total*100）
          const fallbackPct = Math.round((g / groups.length) * 100);
          const progressPct = rawProgressPct !== null
            ? Math.min(99, Math.max(0, rawProgressPct))
            : (raw === "completed" ? 100 : fallbackPct);
          const internalStatus: string | null = st.internal_status ?? null;

          // 轮询时也检查 DB 状态：若已被外部改为 failed（用户放弃），立刻退出
          const currentDbStatus = await ProcedureVideoRepository.getStatus(taskId);
          if (currentDbStatus === "failed") {
            console.log(`[AgnesVideoFull] 第${g + 1}段检测到 DB 状态已 failed（可能用户放弃），退出轮询`);
            return; // finally 会执行 runningTasks--
          }

          // 每段轮询循环开头也做一次轻量检查（见任务五）
          await ProcedureVideoRepository.updateStatus(taskId, {
            status: "processing",
            error: `正在生成第 ${g + 1}/${groups.length} 段：${stepTitle}` +
              `（剩余最快约 ${fastMinutes} 分钟 / 最坏约 ${slowMinutes} 分钟）`,
            progressPct,
            internalStatus,
          });

          if (raw === "completed" || raw === "succeeded" || st.video_url || st.url || st.output?.video_url) {
            segUrl = st.video_url || st.url || st.output?.video_url || st.output?.url || null;
            break;
          }
          if (raw === "failed" || raw === "error") {
            const failDetail = typeof st?.error === "string" ? st.error : (typeof st?.message === "string" ? st.message : (st?.error || st?.message ? JSON.stringify(st.error || st.message) : `状态码 ${stRes.status}`));
            throw new Error(`状态码 ${stRes.status} / 消息 ${failDetail}`);
          }
          // 既不是完成也不是失败：记录未识别状态，避免"静默跑满超时"
          if (raw && !KNOWN_AGNES_STATUS.has(raw)) {
            console.warn(`[AgnesVideoFull] 第${g + 1}段遇到未识别状态 "${raw}"，继续等待（如长期如此请核对 Agnes 文档）`);
          }
        } catch (pollErr: any) {
          if (pollErr?.message && pollErr.message.includes("失败于")) throw pollErr;
          if (pollErr?.message && pollErr.message.includes("状态码")) {
            throw new Error(`失败于${stepTitle}: ${pollErr.message}`);
          }
          const errStr = pollErr?.message || (typeof pollErr === "object" ? JSON.stringify(pollErr) : String(pollErr));
          console.warn(`[AgnesVideoFull] 第${g + 1}段轮询异常，继续等待:`, errStr);
        }
      }
      // 超时信息里带上最后一次看到的状态、响应快照与远端作业 id —— 否则"为什么超时"永远查不出来。
      // 远端作业 id 尤其重要：Agnes 无取消接口，被放弃的作业仍会占着账号队列，
      // 拿到 id 才能用 `GET /agnesapi?video_id=` 事后确认它是不是变成了僵尸。
      if (!segUrl) {
        throw new Error(
          `失败于${stepTitle}: 视频生成超时（${segWindowMin} 分钟）｜远端作业=${segTaskId}｜` +
            `最后一次远端状态=${lastRaw}｜响应快照=${lastSnapshot}`
        );
      }

      // SSRF 防护：校验下载 URL
      const urlCheck = validateDownloadUrl(segUrl);
      if (!urlCheck.ok) {
        throw new Error(`失败于${stepTitle}: ${urlCheck.reason}`);
      }

      // 下载段视频（异步写入）
      const segFile = path.join(fullDir, `${taskId}-seg${g + 1}.mp4`);
      let arrayBuf: ArrayBuffer;
      try {
        const segResp = await fetch(segUrl, { signal: AbortSignal.timeout(120000) });
        if (!segResp.ok) throw new Error(`HTTP ${segResp.status}`);
        arrayBuf = await segResp.arrayBuffer();
        await writeBufferToFile(segFile, arrayBuf);
      } catch (dlErr: any) {
        throw new Error(`失败于${stepTitle}: 下载视频失败 - ${dlErr?.message || dlErr}`);
      }
      segPaths.push(segFile);
      console.log(`[AgnesVideoFull] 第${g + 1}/${groups.length}段下载完成: ${segFile} (${Math.round(arrayBuf.byteLength / 1024)}KB)`);

      // 段文件也要压到 10MiB 以下：工作区会静默删除越线文件，而段文件常年在 6~11MB 徘徊，
      // 一旦被删，后面 concat 就会失败 —— 前面几十分钟的等待全部作废。
      await shrinkIfOversize(segFile).catch((e) =>
        console.warn(`[AgnesVideoFull] 第${g + 1}段压小失败（不影响流程）:`, e?.message || e)
      );

      // Agnes 视频生成限频约 1 次/分钟，段间等待（最后一段无需等待）
      if (g < groups.length - 1) {
        const nextPct = Math.round(((g + 1) / groups.length) * 100);
        await ProcedureVideoRepository.updateStatus(taskId, {
          status: "processing",
          error: `第 ${g + 1}/${groups.length} 段完成（${stepTitle}），等待限频后生成下一段（约 1 分钟）...`,
          progressPct: nextPct,
          internalStatus: null,
        });
        await sleepMs(segGapMs);
      }
    }

    // FFmpeg 拼接（音视频流直接复制，速度快且保留每段原生声音）
    // ---- 拼接前自检 ----
    {
      const dbStatus = await ProcedureVideoRepository.getStatus(taskId);
      if (dbStatus === "failed") {
        console.log(`[AgnesVideoFull] 拼接前检测到 DB 状态已 failed，跳过拼接`);
        return;
      }
    }
    await ProcedureVideoRepository.updateStatus(taskId, {
      status: "processing",
      error: `全部 ${groups.length} 段生成完成，正在拼接音视频...`,
    });
    const listFile = path.join(fullDir, `${taskId}.txt`);
    const listContent = segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    await fs.writeFile(listFile, listContent);
    const outName = `${taskId}.mp4`;
    const outPath = path.join(fullDir, outName);
    // 先拼到中间文件：标题烧录若失败，可直接把它改名为成片，保证"至少有一条无标题的完整成片"
    const rawPath = path.join(fullDir, `${taskId}-raw.mp4`);
    try {
      await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${rawPath}"`);
    } catch (concatErr: any) {
      console.warn("[AgnesVideoFull] concat -c copy 失败，改为重编码拼接:", concatErr?.message || concatErr);
      await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "${rawPath}"`);
    }

    // 烧录"第N步：步骤名"中文标题。Agnes 无法渲染可读中文（字形乱码且只显示数秒），
    // 所以 prompt 里已不再要求模型写字，标题统一在这里由 FFmpeg 用系统 CJK 字体确定性烧录。
    const stepTitles = groups.map((grp, i) => {
      const s = grp[0] || {};
      const no = s.step_no ?? i + 1;
      // 步骤名统一走 resolveStepName：有教学脚本时用脚本里已校订术语的标题，
      // 保证"顶部标题 / 口播开场白 / 底部字幕"三处说的是同一个名字。
      return `第${no}步：${resolveStepName(proc?.id, s, no)}`;
    });
    // 底部字幕只放"操作要点 → 安全 → 验收"：不能重复顶部标题，否则画面上下出现同一句话
    const stepSubs = groups.map((grp) => buildStepSubtitleLines(grp[0] || {}, 5, 22, proc?.id));
    // 口播 = "第N步，步骤名。"开场白 + 字幕正文。开场白念的时候顶部标题正显示在画面上，
    // 所以"听到的"和"看到的"依然对得上，而且开场白还能报出步骤号。
    // ⚠️ 开场白**不进字幕**（否则与顶部标题重复），所以它单独占段首一小段时间；
    // 这段时间里画面上只有顶部标题 —— 正是"听到什么就看到什么"。
    const stepSegments: NarrationSegment[] = groups.map((grp, i) => {
      const s = grp[0] || {};
      const no = s.step_no ?? i + 1;
      return { intro: `第${no}步，${resolveStepName(proc?.id, s, no)}。`, lines: stepSubs[i] || [] };
    });

    // ⚠️ 顺序不能反：**先配音、后烧录**。
    // 配音要逐行量出真实语音时长才能给出字幕时间轴（cues）；
    // 若先烧录，烧录时就拿不到 cues，只能退回"按行数平均切时间"的近似排法 —— 那正是
    // "声音比字幕领先约一行"的老问题。配音没做成时 cues 为空，烧录自动走近似排法。
    const narratedPath = path.join(fullDir, `${taskId}-narrated.mp4`);
    let narrated = false;
    let cues: SubtitleCue[] = [];
    if (isAgnesTtsEnabled()) {
      try {
        await ProcedureVideoRepository.updateStatus(taskId, {
          status: "processing",
          error: `正在合成中文男声配音...`,
        });
        const res = await synthesizeNarration(rawPath, narratedPath, stepSegments);
        narrated = res.ok;
        cues = res.cues;
      } catch (ttsErr: any) {
        console.warn("[AgnesVideoFull] 配音合成失败，成片将不含配音:", ttsErr?.message || ttsErr);
      }
    }
    const basePath = narrated ? narratedPath : rawPath;

    const titledPath = path.join(fullDir, `${taskId}-titled.mp4`);
    let titled = false;
    try {
      // ---- 烧录前自检 ----
      {
        const dbStatus = await ProcedureVideoRepository.getStatus(taskId);
        if (dbStatus === "failed") {
          console.log(`[AgnesVideoFull] 标题烧录前检测到 DB 状态已 failed，跳过`);
          return;
        }
      }
      await ProcedureVideoRepository.updateStatus(taskId, {
        status: "processing",
        error: `正在烧录中文标题与字幕...`,
      });
      titled = await burnStepTitles(basePath, titledPath, stepTitles, stepSubs, cues);
    } catch (titleErr: any) {
      console.warn("[AgnesVideoFull] 标题烧录失败，成片将不含标题:", titleErr?.message || titleErr);
    }

    if (titled) {
      await fs.rename(titledPath, outPath);
      if (narrated) await fs.unlink(narratedPath).catch(() => {});
    } else {
      // 无可用字体或烧录失败：把已有结果（有配音就用配音版）直接作为成片，不让整条任务失败
      await fs.rename(basePath, outPath);
    }
    await fs.unlink(rawPath).catch(() => {});

    // 成片体积护栏：这一步不能省。5~8 段拼出来的成片约 30~40 MiB，**必然**越过工作区
    // 静默删除的 10 MiB 阈值 —— 不压小的话，任务会先显示 completed，随后成片消失、
    // 前端播放器 404，启动自检还会把它改判 failed。压小一点画质，换交付物真实存在。
    await shrinkIfOversize(outPath).catch((e) =>
      console.warn("[AgnesVideoFull] 成片压小失败（不影响流程）:", e?.message || e)
    );

    // 清理段文件与列表（异步）
    await Promise.allSettled([
      ...segPaths.map((p) => fs.unlink(p).catch(() => {})),
      fs.unlink(listFile).catch(() => {}),
    ]);

    const videoUrl = `/uploads/full-videos/${outName}`;
    await ProcedureVideoRepository.updateStatus(taskId, {
      status: "completed",
      videoUrl,
      error: null,
      progressPct: 100,
      internalStatus: null,
    });
    console.log(`[AgnesVideoFull] 完整视频拼接完成: ${outPath} → ${videoUrl}`);
  } catch (err: any) {
    const errMsg = err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
    console.error("[AgnesVideoFull] 完整视频生成失败:", errMsg);
    try {
      await ProcedureVideoRepository.updateStatus(taskId, {
        status: "failed",
        error: errMsg || "完整视频生成失败",
        progressPct: null,
        internalStatus: null,
      });
    } catch {}
  } finally {
    runningTasks--;
  }
}

// ==================== 启动自愈：清理僵死视频任务 ====================
/**
 * 应用启动时执行一次。查 procedure_videos 表中 status = 'processing'|'queued'
 * 且 updated_at < NOW() - INTERVAL 的记录，批量改判 failed。
 * 阈值用 AGNES_STALE_AFTER_MIN 环境变量（默认 60 分钟，大于单段 40 分钟窗口，避免误杀慢跑任务）。
 * 不在运行中定时清扫（避免误杀跨夜慢任务），只做启动时一次。
 */
export async function sweepStaleVideoTasks(): Promise<number> {
  const staleMin = getAgnesStaleAfterMin();
  const cutoffMs = staleMin * 60 * 1000;
  const stale = await ProcedureVideoRepository.findStaleProcessing(cutoffMs);
  if (stale.length === 0) return 0;
  const reason = `服务端重启后任务中断（超过 ${staleMin} 分钟未更新），已自动标记失败，请重新发起`;
  const n = await ProcedureVideoRepository.failTasksByIds(
    stale.map((s) => s.taskId),
    reason
  );
  return n;
}

// ==================== 内部状态观测口（供回归测试与运维诊断使用，业务代码勿用） ====================
export const __runningTasks = { get count() { return runningTasks; } };
