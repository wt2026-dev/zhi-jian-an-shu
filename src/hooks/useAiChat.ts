import { useState, useRef, useEffect } from 'react';
import { aiApi, safeStorage } from '../api';

/** 会话消息结构（与 AI 助手页保持一致，保证同一会话数组可跨组件共享） */
export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  structuredData?: any;
  streaming?: boolean;
  chatId?: string;
}

const WELCOME = `你好，我是 **工业设备检修 AI 专家**。已连接工厂知识库与设备遥测中枢。

你可以向我询问：
- 离心泵、压缩机、减速箱等典型故障树与振动对中分析
- 现场 LOTO 能量隔离与高危作业票安全规范
- 根据轴温与电流遥测数据研判劣化趋势
- 设备外观或破损照片的视觉损伤识别要点`;

const MAX_CHAT_HISTORY = 12;

/**
 * 通用 AI 对话 Hook：会话请求 / 流式解析 / 上下文管理 / 语音转写 / 语音朗读
 * 全局悬浮面板与 AI 助手页共用同一实例，从而实现"同一会话数组"。
 * 本实现与 AiAssistantView.tsx 的内联 SSE 对话功能重叠；当前实际渲染的主用
 * 悬浮面板实现为 AiAssistantPanel（App.tsx 全局渲染），AI 助手页主用
 * AiAssistantView。修改 AI 对话逻辑时须两处同步，或后续版本迁移至单一实现。
 */
