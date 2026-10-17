import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Mic, Send, Volume2, VolumeX, Minus, X, Loader2, Bot, User } from 'lucide-react';
import { useAiChatContext } from '../context/AiChatContext';
import { Markdown } from './ai/Markdown';
import { DIGITAL_PERSONAS } from './DigitalHumanAvatar';

/** 面板头部数字人形象区使用的迷你头像（说话时嘴型动效，复用数字人形象配置） */
const MiniDigitalHuman: React.FC<{
  isSpeaking: boolean;
  isListening: boolean;
  personaId: string;
}> = ({ isSpeaking, isListening, personaId }) => {
  const persona = DIGITAL_PERSONAS.find((p) => p.id === personaId) || DIGITAL_PERSONAS[0];
  const theme = persona.themeColor;
  return (
    <svg className="w-full h-full" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="58" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="2" />
      {/* 安全帽 */}
      <ellipse cx="60" cy="36" rx="33" ry="17" fill={theme} />
      <path d="M27 38 C27 23, 93 23, 93 38 Z" fill={theme} opacity="0.8" />
      <rect x="52" y="25" width="16" height="5" rx="2" fill="#ef4444" />
      {/* 面部 */}
      <rect x="39" y="38" width="42" height="40" rx="14" fill="#fcd34d" />
      <circle cx="45" cy="57" r="3.5" fill="#f87171" opacity={isSpeaking ? 0.65 : 0.3} />
      <circle cx="75" cy="57" r="3.5" fill="#f87171" opacity={isSpeaking ? 0.65 : 0.3} />
      {/* 眼睛 */}
      <ellipse cx="49" cy="51" rx="3.6" ry="4.6" fill="#0f172a" />
      <ellipse cx="71" cy="51" rx="3.6" ry="4.6" fill="#0f172a" />
      <circle cx="50" cy="49" r="1.3" fill="#ffffff" />
      <circle cx="72" cy="49" r="1.3" fill="#ffffff" />
      {/* 眉毛 */}
      <path d="M44 44 Q49 42 54 44" stroke="#78350f" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M66 44 Q71 42 76 44" stroke="#78350f" strokeWidth="2.2" strokeLinecap="round" />
      {/* 嘴型：说话时张合 */}
      {isSpeaking ? (
        <ellipse cx="60" cy="67" rx="6" ry="5.2" fill="#b91c1c">
          <animate attributeName="ry" values="2;5.6;2" dur="0.75s" repeatCount="indefinite" />
        </ellipse>
      ) : (
        <path d="M54 66 Q60 70 66 66" stroke="#92400e" strokeWidth="2" strokeLinecap="round" />
      )}
      {/* 工装 */}
      <path d="M28 82 C40 76, 80 76, 92 82 L100 120 L20 120 Z" fill="#2563eb" />
      <path d="M50 80 L60 90 L70 80" fill={theme} />
      <path d="M22 96 L98 96" stroke="#22c55e" strokeWidth="3.5" />
      {/* 拾音提示环 */}
      {isListening && <circle cx="60" cy="60" r="54" stroke="#10b981" strokeWidth="3" fill="none" opacity="0.8" />}
    </svg>
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
  // 点击 vs 拖拽的分流：mousedown→mousemove 累计位移超过 4px 时视为拖拽，
  // 避免「按了想拖、没拖动却误触展开」；也避免「想点却拖动一点距离、不展开」。
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
      // 累计位移阈值：4px 算"真在拖"，避免点击和拖拽互相干扰
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
      {/* ---------- 悬浮球（也是可拖动的锚点） ---------- */}
      {!chat.panelOpen && (
        <button
          data-onboarding="ai-ball"
          onClick={() => {
            // 拖过了就不算点击：避免「想拖结果只挪了 1px 反而把面板打开」
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
          title="拖动可移动位置 · 点击打开 AI 数字人助手"
          // 用 inline style 而不是 className 的 bottom-6 right-6：拖动后要跟 panel 共用同一份偏移
          className="fixed z-[9999] w-14 h-14 rounded-full bg-white border border-blue-200 shadow-md flex items-center justify-center cursor-pointer transition-all hover:scale-105 hover:shadow-lg p-1"
          style={{
            right: `calc(24px - ${offset.dx}px)`,
            bottom: `calc(24px - ${offset.dy}px)`,
            touchAction: 'none', // 阻止触摸滚动抢手势
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
              // 同悬浮球：跨 iframe 拖拽必须捕获指针，否则划过 iframe 就断流
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* noop */
              }
              onDragStart(e.clientX, e.clientY);
            }}
            className="shrink-0 cursor-move select-none border-b border-slate-200/40"
            style={{ background: 'rgba(248, 250, 252, 0.7)' }}
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
                    {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
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
                      <Markdown content={m.text || ' '} />
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
