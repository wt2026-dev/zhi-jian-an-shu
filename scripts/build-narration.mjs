#!/usr/bin/env node
/**
 * 给成片加上中文男声配音（口播稿）。
 *
 * 为什么需要单独做配音：实测 agnes-video-v2.0 **不会**根据 prompt 生成中文语音 ——
 * 它只会给出一层工业环境音（低频轰鸣 + 宽带噪声），频谱上完全看不到语音共振峰。
 * 即使 prompt 明确要求 "a calm confident professional Chinese male voiceover narrating in Mandarin"，
 * 出来的仍然只有环境音。所以配音必须另外合成再混入。
 *
 * 做法：用 edge-tts（免费、无需 API Key）逐段合成中文男声，按每段起点对齐铺到时间轴上，
 * 与原环境音混音（环境音压低到 0.3，避免盖住人声）。
 *
 * 用法：
 *   node scripts/build-narration.mjs <输入视频> <口播稿JSON> <输出视频>
 * 口播稿 JSON：["第1步，……。", "第2步，……。"]   —— 数组长度即段数，按段均匀铺满整条时间轴。
 *
 * 可选环境变量：
 *   TTS_VOICE   音色（默认 zh-CN-YunxiNeural 云希·男声）
 *   TTS_RATE    edge-tts 语速，如 +12%（默认 +0%，靠 atempo 精确对齐）
 *   AMBIENT_VOL 环境音音量（默认 0.30）
 *   VOICE_VOL   人声音量（默认 1.60）
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const [inVideo, textsFile, outVideo] = process.argv.slice(2);
if (!inVideo || !textsFile || !outVideo) {
  console.error("用法: node scripts/build-narration.mjs <输入视频> <口播稿JSON> <输出视频>");
  process.exit(1);
}
for (const f of [inVideo, textsFile]) if (!fs.existsSync(f)) { console.error("文件不存在:", f); process.exit(1); }

const texts = JSON.parse(fs.readFileSync(textsFile, "utf8"));
if (!Array.isArray(texts) || !texts.length) { console.error("口播稿 JSON 必须是非空数组"); process.exit(1); }

const VOICE = process.env.TTS_VOICE || "zh-CN-YunxiNeural";
const RATE = process.env.TTS_RATE || "+0%";
// 环境音压低到 0.30 作"底噪床"，人声经 loudnorm 拉到 -16 LUFS 稳居其上。
// 为什么必须 loudnorm：实测 edge-tts 干声只有 -25.9 LUFS、语音带(300-3400Hz) -28.1 dB，
// 比 Agnes 原环境音的语音带(-24.5 dB)**还低**。所以"人声×1.6"这种线性增益根本盖不住环境音
// （实测混完语音带反而从 -24.5 掉到 -25.8，等于没有配音）。loudnorm 按感知响度归一到 -16 LUFS
// 并顺带 true-peak 限幅，既不糊在底噪里，也不会削顶。
const AMBIENT_VOL = process.env.AMBIENT_VOL || "0.30";
const VOICE_LUFS = process.env.VOICE_LUFS || "-16";
const VOICE_TP = process.env.VOICE_TP || "-1.5";
const PY = process.env.TTS_PYTHON || "C:/Users/26783/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe";

const probeDuration = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" }).trim()) || 0;

const total = probeDuration(inVideo);
const n = texts.length;
const seg = total / n;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "narration-"));
console.log(`[narration] 视频 ${total.toFixed(2)}s，共 ${n} 段，每段 ${seg.toFixed(2)}s，音色=${VOICE}`);

// 1) 逐段合成
// 注意：中文必须走 --file 而不是 --text。
// 在 Windows 上把中文经 Node 的 execFileSync 作为 argv 传给 Python 会损坏编码
// （表现为 edge-tts 内部崩在 runpy/_run_module_as_main，报一串字节数组），
// 而同样的命令在 shell 里手敲却能成功。落一个 UTF-8 临时文件绕开 argv 即可。
const parts = [];
texts.forEach((text, i) => {
  const mp3 = path.join(tmpDir, `step${i + 1}.mp3`);
  const txt = path.join(tmpDir, `step${i + 1}.txt`);
  fs.writeFileSync(txt, text, "utf8");
  execFileSync(PY, ["-m", "edge_tts", "--voice", VOICE, "--rate", RATE, "--file", txt, "--write-media", mp3], { stdio: "pipe" });
  let dur = probeDuration(mp3);
  // 2) 超出该段时长就压缩语速；上限 1.5 倍，再快就不像人说话了
  let atempo = null;
  if (dur > seg) {
    atempo = Math.min(1.5, dur / seg);
    dur = dur / atempo;
  }
  parts.push({ mp3, atempo, dur });
  console.log(`  ${i + 1}. 合成 ${dur.toFixed(2)}s（原 ${probeDuration(mp3).toFixed(2)}s${atempo ? `，atempo=${atempo.toFixed(2)}` : ""}）起点 ${(i * seg).toFixed(2)}s`);
});

// 3) 按段起点对齐 + 与原声混音
const inputs = ["-i", inVideo, ...parts.flatMap((p) => ["-i", p.mp3])];
const chains = [];
const mixLabels = [];
// 环境音统一成 48k/立体声，避免 amix 因采样率或声道布局不一致而隐式转换出意外电平
chains.push(`[0:a]volume=${AMBIENT_VOL},aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[amb]`);
mixLabels.push("[amb]");
parts.forEach((p, i) => {
  const delayMs = Math.round(i * seg * 1000);
  const tempo = p.atempo ? `atempo=${p.atempo.toFixed(4)},` : "";
  // adelay 需要为每个声道各给一个毫秒值；上面 aformat 已确保立体声，故给两个
  chains.push(
    `[${i + 1}:a]${tempo}loudnorm=I=${VOICE_LUFS}:TP=${VOICE_TP}:LRA=11,` +
      `aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
      `adelay=${delayMs}|${delayMs}[v${i + 1}]`
  );
  mixLabels.push(`[v${i + 1}]`);
});
// normalize=0：amix 默认 normalize=true 会把各路按输入数衰减，正是"配音被稀释"的元凶之一
const filter = `${chains.join(";")};${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[aout]`;

console.log(`[narration] 混音中（环境音 ${AMBIENT_VOL}，人声 loudnorm ${VOICE_LUFS} LUFS / TP ${VOICE_TP}）...`);
execFileSync("ffmpeg", [
  "-v", "error", "-y",
  ...inputs,
  "-filter_complex", filter,
  "-map", "0:v", "-map", "[aout]",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
  outVideo,
], { stdio: "inherit" });

fs.rmSync(tmpDir, { recursive: true, force: true });

// 4) 自检：人声必须明显压过环境音，否则等于"没配音"。
//
// 踩坑记录：最初拿"混后语音带 RMS"去比"原始环境音(满音量)语音带 RMS"，方向就错了 ——
// 环境音被压到 0.30 后语音带自然掉下来，于是永远"负增长"，但人声其实已经存在。
// 正确的基准是：同一条视频、同样的 AMBIENT_VOL、但**不加人声**的底噪床。
// 两者相减才是"人声贡献"，这个差值 >10 dB 才叫人能听清。
const speechBandRms = (file) => {
  // astats 的输出走 stderr，必须用 spawnSync 抓 stderr；execFileSync 只返回 stdout，会拿到空串
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "highpass=f=300,lowpass=f=3400,astats=metadata=1:reset=0", "-f", "null", "-"], { encoding: "utf8" });
  const m = String(r.stderr || "").match(/RMS level dB: ([\-\d.]+)/g) || [];
  return Number((m.pop() || "").split(": ")[1]);
};

const bedFile = path.join(os.tmpdir(), `narration-bed-${Date.now()}.wav`);
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", inVideo, "-af", `volume=${AMBIENT_VOL},aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`, bedFile]);
const bed = speechBandRms(bedFile);
fs.rmSync(bedFile, { force: true });
const mixed = speechBandRms(outVideo);
const gain = mixed - bed;
console.log(`[narration] 语音带 RMS：纯环境床 ${bed.toFixed(2)} dB → 加人声后 ${mixed.toFixed(2)} dB（人声贡献 ${gain >= 0 ? "+" : ""}${gain.toFixed(2)} dB）`);
if (!(gain > 10)) {
  console.error(`[narration] ⚠️ 人声贡献仅 ${gain.toFixed(2)} dB（阈值 +10 dB），会被环境音盖住。请调大 VOICE_LUFS（如 -13）或调小 AMBIENT_VOL（如 0.12）。`);
  process.exit(2);
}
console.log(`[narration] 完成 → ${outVideo}`);
