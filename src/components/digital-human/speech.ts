/**
 * speech.ts — 数字人中文语音合成统一引擎（Web Speech API）
 *
 * 为什么需要这一层：此前 GLB / VRM / Avatar 三条路径各自 new 一个
 * SpeechSynthesisUtterance，导致
 *   1. 音色不确定（不指定 voice，全靠浏览器默认，中文可能落到粤语/台语音色）；
 *   2. 口型时长与真实语音时长脱节（用固定 estMs，语音还在念、嘴已经停了）；
 *   3. 上层拿不到真实的"开始/结束"事件，UI 的"播报中"状态永远不亮；
 *   4. 自动播放策略（user activation）没有显式解锁。
 *
 * 这里集中解决：确定性选音色 + 真实事件回传 + 看门狗兜底 + 一次性解锁。
 *
 * 实测基线（本机 Chrome，zh-CN 音色 6 个）：
 *   默认音色与显式选 zh-CN 音色均能正常触发 start/end/boundary，
 *   中文语速约 240ms/字（rate=1.0）。
 */

export type SpeechGender = 'male' | 'female' | 'any';

export interface SpeakOptions {
  /** 音色性别倾向（按音色名匹配，找不到则退回任意 zh-CN 音色） */
  gender?: SpeechGender;
  rate?: number;
  pitch?: number;
  /** 朗读上限字数（超长文本截断，避免一次念几分钟） */
  maxChars?: number;
  onStart?: () => void;
  /** 每读完一个词触发（供口型跟随真实节奏） */
  onBoundary?: () => void;
  /** completed=true 表示正常念完；false 表示被取消 / 出错 / 看门狗兜底 */
  onEnd?: (completed: boolean) => void;
}

export interface SpeakHandle {
  promise: Promise<boolean>;
  cancel: () => void;
}

/** 语音朗读开关在 localStorage 里的键（与 useAiChat 保持一致） */
export const SPEECH_ENABLED_KEY = 'ai_speech_enabled';

/** 中文语速基准：实测约 240ms/字（rate=1.0） */
const MS_PER_CHAR = 240;
/** 单次朗读的字数上限 */
const DEFAULT_MAX_CHARS = 280;

// Windows Chrome 常见中文音色名 → 性别倾向
const FEMALE_HINTS = [
  'huihui', 'yaoyao', 'xiaoxiao', 'xiaoyi', 'xiaomo', 'xiaorui',
  'xiaoshuang', 'xiaoyan', 'xiaoqiu', 'hanhan', 'female', '女',
];
const MALE_HINTS = [
  'kangkang', 'yunxi', 'yunjian', 'yunyang', 'yunxia', 'male', '男',
];

/**
 * 是否有 speechSynthesis 对象（只做"停止/取消"这类操作时够用）。
 * 注意：jsdom / 部分精简环境只有 speechSynthesis 而没有 SpeechSynthesisUtterance，
 * 此时仍应允许 cancel —— 否则"静音"按钮在测试环境里完全失效。
 */
export function hasSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && !!window.speechSynthesis;
}

/** 是否具备完整朗读能力（还需要 SpeechSynthesisUtterance 构造器） */
export function isSpeechSupported(): boolean {
  return hasSpeechSynthesis() && typeof SpeechSynthesisUtterance !== 'undefined';
}

let voicesWarmed = false;
let voicesChangedBound = false;

/**
 * 音色缓存。
 *
 * ⚠️ 必须绑定"音色表长度"一起失效：Chrome 首次 `getVoices()` 返回空数组，
 * 之后 `voiceschanged` 才异步填充；若只按 gender 缓存，会永久缓存住
 * "空表时算出来的 null"，表现为"明明有中文音色却始终不发声"。
 * 系统中途安装/卸载语音包同理。
 */
let voiceCache = new Map<SpeechGender, SpeechSynthesisVoice | null>();
let voiceCacheListLength = -1;

/** 让音色缓存失效（音色表发生变化时调用） */
function invalidateVoiceCache(): void {
  voiceCache = new Map();
  voiceCacheListLength = -1;
}

