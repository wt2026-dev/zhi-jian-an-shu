#!/usr/bin/env node
/**
 * 给成片烧录：顶部"第N步：步骤名"红色标题条 + 底部中文字幕。
 *
 * 为什么需要这个脚本：实测 agnes-video-v2.0 无法渲染中文文字 —— 它会在画面顶部
 * 画出一行"红色标题"，但字形是乱码（例如把"第1步：泵组运行参数记录与渗漏跑冒滴漏排查"
 * 渲染成"業11.毕 笄: 誒浹廩叕与ヲ与隟隟隟隟隟隟隟空"），而且标题只出现几秒就消失。
 * 因此正确做法是：让视频模型只负责画面与音频，标题与字幕全部由 FFmpeg 用系统 CJK 字体确定性烧录。
 *
 * 用法：
 *   node scripts/burn-step-titles.mjs <输入视频> <输出视频> <标题JSON文件> [字幕JSON文件]
 *
 *   标题 JSON：["第1步：泵组运行参数记录与渗漏跑冒滴漏排查", "第2步：..."]
 *   字幕 JSON：[["第1步，泵组运行参数记录与渗漏跑冒滴漏排查。","巡检记录进出口压力表…"], ["..."]]
 *              —— 外层按"段/步骤"分组，内层是该段要依次显示的字幕行。
 *
 * 可选环境变量：
 *   TITLE_FONT     标题字体（默认 C:/Windows/Fonts/msyhbd.ttc 微软雅黑粗体）
 *   SUBTITLE_FONT  字幕字体（默认 C:/Windows/Fonts/msyh.ttc 微软雅黑常规）
 *   TITLE_BAR      1=画整宽红色标题条（默认，可同时遮住模型画出的乱码文字）；0=只画白描边红字
 *   TITLE_BAR_H    标题条高度占画面高度的比例（默认 0.22）
 *   TITLE_BAR_A    标题条不透明度（默认 1）
 *   SUB_BOX        1=给字幕加浅色底框；0=不加框，黑字直接压在画面上（默认 0）
 *   SUB_BORDER     字幕描边宽度（默认按字号自动，黑字压在深色地面上需要一圈白描边才看得清）
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [inVideo, outVideo, titlesFile, subsFile] = process.argv.slice(2);
if (!inVideo || !outVideo || !titlesFile) {
  console.error("用法: node scripts/burn-step-titles.mjs <输入视频> <输出视频> <标题JSON文件> [字幕JSON文件]");
  process.exit(1);
}
if (!fs.existsSync(inVideo)) { console.error("输入视频不存在:", inVideo); process.exit(1); }

const titles = JSON.parse(fs.readFileSync(titlesFile, "utf8"));
if (!Array.isArray(titles) || !titles.length) { console.error("标题 JSON 必须是非空数组"); process.exit(1); }

const subs = subsFile ? JSON.parse(fs.readFileSync(subsFile, "utf8")) : null;
if (subs && (!Array.isArray(subs) || subs.length !== titles.length)) {
  console.error(`字幕 JSON 必须是数组，且分组数与标题数一致（标题 ${titles.length} 组）`);
  process.exit(1);
}

const FONT = process.env.TITLE_FONT || "C:/Windows/Fonts/msyhbd.ttc";
const SUB_FONT = process.env.SUBTITLE_FONT || "C:/Windows/Fonts/msyh.ttc";
const USE_BAR = (process.env.TITLE_BAR || "1") !== "0";
const BAR_RATIO = Number(process.env.TITLE_BAR_H || 0.22);
const BAR_ALPHA = process.env.TITLE_BAR_A || "1";
const SUB_BOX = process.env.SUB_BOX === "1";
const SUB_BAR_ALPHA = process.env.SUB_BAR_A || "0.85";
for (const f of [FONT, subs ? SUB_FONT : null]) {
  if (f && !fs.existsSync(f)) { console.error("字体文件不存在:", f); process.exit(1); }
}

/** 用 ffprobe 取时长与分辨率，避免把标题/字幕画到画面外 */
function probe(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-show_entries", "stream=width,height,codec_type",
    "-of", "json", file,
  ], { encoding: "utf8" });
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === "video") || {};
  return { duration: Number(j.format?.duration || 0), width: Number(v.width || 1088), height: Number(v.height || 832) };
}

