import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Wrench,
  Camera,
  Mic,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Bot,
  User,
  HelpCircle,
  X,
  Star,
  BookOpen,
  FileCheck,
  Loader2,
} from 'lucide-react';
import { Equipment, UserProfile, WorkOrder } from '../types';
import {
  DiagnosisPanel,
  VisionPanel,
} from './ai/AiModePanels';
import { aiApi, knowledgeApi, safeStorage } from '../api';
import { Markdown } from './ai/Markdown';
import { DigitalHumanAvatar, DigitalHumanAvatarHandle } from './DigitalHumanAvatar';
import { useAiChatContext } from '../context/AiChatContext';
import { useToast } from '../context/ToastContext';

/**
 * 本组件与 useAiChat.ts + AiAssistantPanel 的 AI 对话实现功能重叠；当前实际渲染的
 * 主用页面实现为 AiAssistantView（App.tsx 在 activeTab === 'ai_assistant' 时渲染）。
 * AiAssistantPanel 仍会全局渲染并使用 Hook 实现；修改 AI 对话逻辑时须两处同步，
 * 或后续版本迁移至单一实现。
 */
const MAX_CHAT_HISTORY = 12;

interface AiAssistantViewProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  prefilledEquipment?: Equipment | null;
  prefilledQuery?: string | null;
  onCreateWorkOrderFromAi: (title: string, equipmentName: string, description: string) => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  structuredData?: any;
  streaming?: boolean;
  chatId?: string;
  modelName?: string;
  kind?: 'normal' | 'error';
}

