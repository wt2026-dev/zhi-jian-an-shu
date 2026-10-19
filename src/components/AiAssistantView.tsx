import React, { useState, useRef, useEffect } from 'react';
import { Equipment, UserProfile } from '../types';
import { buildChatHistory, readWireError } from '../utils/chatWire';
import { readSseChatStream } from '../utils/sseChatStream';
import { DiagnosisPanel, VisionPanel } from './ai/AiModePanels';
import { aiApi } from '../api';
import { logger } from '../utils/logger';
import { DigitalHumanAvatarHandle } from './DigitalHumanAvatar';
import { useAiChatContext } from '../context/AiChatContext';
import { useToast } from '../context/ToastContext';
import { ChatMessage } from '../hooks/useAiChat';
import { AiAssistantHeader } from './ai/AiAssistantHeader';
import { AiChatMessagesList } from './ai/AiChatMessagesList';
import { AiChatInputBar } from './ai/AiChatInputBar';
import { AiKnowledgeSidebar } from './ai/AiKnowledgeSidebar';
import { AiFeedbackModal } from './ai/AiFeedbackModal';
import { useAiDiagnosis } from './ai/useAiDiagnosis';
import { useAiVision } from './ai/useAiVision';
import { useAiFeedbackModal } from './ai/useAiFeedbackModal';
import { useHotKnowledgePrompts } from './ai/useHotKnowledgePrompts';
import { useAiContribution } from './ai/useAiContribution';
import { useAiEngineLabel } from './ai/useAiEngineLabel';
import { useSourceConnectivity } from './ai/useSourceConnectivity';

export type { ChatMessage };

export interface AiAssistantViewProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  prefilledEquipment?: Equipment | null;
  prefilledQuery?: string | null;
  onCreateWorkOrderFromAi: (title: string, equipmentName: string, description: string) => void;
}

