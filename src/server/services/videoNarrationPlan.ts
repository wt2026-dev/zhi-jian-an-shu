/**
 * 旁白时间轴域（自 videoGenerationService.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：口播分段/字幕条的类型（NarrationSegment / SubtitleCue /
 * NarrationResult / CuePlan）、utterancesOf 分句、planNarrationTimeline
 * 纯函数时间轴规划（逐行真实语音时长 → 字幕 enable 时段 → atempo 变速量）、
 * buildNarrationAudioFilter 的 ffmpeg filter_complex 装配。
 * 纯逻辑无 IO；TTS 进程合成（synthesizeNarration）仍留在主文件。
 */

import { SAFETY_LINE_PREFIX, clipSubtitle, markTruncated } from "./videoSubtitleText.ts";

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