const { duration, width, height } = probe(inVideo);
const n = titles.length;
const seg = duration / n;

const fontsize = Math.round(height / 19);
const barH = USE_BAR ? Math.round(height * BAR_RATIO) : 0;
const titleY = USE_BAR ? Math.max(0, Math.round((barH - fontsize) / 2)) : Math.round(height * 0.045);

// 字幕：黑字直接压在画面上（不加底框），只加一圈细白描边。
// 工业场景地面偏深，纯黑无描边会糊在画面里，白描边是"不加框也能看清"的最小代价。
const subFontSize = Math.round(height / 24);
const subBorder = Number(process.env.SUB_BORDER || Math.max(2, Math.round(subFontSize / 10)));
const subBarH = subFontSize + Math.round(subFontSize * 0.4) * 2;
const subY = SUB_BOX ? height - subBarH + Math.round(subFontSize * 0.4) : height - subFontSize - Math.round(height * 0.05);

// ffmpeg 滤镜里路径的冒号必须转义，否则会被当成参数分隔符
const escFont = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
const escText = (t) => String(t).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");

const filters = [];
titles.forEach((text, i) => {
  const start = (i * seg).toFixed(3);
  const end = ((i + 1) * seg).toFixed(3);
  const enable = `enable='between(t,${start},${end})'`;
  if (USE_BAR) {
    // 先铺整宽红色标题条（同时遮住模型可能画出的乱码文字），再在上面写字。
    // 默认完全不透明：半透明会把底下的乱码透出来，看着像重影。
    filters.push(`drawbox=x=0:y=0:w=iw:h=${barH}:color=0xC62828@${BAR_ALPHA}:t=fill:${enable}`);
  }
  const style = USE_BAR
    ? "fontcolor=white"
    : `fontcolor=red:borderw=${Math.max(2, Math.round(fontsize / 12))}:bordercolor=white`;
  filters.push(
    `drawtext=fontfile='${escFont(FONT)}':text='${escText(text)}':${style}:fontsize=${fontsize}` +
    `:x=(w-text_w)/2:y=${titleY}:${enable}`
  );
});

if (subs) {
  subs.forEach((lines, i) => {
    if (!Array.isArray(lines) || !lines.length) return;
    const segStart = i * seg;
    const per = seg / lines.length; // 该段内每行字幕平均占用的时长
    lines.forEach((line, k) => {
      const s = (segStart + k * per).toFixed(3);
      const e = (segStart + (k + 1) * per).toFixed(3);
      const enable = `enable='between(t,${s},${e})'`;
      if (SUB_BOX) filters.push(`drawbox=x=0:y=ih-${subBarH}:w=iw:h=${subBarH}:color=white@${SUB_BAR_ALPHA}:t=fill:${enable}`);
      filters.push(
        `drawtext=fontfile='${escFont(SUB_FONT)}':text='${escText(line)}':fontcolor=black:borderw=${subBorder}:bordercolor=white:fontsize=${subFontSize}` +
        `:x=(w-text_w)/2:y=${subY}:${enable}`
      );
    });
  });
}

console.log(`[burn] 输入=${path.basename(inVideo)} 时长=${duration.toFixed(2)}s ${width}x${height}`);
console.log(`[burn] 共 ${n} 段，每段 ${seg.toFixed(2)}s；标题字号=${fontsize}，标题条=${USE_BAR ? barH + "px" : "无"}，字幕字号=${subFontSize}${subs ? "（含字幕）" : "（无字幕）"}`);
titles.forEach((t, i) => {
  const sub = subs?.[i]?.length ? ` ｜字幕 ${subs[i].length} 行` : "";
  console.log(`  ${i + 1}. [${(i * seg).toFixed(1)}s-${((i + 1) * seg).toFixed(1)}s] ${t}${sub}`);
});

execFileSync("ffmpeg", [
  "-v", "error", "-y",
  "-i", inVideo,
  "-vf", filters.join(","),
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
  "-c:a", "copy",
  outVideo,
], { stdio: "inherit" });

console.log(`[burn] 完成 → ${outVideo}`);
