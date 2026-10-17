import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import {
  Sparkles, Volume2, VolumeX, Activity, Check, AlertTriangle, FileText, Settings2, Radio,
  RotateCcw,
} from 'lucide-react';
import { DigitalHumanPersona } from '../types';
import { DigitalHumanGLB, type DigitalHumanGLBHandle } from './digital-human/DigitalHumanGLB';
import { DigitalHuman3D, type DigitalHuman3DHandle } from './digital-human/DigitalHuman3D';
import { speakChinese, cancelSpeech, primeSpeech, voiceGenderFor } from './digital-human/speech';

/**
 * 金色 / 天青动态声波仪（Dynamic Audio Waveform HUD）
 * 纯 CSS 驱动：波形柱由 .wave-bar-1..5 提供「香槟金 → 晨曦金 → 天青」渐变与弹性律动，
 * 静默时回落为低矮灰柱，保证"说话 / 拾音 / 待命"三态一目了然。
 */
const WaveformHUD = ({
  active,
  bars = 18,
  className = '',
  barWidth = 3,
}: {
  active: boolean;
  bars?: number;
  className?: string;
  barWidth?: number;
}) => (
  <div
    className={`flex items-end justify-center gap-[3px] ${className}`}
    data-testid="waveform-hud"
    data-active={active ? '1' : '0'}
    data-bars={bars}
    aria-hidden="true"
  >
    {Array.from({ length: bars }).map((_, i) => (
      <span
        key={i}
        className={`rounded-full transition-all ${active ? `wave-bar-${(i % 5) + 1}` : ''}`}
        style={
          active
            ? { width: `${barWidth}px` }
            : { width: `${barWidth}px`, height: `${4 + ((i * 7) % 10)}px`, backgroundColor: '#CBD5E1' }
        }
      />
    ))}
  </div>
);

/** 现场检修快捷问答指令（游戏化金色胶囊芯片） */
const QUICK_DIRECTIVES: { text: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { text: '今日待办工单与紧急告警', Icon: AlertTriangle },
  { text: '设备健康度最差的3台设备及诊断', Icon: Activity },
  { text: '生成本周设备巡检总结报告', Icon: FileText },
  { text: '螺杆空压机二级保养核心步骤', Icon: Settings2 },
];


export const DIGITAL_PERSONAS: DigitalHumanPersona[] = [
  {
    id: 'zhang',
    name: '张工',
    roleTitle: '机械首席总工程师',
    description: '30年离心机组与重载设备诊断经验，熟悉GB 30871高危规范',
    gender: 'male',
    themeColor: '#2563eb', // 蓝色工装 + 蓝色安全帽
    avatarSvgType: 'zhang',
  },
  {
    id: 'li',
    name: '李工',
    roleTitle: '电气自动化工程师',
    description: '精通PLC逻辑、变频调速与电气防爆LOTO隔离',
    gender: 'female',
    themeColor: '#16a34a', // 绿色工装 + 绿色安全帽
    avatarSvgType: 'li',
  },
  {
    id: 'zhi',
    name: '小智',
    roleTitle: 'AI智能巡检专家',
    description: '连接工厂遥测中枢与千问大模型，秒级响应故障研判',
    gender: 'male',
    themeColor: '#06b6d4', // 青色安全帽
    avatarSvgType: 'zhi',
  },
];

interface DigitalHumanAvatarProps {
  isSpeaking: boolean;
  isListening?: boolean;
  speechEnabled: boolean;
  onToggleSpeech: () => void;
  onSelectPrompt?: (text: string) => void;
  className?: string;
  /** 真实发声状态回传：让上层（悬浮球 / 面板 / 会话状态）与数字人保持一致 */
  onSpeakingChange?: (speaking: boolean) => void;
}

export interface DigitalHumanAvatarHandle {
  /** 让 3D 数字人开口说话（AI 回答文本驱动） */
  speak: (text: string) => Promise<boolean | void>;
  /** 打断或停止数字人当前语音输出 */
  stop?: () => void;
  /** 当前是否正处于 3D 渲染活跃态 */
  is3D?: () => boolean;
}