/**
 * 预热音色列表。Chrome 首次 getVoices() 会返回空数组，
 * 必须等 voiceschanged 事件；这里把结果回调出去并只绑定一次监听。
 */
export function warmUpVoices(onReady?: (voices: SpeechSynthesisVoice[]) => void): void {
  if (!hasSpeechSynthesis()) return;
  const synth = window.speechSynthesis;
  const report = () => {
    invalidateVoiceCache();
    onReady?.(synth.getVoices());
  };
  if (synth.getVoices().length > 0) {
    voicesWarmed = true;
    report();
    return;
  }
  if (!voicesChangedBound) {
    voicesChangedBound = true;
    const handler = () => {
      voicesWarmed = true;
      report();
    };
    try {
      synth.addEventListener('voiceschanged', handler);
    } catch {
      synth.onvoiceschanged = handler;
    }
  }
}

/** 音色表是否已经预热过（诊断用） */
export function areVoicesWarmed(): boolean {
  return voicesWarmed;
}

/** 确定性挑选中文音色：zh-CN > 其他 zh > 任意；性别倾向按音色名匹配 */
export function pickChineseVoice(gender: SpeechGender = 'any'): SpeechSynthesisVoice | null {
  if (!hasSpeechSynthesis()) return null;

  const all = window.speechSynthesis.getVoices();
  // 音色表长度变化 → 缓存整体失效
  if (all.length !== voiceCacheListLength) invalidateVoiceCache();
  voiceCacheListLength = all.length;

  if (voiceCache.has(gender)) return voiceCache.get(gender) ?? null;
  if (!all.length) return null; // 尚未就绪，不缓存

  const zh = all.filter((v) => /^zh([-_]|$)/i.test(v.lang || ''));
  if (!zh.length) {
    voiceCache.set(gender, null);
    return null;
  }
  // 简体中文优先（避免落到 zh-HK 粤语 / zh-TW 台语）
  const zhCN = zh.filter((v) => /^zh[-_]CN$/i.test(v.lang || ''));
  const preferred = zhCN.length ? zhCN : zh;

  let picked: SpeechSynthesisVoice | undefined;
  if (gender !== 'any') {
    const hints = gender === 'male' ? MALE_HINTS : FEMALE_HINTS;
    picked = preferred.find((v) => hints.some((h) => (v.name || '').toLowerCase().includes(h)));
  }
  // 兜底：优先本地音色（离线稳定、无网络抖动）
  if (!picked) picked = preferred.find((v) => v.localService) || preferred[0];

  voiceCache.set(gender, picked ?? null);
  return picked ?? null;
}