export function useAiChat(userRoleTitle?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-init',
      sender: 'assistant',
      text: WELCOME,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [followups, setFollowups] = useState<string[]>([]);
  const [loadingFollowups, setLoadingFollowups] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  // 流式渲染节流：增量先入 buffer，定时批量提交，避免每个 SSE chunk 触发一次全量渲染
  const streamBufferRef = useRef<string>('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------------- 语音播报 (Web Speech API) ---------------- */
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(
    () => safeStorage.getItem('ai_speech_enabled') !== 'false'
  );
  const [isSpeaking, setIsSpeaking] = useState(false);

  const speakText = (rawText: string) => {
    if (!speechEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const cleanText = rawText
        .replace(/[#*`_~>[\]()!-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanText) return;
      const excerpt = cleanText.length > 260 ? cleanText.slice(0, 260) + '...' : cleanText;
      const utterance = new SpeechSynthesisUtterance(excerpt);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } catch {
      setIsSpeaking(false);
    }
  };

  const toggleSpeech = () => {
    if (speechEnabled) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
      setSpeechEnabled(false);
      safeStorage.setItem('ai_speech_enabled', 'false');
    } else {
      setSpeechEnabled(true);
      safeStorage.setItem('ai_speech_enabled', 'true');
    }
  };

  const stopSpeaking = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  };

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /* ---------------- 追问建议 ---------------- */
  const loadFollowups = async (lastUserMessage: string, lastAiReply: string) => {
    if (!lastAiReply) return;
    setLoadingFollowups(true);
    try {
      const res = await aiApi.suggestFollowups({ lastUserMessage, lastAiReply });
      if (res?.success && res.suggestions?.length) setFollowups(res.suggestions);
    } catch {
      // 追问建议失败静默忽略
    } finally {
      setLoadingFollowups(false);
    }
  };

  /* ---------------- 发送消息（SSE 流式） ---------------- */
  const sendMessage = async (textInput?: string, overrideText?: string) => {
    const text = (overrideText ?? textInput ?? '').trim();
    if (!text || isLoading || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    };
    const aiMsgId = `ai-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: aiMsgId,
        sender: 'assistant',
        text: '',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        streaming: true,
      },
    ]);
    setFollowups([]);
    setIsLoading(true);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let replyText = '';
    let chatId = '';

    try {
      const token = safeStorage.getItem('auth_token');
      const res = await fetch('/api/v1/ai/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          userRole: userRoleTitle,
          history: messages.slice(-MAX_CHAT_HISTORY).map((m) => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text,
          })),
        }),
      });

      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try {
          msg = (await res.json()).error || msg;
        } catch {}
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.chatId) chatId = parsed.chatId;
            if (parsed.content) {
              replyText += parsed.content;
              streamBufferRef.current = replyText;
              if (flushTimerRef.current === null) {
                flushTimerRef.current = setTimeout(() => {
                  flushTimerRef.current = null;
                  const snapshot = streamBufferRef.current;
                  setMessages((prev) =>
                    prev.map((m) => (m.id === aiMsgId ? { ...m, text: snapshot } : m))
                  );
                }, 100);
              }
            }
            if (parsed.error) streamError = parsed.error;
          } catch {}
        }
      }

      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      if (streamError) {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, text: `⚠️ ${streamError}`, streaming: false } : m))
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, text: replyText || '(AI 未返回内容)', chatId, streaming: false } : m
          )
        );
        if (replyText) speakText(replyText);
        loadFollowups(text, replyText);
      }
    } catch (e: any) {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      const aborted = e?.name === 'AbortError';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                streaming: false,
                text: aborted
                  ? (m.text || '') + '\n\n_(已手动停止生成)_'
                  : `⚠️ AI 服务请求失败: ${e?.message || '网络异常'}。请检查后端 AI 服务配置后重试。`,
              }
            : m
        )
      );
      if (!aborted && replyText) loadFollowups(text, replyText);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    stopSpeaking();
  };

  /** 重新生成：以该条 AI 消息之前最近的用户消息重发 */
  const regenerate = (aiMsgId: string) => {
    if (isStreaming || isLoading) return;
    const idx = messages.findIndex((m) => m.id === aiMsgId);
    if (idx <= 0) return;
    let userText = '';
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].sender === 'user') {
        userText = messages[i].text;
        break;
      }
    }
    if (!userText) return;
    setMessages((prev) => prev.slice(0, Math.max(0, idx - 1)));
    setTimeout(() => sendMessage(userText), 50);
  };

  /* ---------------- 语音输入 (MediaRecorder → Paraformer) ---------------- */
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let timer: any;
    if (isRecording) timer = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    else setRecordingSeconds(0);
    return () => clearInterval(timer);
  }, [isRecording]);

  /** 录音结束后由回调把识别文本返回给调用方（用于填充输入框） */
  const startVoiceRecording = async (onTranscribed?: (text: string) => void) => {
    if (isRecording) return;
    setVoiceNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsTranscribing(true);
        setVoiceNotice('语音已捕获，正在调用阿里云 DashScope Paraformer-v1 进行工业专有名词转写...');
        try {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64Audio = (reader.result as string).split(',')[1];
            const res = await aiApi.speechToText({
              audioBase64: base64Audio,
              mimeType: 'audio/webm',
              durationSeconds: recordingSeconds,
            });
            if (res && res.text) {
              onTranscribed?.(res.text);
              setVoiceNotice(
                `✅ ${res.engine || 'DashScope Paraformer'} 语音识别成功 (置信度: ${Math.round(
                  (res.confidence || 0.96) * 100
                )}%)`
              );
            } else if (res && res.message) {
              setVoiceNotice(`⚠️ ${res.message}`);
            } else {
              setVoiceNotice('⚠️ 语音转写服务未返回文本，请改用键盘输入。');
            }
            setIsTranscribing(false);
          };
          reader.readAsDataURL(audioBlob);
        } catch {
          setVoiceNotice('Paraformer 语音转文字请求异常，请改用键盘输入。');
          setIsTranscribing(false);
        }
      };

      recorder.start(250);
      setIsRecording(true);
    } catch {
      setVoiceNotice('提示: 浏览器麦克风未授权或不可用，请改用键盘输入。');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const toggleVoiceRecording = async (onTranscribed?: (text: string) => void) => {
    if (isRecording) stopVoiceRecording();
    else await startVoiceRecording(onTranscribed);
  };

  const resetSession = () => {
    stopSpeaking();
    setMessages([
      {
        id: 'm-init',
        sender: 'assistant',
        text: WELCOME,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      },
    ]);
    setFollowups([]);
  };

  return {
    messages,
    setMessages,
    isLoading,
    isStreaming,
    followups,
    loadingFollowups,
    sendMessage,
    stopGeneration,
    regenerate,
    resetSession,
    // 语音播报
    speechEnabled,
    isSpeaking,
    toggleSpeech,
    stopSpeaking,
    speakText,
    // 语音输入
    isRecording,
    recordingSeconds,
    isTranscribing,
    voiceNotice,
    setVoiceNotice,
    startVoiceRecording,
    stopVoiceRecording,
    toggleVoiceRecording,
  };
}

export type AiChatApi = ReturnType<typeof useAiChat>;