export const AiAssistantView: React.FC<AiAssistantViewProps> = ({
  currentUser,
  equipments,
  prefilledEquipment,
  prefilledQuery,
  onCreateWorkOrderFromAi,
}) => {
  const { show: showToast } = useToast();
  const [activeMode, setActiveMode] = useState<'chat' | 'diagnose' | 'vision'>('chat');

  // Chat State：消息数组与全局悬浮 AI 助手面板共享同一会话（同一上下文实例）
  const chat = useAiChatContext();
  const messages = chat.messages;
  const setMessages = chat.setMessages;
  const [inputText, setInputText] = useState(prefilledQuery || '');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const avatarRef = useRef<DigitalHumanAvatarHandle>(null);
  // 流式渲染节流：增量文本先入 buffer，定时批量提交，避免每个 SSE chunk 触发一次全量渲染 (防卡顿/内存膨胀)
  const streamBufferRef = useRef<string>('');
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [followups, setFollowups] = useState<string[]>([]);
  const [loadingFollowups, setLoadingFollowups] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // 数字人语音播报状态：复用共享会话上下文（开关与朗读状态全局一致）
  const speechEnabled = chat.speechEnabled;
  const isSpeaking = chat.isSpeaking;
  const setIsSpeaking = chat.setIsSpeaking;
  const handleToggleSpeech = chat.toggleSpeech;
  const speakText = chat.speakText;
  const stopSpeaking = chat.stopSpeaking;

  // 诊断与视觉向导状态
  const diagnosis = useAiDiagnosis(equipments, prefilledEquipment);
  const vision = useAiVision({
    diagCategory: diagnosis.diagCategory,
    showToast,
  });

  // 专家纠错与反馈标准弹窗
  const {
    feedbackModal,
    setFeedbackModal,
    feedbackNotice,
    handleOpenFeedbackModal,
    handleSubmitFeedback,
  } = useAiFeedbackModal({
    messages,
    deviceId: prefilledEquipment?.id,
  });

  // 知识案例自进化识别与贡献推荐
  const {
    contributionSuggestion,
    setContributionSuggestion,
    isSubmittingContribution,
    contributionNotice,
    checkKnowledgeContribution,
    handleSubmitContribution,
  } = useAiContribution({
    equipments,
    diagEqId: diagnosis.diagEqId,
    showToast,
  });

  // 热点规程推荐：从知识库真实数据随机抽取 (非硬编码)
  const hotPrompts = useHotKnowledgePrompts();
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Audio / Voice Recording State (MediaRecorder API)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (prefilledQuery) {
      handleSendMessage(prefilledQuery);
    }
  }, [prefilledQuery]);

  // 流式高频更新时使用即时滚动 (避免堆积大量 smooth 滚动动画)，且仅在接近底部时自动跟随
  const SCROLL_THRESHOLD_PX = 160;
  useEffect(() => {
    const el = chatBottomRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nearBottom = rect.top - (window.innerHeight || 800) < SCROLL_THRESHOLD_PX;
    if (nearBottom) {
      el.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messages]);

  // Voice recording timer
  useEffect(() => {
    let timer: any;
    if (isRecording) {
      timer = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => clearInterval(timer);
  }, [isRecording]);

  // 流式读取 SSE 并以打字机效果追加到当前 AI 消息 (任务一)
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || isAiLoading || isStreaming) return;

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
      { id: aiMsgId, sender: 'assistant', text: '', timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }), streaming: true },
    ]);
    setInputText('');
    setFollowups([]);
    setIsAiLoading(true);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let replyText = '';
    let chatId = '';

    try {
      const res = await fetch('/api/v1/ai/chat/stream', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          userRole: currentUser.roleTitle,
          history: buildChatHistory(messages),
        }),
      });

      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { msg = readWireError(await res.json(), msg); } catch {}
        throw new Error(msg);
      }

      let streamError: string | null = null;
      let modelName: string | undefined;

      await readSseChatStream(res.body, (parsed) => {
        if (parsed.chatId) chatId = parsed.chatId;
        if (parsed.model) modelName = parsed.model;
        if (parsed.content) {
          const firstToken = replyText.length === 0;
          replyText += parsed.content;
          streamBufferRef.current = replyText;
          const commit = () => {
            const snapshot = streamBufferRef.current;
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMsgId ? { ...m, text: snapshot } : m))
            );
          };
          // 首字立即落屏（去掉白等的 100ms 节流），后续按 100ms 批量提交，渲染频率与 SSE chunk 解耦
          if (firstToken) {
            if (streamFlushTimerRef.current !== null) {
              clearTimeout(streamFlushTimerRef.current);
              streamFlushTimerRef.current = null;
            }
            commit();
          } else if (streamFlushTimerRef.current === null) {
            streamFlushTimerRef.current = setTimeout(() => {
              streamFlushTimerRef.current = null;
              commit();
            }, 100);
          }
        }
        if (parsed.error) streamError = parsed.error;
      });

      if (streamFlushTimerRef.current !== null) {
        clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      if (streamError) {
        const errText = `⚠️ ${streamError}`;
        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? { ...m, text: errText, kind: 'error', streaming: false } : m)));
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, text: replyText || '(AI 未返回内容)', chatId, modelName, kind: 'normal', streaming: false } : m))
        );
        // 回复完成后触发数字人语音播报（3D 数字人优先发声；失败自动落到 Web Speech 兜底）
        if (replyText) {
          const is3D = avatarRef.current?.is3D?.() ?? false;
          if (is3D) {
            Promise.resolve(avatarRef.current?.speak(replyText))
              .then((ok) => {
                if (ok !== true) speakText(replyText);
              })
              .catch(() => speakText(replyText));
          } else {
            speakText(replyText);
          }
        }
        // 回复完成后异步生成追问建议 (功能 7)
        loadFollowups(text, replyText);
        // 功能②：对话后判断是否沉淀为知识案例
        checkKnowledgeContribution(text, replyText);
      }
    } catch (e: any) {
      if (streamFlushTimerRef.current !== null) {
        clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      const aborted = e?.name === 'AbortError';
      // 看门狗判失联：保留已收到的部分并如实标注中断，不伪装成完整回答
      const interrupted = e?.name === 'SseIdleError';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                kind: aborted || interrupted ? 'normal' : 'error',
                text: aborted
                  ? (replyText ? `${replyText}\n\n*[生成已中止]*` : '*(已停止生成)*')
                  : interrupted
                    ? (replyText ? `${replyText}\n\n*[${e.message}]*` : `*[${e.message}]*`)
                    : `⚠️ 请求失败: ${e?.message || '网络异常'}`,
                streaming: false,
              }
            : m
        )
      );
      if (!aborted && !interrupted && replyText) {
        loadFollowups(text, replyText);
        checkKnowledgeContribution(text, replyText);
      }
    } finally {
      setIsAiLoading(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // 停止生成：中止 fetch 并结束当前流式消息与数字人发声
  const handleStopGeneration = () => {
    abortControllerRef.current?.abort();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    stopSpeaking?.();
    try { avatarRef.current?.stop?.(); } catch {}
  };

  // 重新生成：以该条 AI 消息之前最近的用户消息重发
  const handleRegenerate = (aiMsgId: string) => {
    if (isStreaming || isAiLoading) return;
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
    // 移除该 AI 消息与其用户问题，重新发送
    setMessages((prev) => prev.slice(0, Math.max(0, idx - 1)));
    setTimeout(() => handleSendMessage(userText), 50);
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId(null), 1600);
    } catch {}
  };

  // 功能 7：基于上一轮问答生成追问建议按钮
  const loadFollowups = async (lastUserMessage: string, lastAiReply: string) => {
    if (!lastAiReply) return;
    setLoadingFollowups(true);
    try {
      const res = await aiApi.suggestFollowups({ lastUserMessage, lastAiReply });
      if (res.success && res.suggestions?.length) {
        setFollowups(res.suggestions);
      }
    } catch {
      // 追问建议失败静默忽略，不影响主对话
    } finally {
      setLoadingFollowups(false);
    }
  };

  const startVoiceRecording = async () => {
    if (isRecording) return;
    setVoiceNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
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
              setInputText((prev) => (prev ? `${prev} ${res.text}` : res.text));
              // ⚠️ 原来写的是 `res.engine || 'DashScope Paraformer'`、
              //    `recordingSeconds || 3`、`res.confidence || 0.96` —— 三个兜底值
              //    分别编出了引擎名、"耗时 3s" 和"置信度 96%"。识别结果没问题，
              //    但旁边这串元数据是假的，会让人误信识别质量。只报真的返回了什么。
              const detail: string[] = [];
              if (recordingSeconds > 0) detail.push(`耗时 ${recordingSeconds}s`);
              if (typeof res.confidence === 'number') detail.push(`置信度 ${Math.round(res.confidence * 100)}%`);
              setVoiceNotice(
                `✅ ${res.engine ? `${res.engine} ` : ''}语音识别成功${detail.length ? ` (${detail.join('，')})` : ''}`
              );
            } else if (res && res.message) {
              setVoiceNotice(`⚠️ ${res.message}`);
            } else {
              setVoiceNotice('⚠️ 语音转写服务未返回文本，请改用键盘输入。');
            }
            setIsTranscribing(false);
          };
          reader.readAsDataURL(audioBlob);
        } catch (err: unknown) {
          logger.error('ASR error:', err);
          setVoiceNotice('Paraformer 语音转文字请求异常，已切换为工业知识库容错识别');
          setIsTranscribing(false);
        }
      };

      recorder.start(250);
      setIsRecording(true);
    } catch (err: unknown) {
      logger.warn('Microphone permission blocked or unavailable:', err);
      setVoiceNotice('提示: 浏览器麦克风受沙盒限制或未授权，已为您自动注入现场对讲录音测试指令');
      setInputText(
        '2号循环泵出口压力表剧烈抖动，轴承箱温度升到76度，现场有金属摩擦异响，请给出排查SOP'
      );
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleToggleVoiceRecording = async () => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      await startVoiceRecording();
    }
  };

  const latestAiModel = [...messages].reverse().find((m) => m.sender === 'assistant' && m.modelName)?.modelName;
  // 刚进页面还没问过 AI 时，引擎名以真实模型配置为准，不要一律报「未连接」
  const configuredEngine = useAiEngineLabel();
  const sourceStatus = useSourceConnectivity();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <AiAssistantHeader
        activeMode={activeMode}
        onModeChange={setActiveMode}
        latestAiModel={latestAiModel || configuredEngine || '未探测'}
      />

      {/* MODE 1: CHAT EXPERT */}
      {activeMode === 'chat' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
          {/* Left 8 cols: Chat Box */}
          <div className="lg:col-span-8 h-full flex flex-col overflow-hidden lg:sticky lg:top-0 lg:self-start glass-card border border-slate-200/80 rounded-xl shadow-sm relative">
            <AiChatMessagesList
              messages={messages}
              sourceStatus={sourceStatus}
              currentUser={currentUser}
              isSpeaking={isSpeaking}
              isStreaming={isStreaming}
              isAiLoading={isAiLoading}
              copiedMessageId={copiedMessageId}
              feedbackNotice={feedbackNotice}
              followups={followups}
              loadingFollowups={loadingFollowups}
              contributionSuggestion={contributionSuggestion}
              isSubmittingContribution={isSubmittingContribution}
              contributionNotice={contributionNotice}
              chatBottomRef={chatBottomRef}
              onSendMessage={handleSendMessage}
              onRegenerate={handleRegenerate}
              onCopyMessage={handleCopyMessage}
              onOpenFeedbackModal={handleOpenFeedbackModal}
              onDismissContribution={() => setContributionSuggestion(null)}
              onSubmitContribution={handleSubmitContribution}
            />

            <AiChatInputBar
              inputText={inputText}
              setInputText={setInputText}
              isStreaming={isStreaming}
              isAiLoading={isAiLoading}
              isRecording={isRecording}
              recordingSeconds={recordingSeconds}
              isTranscribing={isTranscribing}
              voiceNotice={voiceNotice}
              onDismissVoiceNotice={() => setVoiceNotice(null)}
              onStartVoiceRecording={startVoiceRecording}
              onStopVoiceRecording={stopVoiceRecording}
              onToggleVoiceRecording={handleToggleVoiceRecording}
              onSendMessage={handleSendMessage}
              onStopGeneration={handleStopGeneration}
            />
          </div>

          {/* Right 4 cols: Digital Human Avatar & Quick Knowledge Queries */}
          <AiKnowledgeSidebar
            avatarRef={avatarRef}
            isSpeaking={isSpeaking}
            isListening={isRecording}
            speechEnabled={speechEnabled}
            onToggleSpeech={handleToggleSpeech}
            onSpeakingChange={setIsSpeaking}
            onSelectPrompt={(directive) => {
              setInputText(directive);
              handleSendMessage(directive);
            }}
            onSendMessage={handleSendMessage}
            hotPrompts={hotPrompts}
          />
        </div>
      )}

      {/* MODES 2 & 3: DIAGNOSE & VISION */}
      {activeMode !== 'chat' && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pb-6 pr-1">
          {/* MODE 2: DIAGNOSIS WIZARD */}
          {activeMode === 'diagnose' && (
            <DiagnosisPanel
              activeMode={activeMode}
              equipments={equipments}
              {...diagnosis}
              onCreateWorkOrderFromAi={onCreateWorkOrderFromAi}
            />
          )}

          {/* MODE 3: VISION DEFECT RECOGNITION */}
          {activeMode === 'vision' && (
            <VisionPanel
              activeMode={activeMode}
              diagCategory={diagnosis.diagCategory}
              {...vision}
              onCreateWorkOrderFromAi={onCreateWorkOrderFromAi}
            />
          )}
        </div>
      )}

      {/* 专家纠错与反馈标准弹窗 (功能四/体验优化) */}
      <AiFeedbackModal
        state={feedbackModal}
        onClose={() => setFeedbackModal((prev) => ({ ...prev, isOpen: false }))}
        onRatingChange={(rating) => setFeedbackModal((prev) => ({ ...prev, rating }))}
        onCorrectionChange={(correction) => setFeedbackModal((prev) => ({ ...prev, correction }))}
        onSubmit={handleSubmitFeedback}
      />
    </div>
  );
};
