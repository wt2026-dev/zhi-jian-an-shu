// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanForSpeech,
  estimateSpeechMs,
  pickChineseVoice,
  speakChinese,
  cancelSpeech,
  isSpeechSupported,
  hasSpeechSynthesis,
  voiceGenderFor,
  listChineseVoices,
} from '../src/components/digital-human/speech';

/** 可控的假 utterance：记录实例，便于测试里手动触发 start/end/error */
class FakeUtterance {
  static instances: FakeUtterance[] = [];
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: any = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  onboundary: (() => void) | null = null;
  private listeners: Record<string, Array<() => void>> = {};
  constructor(text: string) {
    this.text = text;
    FakeUtterance.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  emit(type: string) {
    if (type === 'start') this.onstart?.();
    if (type === 'end') this.onend?.();
    if (type === 'boundary') this.onboundary?.();
    if (type === 'error') this.onerror?.();
    (this.listeners[type] || []).forEach((f) => f());
  }
}

const VOICES = [
  { name: 'Microsoft Huihui - Chinese (Simplified, PRC)', lang: 'zh-CN', localService: true, default: false },
  { name: 'Microsoft Kangkang - Chinese (Simplified, PRC)', lang: 'zh-CN', localService: true, default: false },
  { name: 'Google 粤語（香港）', lang: 'zh-HK', localService: false, default: false },
  { name: 'Google US English', lang: 'en-US', localService: false, default: true },
] as unknown as SpeechSynthesisVoice[];

describe('digital-human/speech — 中文语音合成引擎', () => {
  beforeEach(() => {
    FakeUtterance.instances = [];
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    Object.defineProperty(window, 'speechSynthesis', {
      writable: true,
      value: {
        speak: vi.fn(),
        cancel: vi.fn(),
        getVoices: vi.fn(() => VOICES),
        addEventListener: vi.fn(),
        speaking: false,
        pending: false,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('cleanForSpeech', () => {
    it('剥掉 markdown 标记，避免把星号井号念出来', () => {
      const raw = '## 结论\n\n**轴承**温度 `76°C`，见 [规程](http://x/y)。';
      const out = cleanForSpeech(raw);
      expect(out).not.toMatch(/[#*`\[\]()]/);
      expect(out).toContain('轴承');
      expect(out).toContain('规程');
    });

    it('代码块与表格行不参与朗读', () => {
      const raw = '说明如下\n```js\nconst a = 1;\n```\n| 列A | 列B |\n| --- | --- |\n结束';
      const out = cleanForSpeech(raw);
      expect(out).not.toContain('const a');
      expect(out).not.toContain('列A');
      expect(out).toContain('结束');
    });

    it('空输入返回空串', () => {
      expect(cleanForSpeech('')).toBe('');
      expect(cleanForSpeech('   \n  ')).toBe('');
    });
  });

  describe('pickChineseVoice', () => {
    it('优先简体中文音色，不会落到粤语/英语', () => {
      const v = pickChineseVoice('any');
      expect(v).not.toBeNull();
      expect(v!.lang).toBe('zh-CN');
    });

    it('按性别倾向匹配音色名（张工=男声 Kangkang）', () => {
      const v = pickChineseVoice('male');
      expect(v!.name).toContain('Kangkang');
    });

    it('李工走女声（Huihui）', () => {
      const v = pickChineseVoice('female');
      expect(v!.name).toContain('Huihui');
    });

    it('没有中文音色时返回 null（而不是硬塞一个英文音色）', () => {
      (window.speechSynthesis.getVoices as any).mockReturnValue([
        { name: 'Google US English', lang: 'en-US', localService: false, default: true },
      ]);
      expect(pickChineseVoice('any')).toBeNull();
    });

    it('listChineseVoices 只返回中文音色（含 zh-HK / zh-TW）', () => {
      const list = listChineseVoices();
      expect(list.length).toBe(3); // 2 × zh-CN + 1 × zh-HK
      expect(list.every((v) => v.lang.startsWith('zh'))).toBe(true);
    });

    it('音色表变化后缓存会失效（否则会永久缓存住空表时的 null）', () => {
      // 首次：没有中文音色 → null 被缓存
      (window.speechSynthesis.getVoices as any).mockReturnValue([
        { name: 'Google US English', lang: 'en-US', localService: false, default: true },
      ]);
      expect(pickChineseVoice('any')).toBeNull();

      // 音色表异步填充出中文音色（长度变化）→ 必须能重新选中，而不是继续返回 null
      (window.speechSynthesis.getVoices as any).mockReturnValue(VOICES);
      expect(pickChineseVoice('any')?.lang).toBe('zh-CN');
    });
  });

  describe('voiceGenderFor', () => {
    it('三个人设的性别倾向与会话上下文一致', () => {
      expect(voiceGenderFor('zhang')).toBe('male');
      expect(voiceGenderFor('li')).toBe('female');
      expect(voiceGenderFor('zhi')).toBe('male');
      expect(voiceGenderFor('unknown')).toBe('any');
    });
  });

  describe('estimateSpeechMs', () => {
    it('按中文字数估算且被上下限夹住', () => {
      expect(estimateSpeechMs('')).toBe(1200);          // 下限
      expect(estimateSpeechMs('一二三四五')).toBe(1200); // 5 字 × 240 = 1200
      expect(estimateSpeechMs('一'.repeat(100))).toBe(24000);
      expect(estimateSpeechMs('一'.repeat(1000))).toBe(90000); // 上限
    });
  });

  describe('speakChinese', () => {
    it('正常念完 → promise 解析为 true，并回传真实事件', async () => {
      const events: string[] = [];
      const h = speakChinese('设备运行正常', {
        onStart: () => events.push('start'),
        onBoundary: () => events.push('boundary'),
        onEnd: (ok) => events.push(`end:${ok}`),
      });
      const u = FakeUtterance.instances.at(-1)!;
      u.emit('start');
      u.emit('boundary');
      u.emit('end');

      await expect(h.promise).resolves.toBe(true);
      expect(events).toEqual(['start', 'boundary', 'end:true']);
    });

    it('选中的音色是中文，并写入 utterance.voice', () => {
      speakChinese('测试', { gender: 'male' });
      const u = FakeUtterance.instances.at(-1)!;
      expect(u.voice).toBeTruthy();
      expect((u.voice as any).lang).toBe('zh-CN');
      expect(u.lang).toBe('zh-CN');
    });

    /**
     * 核心回归：被主动打断时 promise 必须仍是 true。
     * 若返回 false，调用方会以为"没发出声音"而再兜底读一遍 ——
     * 实测表现为点一次"播报"产生 4 次 speak 调用、声音叠在一起。
     */
    it('已发声后被打断 → 仍解析为 true（避免调用方重复兜底）', async () => {
      const h = speakChinese('一段会被打断的文本');
      const u = FakeUtterance.instances.at(-1)!;
      u.emit('start');
      h.cancel(); // 模拟用户点"播报"/"停止"打断
      await expect(h.promise).resolves.toBe(true);
    });

    it('从头就没响过（引擎报错）→ 解析为 false，让调用方去兜底', async () => {
      const h = speakChinese('一段无法朗读的文本');
      const u = FakeUtterance.instances.at(-1)!;
      u.emit('error');
      await expect(h.promise).resolves.toBe(false);
    });

    it('空文本 / 纯 markdown → 直接 false，不产生 utterance', async () => {
      const h = speakChinese('```js\nconst a=1;\n```');
      await expect(h.promise).resolves.toBe(false);
      expect(FakeUtterance.instances.length).toBe(0);
    });

    it('超长文本按 maxChars 截断', () => {
      speakChinese('一'.repeat(1000), { maxChars: 50 });
      expect(FakeUtterance.instances.at(-1)!.text.length).toBe(50);
    });

    it('朗读前会 cancel 掉上一条，避免 Chrome 队列叠加', () => {
      speakChinese('第一条');
      speakChinese('第二条');
      expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    });
  });

  describe('能力探测', () => {
    it('cancelSpeech 只依赖 speechSynthesis，不要求 SpeechSynthesisUtterance', () => {
      // jsdom / 精简环境下没有 Utterance 构造器，静音按钮仍必须生效
      vi.stubGlobal('SpeechSynthesisUtterance', undefined);
      expect(isSpeechSupported()).toBe(false);
      expect(hasSpeechSynthesis()).toBe(true);
      cancelSpeech();
      expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    });

    it('完全没有 speechSynthesis 时 cancelSpeech 不抛异常', () => {
      Object.defineProperty(window, 'speechSynthesis', { writable: true, value: undefined });
      expect(hasSpeechSynthesis()).toBe(false);
      expect(() => cancelSpeech()).not.toThrow();
    });
  });
});