const WELCOME_PROMPTS = [
  '离心泵、压缩机、减速箱等典型故障树与振动对中分析',
  '现场 LOTO 能量隔离与高危作业票安全规范',
  '根据轴温与电流遥测数据研判劣化趋势',
  '设备外观或破损照片的视觉损伤识别要点',
];

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
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  // 功能②：知识自进化贡献推荐卡片状态
  const [contributionSuggestion, setContributionSuggestion] = useState<{
    id?: string;
    chatId?: string;
    title: string;
    type: string;
    equipment: string;
    summary: string;
    solution: string;
  } | null>(null);
  const [isSubmittingContribution, setIsSubmittingContribution] = useState(false);
  const [contributionNotice, setContributionNotice] = useState<string | null>(null);

  // 数字人语音播报状态：复用共享会话上下文（开关与朗读状态全局一致）
  const speechEnabled = chat.speechEnabled;
  const isSpeaking = chat.isSpeaking;
  const setIsSpeaking = chat.setIsSpeaking;
  const handleToggleSpeech = chat.toggleSpeech;
  const speakText = chat.speakText;
  const stopSpeaking = chat.stopSpeaking;

  // 专家纠错与反馈标准弹窗状态 (替代原有 window.prompt)
  const [feedbackModal, setFeedbackModal] = useState<{
    isOpen: boolean;
    message: ChatMessage | null;
    userQuery: string;
    correction: string;
    rating: number;
    submitting: boolean;
    error: string | null;
  }>({
    isOpen: false,
    message: null,
    userQuery: '',
    correction: '',
    rating: 1,
    submitting: false,
    error: null,
  });

  const handleOpenFeedbackModal = (m: ChatMessage) => {
    const idx = messages.findIndex((item) => item.id === m.id);
    let userQuery = '';
    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].sender === 'user') {
          userQuery = messages[i].text;
          break;
        }
      }
    }
    setFeedbackModal({
      isOpen: true,
      message: m,
      userQuery,
      correction: '',
      rating: 1,
      submitting: false,
      error: null,
    });
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackModal.message || !feedbackModal.correction.trim()) {
      setFeedbackModal((prev) => ({ ...prev, error: '请填写纠错说明或专家修正意见' }));
      return;
    }
    setFeedbackModal((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      await aiApi.submitFeedback({
        chatId: feedbackModal.message.chatId || feedbackModal.message.id,
        user_correction: feedbackModal.correction,
        corrected_content: feedbackModal.correction,
        model_response: feedbackModal.message.text,
        device_id: prefilledEquipment?.id,
      });
      setFeedbackNotice('专家纠错已成功提交，已录入知识沉淀与审核队列！');
      setTimeout(() => setFeedbackNotice(null), 4000);
      setFeedbackModal((prev) => ({ ...prev, isOpen: false }));
    } catch (e: any) {
      setFeedbackModal((prev) => ({ ...prev, submitting: false, error: e?.message || '提交纠错失败' }));
    }
  };

  // 热点规程推荐：从知识库真实数据随机抽取 (非硬编码)
  const [hotPrompts, setHotPrompts] = useState<{ title: string; question: string }[]>([]);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // 挂载时从知识库随机抽取 4 条真实规程标题作为热点推荐
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await knowledgeApi.list();
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          const picked = [...list].sort(() => Math.random() - 0.5).slice(0, 4);
          setHotPrompts(picked.map((k: any) => ({
            title: k.title,
            question: `请结合《${k.title}》规程要点，说明其在现场检修中如何应用？`,
          })));
        }
      } catch {
        // 知识库拉取失败时不展示热点推荐 (不使用硬编码兜底)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Diagnosis Wizard State
  const [diagEqId, setDiagEqId] = useState<string>(
    prefilledEquipment?.id || equipments[0]?.id || ''
  );
  const [diagSymptoms, setDiagSymptoms] = useState('机组带载运行时轴承座伴随规律性低频轰鸣与剧烈振动');
  const [diagCategory, setDiagCategory] = useState('泵类设备');
  const [diagResult, setDiagResult] = useState<any | null>(null);
  const [diagSafetyNotice, setDiagSafetyNotice] = useState<any | null>(null);
  const [diagTraceability, setDiagTraceability] = useState<any | null>(null);
  const [diagSafetyConfirmed, setDiagSafetyConfirmed] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);

  // Vision Defect State
  const [selectedSampleImage, setSelectedSampleImage] = useState<string>('bearing_pitting');
  const [customImageBase64, setCustomImageBase64] = useState<string | null>(null);
  const [customImagePreview, setCustomImagePreview] = useState<string | null>(null);
  const [uploadedImageInfo, setUploadedImageInfo] = useState<{ url: string; filename: string; size: number } | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [visionPrompt, setVisionPrompt] = useState('请分析此轴承滚动体损伤类型、严重程度、失效机理及检修建议');
  const [visionResult, setVisionResult] = useState<any | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false);
  // 功能④：多模态相似案例检索状态
  const [isSearchingMultimodal, setIsSearchingMultimodal] = useState(false);
  const [multimodalCases, setMultimodalCases] = useState<Array<{
    id: string;
    title: string;
    category: string;
    targetEquipment?: string;
    summary: string;
    content: string;
  }> | null>(null);
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [multimodalVisionDesc, setMultimodalVisionDesc] = useState<string | null>(null);
  const [multimodalSafetyHint, setMultimodalSafetyHint] = useState<string | null>(null);

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
          history: messages.slice(-MAX_CHAT_HISTORY).map((m) => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text,
          })),
        }),
      });

      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError: string | null = null;
      let modelName: string | undefined;

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
            if (parsed.model) modelName = parsed.model;
            if (parsed.content) {
              replyText += parsed.content;
              streamBufferRef.current = replyText;
              // 60ms 节流批量提交，渲染频率与 SSE chunk 频率解耦
              if (streamFlushTimerRef.current === null) {
                streamFlushTimerRef.current = setTimeout(() => {
                  streamFlushTimerRef.current = null;
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
            // 3D 路径的 speak() 返回 false 表示"没发出声音"，此时必须兜底朗读，
            // 否则会出现"口型在动但完全没声音"的静默失败。
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
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                kind: aborted ? 'normal' : 'error',
                text: aborted ? (replyText ? `${replyText}\n\n*[生成已中止]*` : '*(已停止生成)*') : `⚠️ 请求失败: ${e?.message || '网络异常'}`,
                streaming: false,
              }
            : m
        )
      );
      if (!aborted && replyText) {
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

  // 功能②：知识贡献识别（对话结束后判断是否沉淀为知识案例）
  const checkKnowledgeContribution = async (lastUserMessage: string, lastAiReply: string) => {
    if (!lastAiReply || lastAiReply.length < 25) return;
    try {
      const currentEqName = equipments.find((e) => e.id === diagEqId)?.name || undefined;
      const res = await aiApi.suggestContribution({
        lastUserMessage,
        lastAiReply,
        equipment: currentEqName,
      });
      if (res.success && res.suggestion?.worthContributing) {
        setContributionSuggestion(res.suggestion);
      }
    } catch {
      // 建议识别失败静默忽略
    }
  };

  const handleSubmitContribution = async () => {
    if (!contributionSuggestion) return;
    setIsSubmittingContribution(true);
    try {
      const res = await aiApi.submitContribution({
        id: contributionSuggestion.id,
        chatId: contributionSuggestion.chatId,
        title: contributionSuggestion.title,
        type: contributionSuggestion.type,
        equipment: contributionSuggestion.equipment,
        summary: contributionSuggestion.summary,
        solution: contributionSuggestion.solution,
      });
      if (res.success) {
        setContributionNotice('已提交，待知识管理员审核');
        setTimeout(() => {
          setContributionSuggestion(null);
          setContributionNotice(null);
        }, 2500);
      }
    } catch (e: any) {
      showToast({ type: 'error', title: '提交知识沉淀失败', message: e.message || '网络异常' });
    } finally {
      setIsSubmittingContribution(false);
    }
  };

  // 功能④：多模态相似案例检索 (看图检索知识库相似案例)
  const handleRunMultimodalSearch = async () => {
    if (!customImageBase64 && !customImagePreview) {
      showToast({ type: 'warning', title: '请先上传图片', message: '请先上传或选择待检索的设备现场图片' });
      return;
    }
    setIsSearchingMultimodal(true);
    setMultimodalCases(null);
    try {
      const res = await aiApi.multimodalSearch({
        imageBase64: customImageBase64 || '',
        userText: visionPrompt || visionResult?.defectType || '',
      });
      if (res.success) {
        setMultimodalVisionDesc(res.visionDescription || null);
        setMultimodalSafetyHint(res.safetyHint || null);
        setMultimodalCases(res.cases || []);
      } else {
        showToast({ type: 'warning', title: '多模态检索未返回有效案例', message: '未找到匹配的相似案例' });
      }
    } catch (e: any) {
      showToast({ type: 'error', title: '多模态检索失败', message: e.message || '网络异常' });
    } finally {
      setIsSearchingMultimodal(false);
    }
  };

  const handleRunDiagnosis = async () => {
    setIsDiagnosing(true);
    setDiagResult(null);
    setDiagSafetyNotice(null);
    setDiagTraceability(null);
    setDiagSafetyConfirmed(false);
    setDiagError(null);

    const targetEq = equipments.find((e) => e.id === diagEqId) || equipments[0];

    try {
      const res = await fetch('/api/v1/ai/diagnose', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          equipmentName: targetEq.name,
          equipmentCode: targetEq.code,
          category: diagCategory,
          symptoms: diagSymptoms,
          telemetry: targetEq.telemetry,
        }),
      });

      const data = await res.json();
      if (data.success && data.diagnosis) {
        setDiagResult(data.diagnosis);
        setDiagSafetyNotice(data.safetyNotice || null);
        setDiagTraceability(data.traceability || null);
        setDiagSafetyConfirmed(false);
      } else {
        throw new Error(data?.error || 'AI 诊断服务未返回有效结论');
      }
    } catch (e: any) {
      // 绝不本地伪造诊断结论兜底，失败必须明确提示用户
      setDiagError(e?.message || 'AI 多维诊断请求失败，请稍后重试');
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingImage(true);
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setCustomImageBase64(base64);
      setCustomImagePreview(dataUrl);

      try {
        const uploadRes = await aiApi.uploadImage(base64, file.name);
        if (uploadRes && uploadRes.success) {
          setUploadedImageInfo({
            url: uploadRes.url,
            filename: uploadRes.filename,
            size: uploadRes.size,
          });
        }
      } catch (err: any) {
        console.warn('Image upload backend error:', err);
        setUploadError(err.message || '图片上传至服务器失败');
      } finally {
        setIsUploadingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRunVisionAnalysis = async () => {
    setIsVisionAnalyzing(true);
    setVisionResult(null);
    setVisionError(null);

    try {
      const res = await aiApi.detectVisionDefects({
        imageBase64: customImageBase64 || '',
        imageUrl: uploadedImageInfo?.url,
        promptText: visionPrompt,
        equipmentType: diagCategory,
      });

      if (res && res.defectResult) {
        setVisionResult({
          ...res.defectResult,
          modelEngine: res.modelEngine,
          rawAnalysis: res.rawAnalysis,
        });
      } else {
        throw new Error('未获取到结构化判损分析');
      }
    } catch (e: any) {
      setVisionError(e?.message || '未获取到结构化判损分析');
      setVisionResult(null);
    } finally {
      setIsVisionAnalyzing(false);
    }
  };

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldModeRef = useRef(false);

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
        } catch (err: any) {
          console.error('ASR error:', err);
          setVoiceNotice('Paraformer 语音转文字请求异常，已切换为工业知识库容错识别');
          setIsTranscribing(false);
        }
      };

      recorder.start(250);
      setIsRecording(true);
    } catch (err: any) {
      console.warn('Microphone permission blocked or unavailable:', err);
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <Sparkles className="w-5 h-5 mr-2 text-blue-600" />
            智检安枢 · 工业检修AI助手
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center text-slate-700 font-medium">
              当前应答引擎：<span className="text-blue-600 font-mono font-semibold ml-0.5">{latestAiModel || '未连接'}</span>
            </span>
            <span className="text-slate-300">·</span>
            <span>融合知识图谱、遥测时序、故障树专家模型与多模态工业视觉诊断能力</span>
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex rounded-lg bg-slate-100 p-1 border border-slate-200">
          <button
            onClick={() => setActiveMode('chat')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer ${
              activeMode === 'chat' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80 font-bold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>智能对话问答</span>
          </button>
          <button
            onClick={() => setActiveMode('diagnose')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer ${
              activeMode === 'diagnose' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80 font-bold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>故障诊断向导</span>
          </button>
          <button
            onClick={() => setActiveMode('vision')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer ${
              activeMode === 'vision' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80 font-bold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>视觉破损识别</span>
          </button>
        </div>
      </div>

      {/* MODE 1: CHAT EXPERT */}
      {activeMode === 'chat' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
          {/* Left 8 cols: Chat Box */}
          <div className="lg:col-span-8 h-full flex flex-col overflow-hidden lg:sticky lg:top-0 lg:self-start glass-card border border-slate-200/80 rounded-xl shadow-sm relative">
            {/* Messages Scroll Area（半透明放行背板，让钛晶网格透出来形成层次） */}
            <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3 bg-white/20">
              {messages.map((m) => {
                const isUser = m.sender === 'user';
                const isError = m.kind === 'error';
                return (
                  <div
                    key={m.id}
                    className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
                  >
                    {/* 头像区域：AI 侧楷体"智"金字+发光脉冲点，用户侧蓝青渐变+角色首字 */}
                    <div className="relative shrink-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center relative overflow-hidden ${
                          isUser
                            ? 'bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-sm flex-col'
                            : 'icon-tile-gold border border-amber-300/70 shadow-sm'
                        }`}
                      >
                        {!isUser && <span className="hud-halo opacity-60" />}
                        {isUser ? (
                          <>
                            <User className="w-4 h-4" />
                            <span className="text-[9px] leading-tight text-white/95 font-medium -mt-0.5">
                              {currentUser?.roleTitle ? currentUser.roleTitle.charAt(0) : '工'}
                            </span>
                          </>
                        ) : (
                          <span
                            className="font-black leading-none text-[18px] relative z-1"
                            style={{ fontFamily: "'KaiTi','STKaiti','FangSong','SimSun',serif" }}
                          >
                            智
                          </span>
                        )}
                      </div>
                      {!isUser && (m.streaming || (isSpeaking && !isUser && messages[messages.length - 1]?.id === m.id)) && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 ring-2 ring-white animate-pulse" />
                      )}
                    </div>

                    {/* 气泡区域：四角统一 20px 圆角与纵向间距 */}
                    <div
                      className={`max-w-[85%] px-4 py-3 text-xs leading-relaxed ${
                        isUser
                          ? 'bubble-frost-user space-y-2'
                          : isError
                          ? 'bg-rose-50/95 border border-rose-200 text-rose-900 rounded-[var(--radius-lg)] shadow-sm space-y-2'
                          : 'bubble-frost text-slate-800 space-y-2'
                      }`}
                    >
                      {/* 首条欢迎问候卡：2x2 交互引导块 */}
                      {m.id === 'm-init' ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-amber-200/40">
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-slate-800 text-sm">智检安枢 · 工业设备检修 AI 专家</span>
                              <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-medium">
                                专家中枢
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                知识库 · 已连接
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200/80">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                                设备遥测中枢 · 已连接
                              </span>
                            </div>
                          </div>
                          <p className="text-slate-600 text-xs">
                            你好，我是 <strong className="text-slate-800">智检安枢的工业设备检修 AI 专家</strong>。已连接工厂知识库与设备遥测中枢，您可以直接点击下方推荐场景发起研判或在底部自由提问：
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                            {WELCOME_PROMPTS.map((prompt, pIdx) => (
                              <button
                                key={pIdx}
                                onClick={() => handleSendMessage(prompt)}
                                disabled={isStreaming || isAiLoading}
                                className="chip-gold !whitespace-normal !h-auto text-left p-2.5 !rounded-xl flex items-start gap-2 hover:shadow-xs transition-all cursor-pointer disabled:opacity-50 text-xs leading-relaxed"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                <span className="text-slate-800 font-medium">{prompt}</span>
                              </button>
                            ))}
                          </div>
                          <div className="text-right pt-1">
                            <span className="text-[9px] text-slate-400">{m.timestamp}</span>
                          </div>
                        </div>
                      ) : isError ? (
                        /* 错误气泡：隔离于专家纠错队列之外，仅保留重新生成 */
                        <div className="space-y-2">
                          <div className="flex items-center space-x-1.5 text-rose-800 font-semibold">
                            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>请求未完成</span>
                          </div>
                          <p className="text-xs text-rose-700 leading-relaxed break-all font-mono">
                            {m.text}
                          </p>
                          <div className="flex items-center justify-between pt-1">
                            <button
                              onClick={() => handleRegenerate(m.id)}
                              disabled={isStreaming || isAiLoading}
                              className="text-[10px] px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              title="重新生成此回复"
                            >
                              重新生成
                            </button>
                            <span className="text-[9px] text-rose-400">{m.timestamp}</span>
                          </div>
                        </div>
                      ) : (
                        /* 常规文本气泡 */
                        <>
                          {isUser || m.streaming ? (
                            // 流式中的消息渲染纯文本 (避免每帧全量 Markdown 重解析导致内存/CPU 膨胀)，完成后一次性渲染 Markdown
                            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{m.text}</pre>
                          ) : (
                            <Markdown content={m.text || ' '} tone="light" />
                          )}
                          {m.streaming && (
                            <span className="inline-block w-1.5 h-3.5 bg-blue-600 animate-pulse rounded-xs ml-0.5 align-text-bottom" />
                          )}
                          <div className={`flex items-center ${isUser ? 'justify-end' : 'justify-between'} gap-2`}>
                            {!isUser && !m.streaming && m.text && (
                              <div className="flex items-center space-x-1.5 mt-1">
                                <button
                                  onClick={() => handleCopyMessage(m)}
                                  className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer"
                                  title="复制回复"
                                >
                                  {copiedMessageId === m.id ? '已复制' : '复制'}
                                </button>
                                <button
                                  onClick={() => handleRegenerate(m.id)}
                                  disabled={isStreaming || isAiLoading}
                                  className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                  title="重新生成此回复"
                                >
                                  重新生成
                                </button>
                                <button
                                  onClick={() => handleOpenFeedbackModal(m)}
                                  className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-colors cursor-pointer"
                                  title="对本条 AI 回复进行质量评分与专家纠错标注"
                                >
                                  标记/纠错
                                </button>
                              </div>
                            )}
                            <span
                              className={`text-[9px] block mt-1 ${
                                isUser ? 'text-blue-100 text-right' : 'text-slate-500'
                              }`}
                            >
                              {m.timestamp}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {isStreaming && (
                <div className="flex items-center space-x-2 px-2">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                  <span className="text-[11px] text-slate-500">正在生成... (可点击输入框右侧按钮停止)</span>
                </div>
              )}
              {feedbackNotice && <div className="text-[11px] text-emerald-700 font-medium pl-11">{feedbackNotice}</div>}
              {!isStreaming && !isAiLoading && followups.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pl-11">
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    你可能想追问：
                  </span>
                  {followups.map((q, qi) => (
                    <button
                      key={qi}
                      onClick={() => handleSendMessage(q)}
                      className="chip-gold fx-shimmer"
                    >
                      <Sparkles className="w-3 h-3 shrink-0 opacity-75" />
                      <span>{q}</span>
                    </button>
                  ))}
                  {loadingFollowups && <span className="text-[10px] text-slate-500 animate-pulse">追问生成中...</span>}
                </div>
              )}

              {/* 功能②：知识贡献识别推荐卡片 (明亮玻璃科技风) */}
              {!isStreaming && !isAiLoading && contributionSuggestion && (
                <div className="mx-2 my-2.5 p-3.5 rounded-xl bg-white/95 backdrop-blur-md border border-blue-200/90 shadow-sm space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="p-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                        <BookOpen className="w-3.5 h-3.5" />
                      </span>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900">
                          📝 本次排查值得沉淀为知识案例，是否提交？
                        </h4>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                            {contributionSuggestion.type || '故障案例'}
                          </span>
                          {contributionSuggestion.equipment && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                              {contributionSuggestion.equipment}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setContributionSuggestion(null)}
                      className="text-slate-500 hover:text-slate-600 text-xs px-1.5 py-0.5 rounded cursor-pointer"
                      title="忽略"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50/90 border border-slate-200/80 text-xs space-y-1">
                    <div className="font-semibold text-slate-800">
                      <span className="text-[11px] text-slate-500 mr-1.5">标题:</span>
                      <span>{contributionSuggestion.title}</span>
                    </div>
                    {contributionSuggestion.summary && (
                      <p className="text-slate-600 text-[11px] leading-relaxed">
                        <span className="text-slate-500 mr-1">摘要:</span>
                        {contributionSuggestion.summary}
                      </p>
                    )}
                    {contributionSuggestion.solution && (
                      <p className="text-slate-600 text-[11px] leading-relaxed">
                        <span className="text-slate-500 mr-1">处置要点:</span>
                        {contributionSuggestion.solution}
                      </p>
                    )}
                  </div>

                  {contributionNotice ? (
                    <div className="flex items-center space-x-1.5 text-xs text-emerald-700 font-semibold py-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>{contributionNotice}</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end space-x-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setContributionSuggestion(null)}
                        className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer transition-colors"
                      >
                        忽略
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitContribution}
                        disabled={isSubmittingContribution}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg flex items-center space-x-1.5 shadow-xs cursor-pointer transition-colors"
                      >
                        {isSubmittingContribution ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>提交中...</span>
                          </>
                        ) : (
                          <>
                            <FileCheck className="w-3.5 h-3.5" />
                            <span>提交</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Input Bar：拟物磨砂游戏化操作底栏 */}
            <div className="p-3 border-t border-amber-100/70 bg-gradient-to-b from-white/65 to-white/95 backdrop-blur-md space-y-2">
              {/* Voice Notice / Recording Animation */}
              {voiceNotice && (
                <div className="flex items-center justify-between px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-[11px] text-blue-700">
                  <span className="flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>{voiceNotice}</span>
                  </span>
                  <button onClick={() => setVoiceNotice(null)} className="text-slate-500 hover:text-slate-700 ml-2">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {isRecording && (
                <div className="flex items-center justify-between px-3 py-2 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs animate-in fade-in">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse"></span>
                    <span className="font-bold">现场麦克风实时录音中:</span>
                    <span className="font-mono text-rose-700 font-bold">00:{recordingSeconds.toString().padStart(2, '0')}</span>
                    {/* 金色/天青声波仪：与数字人剧场保持同一套律动 */}
                    <div className="flex items-end space-x-[3px] h-6 ml-2" aria-hidden="true">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <span key={i} className={`w-[3px] rounded-full wave-bar-${(i % 5) + 1}`} />
                      ))}
                    </div>
                  </div>
                  <span className="text-[11px] text-rose-600">点击下方麦克风结束并由 Paraformer 识别</span>
                </div>
              )}

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onMouseDown={() => {
                    isHoldModeRef.current = false;
                    holdTimerRef.current = setTimeout(() => {
                      isHoldModeRef.current = true;
                      startVoiceRecording();
                    }, 220);
                  }}
                  onMouseUp={() => {
                    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
                    if (isHoldModeRef.current) {
                      stopVoiceRecording();
                    }
                  }}
                  onTouchStart={() => {
                    isHoldModeRef.current = true;
                    startVoiceRecording();
                  }}
                  onTouchEnd={() => {
                    if (isHoldModeRef.current) {
                      stopVoiceRecording();
                    }
                  }}
                  onClick={() => {
                    if (!isHoldModeRef.current) {
                      handleToggleVoiceRecording();
                    }
                    isHoldModeRef.current = false;
                  }}
                  disabled={isTranscribing || isStreaming}
                  title={isRecording ? "松开完成 / 点击停止录音并转写" : "按住说话 / 点击对讲开启现场录音"}
                  className={`p-2.5 rounded-full transition-all cursor-pointer flex items-center justify-center shrink-0 select-none ${
                    isRecording
                      ? 'bg-rose-600 text-white animate-pulse shadow-sm ring-2 ring-rose-400'
                      : isTranscribing
                      ? 'bg-blue-100 text-blue-700 animate-spin'
                      : 'bg-white border border-slate-200 hover:border-amber-300 hover:bg-amber-50/70 text-slate-600 hover:text-amber-700 active:bg-rose-600 active:text-white active:border-rose-600'
                  }`}
                >
                  {isTranscribing ? <RefreshCw className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <textarea
                  rows={2}
                  disabled={isStreaming}
                  placeholder={
                    isStreaming
                      ? 'AI 正在流式生成回复，可点击右侧「停止生成」中断...'
                      : isRecording
                      ? `正在现场录音... (${recordingSeconds}s) 点击麦克风完成并调用 Paraformer 转写`
                      : isTranscribing
                      ? 'Paraformer-v1 语音识别模型解析转录中...'
                      : '输入故障现象、设备位号或规程问题 (Enter 发送 / Shift+Enter 换行)...'
                  }
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  className="flex-1 bg-white/70 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-800 placeholder-slate-400 focus:bg-white resize-none disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                />

                {isStreaming ? (
                  <button
                    onClick={handleStopGeneration}
                    className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    <span className="w-2.5 h-2.5 bg-white rounded-xs"></span>
                    <span>停止生成</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleSendMessage()}
                    disabled={!inputText.trim() || isAiLoading || isTranscribing}
                    className="px-4 py-2.5 rounded-full btn-gold text-xs font-semibold flex items-center space-x-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>发送</span>
                  </button>
                )}
              </div>

              {/* Quick Speech Phrases for Instant Testing */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] text-slate-500">
                <span className="flex items-center gap-1">
                  <Mic className="w-3 h-3 text-cyan-500" />
                  现场对讲语音快捷填入:
                </span>
                <button
                  type="button"
                  onClick={() => setInputText('2号循环泵轴承箱温度升至76度，出口压力表剧烈抖动，伴随金属干摩擦异响，请排查游隙')}
                  className="chip-cyan"
                >
                  泵轴温76°C抖动异响
                </button>
                <button
                  type="button"
                  onClick={() => setInputText('动力站MCC配电柜停电检修，动力电380V，请生成五步法LOTO挂牌上锁与能量隔离措施')}
                  className="chip-cyan"
                >
                  MCC停电LOTO上锁流程
                </button>
                <button
                  type="button"
                  onClick={() => setInputText('工业管线二道截止阀气割动火作业，属于二级高危作业，需要落实哪些防火监护措施')}
                  className="chip-cyan"
                >
                  管线动火作业票防火要求
                </button>
              </div>
            </div>
          </div>

          {/* Right 4 cols: Digital Human Avatar & Quick Knowledge Queries */}
          <div className="lg:col-span-4 h-full flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* 3D Digital Human Avatar with 2D Fallback */}
              <DigitalHumanAvatar
                ref={avatarRef}
                isSpeaking={isSpeaking}
                isListening={isRecording}
                speechEnabled={speechEnabled}
                onToggleSpeech={handleToggleSpeech}
                onSpeakingChange={setIsSpeaking}
                onSelectPrompt={(directive) => {
                  setInputText(directive);
                  handleSendMessage(directive);
                }}
              />

              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-xs">
                <h3 className="text-xs font-bold text-slate-800 flex items-center">
                  <HelpCircle className="w-4 h-4 mr-1.5 text-blue-600" />
                  热点检修与安全规程推荐
                </h3>
                <div className="space-y-2">
                  {hotPrompts.length === 0 ? (
                    <p className="text-[11px] text-slate-500 p-2">知识库规程加载中或暂无可推荐内容...</p>
                  ) : (
                    hotPrompts.map((k, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSendMessage(k.question)}
                        title={k.title}
                        className="w-full text-left p-2.5 rounded-lg bg-slate-50 hover:bg-blue-50 border border-slate-200 text-xs text-slate-700 hover:text-blue-700 transition-colors cursor-pointer leading-relaxed"
                      >
                        {k.title}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-4 text-xs space-y-2">
                <span className="font-bold text-blue-900 flex items-center">
                  <Mic className="w-4 h-4 mr-1.5 text-blue-600" />
                  现场语音转录开单功能
                </span>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  在现场佩戴防噪对讲耳机时，可长按麦克风语音描述现场故障，AI 自动清洗口语化噪音并结构化提取为工单要素。
                </p>
              </div>
            </div>
          </div>
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
              diagCategory={diagCategory}
              setDiagCategory={setDiagCategory}
              diagEqId={diagEqId}
              setDiagEqId={setDiagEqId}
              diagSymptoms={diagSymptoms}
              setDiagSymptoms={setDiagSymptoms}
              diagSafetyConfirmed={diagSafetyConfirmed}
              setDiagSafetyConfirmed={setDiagSafetyConfirmed}
              diagSafetyNotice={diagSafetyNotice}
              isDiagnosing={isDiagnosing}
              diagError={diagError}
              diagResult={diagResult}
              diagTraceability={diagTraceability}
              handleRunDiagnosis={handleRunDiagnosis}
              onCreateWorkOrderFromAi={onCreateWorkOrderFromAi}
            />
          )}

      {/* MODE 3: VISION DEFECT RECOGNITION */}
      {activeMode === 'vision' && (
        <VisionPanel
          activeMode={activeMode}
          diagCategory={diagCategory}
          uploadedImageInfo={uploadedImageInfo}
          customImagePreview={customImagePreview}
          uploadError={uploadError}
          isUploadingImage={isUploadingImage}
          handleFileUpload={handleFileUpload}
          visionPrompt={visionPrompt}
          setVisionPrompt={setVisionPrompt}
          isVisionAnalyzing={isVisionAnalyzing}
          handleRunVisionAnalysis={handleRunVisionAnalysis}
          visionError={visionError}
          visionResult={visionResult}
          multimodalVisionDesc={multimodalVisionDesc}
          multimodalSafetyHint={multimodalSafetyHint}
          multimodalCases={multimodalCases}
          expandedCaseId={expandedCaseId}
          setExpandedCaseId={setExpandedCaseId}
          isSearchingMultimodal={isSearchingMultimodal}
          handleRunMultimodalSearch={handleRunMultimodalSearch}
          onCreateWorkOrderFromAi={onCreateWorkOrderFromAi}
        />
      )}
        </div>
      )}

      {/* 专家纠错与反馈标准弹窗 (功能四/体验优化) */}
      {feedbackModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-lg max-w-xl w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg border border-amber-200">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">AI 回答专家纠错与知识沉淀标注</h3>
                  <p className="text-[11px] text-slate-500">纠错审核通过后将沉淀更新入知识库向量索引</p>
                </div>
              </div>
              <button
                onClick={() => setFeedbackModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-slate-500 hover:text-slate-600 p-1 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 原问题与原回复预览 */}
            <div className="space-y-2 text-xs">
              {feedbackModal.userQuery && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-medium block mb-0.5">用户原始提问:</span>
                  <p className="text-slate-800 line-clamp-2">{feedbackModal.userQuery}</p>
                </div>
              )}
              {feedbackModal.message && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-medium block mb-0.5">AI 原始回答摘要:</span>
                  <p className="text-slate-600 text-[11px] line-clamp-3 font-mono">{feedbackModal.message.text}</p>
                </div>
              )}
            </div>

            {/* 质量评分 */}
            <div>
              <label className="block text-xs text-slate-700 mb-1.5 font-medium">
                回复质量评分:
              </label>
              <div className="flex items-center space-x-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setFeedbackModal((prev) => ({ ...prev, rating: star }))}
                    className="p-1 cursor-pointer hover:scale-110 transition-transform"
                  >
                    <Star
                      className={`w-5 h-5 ${
                        star <= feedbackModal.rating ? 'fill-amber-500 text-amber-500' : 'text-slate-300'
                      }`}
                    />
                  </button>
                ))}
                <span className="text-xs text-slate-600 ml-2">
                  {feedbackModal.rating === 1
                    ? '严重错误 / 存在安全隐患'
                    : feedbackModal.rating === 2
                    ? '部分内容不准确'
                    : feedbackModal.rating === 3
                    ? '答案合格但不够完整'
                    : feedbackModal.rating === 4
                    ? '良好，仅需微调'
                    : '完全准确'}
                </span>
              </div>
            </div>

            {/* 专家修正内容 */}
            <div>
              <label className="block text-xs text-slate-700 mb-1.5 font-medium">
                专家正确答案 / 规程修正意见 *
              </label>
              <textarea
                rows={4}
                value={feedbackModal.correction}
                onChange={(e) => setFeedbackModal((prev) => ({ ...prev, correction: e.target.value }))}
                placeholder="例如：关于离心泵同轴度径向偏差，国家标准 GB 50275 要求控制在 ≤ 0.05mm 以内，而不是 0.15mm..."
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-sans"
              />
            </div>

            {feedbackModal.error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{feedbackModal.error}</span>
              </div>
            )}

            <div className="flex justify-end space-x-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setFeedbackModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmitFeedback}
                disabled={feedbackModal.submitting}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {feedbackModal.submitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>提交中...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>提交专家纠错标注</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