/** 渲染后端标识：自研程序化 3D（默认）/ 写实工程师 GLB */
type RenderBackend = 'glb' | 'procedural';

const BACKEND_TITLE: Record<RenderBackend, string> = {
  glb: '写实工程师 3D 数字人・本地渲染',
  procedural: '自研3D数字人・本地渲染',
};

export const DigitalHumanAvatar = forwardRef<DigitalHumanAvatarHandle, DigitalHumanAvatarProps>((
  {
    isSpeaking,
    isListening = false,
    speechEnabled,
    onToggleSpeech,
    onSelectPrompt,
    className = '',
    onSpeakingChange,
  },
  ref,
) => {
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(() => {
    try {
      return localStorage.getItem('industrial_digital_human_persona') || 'zhang';
    } catch {
      return 'zhang';
    }
  });

  // 渲染后端：默认写实 3D 数字人（asian_worker.glb），若加载异常则 onError 自动降级至自研程序化 3D 模型
  const [backend, setBackend] = useState<RenderBackend>(() => {
    try {
      return new URLSearchParams(window.location.search).get('dh_backend') === 'procedural' ? 'procedural' : 'glb';
    } catch {
      return 'glb';
    }
  });
  /** 本地发声状态：与父级 isSpeaking 取并集，保证"真实在发声"时一定亮起 */
  const [localSpeaking, setLocalSpeaking] = useState(false);

  const glbRef = useRef<DigitalHumanGLBHandle>(null);
  const human3dRef = useRef<DigitalHuman3DHandle>(null);

  /** 最近一次朗读的文本，供"重播"按钮使用 */
  const lastSpokenRef = useRef<string>('');

  const speakingActive = isSpeaking || localSpeaking;

  // 把真实发声状态同时回传上层
  const handleSpeakingChange = useCallback((v: boolean) => {
    setLocalSpeaking(v);
    onSpeakingChange?.(v);
  }, [onSpeakingChange]);

  /**
   * 唯一的发声降级链：当前挂载的 3D 后端 → Web Speech 兜底。
   *
   * 注意：同一时刻只挂载一个 3D 后端（GLB / 程序化 3D），
   * 所以这里只需要"当前后端失败就落到纯语音"，不必逐个遍历 ref。
   * 关键点是**绝不在某条路径返回 false 时静默结束** —— 那正是
   * "口型在动但完全没声音"的成因。
   */
  const runSpeakChain = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text) return false;
      lastSpokenRef.current = text;

      const backend = glbRef.current || human3dRef.current;
      if (backend) {
        try {
          if ((await backend.speak(text)) === true) return true;
        } catch {
          /* 落到下面的纯语音兜底 */
        }
      }

      // 纯语音兜底：即使 3D 后端全部不可用，也必须让用户听到声音
      const handle = speakChinese(text, {
        gender: voiceGenderFor(selectedPersonaId),
        onStart: () => handleSpeakingChange(true),
        onEnd: () => handleSpeakingChange(false),
      });
      return handle.promise;
    },
    [handleSpeakingChange, selectedPersonaId],
  );

  // 语音静音联动：静音时立即停止语音播报
  useEffect(() => {
    if (!speechEnabled) {
      cancelSpeech();
      try { glbRef.current?.stop(); } catch {}
      try { glbRef.current?.stop(); } catch {}
      try { human3dRef.current?.stop(); } catch {}
      setLocalSpeaking(false);
    }
  }, [speechEnabled]);

  // 首次用户手势解锁自动播放策略（Chrome 要求文档具备 user activation）
  useEffect(() => {
    const unlock = () => primeSpeech();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // 对外暴露句柄：is3D() / speak() / stop()
  useImperativeHandle(ref, () => ({
    is3D: () => !!(glbRef.current || human3dRef.current),

    /**
     * 统一发声入口。
     * 逐级尝试 3D 渲染后端，**任一级失败都会继续往下走**，
     * 最后一定落到 Web Speech 纯语音兜底 —— 不再出现"某条路径静默失败导致完全无声"。
     */
    speak: async (text: string) => {
      if (!text || !speechEnabled) return false;
      return runSpeakChain(text);
    },

    stop: () => {
      cancelSpeech();
      try { glbRef.current?.stop(); } catch {}
      try { glbRef.current?.stop(); } catch {}
      try { human3dRef.current?.stop(); } catch {}
      setLocalSpeaking(false);
    },
  }));

  const activePersona = DIGITAL_PERSONAS.find((p) => p.id === selectedPersonaId) || DIGITAL_PERSONAS[0];

  const handleSelectPersona = (id: string) => {
    setSelectedPersonaId(id);
    try {
      localStorage.setItem('industrial_digital_human_persona', id);
    } catch {}
  };

  /** 重播：把最近一次 AI 回答再念一遍（用户点"播报"就该听到声音） */
  const handleReplay = () => {
    const text = lastSpokenRef.current;
    if (!text || !speechEnabled) return;
    primeSpeech();
    // 先打断当前朗读（避免新语音被 Chrome 排队），再走同一条降级链
    cancelSpeech();
    try { glbRef.current?.stop(); } catch {}
    try { glbRef.current?.stop(); } catch {}
    try { human3dRef.current?.stop(); } catch {}
    void runSpeakChain(text);
  };

  return (
    <div className={`hud-card fx-shimmer p-4 sm:p-5 relative transition-all ${className}`}>
      {/* Top Header: Title & Persona Switcher */}
      <div className="flex items-center justify-between gap-2 relative z-10 pb-2.5 border-b border-amber-100/80">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="icon-tile icon-tile-sm icon-tile-gold shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-1.5 truncate">
              <span>{BACKEND_TITLE[backend]}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full border shrink-0 bg-cyan-50 text-cyan-700 border-cyan-200">
                本地 3D · LIVE
              </span>
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">
              {activePersona.roleTitle} · {activePersona.name}
            </p>
          </div>
        </div>

        {/* TTS Speech Toggle + Replay */}
        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={handleReplay}
            disabled={!speechEnabled}
            data-testid="digital-human-replay"
            title={speechEnabled ? '重播最近一次播报内容' : '请先开启语音朗读'}
            className="px-2 py-1 rounded-md text-[11px] font-medium flex items-center space-x-1 transition-all cursor-pointer border bg-white text-slate-600 border-slate-200 hover:text-cyan-700 hover:bg-cyan-50 hover:border-cyan-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>播报</span>
          </button>
          <button
            type="button"
            onClick={onToggleSpeech}
            data-testid="digital-human-speech-toggle"
            title={speechEnabled ? '语音朗读已开启（点击关闭）' : '语音朗读已关闭（点击开启）'}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center space-x-1 transition-all cursor-pointer border ${
              speechEnabled
                ? 'bg-blue-50 text-blue-600 border-blue-200 shadow-2xs'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            {speechEnabled ? <Volume2 className="w-3.5 h-3.5 text-blue-600" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>{speechEnabled ? '朗读开' : '朗读关'}</span>
          </button>
        </div>
      </div>

      {/* Main Avatar Canvas Area */}
      <div className="py-1 flex flex-col items-center gap-2 relative z-10 w-full">
        {/* Main Render Area */}
        <div className="relative flex flex-col items-center justify-center w-full">
          {/* 次世代立绘剧场：全景舞台 + 环境光晕 + 全息底网 + 呼吸脉冲 + 3D渲染 + 全息底座 */}
          <div className="relative w-full h-[286px] sm:h-[322px] rounded-2xl overflow-hidden border border-amber-100/70 bg-gradient-to-b from-white/70 via-amber-50/25 to-cyan-50/25">
            {/* ① 环境景深漫反射光晕（晨曦金 / 天青 / 靛紫） */}
            <div className="absolute inset-0 overflow-hidden rounded-2xl">
              <div className="fx-bloom" />
            </div>

            {/* ② 微晶六边形全息透光底网 */}
            <div className="fx-hex absolute inset-0 rounded-2xl" />

            {/* ③ 晨曦微光粒子 */}
            <div className="fx-particles rounded-2xl" />

            {/* ④ 同心圆呼吸脉冲地标（说话金 / 拾音绿 / 待命青） */}
            <div className="absolute left-1/2 bottom-10 -translate-x-1/2 w-[224px] h-[224px] pointer-events-none">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`absolute inset-0 rounded-full border pulse-ring ${i === 1 ? 'pulse-ring-2' : i === 2 ? 'pulse-ring-3' : ''}`}
                  style={{
                    borderColor: speakingActive
                      ? 'rgba(232, 163, 61, 0.55)'
                      : isListening
                      ? 'rgba(16, 185, 129, 0.45)'
                      : 'rgba(14, 165, 233, 0.32)',
                  }}
                />
              ))}
            </div>

            {/* ⑤ 全息科技光环 */}
            <div
              className="hud-halo"
              style={{ opacity: speakingActive ? 0.95 : isListening ? 0.8 : 0.55 }}
            />

            {/* ⑥ 3D 渲染舞台（写实 GLB → 自研程序化 3D，逐级平滑降级） */}
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="w-full h-full flex items-center justify-center">
                {backend === 'glb' && (
                  <DigitalHumanGLB
                    ref={glbRef}
                    personaId={selectedPersonaId}
                    isSpeaking={isSpeaking}
                    onError={(err) => {
                      console.warn('[DigitalHumanAvatar] GLB 模型加载异常，降级至自研程序化 3D 模型:', err);
                      setBackend('procedural');
                    }}
                    className="w-full h-full"
                  />
                )}
                {backend === 'procedural' && (
                  <DigitalHuman3D
                    ref={human3dRef}
                    personaId={selectedPersonaId}
                    isSpeaking={isSpeaking}
                    className="w-full h-full"
                  />
                )}
              </div>
            </div>

            {/* ⑦ 全息底座 */}
            <div className="hud-pedestal absolute bottom-3 left-1/2 -translate-x-1/2 w-[248px] sm:w-[284px] h-4 rounded-[50%]" />

            {/* ⑧ 金色/天青声波仪表盘 + 状态浮标 */}
            <div className="absolute inset-x-4 bottom-3 z-20 flex flex-col items-center gap-1.5 pointer-events-none">
              <WaveformHUD active={speakingActive || isListening} bars={24} className="h-6 w-full" />
              <div className="px-2.5 py-0.5 rounded-full bg-white/90 backdrop-blur-xs border border-amber-200/70 text-[10px] font-mono text-slate-700 flex items-center space-x-1.5 shadow-sm">
                {speakingActive ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                    <span className="text-amber-700 font-bold">3D语音实时输出中</span>
                  </>
                ) : isListening ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="text-emerald-600 font-bold">正在现场拾音</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    <span>3D数字人 · 在线待命</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Lower Section: Persona Details & Persona Switcher */}
        <div className="w-full space-y-2.5 text-left">
          {/* 活跃人设简介 */}
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-base font-bold text-slate-900">{activePersona.name}</span>
              <span
                className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: `${activePersona.themeColor}15`,
                  color: activePersona.themeColor,
                  border: `1px solid ${activePersona.themeColor}30`,
                }}
              >
                {activePersona.roleTitle}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">{activePersona.description}</p>
          </div>

          {/* 三形象切换器（张工 / 李工 / 小智） */}
          <div>
            <span className="text-[11px] text-slate-500 font-medium block mb-1.5">切换专家形象：</span>
            <div className="grid grid-cols-3 gap-2">
              {DIGITAL_PERSONAS.map((p) => {
                const isSelected = p.id === activePersona.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPersona(p.id)}
                    className={`justify-center text-xs font-semibold ${isSelected ? 'chip-gold' : 'chip-cyan'}`}
                  >
                    <span>{p.name}</span>
                    {isSelected && <Check className="w-3 h-3 ml-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Directive Hotkeys */}
          {onSelectPrompt && (
            <div className="pt-2 border-t border-amber-100/70">
              <div className="text-[11px] text-slate-500 mb-1.5 flex items-center font-medium">
                <Radio className="w-3 h-3 mr-1 text-amber-500" />
                <span>现场检修快捷问答指令：</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_DIRECTIVES.map(({ text, Icon }) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => onSelectPrompt(text)}
                    className="chip-gold fx-shimmer"
                  >
                    <Icon className="w-3 h-3 shrink-0 opacity-80" />
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

DigitalHumanAvatar.displayName = 'DigitalHumanAvatar';