/** 清洗待朗读文本：去掉代码块 / markdown 标记，避免念出 "星号井号" */
export function cleanForSpeech(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, ' ') // markdown 表格行不朗读
    .replace(/[#*_~>|]/g, ' ')
    .replace(/[\[\]()!-]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ') // emoji
    .replace(/\s+/g, ' ')
    .trim();
}

/** 估算朗读时长（毫秒），仅用于看门狗兜底，不用于驱动口型 */
export function estimateSpeechMs(text: string, rate = 1): number {
  const chars = text.replace(/\s/g, '').length;
  const base = chars * MS_PER_CHAR;
  return Math.round(Math.min(Math.max(base, 1200), 90000) / Math.max(rate, 0.1));
}

/**
 * 解锁自动播放策略。
 * Chrome 要求文档具备 user activation 才允许 speechSynthesis 发声；
 * 在首次用户手势里发一个"零音量、极短"的语音即可解锁，且不产生可听声音。
 */
let primed = false;
export function primeSpeech(): void {
  if (primed || !isSpeechSupported()) return;
  primed = true;
  warmUpVoices();
  try {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.rate = 10;
    u.lang = 'zh-CN';
    synth.speak(u);
  } catch {
    /* 解锁失败不阻塞主流程 */
  }
}

/** 立即停止当前朗读（只依赖 speechSynthesis，不要求 SpeechSynthesisUtterance） */
export function cancelSpeech(): void {
  if (!hasSpeechSynthesis()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

/**
 * 朗读一段中文。返回 { promise, cancel }。
 *
 * promise 的语义（**这层语义很关键，改之前先读**）：
 *   - `true`  = **确实发出过声音**（哪怕中途被用户/新语音打断，只要 onstart 触发过就算）；
 *   - `false` = 完全没发出声音（不支持 TTS / 空文本 / 引擎报错 / 看门狗兜底）。
 *
 * 为什么不用"是否念完"做判据：调用方（AiAssistantView / DigitalHumanAvatar）用
 * `ok !== true` 来决定是否降级到备用朗读路径。若把"被主动打断"也算成 false，
 * 那么"用户点播报打断当前朗读"会连带触发一次多余的兜底重读 —— 实测表现为
 * 一次点击产生 4 次 speak 调用（3 次 interrupted + 1 次正常），声音叠在一起。
 *
 * 事件回调（onStart / onBoundary / onEnd）都来自**真实**语音事件，
 * 因此可用于驱动口型与 UI 状态，而不是靠估算时长。
 */
export function speakChinese(rawText: string, opts: SpeakOptions = {}): SpeakHandle {
  const {
    gender = 'any',
    rate = 1.0,
    pitch = 1.0,
    maxChars = DEFAULT_MAX_CHARS,
    onStart,
    onBoundary,
    onEnd,
  } = opts;

  const text = cleanForSpeech(rawText);
  if (!isSpeechSupported() || !text) {
    onEnd?.(false);
    return { promise: Promise.resolve(false), cancel: () => {} };
  }

  const synth = window.speechSynthesis;
  const excerpt = text.length > maxChars ? text.slice(0, maxChars) : text;

  let settled = false;
  let started = false;
  let watchdog: number | undefined;
  let resolveFn: (v: boolean) => void = () => {};
  const promise = new Promise<boolean>((res) => {
    resolveFn = res;
  });

  const finish = (completed: boolean) => {
    if (settled) return;
    settled = true;
    if (watchdog !== undefined) window.clearTimeout(watchdog);
    // 只要真的响过，就对外报"已发声"，避免调用方重复兜底
    const producedAudio = started || completed;
    onEnd?.(producedAudio);
    resolveFn(producedAudio);
  };

  const cancel = () => {
    cancelSpeech();
    finish(false);
  };

  // 打断上一次朗读，避免新语音被排队（Chrome 会串行播报队列）
  cancelSpeech();

  const u = new SpeechSynthesisUtterance(excerpt);
  u.lang = 'zh-CN';
  u.rate = rate;
  u.pitch = pitch;
  u.volume = 1;
  const voice = pickChineseVoice(gender);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang || 'zh-CN';
  }
  u.onstart = () => {
    started = true;
    onStart?.();
  };
  u.onboundary = () => onBoundary?.();
  u.onend = () => finish(true);
  u.onerror = () => finish(false);

  // 看门狗：TTS 引擎卡死（onend / onerror 均不触发）时兜底，避免状态永久卡在"播报中"
  watchdog = window.setTimeout(() => finish(false), estimateSpeechMs(excerpt, rate) + 5000);

  try {
    synth.speak(u);
  } catch {
    finish(false);
  }

  return { promise, cancel };
}

/** 当前是否正在发声（用于 UI 状态兜底判断） */
export function isSpeakingNow(): boolean {
  if (!hasSpeechSynthesis()) return false;
  try {
    return window.speechSynthesis.speaking;
  } catch {
    return false;
  }
}

/**
 * 人设 → 中文音色性别倾向。
 * 与 `DigitalHumanAvatar.tsx` 的 `DIGITAL_PERSONAS[].gender` 保持一致：
 * 张工(男) / 李工(女) / 小智(男)。
 */
const PERSONA_VOICE: Record<string, SpeechGender> = {
  zhang: 'male',
  li: 'female',
  zhi: 'male',
};

export function voiceGenderFor(personaId: string): SpeechGender {
  return PERSONA_VOICE[personaId] || 'any';
}

/** 已就绪的中文音色清单（诊断 / 设置页用） */
export function listChineseVoices(): Array<{ name: string; lang: string; local: boolean }> {
  if (!isSpeechSupported()) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => /^zh([-_]|$)/i.test(v.lang || ''))
    .map((v) => ({ name: v.name, lang: v.lang, local: !!v.localService }));
}
