import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Mic, Send, Volume2, VolumeX, Minus, X, Loader2, User } from 'lucide-react';
import { useAiChatContext } from '../context/AiChatContext';
import { Markdown } from './ai/Markdown';
import { DIGITAL_PERSONAS } from './DigitalHumanAvatar';
import { PERSONA_CONFIGS } from './digital-human/EngineerModel';

/**
 * 按系数调暗 / 调亮一个 0xRRGGBB 色（低多边形靠"受光面 + 暗面"读体积，
 * 单色平涂在 52px 里就又是一块积木了）。
 */
const shade = (c: number, k: number): string => {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${ch((c >> 16) & 255)}${ch((c >> 8) & 255)}${ch(c & 255)}`;
};

/**
 * 右下角悬浮球 / 面板头部的迷你工人像（零网络请求内联 SVG）。
 *
 * 为什么换掉原来的「庖」字圆徽：用户口径很明确 —— "不要用那个夸张的圆形头像"。
 * 印章是品牌符号，不是"数字人"；悬浮球里出现的必须是**和 3D 舞台同一个人**。
 * 所以这里画的是同一个低多边形检修工人：安全帽 + 靛蓝工装 + 荧光反光条，
 * 配色直接取 `PERSONA_CONFIGS`（3D 模型的单一来源），换人设时两边不会分叉。
 * 五官刻意压小、无腮红、无高光大眼睛 —— 动漫脸正是上一轮被点名的问题。
 */
const MiniDigitalHuman: React.FC<{
  isSpeaking: boolean;
  isListening: boolean;
  personaId: string;
}> = ({ isSpeaking, isListening, personaId }) => {
  const cfg = PERSONA_CONFIGS[personaId] || PERSONA_CONFIGS.zhang;
  const helmet = shade(cfg.helmetColor, 1);
  // 白帽（总工）在白玉底上会糊成一片，必须给一条冷灰描边把它从背景里拎出来
  const helmetEdge = cfg.helmetColor > 0xdedede ? '#94a3b8' : shade(cfg.helmetColor, 0.68);
  const overall = shade(cfg.overallColor, 1);
  const skin = shade(cfg.skinTone, 1);
  const hair = shade(cfg.hairColor, 1);
  return (
    <span
      className="relative w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-b from-slate-50 via-white to-blue-50"
      data-testid="mini-digital-human"
      data-persona={personaId}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" className="w-full h-full block" role="presentation">
        {/* 外圈虚线信号弧：与顶栏 Logo 的蓝青双弧同款语汇（品牌连续性留在这里，而不是靠字印） */}
        <path
          d="M24 3.2 A20.8 20.8 0 0 1 44.8 24"
          fill="none" stroke="#06b6d4" strokeOpacity="0.7" strokeWidth="1.3"
          strokeLinecap="round" strokeDasharray="2.4 3.6"
        />
        <path
          d="M24 44.8 A20.8 20.8 0 0 1 3.2 24"
          fill="none" stroke="#3b82f6" strokeOpacity="0.7" strokeWidth="1.3"
          strokeLinecap="round" strokeDasharray="2.4 3.6"
        />

        {/* ── 工装：肩线外扩 + 右半身暗面，读得出"一件衣服"而不是一块蓝 ── */}
        <polygon points="3,48 7.5,37.5 16,33 32,33 40.5,37.5 45,48" fill={overall} />
        <polygon points="32,33 40.5,37.5 45,48 34,48" fill={shade(cfg.overallColor, 0.74)} />
        {/* 反光条（GB 20653：荧光黄绿底 + 银白带） */}
        <polygon points="14.6,35.4 17.6,34.4 17.6,48 14.6,48" fill={shade(cfg.stripColor, 1)} opacity="0.92" />
        <polygon points="33.4,35.4 30.4,34.4 30.4,48 33.4,48" fill={shade(cfg.stripColor, 0.86)} opacity="0.92" />
        <rect x="11.8" y="43.6" width="24.4" height="2.4" fill="#eef2f3" opacity="0.9" />
        {/* 领口：翻领两片 + 中间露出的一点颈窝，去掉"头插在瓶子里" */}
        <polygon points="19.4,32.6 24,38.4 21.2,32.2" fill={shade(cfg.overallColor, 1.28)} />
        <polygon points="28.6,32.6 24,38.4 26.8,32.2" fill={shade(cfg.overallColor, 1.16)} />
        <polygon points="21.6,32.2 24,36.4 26.4,32.2" fill={shade(cfg.skinTone, 0.86)} />

        {/* ── 头：略带方下颌的多边形体块，两侧给出受光/背光两个面 ── */}
        <polygon points="17.4,17.6 30.6,17.6 30.6,26.4 28.2,31 24,32.6 19.8,31 17.4,26.4" fill={skin} />
        <polygon points="27,17.6 30.6,17.6 30.6,26.4 28.2,31 26,32" fill={shade(cfg.skinTone, 0.9)} />
        {/* 耳 */}
        <polygon points="16.6,22 17.6,21.6 17.6,25.6 16.8,25.2" fill={shade(cfg.skinTone, 0.94)} />
        <polygon points="31.4,22 30.4,21.6 30.4,25.6 31.2,25.2" fill={shade(cfg.skinTone, 0.84)} />
        {/* 鬓角 + 耳上碎发：帽子与脸之间的过渡，缺了它就是"头盔直接扣在脸上" */}
        <polygon points="17.6,18.2 19.6,18.2 19.4,22.4 17.6,21.6" fill={hair} />
        <polygon points="30.4,18.2 28.4,18.2 28.6,22.4 30.4,21.6" fill={hair} />
        {/* 眉 / 眼 / 鼻 / 嘴：短促、中性、无高光 —— 成人脸靠骨点与阴影，不靠大眼 */}
        <path d="M19.9 23.1 h2.6 M25.5 23.1 h2.6" stroke={hair} strokeWidth="1" strokeLinecap="round" />
        <ellipse cx="21.2" cy="24.7" rx="0.95" ry="1.05" fill="#241f26" />
        <ellipse cx="26.8" cy="24.7" rx="0.95" ry="1.05" fill="#241f26" />
        <path d="M24 26.1 l-0.7 2.1 h1.5" fill="none" stroke={shade(cfg.skinTone, 0.74)} strokeWidth="0.7" strokeLinejoin="round" />
        <path d="M21.9 29.6 h4.2" stroke={shade(cfg.skinTone, 0.62)} strokeWidth="0.9" strokeLinecap="round" />

        {/* ── 安全帽：帽檐 + 帽壳 + 顶筋 + 背光暗面 ── */}
        <path
          d="M14.2 18.4 a9.9 10.4 0 0 1 19.6 0 Z"
          fill={helmet} stroke={helmetEdge} strokeWidth="0.7" strokeLinejoin="round"
        />
        <path d="M24.9 8.1 h2.6 a9.9 9.9 0 0 1 6.2 10.3 h-8.8 Z" fill={shade(cfg.helmetColor, 0.9)} opacity="0.55" />
        <rect x="22.7" y="8" width="2.6" height="10.4" rx="1.2" fill={shade(cfg.helmetColor, 0.88)} />
        <rect x="11" y="17.4" width="26" height="3.5" rx="1.75" fill={shade(cfg.helmetColor, 0.96)} stroke={helmetEdge} strokeWidth="0.6" />
        <rect x="11" y="17.4" width="26" height="1.1" rx="0.55" fill={shade(cfg.helmetColor, 1.18)} />
      </svg>
      {/* 说话：琥珀色细环脉冲（克制，不铺满整球） */}
      {isSpeaking && (
        <span className="absolute inset-0 rounded-full border border-amber-400/80 animate-pulse pointer-events-none" />
      )}
      {/* 拾音：翠绿细环 */}
      {isListening && (
        <span className="absolute inset-0 rounded-full border border-emerald-400/80 animate-pulse pointer-events-none" />
      )}
    </span>
  );
};

/**
 * 全局悬浮 AI 助手
 * - 右下角悬浮球（56px，数字人头像），未登录不渲染
 * - 点击展开 380×560 悬浮卡片：数字人形象区 / 消息流 / 输入区
 * - 支持拖拽移动、最小化（收起为悬浮球）、关闭
 * - 打开状态全局唯一（由 AiChatProvider 托管）
 */
export const AiAssistantPanel: React.FC = () => {
  const chat = useAiChatContext();
  const [inputText, setInputText] = useState('');
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);
  // 点击 vs 拖拽的分流：累计位移 > 4px 才算真拖，否则 click 仍触发 openPanel。
  const dragMovedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [personaId, setPersonaId] = useState<string>(() => {
    try {
      return localStorage.getItem('industrial_digital_human_persona') || 'zhang';
    } catch {
      return 'zhang';
    }
  });

  const persona = DIGITAL_PERSONAS.find((p) => p.id === personaId) || DIGITAL_PERSONAS[0];

  // 自动跟随最新消息滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.messages]);

  // 外部预填（如驾驶舱"AI 解读"）：自动填入并直接提问
  useEffect(() => {
    if (chat.prefillSeq > 0 && chat.prefill) {
      const text = chat.prefill;
      setInputText(text);
      chat.clearPrefill();
      setTimeout(() => chat.sendMessage(text), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.prefillSeq]);

  // 面板打开时保留上次位置（不再强制重置到右下角）

  /* ---------------- 拖拽移动（带视口边界约束，防止移出屏幕） ---------------- */
  const onDragStart = (clientX: number, clientY: number) => {
    dragRef.current = { sx: clientX, sy: clientY, bx: offset.dx, by: offset.dy };
    dragMovedRef.current = false;
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      if (!dragMovedRef.current && Math.abs(x - d.sx) + Math.abs(y - d.sy) > 4) {
        dragMovedRef.current = true;
      }
      const rawDx = d.bx + (x - d.sx);
      const rawDy = d.by + (y - d.sy);
      // 允许自由拖拽到页面任意位置，仅防止完全拖出视口
      // 面板宽约 340px，高约 420px；right/bottom 定位，dx 正值=向左移，dy 正值=向上移
      const minDx = -(window.innerWidth - 100);   // 最多向右移（面板左边不超出视口）
      const maxDx = window.innerWidth - 100;       // 最多向左移（面板右边不超出视口）
      const minDy = -(window.innerHeight - 80);    // 最多向下移（面板顶部不超出视口）
      const maxDy = window.innerHeight - 80;        // 最多向上移（面板底部不超出视口）
      const clampedDx = Math.min(Math.max(rawDx, minDx), maxDx);
      const clampedDy = Math.min(Math.max(rawDy, minDy), maxDy);
      setOffset({ dx: clampedDx, dy: clampedDy });
    };
    const stop = () => setDragging(false);
    // ★ 一律用 Pointer Events，不用 mousemove/touchmove。
    //   踩过的坑：检修闯关页的球压在 Godot iframe 上，指针一旦划进 iframe，
    //   父 window 的 mousemove 直接断流（iframe 是独立 document，事件不冒上来），
    //   表现为"拖两下就卡住"。配合 onPointerDown 里的 setPointerCapture，
    //   后续 pointermove 会被强制重定向到发起拖拽的元素，跨 iframe 也不丢。
    const handlePointer = (e: PointerEvent) => onMove(e.clientX, e.clientY);
    window.addEventListener('pointermove', handlePointer);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', handlePointer);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    chat.sendMessage(text);
  };

  const handleMic = () => {
    chat.toggleVoiceRecording((text) => {
      setInputText((prev) => (prev ? `${prev} ${text}` : text));
    });
  };

  return (
    <>
      {/* ---------- 悬浮球（同时也是可拖动的锚点） ---------- */}
      {!chat.panelOpen && (
        <button
          data-onboarding="ai-ball"
          onClick={() => {
            // 拖过了就不算点击：避免「想拖结果只挪了 1px 却把面板打开」
            if (dragMovedRef.current) return;
            chat.openPanel();
          }}
          onPointerDown={(e) => {
            // ★ 关键：捕获指针。iframe 是独立 document，指针划过它时父 window
            //   收不到任何 mouse/pointer 事件（拖拽会当场卡死）。setPointerCapture
            //   把后续 pointermove/pointerup 强制重定向到本按钮，跨 iframe 也不断流。
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 老浏览器没有 PointerCapture，退化成 window 监听 */
            }
            onDragStart(e.clientX, e.clientY);
          }}
          title="拖动可移动位置 · 点击打开 AI 专家智能中枢"
          className="fixed z-[9999] w-14 h-14 rounded-full bg-white/95 backdrop-blur-md border-2 border-amber-400/80 shadow-[0_4px_20px_rgba(245,158,11,0.25)] flex items-center justify-center cursor-pointer transition-all hover:scale-110 hover:shadow-[0_8px_30px_rgba(245,158,11,0.4)] p-0.5"
          style={{
            right: `calc(24px - ${offset.dx}px)`,
            bottom: `calc(24px - ${offset.dy}px)`,
            touchAction: 'none',
          }}
        >
          <MiniDigitalHuman isSpeaking={chat.isSpeaking} isListening={chat.isRecording} personaId={personaId} />
        </button>
      )}

      {/* ---------- 展开的悬浮卡片 ---------- */}
      {chat.panelOpen && (
        <div
          className="fixed z-[9999] flex flex-col rounded-lg shadow-2xl"
          style={{
            width: 'min(340px, 88vw)',
            height: 'auto',
            maxHeight: 'min(420px, 65vh)',
            right: `calc(24px - ${offset.dx}px)`,
            bottom: `calc(24px - ${offset.dy}px)`,
            borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(203, 213, 225, 0.6)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06)',
          }}
        >
          {/* 头部：数字人形象区（可拖拽） */}
          <div
            onPointerDown={(e) => {
              // 头部是拖拽区，但朗读/最小化/关闭三个按钮也挂在头部里。
              // 一旦对头部 setPointerCapture，后续 pointerup 与由它派生的 click
              // 都会被重定向到捕获元素（头部本身），按钮的 onClick 永远不触发 ——
              // 表现为「点关闭没反应」。指针落在按钮上时不启动拖拽、不捕获指针。
              if ((e.target as HTMLElement | null)?.closest('button')) return;
              // 同悬浮球：跨 iframe 拖拽必须捕获指针，否则划过 iframe 就断流
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* noop */
              }
              onDragStart(e.clientX, e.clientY);
            }}
            className="shrink-0 cursor-move select-none border-b border-slate-200/40"
            style={{ background: 'rgba(248, 250, 252, 0.7)', touchAction: 'none' }}
          >
            <div className="flex items-center gap-2.5 px-3 py-2">
              {/* 数字人头像 */}
              <div className="relative w-11 h-11 shrink-0">
                <div
                  className={`w-11 h-11 rounded-full overflow-hidden border ${
                    chat.isSpeaking
                      ? 'border-blue-500 shadow-sm'
                      : chat.isRecording
                      ? 'border-emerald-500'
                      : 'border-slate-200'
                  }`}
                >
                  <MiniDigitalHuman
                    isSpeaking={chat.isSpeaking}
                    isListening={chat.isRecording}
                    personaId={personaId}
                  />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs font-bold text-slate-800 truncate">{persona.name} · 智检安枢 AI 助手</span>
                </div>
                <p className="text-[10px] text-slate-500 truncate">{persona.roleTitle}</p>
                <p className="text-[10px] text-blue-600 truncate font-medium">
                  {chat.isStreaming
                    ? '正在思考并生成回答...'
                    : chat.isSpeaking
                    ? '语音播报中'
                    : '在线待命 · 随时提问'}
                </p>
              </div>

              {/* 操作按钮：朗读开关 / 最小化 / 关闭 */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={chat.toggleSpeech}
                  title={chat.speechEnabled ? '关闭语音朗读' : '开启语音朗读'}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    chat.speechEnabled
                      ? 'bg-blue-50 text-blue-600 border border-blue-200'
                      : 'bg-white text-slate-500 hover:text-slate-800 border border-slate-200'
                  }`}
                >
                  {chat.speechEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => chat.closePanel()}
                  title="最小化（收起为悬浮球）"
                  className="p-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 border border-slate-200 transition-colors cursor-pointer"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    chat.stopGeneration();
                    chat.stopSpeaking();
                    chat.closePanel();
                  }}
                  title="关闭面板"
                  className="p-1.5 rounded-lg bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* 消息流：内容少时按内容自适应紧凑无留白，消息多时限制最高 280px / 50vh 内部滚动 */}
          <div
            className="overflow-y-auto px-3 py-2 space-y-2"
            style={{
              maxHeight: 'min(280px, 50vh)',
            }}
          >
            {chat.messages.map((m) => {
              const isUser = m.sender === 'user';
              return (
                <div key={m.id} className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                  <div
                    className={`w-6 h-6 rounded-md shrink-0 flex items-center justify-center text-xs ${
                      isUser ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600 border border-blue-200'
                    }`}
                  >
                    {isUser ? <User className="w-3.5 h-3.5" /> : (
                      <span className="font-black leading-none text-[12px]" style={{ fontFamily: "'KaiTi','STKaiti','FangSong','SimSun',serif" }}>智</span>
                    )}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      isUser
                        ? 'bg-blue-600 text-white rounded-tr-none shadow-sm'
                        : 'bg-slate-50 border border-slate-200 text-slate-800 rounded-tl-none'
                    }`}
                  >
                    {isUser || m.streaming ? (
                      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{m.text}</pre>
                    ) : (
                      <Markdown content={m.text || ' '} tone="light" />
                    )}
                    {m.streaming && (
                      <span className="inline-block w-1.5 h-3 bg-blue-500 rounded-sm ml-0.5 align-text-bottom" />
                    )}
                    <div className={`text-[9px] mt-1 ${isUser ? 'text-blue-200 text-right' : 'text-slate-500'}`}>
                      {m.timestamp}
                    </div>
                  </div>
                </div>
              );
            })}

            {!chat.isStreaming && !chat.isLoading && chat.followups.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-8">
                {chat.followups.slice(0, 3).map((q, i) => (
                  <button
                    key={i}
                    onClick={() => chat.sendMessage(q)}
                    className="px-2 py-1 rounded-full bg-slate-100 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 text-[10px] text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 语音提示条 */}
          {chat.voiceNotice && (
            <div className="mx-3 mb-1.5 px-2.5 py-1.5 rounded-md bg-blue-50 border border-blue-200 text-[10px] text-blue-800 flex items-start justify-between gap-2">
              <span className="flex-1">{chat.voiceNotice}</span>
              <button onClick={() => chat.setVoiceNotice(null)} className="text-slate-500 hover:text-slate-600">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 输入区 */}
          <div className="shrink-0 border-t border-slate-200/50 px-3 py-2">
            <div className="flex items-end gap-2">
              <button
                onClick={handleMic}
                disabled={chat.isTranscribing || chat.isStreaming}
                title={chat.isRecording ? '点击结束录音并转写' : '点击开始语音输入'}
                className={`p-2 rounded-lg shrink-0 transition-all cursor-pointer ${
                  chat.isRecording
                    ? 'bg-rose-600 text-white'
                    : chat.isTranscribing
                    ? 'bg-blue-50 text-blue-600 border border-blue-200'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
                }`}
              >
                {chat.isTranscribing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>

              <textarea
                rows={2}
                value={inputText}
                disabled={chat.isStreaming}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  chat.isStreaming
                    ? 'AI 正在生成回答...'
                    : chat.isRecording
                    ? `录音中 ${chat.recordingSeconds}s，点击麦克风结束`
                    : '描述故障现象或提问 (Enter 发送)'
                }
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:bg-white resize-none disabled:opacity-60"
              />

              {chat.isStreaming ? (
                <button
                  onClick={chat.stopGeneration}
                  className="p-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white shrink-0 cursor-pointer shadow-sm"
                  title="停止生成"
                >
                  <span className="block w-2.5 h-2.5 bg-white rounded-sm mx-auto" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim() || chat.isLoading}
                  className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white shrink-0 cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="发送"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AiAssistantPanel;
